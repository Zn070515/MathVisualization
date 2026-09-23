import { useCallback, useEffect, useMemo, useRef } from 'react';
import { type FourierEstimate, displayNumberToText } from '@mathviz/mathcore';
import { drawGridAndAxes } from '../render/axes2d';
import { CANVAS_COLORS, prepareCanvas2d } from '../render/canvasSurface';
import { viewNumber } from '../display/numbers';
import { useStore } from '../state/store';
import { selectActiveExpression, type ViewRendererProps } from '../state/workspaceStore';
import type { FrequencyViewport } from '../state/workspaceStore';
import { useResizeVersion } from './useResizeVersion';
import {
  estimateActiveFourierTransform,
  fitFrequencyViewport,
  frequencyRange,
  projectFourierValue,
  snapFrequency,
  transformModeOf,
  type TransformMode,
} from './frequencyEvaluation';
import { toScreen, type Window2d } from './window2d';

const MODE_LABELS: Readonly<Record<TransformMode, string>> = {
  magnitude: '|F(ω)|',
  phase: 'arg F(ω)',
  real: 'Re F(ω)',
  imaginary: 'Im F(ω)',
};

export function FrequencyDomainView({ store, view }: ViewRendererProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resizeVersion = useResizeVersion(canvasRef);
  const state = useStore(store, (current) => current);
  const active = useMemo(
    () => selectActiveExpression(state.workspace, state.focusedLineId, store.drawableKinds),
    [state.workspace, state.focusedLineId, store.drawableKinds],
  );
  const estimate = useMemo(
    () => estimateActiveFourierTransform(active, state.workspace, state.parameterValues),
    [active, state.workspace, state.parameterValues],
  );
  const mode = transformModeOf(view.mode);
  const frequencyCursor = state.frequencyHover ?? state.frequencySelection;
  const measuredRange = useMemo(
    () => (estimate === null ? null : frequencyRange(estimate, mode)),
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
      xName: 'ω',
      yName: MODE_LABELS[mode],
    });
    if (estimate === null || estimate.values.length === 0) return;

    context.strokeStyle = CANVAS_COLORS.curve;
    context.lineWidth = Math.max(1.5, ratio * 1.8);
    context.beginPath();
    let started = false;
    for (let index = 0; index < estimate.values.length; index += 1) {
      const frequency = estimate.frequencies[index];
      const value = estimate.values[index];
      if (frequency === undefined || value === undefined) continue;
      const projected = projectFourierValue(value, mode);
      if (projected === null || !Number.isFinite(projected)) {
        started = false;
        continue;
      }
      const point = toScreen(window, { x: frequency, y: projected }, width, height);
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        started = false;
        continue;
      }
      if (started) context.lineTo(point.x, point.y);
      else context.moveTo(point.x, point.y);
      started = true;
    }
    context.stroke();

    if (frequencyCursor !== null) {
      const point = toScreen(window, { x: frequencyCursor, y: 0 }, width, height);
      if (Number.isFinite(point.x) && point.x >= 0 && point.x <= width) {
        context.strokeStyle = CANVAS_COLORS.cursor;
        context.lineWidth = Math.max(1, ratio);
        context.beginPath();
        context.moveTo(point.x, 0);
        context.lineTo(point.x, height);
        context.stroke();
      }
    }
  }, [estimate, frequencyCursor, frequencyViewport, mode]);

  useEffect(() => {
    draw();
  }, [draw, resizeVersion]);

  const diagnostic = diagnosticText(estimate);
  return (
    <div className="view view--frequency-domain" data-frequency-mode={mode}>
      <canvas
        ref={canvasRef}
        className="view__canvas view__canvas--paper"
        role="img"
        aria-label={`Frequency-domain plot of ${MODE_LABELS[mode]} over angular frequency ω`}
        onPointerMove={(event) => {
          const frequency = frequencyAt(event, canvasRef.current, plotWindow(frequencyViewport));
          const snapped =
            frequency === null || estimate === null
              ? null
              : snapFrequency(frequency, estimate.frequencies);
          if (snapped !== null) store.setFrequencyHover(snapped);
        }}
        onPointerDown={(event) => {
          const frequency = frequencyAt(event, canvasRef.current, plotWindow(frequencyViewport));
          const snapped =
            frequency === null || estimate === null
              ? null
              : snapFrequency(frequency, estimate.frequencies);
          if (snapped !== null) {
            store.setFrequencySelection(snapped);
            store.setFrequencyHover(snapped);
          }
        }}
        onPointerLeave={() => {
          store.clearFrequencyCursor();
        }}
      />

      <div className="legend legend--corner">
        <span className="legend__title">{MODE_LABELS[mode]} over ω ∈ [-8, 8]</span>
        {estimate !== null && (
          <span className="legend__range">
            finite t-window [-8, 8] · {estimate.timeSamples} samples ·{' '}
            {estimate.convergence === 'converged' ? 'refined' : 'unresolved'}
            {Number.isFinite(estimate.estimatedError) && (
              <> · error {displayNumberToText(viewNumber(estimate.estimatedError))}</>
            )}
          </span>
        )}
        {measuredRange !== null && (
          <span className="legend__range">
            measured y {displayNumberToText(viewNumber(measuredRange.min))} …{' '}
            {displayNumberToText(viewNumber(measuredRange.max))}
            <button
              type="button"
              className="legend__action"
              onClick={() => {
                if (estimate === null) return;
                const fitted = fitFrequencyViewport(frequencyViewport, estimate, mode);
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

function plotWindow(viewport: FrequencyViewport): Window2d {
  return {
    xMin: viewport.xMin,
    xMax: viewport.xMax,
    yMin: viewport.yMin,
    yMax: viewport.yMax,
  };
}

function frequencyAt(
  event: { clientX: number; clientY: number },
  canvas: HTMLCanvasElement | null,
  window: Window2d,
): number | null {
  if (canvas === null) return null;
  const bounds = canvas.getBoundingClientRect();
  if (bounds.width === 0) return null;
  const x =
    window.xMin + ((event.clientX - bounds.left) / bounds.width) * (window.xMax - window.xMin);
  return Number.isFinite(x) ? x : null;
}

function diagnosticText(estimate: FourierEstimate | null): string | null {
  if (estimate === null) return 'Add F(ω)=Fourier(f(t)) to open a frequency-domain view.';
  if (estimate.values.length > 0 && estimate.convergence === 'converged') return null;
  return estimate.diagnostics.join(' ');
}
