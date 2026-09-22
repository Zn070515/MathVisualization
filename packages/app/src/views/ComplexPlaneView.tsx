/**
 * The complex plane.
 *
 * The plane is not a picture *of* anything: it is the space the mathematics
 * happens in, with a real axis and an imaginary one. A complex function is a map
 * *on* this plane, and domain colouring is one way of drawing that map — which is
 * why the two are separate kinds of view rather than one kind with a mode.
 *
 * What it shows beyond the axes:
 *
 * - the shared cursor, as the point `z`;
 * - for a function of one complex variable, the image `f(z)` as an open marker
 *   joined to `z` by a line, so the mapping is visible rather than asserted;
 * - for a function of a real variable taking complex values, the path it traces.
 *
 * It draws the plane whether or not there is anything to put on it. An empty
 * plane is a true statement about a plane; a heatmap of nothing would not be.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { type Complex, cx, displayNumberToText } from '@mathviz/mathcore';
import { drawGridAndAxes } from '../render/axes2d';
import { CANVAS_COLORS, prepareCanvas2d } from '../render/canvasSurface';
import { viewNumber } from '../display/numbers';
import { useStore } from '../state/store';
import { selectActiveExpression, type ViewRendererProps } from '../state/workspaceStore';
import { handleCameraKey } from './cameraKeys';
import { makePointEvaluation } from './evaluation';
import { useResizeVersion } from './useResizeVersion';
import { fromScreen, planeWindow, toScreen } from './window2d';

/** Points sampled along a path, and along the line from `z` to `f(z)`. */
const SAMPLES = 900;

export function ComplexPlaneView({ store }: ViewRendererProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resizeVersion = useResizeVersion(canvasRef);
  const state = useStore(store, (current) => current);
  const { workspace, focusedLineId } = state;
  const functions = workspace.functions;
  const active = useMemo(
    () => selectActiveExpression(workspace, focusedLineId, store.drawableKinds),
    [workspace, focusedLineId, store.drawableKinds],
  );

  const evaluation = useMemo(
    () => makePointEvaluation(active, state.parameterValues, functions),
    [active, state.parameterValues, functions],
  );

  const signature = active?.signature;
  /** A map of the plane: the cursor's image is worth drawing. */
  const drawsMap = signature?.domain.kind === 'C' && signature.codomain.kind === 'C';
  /** A curve through the plane, parameterised by the variable on the real axis. */
  const drawsPath =
    signature?.domain.kind === 'R' && signature.domain.dim === 1 && signature.codomain.kind === 'C';

  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const surface = prepareCanvas2d(canvas);
    if (surface === null) return;
    const { context, width, height, ratio } = surface;

    const window = planeWindow(state.viewport, width, height);
    drawGridAndAxes(context, { window, width, height, ratio, xName: 'Re z', yName: 'Im z' });

    if (drawsPath && evaluation !== null) {
      context.strokeStyle = CANVAS_COLORS.curve;
      context.lineWidth = Math.max(1.2, ratio * 1.4);
      context.beginPath();
      let started = false;
      const step = (window.xMax - window.xMin) / SAMPLES;
      for (let index = 0; index <= SAMPLES; index += 1) {
        const value = evaluation.valueAt(cx(window.xMin + index * step, 0));
        if (value === null || !Number.isFinite(value.re) || !Number.isFinite(value.im)) {
          started = false;
          continue;
        }
        const point = toScreen(window, { x: value.re, y: value.im }, width, height);
        if (started) context.lineTo(point.x, point.y);
        else {
          context.moveTo(point.x, point.y);
          started = true;
        }
      }
      context.stroke();
    }

    const cursor = state.hover ?? state.selection;
    if (cursor === null) return;

    const at = toScreen(window, { x: cursor.re, y: cursor.im }, width, height);
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return;

    // Where the map sends the cursor. Drawn as a line and an open marker rather
    // than as a second dot, because the point of it is the correspondence: this
    // point goes to that one.
    if (drawsMap && evaluation !== null) {
      const result = evaluation.evaluate(cursor);
      if (result.ok && Number.isFinite(result.value.re) && Number.isFinite(result.value.im)) {
        const image = toScreen(window, { x: result.value.re, y: result.value.im }, width, height);
        context.strokeStyle = CANVAS_COLORS.cursor;
        context.lineWidth = Math.max(1, ratio);
        context.beginPath();
        context.moveTo(at.x, at.y);
        context.lineTo(image.x, image.y);
        context.stroke();

        context.beginPath();
        context.arc(image.x, image.y, Math.max(2.5, ratio * 3), 0, Math.PI * 2);
        context.strokeStyle = CANVAS_COLORS.curveSecondary;
        context.lineWidth = Math.max(1.2, ratio * 1.4);
        context.stroke();
      }
    }

    context.beginPath();
    context.arc(at.x, at.y, Math.max(2.5, ratio * 3), 0, Math.PI * 2);
    context.fillStyle = CANVAS_COLORS.curveSecondary;
    context.fill();
  }, [drawsMap, drawsPath, evaluation, state.hover, state.selection, state.viewport]);

  useEffect(() => {
    draw();
  }, [draw, resizeVersion]);

  const planeAt = (event: { clientX: number; clientY: number }): Complex | null => {
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
    return cx(point.x, point.y);
  };

  return (
    <div className="view">
      <canvas
        ref={canvasRef}
        className="view__canvas view__canvas--paper"
        tabIndex={0}
        role="img"
        aria-label={`The complex plane, with a real and an imaginary axis, showing real values from ${displayNumberToText(
          viewNumber(state.viewport.centre.re - state.viewport.halfWidth),
        )} to ${displayNumberToText(
          viewNumber(state.viewport.centre.re + state.viewport.halfWidth),
        )}`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragStart.current = { x: event.clientX, y: event.clientY };
          store.setSelection(planeAt(event));
        }}
        onPointerMove={(event) => {
          const point = planeAt(event);
          store.setHover(point);

          const start = dragStart.current;
          if (start === null) return;
          const canvas = canvasRef.current;
          if (canvas === null) return;
          const bounds = canvas.getBoundingClientRect();
          if (bounds.width === 0) return;
          const unitsPerPixel = (2 * state.viewport.halfWidth) / bounds.width;
          store.panViewport(
            -(event.clientX - start.x) * unitsPerPixel,
            (event.clientY - start.y) * unitsPerPixel,
          );
          dragStart.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={() => {
          dragStart.current = null;
        }}
        onPointerLeave={() => {
          dragStart.current = null;
          store.clearCursor();
        }}
        onWheel={(event) => {
          store.zoomViewport(Math.exp(event.deltaY * 0.0015), planeAt(event) ?? undefined);
        }}
        onKeyDown={(event) => {
          handleCameraKey(event, store);
        }}
      />

      <div className="legend legend--corner">
        <span className="legend__title">z-plane</span>
        {drawsMap && <span className="legend__range">z ↦ f(z)</span>}
        {drawsPath && <span className="legend__range">path of f(t)</span>}
      </div>
    </div>
  );
}
