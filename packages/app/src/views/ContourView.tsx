/**
 * Level sets of a scalar field over the plane.
 *
 * The contour view deliberately samples the same real evaluator and rectangle
 * as the surface view. It is therefore a second reading of the field, not a
 * decoration placed over a separately generated picture. The shared viewport
 * and cursor make it useful beside either the 3D surface or the heatmap.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  axisTicks,
  contourLines,
  cx,
  displayNumberToText,
  sampleSurface,
  type SurfaceMesh,
} from '@mathviz/mathcore';
import { drawGridAndAxes } from '../render/axes2d';
import { CANVAS_COLORS, prepareCanvas2d } from '../render/canvasSurface';
import { NumberText } from '../display/NumberText';
import { viewNumber } from '../display/numbers';
import { useStore } from '../state/store';
import { selectActiveExpression, type ViewRendererProps } from '../state/workspaceStore';
import { handleCameraKey } from './cameraKeys';
import { makePointEvaluation } from './evaluation';
import { useResizeVersion } from './useResizeVersion';
import { fromScreen, planeWindow, toScreen } from './window2d';

const RESOLUTION = 129;

interface Range {
  readonly min: number;
  readonly max: number;
}

export function ContourView({ store }: ViewRendererProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resizeVersion = useResizeVersion(canvasRef);
  const dragging = useRef<{ x: number; y: number } | null>(null);
  const [measured, setMeasured] = useState<Range | null>(null);
  const state = useStore(store, (current) => current);
  const { workspace, focusedLineId } = state;
  const active = selectActiveExpression(workspace, focusedLineId, store.drawableKinds);
  const evaluation = makePointEvaluation(active, state.parameterValues, workspace.functions);

  const drawable =
    active?.signature.domain.kind === 'R' &&
    active.signature.domain.dim === 2 &&
    active.signature.codomain.kind === 'R' &&
    active.signature.codomain.dim === 1;

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

    const mesh = sampleSurface((x, y) => evaluation.evaluate(cx(x, y)), {
      xMin: window.xMin,
      xMax: window.xMax,
      yMin: window.yMin,
      yMax: window.yMax,
      columns: RESOLUTION,
      rows: RESOLUTION,
    });
    const range = rangeOf(mesh);
    setMeasured((previous) =>
      previous !== null && previous.min === range.min && previous.max === range.max
        ? previous
        : range,
    );

    const levels = axisTicks(range.min, range.max, 9).major.map((tick) => tick.value);
    const lines = contourLines(mesh, levels);
    for (const line of lines) {
      context.strokeStyle =
        Math.abs(line.level) < 1e-12 ? CANVAS_COLORS.curveSecondary : CANVAS_COLORS.curve;
      context.lineWidth = Math.max(1, ratio * (Math.abs(line.level) < 1e-12 ? 1.7 : 1.1));
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

    const cursor = state.hover ?? state.selection;
    if (cursor !== null) {
      const at = toScreen(window, { x: cursor.re, y: cursor.im }, width, height);
      if (Number.isFinite(at.x) && Number.isFinite(at.y)) {
        context.beginPath();
        context.arc(at.x, at.y, Math.max(3, ratio * 4), 0, Math.PI * 2);
        context.fillStyle = CANVAS_COLORS.paper;
        context.fill();
        context.strokeStyle = CANVAS_COLORS.cursor;
        context.lineWidth = Math.max(1.2, ratio * 1.5);
        context.stroke();
      }
    }
  }, [drawable, evaluation, state.selection, state.hover, state.viewport]);

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

  const rangeText =
    measured === null
      ? 'the current plane window'
      : `levels from ${displayNumberToText(viewNumber(measured.min))} to ${displayNumberToText(
          viewNumber(measured.max),
        )}`;

  return (
    <div className="view">
      <canvas
        ref={canvasRef}
        className="view__canvas view__canvas--paper"
        tabIndex={0}
        role="img"
        aria-label={`Contour lines of a scalar field over ${rangeText}`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragging.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerMove={(event) => {
          const point = toPlane(event);
          store.setHover(point);
          const start = dragging.current;
          if (start === null || point === null) return;
          const canvas = canvasRef.current;
          if (canvas === null) return;
          const unitsPerPixel =
            (2 * state.viewport.halfWidth) / Math.max(1, canvas.getBoundingClientRect().width);
          store.panViewport(
            -(event.clientX - start.x) * unitsPerPixel,
            (event.clientY - start.y) * unitsPerPixel,
          );
          dragging.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={(event) => {
          const start = dragging.current;
          dragging.current = null;
          if (start === null) return;
          const travelled = Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y);
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
            Contours need a real scalar field of two real variables, such as{' '}
            <span className="view__mono">f(x,y)=x^2-y^2</span>.
          </p>
        </div>
      )}

      {drawable && measured !== null && (
        <div className="legend legend--corner">
          <span className="legend__title">level sets · z = f(x, y)</span>
          <span className="legend__range">
            z ∈ [<NumberText value={viewNumber(measured.min)} />,{' '}
            <NumberText value={viewNumber(measured.max)} />]
          </span>
          <span className="legend__range">zero level highlighted · undefined cells omitted</span>
        </div>
      )}
    </div>
  );
}

function rangeOf(mesh: SurfaceMesh): Range {
  if (!Number.isFinite(mesh.zMin) || !Number.isFinite(mesh.zMax)) return { min: -1, max: 1 };
  if (mesh.zMin === mesh.zMax) return { min: mesh.zMin - 1, max: mesh.zMax + 1 };
  return { min: mesh.zMin, max: mesh.zMax };
}
