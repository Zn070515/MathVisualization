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
 * - for a function of a real variable taking complex values, the path it traces;
 * - where a function of one complex variable vanishes and where it blows up,
 *   marked with the order the argument principle gives them.
 *
 * It draws the plane whether or not there is anything to put on it. An empty
 * plane is a true statement about a plane; a heatmap of nothing would not be.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type Complex,
  type Singularity,
  cx,
  displayComplex,
  displayComplexToText,
  displayNumberToText,
  findZerosAndPoles,
} from '@mathviz/mathcore';
import { drawGridAndAxes } from '../render/axes2d';
import { CANVAS_COLORS, prepareCanvas2d } from '../render/canvasSurface';
import { TICK_FONT } from '../render/canvasText';
import { roundForScale, viewNumber } from '../display/numbers';
import { useStore } from '../state/store';
import { selectActiveExpression, type ViewRendererProps } from '../state/workspaceStore';
import { handleCameraKey } from './cameraKeys';
import { makePointEvaluation } from './evaluation';
import { useResizeVersion } from './useResizeVersion';
import { fromScreen, planeWindow, toScreen, type Window2d } from './window2d';

/** Points sampled along a path, and along the line from `z` to `f(z)`. */
const SAMPLES = 900;

/** How near a marked point the pointer has to be for the cursor to take it. */
const SNAP_RADIUS = 14;

/**
 * The radius a marked point is drawn at, before the pixel ratio scales it.
 *
 * A little larger than the cursor dot, so that when the cursor takes a mark the mark
 * is still visible as a ring around it rather than disappearing underneath.
 */
const MARK_RADIUS = 4;

/**
 * A marked point, written as its coordinate and nothing else.
 *
 * Whether it is a zero or a pole is not in the text. It is in the shape of the mark —
 * filled for a zero, open for a pole — which is where a reader looks for it anyway,
 * and which leaves the label to say the one thing the picture cannot: which numbers
 * these are.
 *
 * The order is the one exception, because no other part of the picture carries it: a
 * zero of order two is written `(0, 0) ×2`. It is three characters against the
 * `zero of order 2 at` it replaces, and it is how a multiplicity is written in the
 * mathematics, so it costs a reader nothing to read.
 *
 * The coordinate is rounded to the place the picture can support before it is written,
 * because the search *located* this point rather than solving for it: `z²` has its
 * zero at the origin, and the refinement puts it at `-1.06×10⁻¹⁶`, which is not a
 * coordinate anyone wants to read and is not more true than `0`.
 */
function describe(point: Singularity, spanX: number, spanY: number): string {
  const where = displayComplexToText(
    displayComplex(
      { re: roundForScale(point.z.re, spanX), im: roundForScale(point.z.im, spanY) },
      { digits: 4 },
    ),
  );
  return point.order === 1 ? where : `${where} ×${point.order}`;
}

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
  /** A map of the plane: the cursor's image is worth drawing, and so are its zeros. */
  const drawsMap = signature?.domain.kind === 'C' && signature.codomain.kind === 'C';
  /** A curve through the plane, parameterised by the variable on the real axis. */
  const drawsPath =
    signature?.domain.kind === 'R' && signature.domain.dim === 1 && signature.codomain.kind === 'C';

  const dragStart = useRef<{ x: number; y: number } | null>(null);
  /** The marked point the cursor has taken, if any. Labelled; the rest are marks. */
  const [snapped, setSnapped] = useState<Singularity | null>(null);

  /**
   * The canvas size, which the searching has to know and React cannot ask for.
   *
   * The region to search is the region on screen, and that depends on the shape of
   * the canvas. So the size is held in state and updated from the draw — guarded, so
   * that an unchanged size does not cause a render.
   */
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  const region = useMemo(
    (): Window2d | null =>
      size === null ? null : planeWindow(state.viewport, size.width, size.height),
    [state.viewport, size],
  );

  /**
   * Where the function vanishes and where it blows up, inside what is on screen.
   *
   * Memoised against the region rather than recomputed per frame, because finding
   * them means hundreds of evaluations and the pointer moves at sixty hertz. Panning
   * costs one search per new region, not one per pixel.
   */
  const singularities = useMemo((): readonly Singularity[] => {
    if (!drawsMap || evaluation === null || region === null) return [];
    return findZerosAndPoles((z) => evaluation.evaluate(z), {
      xMin: region.xMin,
      xMax: region.xMax,
      yMin: region.yMin,
      yMax: region.yMax,
    });
  }, [drawsMap, evaluation, region]);

  const zeros = singularities.filter((point) => point.kind === 'zero').length;
  const poles = singularities.length - zeros;
  /** Whether any mark carries an order a reader would have to be told about. */
  const repeated = singularities.some((point) => point.order > 1);

  /**
   * Let go of a taken point when the set of them changes.
   *
   * The marks are recomputed when the expression changes or the region moves, and a
   * point that was held a moment ago belongs to the *previous* set — the label would
   * go on describing a zero of a function that is no longer the one being drawn.
   * Editing a line or focusing another does exactly that.
   */
  useEffect(() => {
    setSnapped(null);
  }, [singularities]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const surface = prepareCanvas2d(canvas);
    if (surface === null) return;
    const { context, width, height, ratio } = surface;

    setSize((previous) =>
      previous !== null && previous.width === width && previous.height === height
        ? previous
        : { width, height },
    );

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

    // Where the function vanishes and where it blows up. A zero is filled and a pole
    // is open, because the two are opposites of each other in the mathematics and the
    // drawing should not have to be read twice to say so.
    const radius = Math.max(MARK_RADIUS, ratio * MARK_RADIUS);
    for (const point of singularities) {
      const at = toScreen(window, { x: point.z.re, y: point.z.im }, width, height);
      if (!Number.isFinite(at.x) || at.x < -20 || at.x > width + 20) continue;
      if (!Number.isFinite(at.y) || at.y < -20 || at.y > height + 20) continue;

      context.beginPath();
      context.arc(at.x, at.y, radius, 0, Math.PI * 2);
      context.lineWidth = Math.max(1.4, ratio * 1.6);
      context.strokeStyle = CANVAS_COLORS.curve;
      if (point.kind === 'zero') {
        context.fillStyle = CANVAS_COLORS.curve;
        context.fill();
      }
      context.stroke();
    }

    if (snapped !== null) {
      const at = toScreen(window, { x: snapped.z.re, y: snapped.z.im }, width, height);
      if (Number.isFinite(at.x)) {
        const text = describe(snapped, window.xMax - window.xMin, window.yMax - window.yMin);
        context.font = `${TICK_FONT.size}px ${TICK_FONT.family}`;
        const textWidth = context.measureText(text).width;
        // Beside the point, and inside the frame: flipped to the other side when
        // there is no room on the right, and then clamped, because a label wider than
        // the frame has no good side and sliding off the edge is worse than being
        // pinned to it.
        const preferred = at.x + 10 + textWidth > width - 4 ? at.x - 10 - textWidth : at.x + 10;
        const left = Math.max(4, Math.min(preferred, width - textWidth - 4));
        context.fillStyle = CANVAS_COLORS.curve;
        context.textAlign = 'left';
        context.textBaseline = 'bottom';
        context.fillText(text, left, Math.max(TICK_FONT.size + 2, at.y - 8));
      }
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
  }, [
    drawsMap,
    drawsPath,
    evaluation,
    singularities,
    snapped,
    state.hover,
    state.selection,
    state.viewport,
  ]);

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

  /**
   * The cursor a marked point under the pointer would set, if there is one.
   *
   * Taking the point is what makes the mark readable rather than merely visible: the
   * readout prints the coordinate the argument principle found, not the nearest pixel's.
   *
   * The coordinate comes back stated to the place the picture can support, and it is
   * stated *here* rather than at each place that writes it down, because there are two
   * of those — the label beside the mark and the shared cursor the readout follows — and
   * two statements of the same point that round differently are two different answers.
   */
  const snappedCursor = (event: {
    clientX: number;
    clientY: number;
  }): { z: Complex; point: Singularity } | null => {
    const canvas = canvasRef.current;
    if (canvas === null || singularities.length === 0) return null;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return null;

    const window = planeWindow(state.viewport, bounds.width, bounds.height);
    const spanX = window.xMax - window.xMin;
    const spanY = window.yMax - window.yMin;
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;

    let best: Singularity | null = null;
    let bestDistance = SNAP_RADIUS * SNAP_RADIUS;
    for (const point of singularities) {
      const at = toScreen(window, { x: point.z.re, y: point.z.im }, bounds.width, bounds.height);
      const dx = at.x - pointerX;
      const dy = at.y - pointerY;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = point;
      }
    }
    return best === null
      ? null
      : {
          z: cx(roundForScale(best.z.re, spanX), roundForScale(best.z.im, spanY)),
          point: best,
        };
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
          // Holding takes the same point a hover would have: a marked point if one is
          // under the pointer, and otherwise the point of the plane it is at.
          const taken = snappedCursor(event);
          store.setSelection(taken === null ? planeAt(event) : taken.z);
        }}
        onPointerMove={(event) => {
          // Snapping comes first: on a marked point the cursor takes *that* point, so
          // the readout prints the coordinate the argument principle found rather than
          // the nearest pixel's.
          const taken = snappedCursor(event);
          setSnapped(taken === null ? null : taken.point);
          store.setHover(taken === null ? planeAt(event) : taken.z);

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
          setSnapped(null);
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
        {drawsMap && (zeros > 0 || poles > 0) && (
          <span className="legend__range">
            ● {zeros} zero{zeros === 1 ? '' : 's'} · ○ {poles} pole{poles === 1 ? '' : 's'}
          </span>
        )}
        {repeated && <span className="legend__range">×n marks a point of order n</span>}
      </div>
    </div>
  );
}
