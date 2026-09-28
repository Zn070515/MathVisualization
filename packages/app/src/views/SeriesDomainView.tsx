/**
 * A linked periodic signal and its finite Fourier-series partial sum.
 *
 * The coefficients come from the shared numerical estimate. The source curve is
 * sampled independently through the ordinary point evaluator, so a failed source
 * sample creates a gap instead of a line across an undefined point. The frame is
 * persistent state: this view derives an initial one-period frame, but only the
 * explicit Fit action changes an existing frame.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  cx,
  displayNumberToText,
  evaluateFourierSeriesAt,
  type FourierSeriesEstimate,
} from '@mathviz/mathcore';
import { drawGridAndAxes } from '../render/axes2d';
import { CANVAS_COLORS, prepareCanvas2d } from '../render/canvasSurface';
import { viewNumber } from '../display/numbers';
import { useStore } from '../state/store';
import {
  selectActiveExpression,
  selectSourceExpression,
  type SeriesViewport,
  type ViewRendererProps,
} from '../state/workspaceStore';
import { useResizeVersion } from './useResizeVersion';
import { makePointEvaluation } from './evaluation';
import {
  estimateActiveFourierSeries,
  fitSeriesViewport,
  initialSeriesViewport,
  selectFourierSeries,
} from './seriesEvaluation';
import { fromScreen, toScreen, type Window2d } from './window2d';

const CURVE_SAMPLES = 512;

interface Range {
  readonly min: number;
  readonly max: number;
}

export function SeriesDomainView({ store }: ViewRendererProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resizeVersion = useResizeVersion(canvasRef);
  const state = useStore(store, (current) => current);
  const active = useMemo(
    () => selectActiveExpression(state.workspace, state.focusedLineId, store.drawableKinds),
    [state.focusedLineId, state.workspace, store.drawableKinds],
  );
  const source = useMemo(
    () => selectSourceExpression(state.workspace, state.focusedLineId, store.drawableKinds),
    [state.focusedLineId, state.workspace, store.drawableKinds],
  );
  const series = useMemo(() => selectFourierSeries(active), [active]);
  const evaluation = useMemo(
    () => makePointEvaluation(source, state.parameterValues, state.workspace.functions),
    [source, state.parameterValues, state.workspace.functions],
  );
  const estimate = useMemo(
    () =>
      estimateActiveFourierSeries(
        active,
        state.workspace,
        state.parameterValues,
        state.seriesSettings,
      ),
    [active, state.parameterValues, state.seriesSettings, state.workspace],
  );
  const sourceRange = useMemo(
    () => measureCurves(evaluation, estimate, estimate?.period ?? 2),
    [evaluation, estimate],
  );
  const frame = useMemo<SeriesViewport>(() => {
    if (state.seriesViewport !== null) return state.seriesViewport;
    return initialSeriesViewport(estimate?.period ?? 2, sourceRange ?? { min: -1, max: 1 });
  }, [estimate?.period, sourceRange, state.seriesViewport]);
  const plot = frame as Window2d;
  const samples = useMemo(
    () => sampleCurves(evaluation, estimate, frame),
    [evaluation, estimate, frame],
  );
  const sourceName = series?.sourceVariable ?? source?.parameterNames[0] ?? 't';

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const surface = prepareCanvas2d(canvas);
    if (surface === null) return;
    const { context, width, height, ratio } = surface;
    drawGridAndAxes(context, {
      window: plot,
      width,
      height,
      ratio,
      xName: 't',
      yName: 'value',
    });
    drawCurve(context, plot, samples.source, width, height, ratio, CANVAS_COLORS.curveSecondary);
    drawCurve(context, plot, samples.partial, width, height, ratio, CANVAS_COLORS.curve, 2.1);

    const cursor = state.hover?.re ?? state.selection?.re;
    if (cursor !== undefined && cursor !== null && Number.isFinite(cursor)) {
      const point = toScreen(plot, { x: cursor, y: 0 }, width, height);
      if (Number.isFinite(point.x) && point.x >= 0 && point.x <= width) {
        context.strokeStyle = CANVAS_COLORS.cursor;
        context.lineWidth = Math.max(1, ratio);
        context.beginPath();
        context.moveTo(point.x, 0);
        context.lineTo(point.x, height);
        context.stroke();
      }
    }
  }, [plot, samples, state.hover, state.selection]);

  useEffect(() => {
    draw();
  }, [draw, resizeVersion]);

  const onPointerTime = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): number | null => {
      const canvas = canvasRef.current;
      if (canvas === null) return null;
      const bounds = canvas.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return null;
      const point = fromScreen(
        plot,
        { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        bounds.width,
        bounds.height,
      );
      return Number.isFinite(point.x) ? point.x : null;
    },
    [plot],
  );

  const onFit = (): void => {
    if (estimate === null) return;
    const fitted = fitSeriesViewport(frame, estimate, sourceRange ?? { min: -1, max: 1 });
    if (fitted !== null) store.setSeriesViewport(fitted);
  };

  const diagnostic = seriesDiagnostic(estimate);
  const rangeText = `t ∈ [${displayNumberToText(viewNumber(frame.xMin))}, ${displayNumberToText(
    viewNumber(frame.xMax),
  )}]`;

  return (
    <div className="view view--series-domain">
      <canvas
        ref={canvasRef}
        className="view__canvas view__canvas--paper"
        role="img"
        aria-label="Fourier series partial sums"
        onPointerMove={(event) => {
          const time = onPointerTime(event);
          store.setHover(time === null ? null : cx(time, 0));
        }}
        onPointerDown={(event) => {
          const time = onPointerTime(event);
          if (time !== null) {
            store.setSelection(cx(time, 0));
            store.setHover(cx(time, 0));
          }
        }}
        onPointerLeave={() => store.clearCursor()}
      />

      <div className="legend legend--corner">
        <span className="legend__title">source f({sourceName}) · partial sum Sₙ(t)</span>
        <span className="legend__range">{rangeText} · persistent frame</span>
        <span className="legend__range legend__control">
          <label>
            Fourier series order{' '}
            <select
              aria-label="Fourier series order"
              value={state.seriesSettings.order}
              onChange={(event) =>
                store.setFourierSeriesSettings({
                  ...state.seriesSettings,
                  order: Number(event.target.value),
                })
              }
            >
              {Array.from({ length: 64 }, (_, index) => index + 1).map((order) => (
                <option key={order} value={order}>
                  {order}
                </option>
              ))}
            </select>
          </label>{' '}
          <label>
            integration intervals{' '}
            <select
              aria-label="Fourier series integration intervals"
              value={state.seriesSettings.integrationSampleCount}
              onChange={(event) =>
                store.setFourierSeriesSettings({
                  ...state.seriesSettings,
                  integrationSampleCount: Number(event.target.value),
                })
              }
            >
              {[32, 64, 128, 256, 512].map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>
        </span>
        <span className="legend__range">
          <button type="button" aria-label="Fit Fourier series view" onClick={onFit}>
            Fit
          </button>
        </span>
        {estimate !== null && <SeriesEstimateLegend estimate={estimate} />}
        {diagnostic !== null && (
          <span className="legend__range" role="status">
            {diagnostic}
          </span>
        )}
      </div>
    </div>
  );
}

function SeriesEstimateLegend({ estimate }: { readonly estimate: FourierSeriesEstimate }) {
  const period =
    estimate.period === null ? 'unresolved' : displayNumberToText(viewNumber(estimate.period));
  const quadrature =
    estimate.baseIntegrationIntervals > 0 && estimate.refinedIntegrationIntervals > 0
      ? `Q requested ${estimate.requestedIntegrationSampleCount} · Q_eff ${estimate.baseIntegrationIntervals} · ${
          estimate.constantCoefficient !== null &&
          estimate.cosineCoefficients.length === estimate.order &&
          estimate.sineCoefficients.length === estimate.order
            ? `refined ${estimate.refinedIntegrationIntervals}`
            : 'refinement unavailable'
        }`
      : `Q requested ${estimate.requestedIntegrationSampleCount} · quadrature unresolved before refinement`;
  const disagreement = Number.isFinite(estimate.coefficientDisagreement)
    ? `coefficient disagreement ${displayNumberToText(viewNumber(estimate.coefficientDisagreement))}`
    : 'coefficient disagreement unresolved';
  return (
    <>
      <span className="legend__range">
        P = {period} · {quadrature}
      </span>
      <span className="legend__range">
        {disagreement} · {convergenceLabel(estimate)}
      </span>
    </>
  );
}

function convergenceLabel(estimate: FourierSeriesEstimate): string {
  if (estimate.constantCoefficient === null) return 'unresolved estimate';
  return estimate.convergence === 'converged'
    ? 'coefficient refinement converged (sampled)'
    : 'sampling-sensitive: coefficient refinement unresolved';
}

function seriesDiagnostic(estimate: FourierSeriesEstimate | null): string | null {
  if (estimate === null) return 'Add S(t)=FourierSeries(f(u), P) to open this view.';
  if (estimate.constantCoefficient !== null) return null;
  return `Fourier-series estimate unresolved: ${estimate.diagnostics.at(-1) ?? 'no finite coefficients were obtained.'}`;
}

function measureCurves(
  evaluation: ReturnType<typeof makePointEvaluation>,
  estimate: FourierSeriesEstimate | null,
  period: number,
): Range | null {
  if (evaluation === null || !Number.isFinite(period) || period <= 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index <= 256; index += 1) {
    const time = -period / 2 + (period * index) / 256;
    const value = evaluation.valueAt(cx(time, 0));
    if (value !== null && Number.isFinite(value.re) && value.im === 0) {
      min = Math.min(min, value.re);
      max = Math.max(max, value.re);
    }
    const partial = estimate === null ? null : evaluateFourierSeriesAt(estimate, time);
    if (partial !== null && Number.isFinite(partial)) {
      min = Math.min(min, partial);
      max = Math.max(max, partial);
    }
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

function sampleCurves(
  evaluation: ReturnType<typeof makePointEvaluation>,
  estimate: FourierSeriesEstimate | null,
  frame: SeriesViewport,
): { source: readonly (number | null)[]; partial: readonly (number | null)[] } {
  const source: (number | null)[] = [];
  const partial: (number | null)[] = [];
  for (let index = 0; index <= CURVE_SAMPLES; index += 1) {
    const time = frame.xMin + ((frame.xMax - frame.xMin) * index) / CURVE_SAMPLES;
    const sourceValue = evaluation?.valueAt(cx(time, 0));
    source.push(
      sourceValue !== null &&
        sourceValue !== undefined &&
        sourceValue.im === 0 &&
        Number.isFinite(sourceValue.re)
        ? sourceValue.re
        : null,
    );
    const seriesValue = estimate === null ? null : evaluateFourierSeriesAt(estimate, time);
    partial.push(seriesValue);
  }
  return { source, partial };
}

function drawCurve(
  context: CanvasRenderingContext2D,
  window: Window2d,
  values: readonly (number | null)[],
  width: number,
  height: number,
  ratio: number,
  colour: string,
  lineWidth = 1.4,
): void {
  context.strokeStyle = colour;
  context.lineWidth = Math.max(lineWidth, ratio * lineWidth);
  context.beginPath();
  let started = false;
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      started = false;
      return;
    }
    const x = window.xMin + ((window.xMax - window.xMin) * index) / CURVE_SAMPLES;
    const point = toScreen(window, { x, y: value }, width, height);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      started = false;
      return;
    }
    if (started) context.lineTo(point.x, point.y);
    else {
      context.moveTo(point.x, point.y);
      started = true;
    }
  });
  context.stroke();
}
