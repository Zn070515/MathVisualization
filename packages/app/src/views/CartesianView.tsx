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
import { type Complex, cx, displayNumberToText } from '@mathviz/mathcore';
import { drawGridAndAxes } from '../render/axes2d';
import { CANVAS_COLORS, prepareCanvas2d } from '../render/canvasSurface';
import { NumberText } from '../display/NumberText';
import { viewNumber } from '../display/numbers';
import { useStore } from '../state/store';
import { selectActiveExpression, type ViewRendererProps } from '../state/workspaceStore';
import { handleCameraKey } from './cameraKeys';
import { makePointEvaluation } from './evaluation';
import { useResizeVersion } from './useResizeVersion';
import { fitViewport, fromScreen, planeWindow, toScreen } from './window2d';

/** Points sampled across the visible interval. */
const SAMPLES = 900;

interface Range {
  readonly min: number;
  readonly max: number;
}

export function CartesianView({ store }: ViewRendererProps): React.JSX.Element {
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

    // The shared cursor: a rule at the chosen value of the variable, and a mark
    // where the curve is there, so the readout has something on the picture to
    // point at.
    const cursor = state.hover ?? state.selection;
    if (cursor !== null) {
      const x = toScreen(window, { x: cursor.re, y: 0 }, width, height).x;
      if (Number.isFinite(x) && x >= 0 && x <= width) {
        context.strokeStyle = CANVAS_COLORS.cursor;
        context.lineWidth = Math.max(1, ratio);
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();

        const onCurve = evaluation.valueAt(cx(cursor.re, 0));
        if (onCurve !== null && Number.isFinite(onCurve.re)) {
          const mark = toScreen(window, { x: cursor.re, y: onCurve.re }, width, height);
          context.beginPath();
          context.arc(mark.x, mark.y, Math.max(2, ratio * 2.5), 0, Math.PI * 2);
          context.fillStyle = CANVAS_COLORS.curveSecondary;
          context.fill();
        }
      }
    }
  }, [
    drawable,
    evaluation,
    isComplexValued,
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
          store.setSelection(variableAt(event));
        }}
        onPointerMove={(event) => {
          const point = variableAt(event);
          if (point !== null) store.setHover(point);

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
