/**
 * A finite-window numerical convolution view.
 *
 * The three curves are deliberately drawn from one estimate: the two source
 * samples and the accumulated integral at the same output times. This keeps the
 * picture honest about what was evaluated, and makes the relationship between
 * the input signals and (f * g)(t) visible without claiming a whole-line exact
 * convolution.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { cx, displayNumberToText, type FieldMode } from '@mathviz/mathcore';
import { drawGridAndAxes } from '../render/axes2d';
import { CANVAS_COLORS, prepareCanvas2d } from '../render/canvasSurface';
import { viewNumber } from '../display/numbers';
import { useStore } from '../state/store';
import { selectActiveExpression, type ViewRendererProps } from '../state/workspaceStore';
import { useResizeVersion } from './useResizeVersion';
import {
  estimateActiveConvolution,
  estimateActiveDftProduct,
  projectConvolutionValue,
  selectConvolution,
  type ConvolutionSettings,
} from './convolutionEvaluation';
import { toScreen, type Window2d } from './window2d';

const CONVOLUTION_COLOUR = '#2f6f8f';

const MODE_LABELS: Readonly<Record<Exclude<FieldMode, 'complex'>, string>> = {
  real: 'Re',
  imaginary: 'Im',
  magnitude: '|·|',
  phase: 'arg',
};

interface Range {
  readonly min: number;
  readonly max: number;
}

export function ConvolutionView({ store, view }: ViewRendererProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resizeVersion = useResizeVersion(canvasRef);
  const state = useStore(store, (current) => current);
  const active = useMemo(
    () => selectActiveExpression(state.workspace, state.focusedLineId, store.drawableKinds),
    [state.workspace, state.focusedLineId, store.drawableKinds],
  );
  const convolution = useMemo(() => selectConvolution(active), [active]);
  const settings = useMemo<ConvolutionSettings>(
    () => ({
      integrationWindow: state.sampling.timeWindow,
      outputWindow: state.sampling.timeWindow,
      outputSampleCount: state.sampling.sampleCount,
      integrationSampleCount: state.sampling.sampleCount,
    }),
    [state.sampling],
  );
  const estimate = useMemo(
    () => estimateActiveConvolution(active, state.workspace, state.parameterValues, settings),
    [active, state.workspace, state.parameterValues, settings],
  );
  const productCheck = useMemo(
    () => estimateActiveDftProduct(active, state.workspace, state.parameterValues, state.sampling),
    [active, state.workspace, state.parameterValues, state.sampling],
  );
  const mode = normaliseMode(view.mode);
  const curves = useMemo(
    () =>
      estimate === null
        ? null
        : {
            left: projectSeries(estimate.sampleTimes, estimate.leftValues, mode),
            right: projectSeries(estimate.sampleTimes, estimate.rightValues, mode),
            convolution: projectSeries(estimate.sampleTimes, estimate.values, mode),
          },
    [estimate, mode],
  );
  const measured = useMemo(() => rangeOf(curves), [curves]);
  const plot = useMemo(
    () => ({
      xMin: settings.outputWindow.min,
      xMax: settings.outputWindow.max,
      yMin: measured.min,
      yMax: measured.max,
    }),
    [measured, settings.outputWindow],
  );
  const cursor = state.hover?.re ?? state.selection?.re ?? null;

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
      yName: convolutionModeLabel(mode),
    });

    if (curves !== null) {
      drawCurve(context, plot, curves.left, width, height, ratio, CANVAS_COLORS.curveSecondary);
      drawCurve(context, plot, curves.right, width, height, ratio, CANVAS_COLORS.tickLabel);
      drawCurve(context, plot, curves.convolution, width, height, ratio, CONVOLUTION_COLOUR, 2.2);
    }

    if (cursor !== null) {
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
  }, [cursor, curves, mode, plot]);

  useEffect(() => {
    draw();
  }, [draw, resizeVersion]);

  const sourceNames = sourceLabels(convolution);
  const diagnostic = diagnosticText(estimate);
  const rangeText = `t ∈ [${displayNumberToText(viewNumber(plot.xMin))}, ${displayNumberToText(
    viewNumber(plot.xMax),
  )}]`;

  return (
    <div className="view view--convolution">
      <canvas
        ref={canvasRef}
        className="view__canvas view__canvas--paper"
        role="img"
        aria-label={`Finite-window numerical convolution of ${sourceNames[0]} and ${sourceNames[1]} over ${rangeText}`}
        onPointerMove={(event) => {
          const time = timeAt(event, canvasRef.current, plot);
          store.setHover(time === null ? null : cx(time, 0));
        }}
        onPointerDown={(event) => {
          const time = timeAt(event, canvasRef.current, plot);
          if (time !== null) {
            store.setSelection(cx(time, 0));
            store.setHover(cx(time, 0));
          }
        }}
        onPointerLeave={() => {
          store.clearCursor();
        }}
      />

      <div className="legend legend--corner">
        <span className="legend__title">
          {sourceNames[0]} · {sourceNames[1]} · ({sourceNames[0]} * {sourceNames[1]})(t)
        </span>
        <span className="legend__range">
          {MODE_LABELS[mode]} projection · finite t-window {rangeText}
        </span>
        <span className="legend__range">
          {settings.outputSampleCount} output samples ·{' '}
          {estimate?.refinedIntegrationSampleCount ?? settings.integrationSampleCount} refined
          integration samples
          {estimate !== null && <> · refinement from {estimate.primaryIntegrationSampleCount}</>}
        </span>
        {estimate !== null && Number.isFinite(estimate.estimatedError) && (
          <span className="legend__range">
            refinement error {displayNumberToText(viewNumber(estimate.estimatedError))} ·{' '}
            {estimate.stability}
          </span>
        )}
        {productCheck !== null && (
          <>
            <span className="legend__range">DFT product check · periodic sampled convolution</span>
            <span className="legend__range">
              origin phase: exp(i·ω·t_min) · {productCheck.status}
            </span>
            {Number.isFinite(productCheck.maxAbsoluteDifference) && (
              <span className="legend__range">
                max difference {displayNumberToText(viewNumber(productCheck.maxAbsoluteDifference))}
              </span>
            )}
          </>
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

function normaliseMode(mode: FieldMode): Exclude<FieldMode, 'complex'> {
  return mode === 'complex' ? 'magnitude' : mode;
}

function convolutionModeLabel(mode: Exclude<FieldMode, 'complex'>): string {
  return mode === 'magnitude' ? '|f*g|' : `${MODE_LABELS[mode]}(f*g)`;
}

function projectSeries(
  times: readonly number[],
  values: readonly { readonly re: number; readonly im: number }[],
  mode: Exclude<FieldMode, 'complex'>,
): readonly { readonly time: number; readonly value: number }[] {
  const series: { time: number; value: number }[] = [];
  for (let index = 0; index < Math.min(times.length, values.length); index += 1) {
    const time = times[index];
    const value = values[index];
    if (time === undefined || value === undefined) continue;
    const projected = projectConvolutionValue(value, mode);
    if (projected !== null && Number.isFinite(projected)) series.push({ time, value: projected });
  }
  return series;
}

function rangeOf(
  curves: {
    readonly left: readonly { readonly time: number; readonly value: number }[];
    readonly right: readonly { readonly time: number; readonly value: number }[];
    readonly convolution: readonly { readonly time: number; readonly value: number }[];
  } | null,
): Range {
  if (curves === null) return { min: -1, max: 1 };
  const values = [...curves.left, ...curves.right, ...curves.convolution].map(
    (point) => point.value,
  );
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return { min: -1, max: 1 };
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (min === max) {
    const padding = Math.max(1, Math.abs(min) * 0.08);
    min -= padding;
    max += padding;
  } else {
    const padding = (max - min) * 0.08;
    min -= padding;
    max += padding;
  }
  return { min, max };
}

function drawCurve(
  context: CanvasRenderingContext2D,
  plot: Window2d,
  series: readonly { readonly time: number; readonly value: number }[],
  width: number,
  height: number,
  ratio: number,
  colour: string,
  widthMultiplier = 1.5,
): void {
  context.strokeStyle = colour;
  context.lineWidth = Math.max(1.2, ratio * widthMultiplier);
  context.beginPath();
  let started = false;
  for (const point of series) {
    const screen = toScreen(plot, { x: point.time, y: point.value }, width, height);
    if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y)) {
      started = false;
      continue;
    }
    if (started) context.lineTo(screen.x, screen.y);
    else context.moveTo(screen.x, screen.y);
    started = true;
  }
  context.stroke();
}

function sourceLabels(node: ReturnType<typeof selectConvolution>): readonly [string, string] {
  if (node === null) return ['f', 'g'];
  return [sourceLabel(node.left, 'f'), sourceLabel(node.right, 'g')];
}

function sourceLabel(
  source: { readonly kind: string; readonly callee?: string },
  fallback: string,
): string {
  return source.kind === 'call' && source.callee !== undefined ? source.callee : fallback;
}

function timeAt(
  event: { readonly clientX: number },
  canvas: HTMLCanvasElement | null,
  plot: Window2d,
): number | null {
  if (canvas === null) return null;
  const bounds = canvas.getBoundingClientRect();
  if (bounds.width === 0) return null;
  const time = plot.xMin + ((event.clientX - bounds.left) / bounds.width) * (plot.xMax - plot.xMin);
  return Number.isFinite(time) ? time : null;
}

function diagnosticText(estimate: ReturnType<typeof estimateActiveConvolution>): string | null {
  if (estimate === null) return 'Add Convolution(f(t), g(t)) to open a convolution view.';
  if (estimate.stability === 'stable' && estimate.values.length > 0) return null;
  return estimate.diagnostics.join(' ');
}
