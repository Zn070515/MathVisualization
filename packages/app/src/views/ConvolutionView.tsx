/**
 * A finite-window numerical convolution view.
 *
 * The three curves are deliberately drawn from one estimate: the two source
 * samples and the accumulated integral at the same output times. This keeps the
 * picture honest about what was evaluated, and makes the relationship between
 * the input signals and (f * g)(t) visible without claiming a whole-line exact
 * convolution.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cx, displayNumberToText, type FieldMode } from '@mathviz/mathcore';
import { drawGridAndAxes } from '../render/axes2d';
import { CANVAS_COLORS, prepareCanvas2d } from '../render/canvasSurface';
import { viewNumber } from '../display/numbers';
import { useStore } from '../state/store';
import { selectActiveExpression, type ViewRendererProps } from '../state/workspaceStore';
import { useResizeVersion } from './useResizeVersion';
import {
  estimateActiveConvolution,
  estimateActiveConvolutionConstruction,
  estimateActiveDftProduct,
  projectConstructionValue,
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
  const constructionCanvasRef = useRef<HTMLCanvasElement>(null);
  const resizeVersion = useResizeVersion(canvasRef);
  const constructionResizeVersion = useResizeVersion(constructionCanvasRef);
  const [showConstruction, setShowConstruction] = useState(false);
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
  const outputTime = state.hover?.re ?? state.selection?.re ?? null;
  const construction = useMemo(
    () =>
      showConstruction
        ? estimateActiveConvolutionConstruction(
            active,
            state.workspace,
            state.parameterValues,
            outputTime,
            settings,
          )
        : null,
    [active, outputTime, settings, showConstruction, state.parameterValues, state.workspace],
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
  const constructionCurves = useMemo(
    () =>
      construction === null
        ? null
        : {
            left: projectConstructionSeries(construction.tau, construction.leftValues, mode),
            shiftedRight: projectConstructionSeries(
              construction.tau,
              construction.shiftedRightValues,
              mode,
            ),
            product: projectConstructionSeries(construction.tau, construction.productValues, mode),
            accumulated: projectConstructionSeries(
              construction.tau,
              construction.accumulatedValues,
              mode,
            ),
          },
    [construction, mode],
  );
  const constructionTopPlot = useMemo(
    () => ({
      xMin: settings.integrationWindow.min,
      xMax: settings.integrationWindow.max,
      yMin: rangeOfConstruction(constructionCurves, 'top').min,
      yMax: rangeOfConstruction(constructionCurves, 'top').max,
    }),
    [constructionCurves, settings.integrationWindow],
  );
  const constructionAccumulationPlot = useMemo(
    () => ({
      xMin: settings.integrationWindow.min,
      xMax: settings.integrationWindow.max,
      yMin: rangeOfConstruction(constructionCurves, 'accumulated').min,
      yMax: rangeOfConstruction(constructionCurves, 'accumulated').max,
    }),
    [constructionCurves, settings.integrationWindow],
  );
  const cursor = outputTime;

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

  const drawConstruction = useCallback(() => {
    const canvas = constructionCanvasRef.current;
    if (canvas === null) return;
    const surface = prepareCanvas2d(canvas);
    if (surface === null) return;
    const { context, width, height, ratio } = surface;
    if (!showConstruction || constructionCurves === null) return;

    const topHeight = Math.max(1, Math.floor(height * 0.58));
    const bottomHeight = Math.max(1, height - topHeight);
    context.save();
    drawConstructionBand(
      context,
      constructionTopPlot,
      {
        left: constructionCurves.left,
        shiftedRight: constructionCurves.shiftedRight,
        product: constructionCurves.product,
      },
      width,
      topHeight,
      ratio,
      'f(τ), g(T−τ), product',
    );
    context.translate(0, topHeight);
    drawGridAndAxes(context, {
      window: constructionAccumulationPlot,
      width,
      height: bottomHeight,
      ratio,
      xName: 'τ',
      yName: 'A_T(τ)',
    });
    drawConstructionCurve(
      context,
      constructionAccumulationPlot,
      constructionCurves.accumulated,
      width,
      bottomHeight,
      ratio,
      CANVAS_COLORS.curve,
      2.2,
    );
    context.restore();
  }, [constructionAccumulationPlot, constructionCurves, constructionTopPlot, showConstruction]);

  useEffect(() => {
    drawConstruction();
  }, [constructionResizeVersion, drawConstruction]);

  const sourceNames = sourceLabels(convolution);
  const diagnostic = diagnosticText(estimate);
  const rangeText = `t ∈ [${displayNumberToText(viewNumber(plot.xMin))}, ${displayNumberToText(
    viewNumber(plot.xMax),
  )}]`;
  const hasConstructionCanvas = showConstruction && construction !== null;

  return (
    <div
      className={
        hasConstructionCanvas
          ? 'view view--convolution view--convolution-construction'
          : 'view view--convolution'
      }
    >
      <div className="convolution-view__plots">
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
        <canvas
          ref={constructionCanvasRef}
          className={
            hasConstructionCanvas
              ? 'view__canvas view__canvas--paper view__canvas--construction'
              : 'view__canvas view__canvas--paper view__canvas--construction view__canvas--construction-hidden'
          }
          role={hasConstructionCanvas ? 'img' : undefined}
          aria-hidden={!hasConstructionCanvas}
          aria-label={
            hasConstructionCanvas
              ? `Convolution construction at T=${displayNumberToText(viewNumber(outputTime as number))}`
              : undefined
          }
        />
      </div>

      <div className="legend legend--corner">
        <span className="legend__title">
          {sourceNames[0]} · {sourceNames[1]} · ({sourceNames[0]} * {sourceNames[1]})(t)
        </span>
        <span className="legend__range">
          {MODE_LABELS[mode]} projection · finite t-window {rangeText}
        </span>
        <label className="legend__range legend__control">
          <input
            type="checkbox"
            aria-label="show convolution construction"
            checked={showConstruction}
            onChange={(event) => setShowConstruction(event.target.checked)}
          />{' '}
          show convolution construction
        </label>
        {showConstruction && outputTime === null && (
          <span className="legend__range" role="status">
            select or move over an output coordinate to see the construction
          </span>
        )}
        {showConstruction && construction !== null && (
          <>
            <span className="legend__range">
              T = {displayNumberToText(viewNumber(construction.outputTime))} · τ ∈ [
              {displayNumberToText(viewNumber(construction.integrationWindow.min))},{' '}
              {displayNumberToText(viewNumber(construction.integrationWindow.max))}]
            </span>
            <span className="legend__range">
              f(τ) · g(T−τ) · accumulated integral · {construction.refinedIntegrationSampleCount}{' '}
              refined samples from {construction.primaryIntegrationSampleCount}
            </span>
            {Number.isFinite(construction.estimatedError) && (
              <span className="legend__range">
                construction refinement error{' '}
                {displayNumberToText(viewNumber(construction.estimatedError))} ·{' '}
                {construction.stability}
              </span>
            )}
          </>
        )}
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
              origin phase: exp(i·ω·t_min) · sampled identity: {productCheck.status}
            </span>
            {Number.isFinite(productCheck.maxAbsoluteDifference) && (
              <span className="legend__range">
                max difference {displayNumberToText(viewNumber(productCheck.maxAbsoluteDifference))}
              </span>
            )}
            <span className="legend__range">
              sampling representation: {productCheck.samplingStatus}
            </span>
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

interface ConstructionPoint {
  readonly time: number;
  readonly value: number | null;
}

interface ConstructionCurves {
  readonly left: readonly ConstructionPoint[];
  readonly shiftedRight: readonly ConstructionPoint[];
  readonly product: readonly ConstructionPoint[];
  readonly accumulated: readonly ConstructionPoint[];
}

function projectConstructionSeries(
  times: readonly number[],
  values: readonly ({ readonly re: number; readonly im: number } | null)[],
  mode: Exclude<FieldMode, 'complex'>,
): readonly ConstructionPoint[] {
  const series: ConstructionPoint[] = [];
  for (let index = 0; index < times.length; index += 1) {
    const time = times[index];
    if (time === undefined) continue;
    const value = values[index] ?? null;
    const projected = projectConstructionValue(value, mode);
    series.push({
      time,
      value: projected !== null && Number.isFinite(projected) ? projected : null,
    });
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

function rangeOfConstruction(
  curves: ConstructionCurves | null,
  section: 'top' | 'accumulated',
): Range {
  if (curves === null) return { min: -1, max: 1 };
  const series =
    section === 'top'
      ? [...curves.left, ...curves.shiftedRight, ...curves.product]
      : curves.accumulated;
  const finite = series
    .map((point) => point.value)
    .filter((value): value is number => value !== null && Number.isFinite(value));
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

function drawConstructionBand(
  context: CanvasRenderingContext2D,
  plot: Window2d,
  curves: Pick<ConstructionCurves, 'left' | 'shiftedRight' | 'product'>,
  width: number,
  height: number,
  ratio: number,
  yName: string,
): void {
  drawGridAndAxes(context, {
    window: plot,
    width,
    height,
    ratio,
    xName: 'τ',
    yName,
  });
  drawConstructionCurve(
    context,
    plot,
    curves.left,
    width,
    height,
    ratio,
    CANVAS_COLORS.curveSecondary,
  );
  drawConstructionCurve(
    context,
    plot,
    curves.shiftedRight,
    width,
    height,
    ratio,
    CANVAS_COLORS.tickLabel,
  );
  drawConstructionCurve(
    context,
    plot,
    curves.product,
    width,
    height,
    ratio,
    CONVOLUTION_COLOUR,
    2.2,
  );
}

function drawConstructionCurve(
  context: CanvasRenderingContext2D,
  plot: Window2d,
  series: readonly ConstructionPoint[],
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
    if (point.value === null) {
      started = false;
      continue;
    }
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
