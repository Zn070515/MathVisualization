import { useCallback, useEffect, useMemo, useRef } from 'react';
import { displayNumberToText } from '@mathviz/mathcore';
import { drawGridAndAxes } from '../render/axes2d';
import { CANVAS_COLORS, prepareCanvas2d } from '../render/canvasSurface';
import { viewNumber } from '../display/numbers';
import { useStore } from '../state/store';
import {
  DFT_SAMPLE_COUNTS,
  selectActiveExpression,
  type ViewRendererProps,
} from '../state/workspaceStore';
import { useResizeVersion } from './useResizeVersion';
import {
  dftRange,
  dftStemValues,
  dftFrequencyVariable,
  estimateActiveDft,
  fitDftViewport,
  nyquistBoundaryFrequencies,
  snapDftBin,
  type DftMode,
} from './dftEvaluation';
import { toScreen, type Window2d } from './window2d';

const MODE_LABELS: Readonly<Record<DftMode, string>> = {
  magnitude: '|D[k]|',
  phase: 'arg D[k]',
  real: 'Re D[k]',
  imaginary: 'Im D[k]',
};

export function DftDomainView({ store, view }: ViewRendererProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resizeVersion = useResizeVersion(canvasRef);
  const state = useStore(store, (current) => current);
  const active = useMemo(
    () => selectActiveExpression(state.workspace, state.focusedLineId, store.drawableKinds),
    [state.workspace, state.focusedLineId, store.drawableKinds],
  );
  const estimate = useMemo(
    () => estimateActiveDft(active, state.workspace, state.parameterValues, state.sampling),
    [active, state.workspace, state.parameterValues, state.sampling],
  );
  const frequencyVariable = dftFrequencyVariable(active);
  const mode: DftMode = view.mode === 'complex' ? 'magnitude' : view.mode;
  const frequencyCursor = state.frequencyHover ?? state.frequencySelection;
  const measuredRange = useMemo(
    () => (estimate === null ? null : dftRange(estimate, mode)),
    [estimate, mode],
  );
  const frequencyViewport = state.frequencyViewport;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const surface = prepareCanvas2d(canvas);
    if (surface === null) return;
    const { context, width, height, ratio } = surface;
    const window = plotWindow(frequencyViewport);
    drawGridAndAxes(context, {
      window,
      width,
      height,
      ratio,
      xName: frequencyVariable,
      yName: MODE_LABELS[mode],
    });
    if (estimate === null || estimate.values.length === 0) return;

    context.save();
    context.strokeStyle = CANVAS_COLORS.curveSecondary;
    context.lineWidth = Math.max(1, ratio);
    context.setLineDash([Math.max(4, ratio * 5), Math.max(3, ratio * 4)]);
    for (const boundary of nyquistBoundaryFrequencies(estimate)) {
      const point = toScreen(window, { x: boundary, y: 0 }, width, height);
      if (!Number.isFinite(point.x) || point.x < 0 || point.x > width) continue;
      context.beginPath();
      context.moveTo(point.x, 0);
      context.lineTo(point.x, height);
      context.stroke();
    }
    context.restore();

    const baseline = toScreen(window, { x: 0, y: 0 }, width, height).y;
    for (const stem of dftStemValues(estimate, mode)) {
      const point = toScreen(window, { x: stem.frequency, y: stem.value }, width, height);
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      context.strokeStyle = CANVAS_COLORS.curve;
      context.lineWidth = Math.max(1.2, ratio * 1.5);
      context.beginPath();
      context.moveTo(point.x, baseline);
      context.lineTo(point.x, point.y);
      context.stroke();
      context.fillStyle = CANVAS_COLORS.curve;
      context.beginPath();
      context.arc(point.x, point.y, Math.max(2.5, ratio * 3), 0, Math.PI * 2);
      context.fill();
    }

    if (frequencyCursor !== null) {
      const snapped = snapDftBin(frequencyCursor, estimate);
      if (snapped !== null) {
        const point = toScreen(window, { x: snapped.frequency, y: 0 }, width, height);
        if (Number.isFinite(point.x) && point.x >= 0 && point.x <= width) {
          context.strokeStyle = CANVAS_COLORS.cursor;
          context.lineWidth = Math.max(1, ratio);
          context.beginPath();
          context.moveTo(point.x, 0);
          context.lineTo(point.x, height);
          context.stroke();
        }
      }
    }
  }, [estimate, frequencyCursor, frequencyVariable, frequencyViewport, mode]);

  useEffect(() => {
    draw();
  }, [draw, resizeVersion]);

  const diagnostic = diagnosticText(estimate);
  return (
    <div className="view view--frequency-domain" data-frequency-mode={mode} data-transform="dft">
      <canvas
        ref={canvasRef}
        className="view__canvas view__canvas--paper"
        role="img"
        aria-label={`Discrete Fourier spectrum of ${MODE_LABELS[mode]} over angular frequency ${frequencyVariable}`}
        onPointerMove={(event) => {
          const frequency = frequencyAt(event, canvasRef.current, plotWindow(frequencyViewport));
          if (frequency === null || estimate === null) return;
          const snapped = snapDftBin(frequency, estimate);
          if (snapped !== null) store.setFrequencyHover(snapped.frequency);
        }}
        onPointerDown={(event) => {
          const frequency = frequencyAt(event, canvasRef.current, plotWindow(frequencyViewport));
          if (frequency === null || estimate === null) return;
          const snapped = snapDftBin(frequency, estimate);
          if (snapped !== null) {
            store.setFrequencySelection(snapped.frequency);
            store.setFrequencyHover(snapped.frequency);
          }
        }}
        onPointerLeave={() => {
          store.clearFrequencyCursor();
        }}
      />

      <div className="legend legend--corner">
        <span className="legend__title">
          {MODE_LABELS[mode]} · discrete DFT bins over {frequencyVariable}
        </span>
        <label className="legend__range">
          <span>N</span>{' '}
          <select
            aria-label="DFT sample count"
            value={state.sampling.sampleCount}
            onChange={(event) => {
              store.setSamplingSettings({
                ...state.sampling,
                sampleCount: Number(event.target.value),
              });
            }}
          >
            {DFT_SAMPLE_COUNTS.map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </label>
        {estimate !== null && (
          <span className="legend__range">
            Δt {displayNumberToText(viewNumber(estimate.sampleInterval))} · fₛ{' '}
            {displayNumberToText(viewNumber(estimate.samplingFrequency))} · Nyquist{' '}
            {displayNumberToText(viewNumber(estimate.nyquistAngularFrequency))}
          </span>
        )}
        {measuredRange !== null && (
          <span className="legend__range">
            measured y {displayNumberToText(viewNumber(measuredRange.min))} …{' '}
            {displayNumberToText(viewNumber(measuredRange.max))}{' '}
            <button
              type="button"
              className="legend__action"
              onClick={() => {
                if (estimate === null) return;
                const fitted = fitDftViewport(frequencyViewport, estimate, mode);
                if (fitted !== null) store.setFrequencyViewport(fitted);
              }}
              title="Move the frequency frame to the measured range"
            >
              Fit
            </button>
          </span>
        )}
      </div>

      {diagnostic !== null && (
        <div className="view__overlay" role="status">
          <p>{diagnostic}</p>
        </div>
      )}
    </div>
  );
}

function plotWindow(viewport: { xMin: number; xMax: number; yMin: number; yMax: number }): Window2d {
  return viewport;
}

function frequencyAt(
  event: { clientX: number },
  canvas: HTMLCanvasElement | null,
  window: Window2d,
): number | null {
  if (canvas === null) return null;
  const bounds = canvas.getBoundingClientRect();
  if (bounds.width === 0) return null;
  const frequency =
    window.xMin + ((event.clientX - bounds.left) / bounds.width) * (window.xMax - window.xMin);
  return Number.isFinite(frequency) ? frequency : null;
}

function diagnosticText(estimate: ReturnType<typeof estimateActiveDft>): string | null {
  if (estimate === null) return 'Add D(ω)=DFT(f(t)) to open a discrete spectrum view.';
  if (estimate.stability === 'stable') return null;
  return estimate.diagnostics.join(' ');
}
