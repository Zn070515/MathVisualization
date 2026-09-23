/**
 * The cartesian view: a function of one real variable, drawn on a pair of axes.
 *
 * A real signal is one curve; a complex-valued signal is drawn as two, the real
 * part and the imaginary part, which is the honest way to show complex values on
 * a single pair of axes.
 *
 * The window comes from the shared viewport, exactly as it does for the complex
 * plane, so the two views are looking at the same camera and panning one pans the
 * other. The measured range is still stated even though it no longer decides the
 * framing: a curve that leaves the picture is then a number in the legend rather
 * than a surprise, and `Fit` is there for a reader who wants the frame moved
 * rather than the scale guessed at.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type Complex,
  type PointOfInterest,
  cx,
  displayNumberToText,
  findPointsOfInterest,
} from '@mathviz/mathcore';
import { drawGridAndAxes } from '../render/axes2d';
import { CANVAS_COLORS, prepareCanvas2d } from '../render/canvasSurface';
import { TICK_FONT } from '../render/canvasText';
import { NumberText } from '../display/NumberText';
import { roundForScale, viewNumber } from '../display/numbers';
import { useStore } from '../state/store';
import {
  selectActiveExpression,
  selectSourceExpression,
  type ViewRendererProps,
} from '../state/workspaceStore';
import { handleCameraKey } from './cameraKeys';
import { makePointEvaluation } from './evaluation';
import { useResizeVersion } from './useResizeVersion';
import { fitViewport, fromScreen, planeWindow, toScreen } from './window2d';
import { estimateActiveDft, sampleMarkerValues } from './dftEvaluation';

/** Points sampled across the visible interval. */
const SAMPLES = 900;

/** How near a marked point the pointer has to be for the cursor to take it. */
const SNAP_RADIUS = 14;

/** How near the curve the pointer has to be for the curve to be marked at all. */
const NEAR_CURVE = 26;

/** The radius a marked point is drawn at, before the pixel ratio scales it. */
const MARK_RADIUS = 3.5;

/** The height a marked point sits at: an axis crossing is on the axis. */
function heightOf(point: PointOfInterest): number {
  return point.kind === 'crossing' ? 0 : point.value;
}

/**
 * A point on the graph, written as its coordinate and nothing else.
 *
 * The *kind* is deliberately not in the text. It is in the shape of the mark —
 * filled for a crossing, open for a turn — which is where a reader looks for it
 * anyway, and which leaves the label to say the one thing the picture cannot: which
 * numbers these are. `min (0, 0)` and `(0, 0)` name the same coordinate, and the
 * coordinate is what is wanted.
 *
 * Each coordinate is rounded to the place its *own* axis can support. One span for
 * both would be wrong in a way a reader can see: the vertical span of `exp(-t²)` on a
 * wide canvas is under two units against a horizontal span of nearly five, so
 * rounding the height to a thousandth of the *width* turns the maximum at 1 into
 * `0.9984`, which is not this function's maximum.
 */
function formatPoint(t: number, value: number, spanX: number, spanY: number): string {
  return `(${displayNumberToText(viewNumber(roundForScale(t, spanX)))}, ${displayNumberToText(
    viewNumber(roundForScale(value, spanY)),
  )})`;
}

interface Range {
  readonly min: number;
  readonly max: number;
}

/**
 * A point on the curve the picture marks, and the analysed point it has taken if any.
 *
 * `point` is set when the mark has taken one of the analysed points and null when it is
 * simply a place on the curve, which is what decides how the mark is ringed.
 */
interface OnCurve {
  readonly t: number;
  readonly value: number;
  readonly point: PointOfInterest | null;
}

export function CartesianView({ store }: ViewRendererProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resizeVersion = useResizeVersion(canvasRef);
  const state = useStore(store, (current) => current);
  const { workspace, focusedLineId } = state;
  const functions = workspace.functions;
  const active = useMemo(
    () => selectSourceExpression(workspace, focusedLineId, store.drawableKinds),
    [workspace, focusedLineId, store.drawableKinds],
  );
  const transformActive = useMemo(
    () => selectActiveExpression(workspace, focusedLineId, store.drawableKinds),
    [workspace, focusedLineId, store.drawableKinds],
  );

  const evaluation = useMemo(
    () => makePointEvaluation(active, state.parameterValues, functions),
    [active, state.parameterValues, functions],
  );

  const dftEstimate = useMemo(
    () => estimateActiveDft(transformActive, workspace, state.parameterValues, state.sampling),
    [transformActive, workspace, state.parameterValues, state.sampling],
  );

  const drawable = useMemo(() => {
    const signature = active?.signature;
    if (signature === undefined) return false;
    return signature.domain.kind === 'R' && signature.domain.dim === 1;
  }, [active]);

  const isComplexValued = active?.signature.codomain.kind === 'C';
  const variableName = evaluation?.variableNames[0] ?? 't';

  /**
   * The span the horizontal axis is showing.
   *
   * Stated on the picture and on the accessible label, because a canvas has no
   * text in it: without this, what is on screen is available to a sighted reader
   * and to nobody else.
   */
  const visible = useMemo(
    () => ({
      min: state.viewport.centre.re - state.viewport.halfWidth,
      max: state.viewport.centre.re + state.viewport.halfWidth,
    }),
    [state.viewport],
  );
  const rangeText = `${displayNumberToText(viewNumber(visible.min))} to ${displayNumberToText(
    viewNumber(visible.max),
  )}`;

  const [measured, setMeasured] = useState<Range | null>(null);

  /** Where the pointer is on the curve, or null when it is nowhere near one. */
  const [onCurve, setOnCurve] = useState<OnCurve | null>(null);

  /**
   * Where the curve crosses the axis, and where it turns round.
   *
   * Only where the value is real: for a signal drawn as its real and imaginary
   * parts, "the zeros of f" is not what is on the screen, and marking them would
   * point at a curve that is not the one being read.
   */
  const criticalPoints = useMemo((): readonly PointOfInterest[] => {
    if (!drawable || evaluation === null || isComplexValued) return [];
    return findPointsOfInterest((t) => evaluation.evaluate(cx(t, 0)), {
      tMin: visible.min,
      tMax: visible.max,
    });
  }, [drawable, evaluation, isComplexValued, visible]);

  /**
   * Let go of the mark when the picture becomes a picture of something else.
   *
   * A mark taken a moment ago belonged to the *previous* function: editing the
   * expression, focusing another line, or moving a parameter changes what is being
   * drawn, and the mark would go on labelling a curve that is no longer there.
   *
   * Keyed on the evaluation and not on the marked points, because those are recomputed
   * when the window moves as well — and panning does not change what the function is,
   * only where it is being looked at. Keying on them would drop the mark on every frame
   * of a drag.
   */
  useEffect(() => {
    setOnCurve(null);
  }, [evaluation]);

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
      xName: variableName,
      yName: 'y',
    });

    if (!drawable || evaluation === null) return;

    const samples: (Complex | null)[] = [];
    const step = (window.xMax - window.xMin) / SAMPLES;
    for (let index = 0; index <= SAMPLES; index += 1) {
      samples.push(evaluation.valueAt(cx(window.xMin + index * step, 0)));
    }

    // The range is measured over the whole visible interval, whether or not the
    // curve is inside the frame: it is a fact about the function, and it is what
    // the legend states.
    let min = 0;
    let max = 0;
    for (const value of samples) {
      if (value === null) continue;
      for (const component of [value.re, value.im]) {
        if (!Number.isFinite(component)) continue;
        if (component < min) min = component;
        if (component > max) max = component;
      }
    }
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const pad = (max - min) * 0.08;
    setMeasured((previous) =>
      previous !== null && previous.min === min - pad && previous.max === max + pad
        ? previous
        : { min: min - pad, max: max + pad },
    );

    const strokeCurve = (pick: (value: Complex) => number, colour: string): void => {
      context.strokeStyle = colour;
      context.lineWidth = Math.max(1.2, ratio * 1.4);
      context.beginPath();
      let started = false;
      samples.forEach((value, index) => {
        if (value === null) {
          started = false;
          return;
        }
        const component = pick(value);
        if (!Number.isFinite(component)) {
          started = false;
          return;
        }
        const point = toScreen(
          window,
          { x: window.xMin + index * step, y: component },
          width,
          height,
        );
        if (started) context.lineTo(point.x, point.y);
        else {
          context.moveTo(point.x, point.y);
          started = true;
        }
      });
      context.stroke();
    };

    strokeCurve((value) => value.re, CANVAS_COLORS.curve);
    if (isComplexValued) strokeCurve((value) => value.im, CANVAS_COLORS.curveSecondary);

    // A DFT is a statement about these samples, not merely about the continuous
    // source curve. Draw the same finite sample values consumed by the DFT view,
    // so the time-domain and frequency-domain panes cannot drift apart.
    for (const marker of dftEstimate === null ? [] : sampleMarkerValues(dftEstimate)) {
      if (marker.t < window.xMin || marker.t > window.xMax) continue;
      const at = toScreen(window, { x: marker.t, y: marker.value }, width, height);
      if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) continue;
      context.beginPath();
      context.arc(at.x, at.y, Math.max(2.5, ratio * 3), 0, Math.PI * 2);
      context.fillStyle = CANVAS_COLORS.paper;
      context.fill();
      context.strokeStyle = CANVAS_COLORS.curveSecondary;
      context.lineWidth = Math.max(1.2, ratio * 1.5);
      context.stroke();
    }

    // The points worth naming: marked always, labelled only for the one the pointer
    // has taken. That is how a reader finds them without the picture disappearing
    // under numbers.
    //
    // A crossing is filled and a turn is open, because the two say opposite things —
    // the curve reaching zero, and the curve turning round — and the shape of the mark
    // is where a reader looks for that. It leaves the label to say the one thing the
    // picture cannot, namely which numbers these are.
    for (const point of criticalPoints) {
      const at = toScreen(window, { x: point.t, y: heightOf(point) }, width, height);
      if (!Number.isFinite(at.x) || at.x < 0 || at.x > width) continue;
      context.beginPath();
      context.arc(at.x, at.y, Math.max(2.5, ratio * MARK_RADIUS), 0, Math.PI * 2);
      context.lineWidth = Math.max(1.2, ratio * 1.4);
      if (point.kind === 'crossing') {
        context.fillStyle = CANVAS_COLORS.curve;
        context.fill();
      } else {
        // Filled with the paper and ringed with ink, so an open mark reads as a mark
        // *on* the curve rather than as a gap in it.
        context.fillStyle = CANVAS_COLORS.paper;
        context.fill();
        context.strokeStyle = CANVAS_COLORS.curve;
        context.stroke();
      }
    }

    // The point to mark: where the pointer is on the curve, or — the pointer having
    // left the canvas altogether — the point that was held. A click marks a point, and
    // the readout goes on saying it is held; the picture has to say so too, or the value
    // in the readout belongs to nothing a reader can see.
    //
    // The condition on the hover is the point: the readout reads `hover ?? selection`,
    // so a mark picked on any other rule would sooner or later point at a different
    // place from the one the readout is describing. Held points sit on the real part,
    // which is the curve drawn in the primary ink.
    const held = state.hover === null ? state.selection : null;
    let mark = onCurve;
    if (mark === null && held !== null && evaluation !== null) {
      const value = evaluation.valueAt(cx(held.re, 0));
      if (value !== null && Number.isFinite(value.re)) {
        mark = { t: held.re, value: value.re, point: null };
      }
    }

    // Only when there is a curve there to mark: a mark that followed the pointer
    // across empty space would assert a value at a place there is no curve.
    //
    // Ringed in the ink of the curve when it has taken a marked point, and in the
    // secondary ink when it is simply where the pointer meets the curve, so which one
    // it is can be seen without reading the label.
    if (mark !== null) {
      const at = toScreen(window, { x: mark.t, y: mark.value }, width, height);
      if (Number.isFinite(at.x) && Number.isFinite(at.y) && at.x >= 0 && at.x <= width) {
        context.beginPath();
        context.arc(at.x, at.y, Math.max(2.5, ratio * MARK_RADIUS), 0, Math.PI * 2);
        context.fillStyle = CANVAS_COLORS.paper;
        context.fill();
        context.strokeStyle =
          mark.point === null ? CANVAS_COLORS.curveSecondary : CANVAS_COLORS.curve;
        context.lineWidth = Math.max(1.4, ratio * 1.6);
        context.stroke();

        const text = formatPoint(
          mark.t,
          mark.value,
          window.xMax - window.xMin,
          window.yMax - window.yMin,
        );
        context.font = `${TICK_FONT.size}px ${TICK_FONT.family}`;
        const textWidth = context.measureText(text).width;
        // Beside the point, and inside the frame — flipped to the other side rather
        // than clipped when there is no room on the right, and then clamped, because
        // a label wider than the frame has no good side and sliding off the edge is
        // worse than being pinned to it.
        const preferred = at.x + 10 + textWidth > width - 4 ? at.x - 10 - textWidth : at.x + 10;
        const left = Math.max(4, Math.min(preferred, width - textWidth - 4));
        context.fillStyle = CANVAS_COLORS.curve;
        context.textAlign = 'left';
        context.textBaseline = 'bottom';
        context.fillText(text, left, Math.max(TICK_FONT.size + 2, at.y - 8));
      }
    }
  }, [
    criticalPoints,
    dftEstimate,
    drawable,
    evaluation,
    isComplexValued,
    onCurve,
    state.hover,
    state.selection,
    state.viewport,
    variableName,
  ]);

  useEffect(() => {
    draw();
  }, [draw, resizeVersion]);

  /** Frame the range the legend is stating. */
  const fit = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas === null || measured === null) return;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;
    const window = planeWindow(state.viewport, bounds.width, bounds.height);
    store.setViewport(
      fitViewport(
        window.xMin,
        window.xMax,
        measured.min,
        measured.max,
        bounds.height / bounds.width,
      ),
    );
  }, [measured, state.viewport, store]);

  /**
   * The variable under a pointer.
   *
   * The shared cursor is a plane coordinate; for a function of one real variable
   * the imaginary part stays zero, so the same point still means the same thing to
   * every view.
   */
  const variableAt = (event: { clientX: number; clientY: number }): Complex | null => {
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
    return Number.isFinite(point.x) ? cx(point.x, 0) : null;
  };

  /**
   * The value of the variable at which the cursor takes a marked point, if it does.
   *
   * Snapping is what makes the marked points readable rather than merely visible: the
   * cursor takes the value the analysis found, so the readout prints that value and not
   * the nearest pixel's.
   *
   * The value comes back stated to the place the picture can support, and it is stated
   * *here* and not at each place that writes it down, because there are two of those —
   * the label beside the mark and the shared cursor the readout follows — and two
   * statements of the same point that round differently are two different answers. The
   * search *located* this point rather than solving for it, so the last digits of the
   * refinement are the method's artefact and belong in neither.
   */
  const snappedCursor = (event: {
    clientX: number;
    clientY: number;
  }): { t: number; point: PointOfInterest } | null => {
    const canvas = canvasRef.current;
    if (canvas === null || criticalPoints.length === 0) return null;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return null;

    const window = planeWindow(state.viewport, bounds.width, bounds.height);
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;

    let best: PointOfInterest | null = null;
    let bestDistance = SNAP_RADIUS * SNAP_RADIUS;
    for (const point of criticalPoints) {
      const at = toScreen(window, { x: point.t, y: heightOf(point) }, bounds.width, bounds.height);
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
      : { t: roundForScale(best.t, window.xMax - window.xMin), point: best };
  };

  /**
   * The point on the curve nearest the pointer, when the pointer is near the curve.
   *
   * The variable comes from the pointer's x, exactly as the shared cursor's does; the
   * value is then read off the function there, so the mark sits *on* the curve rather
   * than under the pointer. For a signal drawn as its real and imaginary parts,
   * whichever of the two curves passes nearer the pointer is the one marked, because
   * that is the one being pointed at.
   *
   * Null when no curve passes within `NEAR_CURVE` pixels of the pointer: there is no
   * value at a place where there is no curve.
   */
  const curveUnder = (event: { clientX: number; clientY: number }): OnCurve | null => {
    const canvas = canvasRef.current;
    const variable = variableAt(event);
    if (canvas === null || evaluation === null || variable === null) return null;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return null;

    const value = evaluation.valueAt(variable);
    if (value === null) return null;

    const window = planeWindow(state.viewport, bounds.width, bounds.height);
    const pointerY = event.clientY - bounds.top;
    const t = variable.re;

    let best: OnCurve | null = null;
    let bestDistance = NEAR_CURVE;
    for (const component of isComplexValued ? [value.re, value.im] : [value.re]) {
      if (!Number.isFinite(component)) continue;
      const at = toScreen(window, { x: t, y: component }, bounds.width, bounds.height);
      if (!Number.isFinite(at.y)) continue;
      const distance = Math.abs(at.y - pointerY);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { t, value: component, point: null };
      }
    }
    return best;
  };

  const dragStart = useRef<{ x: number; y: number } | null>(null);

  return (
    <div className="view">
      <canvas
        ref={canvasRef}
        className="view__canvas view__canvas--paper"
        tabIndex={0}
        role="img"
        aria-label={`Graph of a function of ${variableName}, over ${rangeText}`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragStart.current = { x: event.clientX, y: event.clientY };
          // Holding takes the same point a hover would have: a marked point if one is
          // under the pointer, and otherwise the variable it is at.
          const taken = snappedCursor(event);
          store.setSelection(taken === null ? variableAt(event) : cx(taken.t, 0));
        }}
        onPointerMove={(event) => {
          // Snapping comes first: on a marked point the mark takes *that* point, so
          // the readout prints the value the analysis found rather than the
          // coordinate under the pixel. Failing that the mark goes on whichever curve
          // passes nearest the pointer, and vanishes when none does.
          const taken = snappedCursor(event);
          if (taken === null) {
            setOnCurve(curveUnder(event));
            const point = variableAt(event);
            if (point !== null) store.setHover(point);
          } else {
            setOnCurve({ t: taken.t, value: heightOf(taken.point), point: taken.point });
            store.setHover(cx(taken.t, 0));
          }

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
          setOnCurve(null);
          store.clearCursor();
        }}
        onWheel={(event) => {
          store.zoomViewport(Math.exp(event.deltaY * 0.0015), variableAt(event) ?? undefined);
        }}
        onKeyDown={(event) => {
          handleCameraKey(event, store);
        }}
      />

      {!drawable && (
        <div className="view__overlay">
          <p>
            A graph needs a function of one real variable, such as{' '}
            <span className="view__mono">f(t)=exp(-t^2)</span>.
          </p>
        </div>
      )}

      {drawable && (
        <div className="legend legend--corner">
          <span className="legend__title">
            {isComplexValued ? 'Re f · Im f' : 'f'} over {variableName} ∈ [
            <NumberText value={viewNumber(visible.min)} />,{' '}
            <NumberText value={viewNumber(visible.max)} />]
          </span>
          {measured !== null && (
            <span className="legend__range">
              <NumberText value={viewNumber(measured.min)} /> …{' '}
              <NumberText value={viewNumber(measured.max)} />
              <button
                type="button"
                className="legend__action"
                onClick={fit}
                title="Move the frame to this range"
              >
                Fit
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
