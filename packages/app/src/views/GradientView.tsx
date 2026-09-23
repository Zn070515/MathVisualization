/**
 * A scalar field together with its numerical gradient.
 *
 * The arrows are computed from the same point evaluator as the surface and
 * contour views. They are deliberately drawn on the plane, where the gradient
 * is a tangent-plane object: at a regular point it points in the direction of
 * greatest increase and is perpendicular to the level curves behind it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  axisTicks,
  contourLines,
  cx,
  displayNumberToText,
  gradientAt,
  sampleSurface,
  type Gradient,
  type RealFieldEvaluator,
} from '@mathviz/mathcore';
import { drawGridAndAxes } from '../render/axes2d';
import { CANVAS_COLORS, prepareCanvas2d } from '../render/canvasSurface';
import { NumberText } from '../display/NumberText';
import { viewNumber } from '../display/numbers';
import { useStore } from '../state/store';
import {
  selectActiveExpression,
  type Viewport,
  type ViewRendererProps,
} from '../state/workspaceStore';
import { handleCameraKey } from './cameraKeys';
import { makePointEvaluation } from './evaluation';
import { useResizeVersion } from './useResizeVersion';
import { fromScreen, planeWindow, toScreen } from './window2d';

const CONTOUR_RESOLUTION = 65;
const ARROW_RESOLUTION = 17;

interface DragState {
  readonly originX: number;
  readonly originY: number;
  readonly lastX: number;
  readonly lastY: number;
}

interface GradientRange {
  readonly maxMagnitude: number;
  readonly maxError: number;
}

interface ArrowSample {
  readonly x: number;
  readonly y: number;
  readonly gradient: Gradient;
}

export function GradientView({ store }: ViewRendererProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resizeVersion = useResizeVersion(canvasRef);
  const dragging = useRef<DragState | null>(null);
  const [measured, setMeasured] = useState<GradientRange | null>(null);
  const state = useStore(store, (current) => current);
  const { workspace, focusedLineId } = state;
  const active = useMemo(
    () => selectActiveExpression(workspace, focusedLineId, store.drawableKinds),
    [workspace, focusedLineId, store.drawableKinds],
  );
  const evaluation = useMemo(
    () => makePointEvaluation(active, state.parameterValues, workspace.functions),
    [active, state.parameterValues, workspace.functions],
  );

  const drawable = useMemo(
    () =>
      active?.signature.domain.kind === 'R' &&
      active.signature.domain.dim === 2 &&
      active.signature.codomain.kind === 'R' &&
      active.signature.codomain.dim === 1,
    [active],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const surface = prepareCanvas2d(canvas);
    if (surface === null) return;
    const { context, width, height, ratio } = surface;
    const window = planeWindow(state.viewport, width, height);

    drawGridAndAxes(context, {
      window,
      width,
      height,
      ratio,
      xName: evaluation?.variableNames[0] ?? 'x',
      yName: evaluation?.variableNames[1] ?? 'y',
    });

    if (!drawable || evaluation === null) return;

    // Level curves are a reference frame for the vectors. Both are sampled
    // from this evaluator, so a contour and an arrow cannot disagree about f.
    const mesh = sampleSurface((x, y) => evaluation.evaluate(cx(x, y)), {
      xMin: window.xMin,
      xMax: window.xMax,
      yMin: window.yMin,
      yMax: window.yMax,
      columns: CONTOUR_RESOLUTION,
      rows: CONTOUR_RESOLUTION,
    });
    const levels = axisTicks(mesh.zMin, mesh.zMax, 8).major.map((tick) => tick.value);
    const lines = contourLines(mesh, levels);
    context.strokeStyle = 'rgba(25, 23, 20, 0.18)';
    context.lineWidth = Math.max(1, ratio * 0.9);
    for (const line of lines) {
      for (const path of line.paths) {
        if (path.points.length < 2) continue;
        context.beginPath();
        const first = toScreen(window, path.points[0] as { x: number; y: number }, width, height);
        context.moveTo(first.x, first.y);
        for (const point of path.points.slice(1)) {
          const at = toScreen(window, point, width, height);
          context.lineTo(at.x, at.y);
        }
        if (path.closed) context.closePath();
        context.stroke();
      }
    }

    const arrows = collectArrows((x, y) => evaluation.evaluate(cx(x, y)), window);
    const maxMagnitude = arrows.reduce(
      (maximum, arrow) => Math.max(maximum, Math.hypot(arrow.gradient.x, arrow.gradient.y)),
      0,
    );
    const maxError = arrows.reduce(
      (maximum, arrow) => Math.max(maximum, arrow.gradient.estimatedError),
      0,
    );
    setMeasured((previous) =>
      previous !== null &&
      previous.maxMagnitude === maxMagnitude &&
      previous.maxError === maxError
        ? previous
        : { maxMagnitude, maxError },
    );
    drawArrows(context, arrows, window, width, height, ratio, maxMagnitude);
  }, [drawable, evaluation, state.viewport]);

  useEffect(() => {
    draw();
  }, [draw, resizeVersion]);

  const toPlane = (event: { clientX: number; clientY: number }): ReturnType<typeof cx> | null => {
    const canvas = canvasRef.current;
    if (canvas === null) return null;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return null;
    const window = planeWindow(state.viewport, bounds.width, bounds.height);
    const point = fromScreen(
      window,
      { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      bounds.width,
      bounds.height,
    );
    return Number.isFinite(point.x) && Number.isFinite(point.y) ? cx(point.x, point.y) : null;
  };

  const cursorPoint = state.hover ?? state.selection;
  const cursorGradient = useMemo(() => {
    if (!drawable || evaluation === null || cursorPoint === null) return null;
    const result = gradientAt(
      (x, y) => evaluation.evaluate(cx(x, y)),
      cursorPoint.re,
      cursorPoint.im,
    );
    return result.ok ? result.value : null;
  }, [cursorPoint, drawable, evaluation]);
  const bounds = canvasRef.current?.getBoundingClientRect();
  const halfHeight =
    bounds === undefined || bounds.width === 0
      ? state.viewport.halfWidth
      : state.viewport.halfWidth * (bounds.height / bounds.width);

  return (
    <div className="view">
      <canvas
        ref={canvasRef}
        className="view__canvas view__canvas--paper"
        tabIndex={0}
        role="img"
        aria-label="Gradient vectors of a scalar field over the plane"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragging.current = {
            originX: event.clientX,
            originY: event.clientY,
            lastX: event.clientX,
            lastY: event.clientY,
          };
        }}
        onPointerMove={(event) => {
          const point = toPlane(event);
          store.setHover(point);
          const drag = dragging.current;
          if (drag === null || point === null) return;
          const canvas = canvasRef.current;
          if (canvas === null) return;
          const unitsPerPixel =
            (2 * state.viewport.halfWidth) / Math.max(1, canvas.getBoundingClientRect().width);
          store.panViewport(
            -(event.clientX - drag.lastX) * unitsPerPixel,
            (event.clientY - drag.lastY) * unitsPerPixel,
          );
          dragging.current = { ...drag, lastX: event.clientX, lastY: event.clientY };
        }}
        onPointerUp={(event) => {
          const drag = dragging.current;
          dragging.current = null;
          if (drag === null) return;
          const travelled =
            Math.abs(event.clientX - drag.originX) + Math.abs(event.clientY - drag.originY);
          if (travelled <= 3) store.setSelection(toPlane(event));
        }}
        onPointerLeave={() => {
          dragging.current = null;
          store.clearCursor();
        }}
        onWheel={(event) => {
          store.zoomViewport(Math.exp(event.deltaY * 0.0015), toPlane(event) ?? undefined);
        }}
        onKeyDown={(event) => {
          handleCameraKey(event, store);
        }}
      />

      {drawable && cursorPoint !== null && (
        <GradientCrosshair point={cursorPoint} viewport={state.viewport} halfHeight={halfHeight} />
      )}

      {drawable && cursorPoint !== null && cursorGradient !== null && (
        <div className="legend">
          <span className="legend__title">at the selected point</span>
          <span className="legend__range">
            ∇f = ({displayNumberToText(viewNumber(cursorGradient.x))},{' '}
            {displayNumberToText(viewNumber(cursorGradient.y))})
          </span>
          <span className="legend__range">
            |∇f| = <NumberText value={viewNumber(Math.hypot(cursorGradient.x, cursorGradient.y))} />
          </span>
        </div>
      )}

      {active === null && (
        <div className="view__overlay">
          <p>
            Nothing to draw yet. Write a scalar field such as{' '}
            <span className="view__mono">f(x,y)=x^2-y^2</span>.
          </p>
        </div>
      )}
      {active !== null && !drawable && (
        <div className="view__overlay">
          <p>
            Gradients need a real scalar field of two real variables, such as{' '}
            <span className="view__mono">f(x,y)=x^2-y^2</span>.
          </p>
        </div>
      )}

      {drawable && measured !== null && (
        <div className="legend legend--corner">
          <span className="legend__title">gradient field · ∇f</span>
          <span className="legend__range">
            max |∇f| ≈ <NumberText value={viewNumber(measured.maxMagnitude)} />
          </span>
          <span className="legend__range">arrows scaled for the current window · contours underneath</span>
          <span className="legend__range">
            sampling disagreement ≈ <NumberText value={viewNumber(measured.maxError)} />
          </span>
        </div>
      )}
    </div>
  );
}

function collectArrows(
  evaluate: RealFieldEvaluator,
  window: { readonly xMin: number; readonly xMax: number; readonly yMin: number; readonly yMax: number },
): readonly ArrowSample[] {
  const arrows: ArrowSample[] = [];
  for (let row = 0; row < ARROW_RESOLUTION; row += 1) {
    const y = interpolate(window.yMin, window.yMax, row / (ARROW_RESOLUTION - 1));
    for (let column = 0; column < ARROW_RESOLUTION; column += 1) {
      const x = interpolate(window.xMin, window.xMax, column / (ARROW_RESOLUTION - 1));
      const result = gradientAt(evaluate, x, y);
      if (result.ok && Number.isFinite(result.value.x) && Number.isFinite(result.value.y)) {
        arrows.push({ x, y, gradient: result.value });
      }
    }
  }
  return arrows;
}

function drawArrows(
  context: CanvasRenderingContext2D,
  arrows: readonly ArrowSample[],
  window: { readonly xMin: number; readonly xMax: number; readonly yMin: number; readonly yMax: number },
  width: number,
  height: number,
  ratio: number,
  maxMagnitude: number,
): void {
  const gridSpacing = Math.min(
    (window.xMax - window.xMin) / (ARROW_RESOLUTION - 1),
    (window.yMax - window.yMin) / (ARROW_RESOLUTION - 1),
  );
  const scale = maxMagnitude === 0 ? 0 : (0.34 * gridSpacing) / maxMagnitude;
  context.strokeStyle = CANVAS_COLORS.curveSecondary;
  context.fillStyle = CANVAS_COLORS.curveSecondary;
  context.lineWidth = Math.max(1, ratio * 1.1);

  for (const arrow of arrows) {
    const start = toScreen(window, arrow, width, height);
    const end = toScreen(
      window,
      { x: arrow.x + arrow.gradient.x * scale, y: arrow.y + arrow.gradient.y * scale },
      width,
      height,
    );
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 1) continue;
    const head = Math.min(5 * ratio, length * 0.45);
    const angle = Math.atan2(dy, dx);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.moveTo(end.x, end.y);
    context.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
    context.moveTo(end.x, end.y);
    context.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
    context.stroke();
  }
}

function interpolate(minimum: number, maximum: number, fraction: number): number {
  return minimum + (maximum - minimum) * fraction;
}

function GradientCrosshair({
  point,
  viewport,
  halfHeight,
}: {
  readonly point: ReturnType<typeof cx>;
  readonly viewport: Viewport;
  readonly halfHeight: number;
}): React.JSX.Element | null {
  const left = 50 + ((point.re - viewport.centre.re) / (2 * viewport.halfWidth)) * 100;
  const top = 50 - ((point.im - viewport.centre.im) / (2 * halfHeight)) * 100;
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  return <div className="crosshair" style={{ left: `${left}%`, top: `${top}%` }} aria-hidden="true" />;
}
