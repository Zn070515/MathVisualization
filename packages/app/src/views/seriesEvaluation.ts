import {
  type FourierSeriesEstimate,
  type FourierSeriesNode,
  type Workspace,
  evaluateFourierSeriesAt,
  estimateFourierSeries,
  workspaceEnvironment,
} from '@mathviz/mathcore';
import type {
  ActiveExpression,
  FourierSeriesSettings,
  SeriesViewport,
} from '../state/workspaceStore';

/** Series estimates are shared by the series canvas and its readout. */
const estimateCache = new WeakMap<Workspace, Map<string, FourierSeriesEstimate | null>>();

export function selectFourierSeries(active: ActiveExpression | null): FourierSeriesNode | null {
  const statement = active?.entry.statement;
  if (statement?.kind !== 'function-definition') return null;
  return statement.body.kind === 'fourier-series' ? statement.body : null;
}

export function estimateActiveFourierSeries(
  active: ActiveExpression | null,
  workspace: Workspace,
  parameterValues: ReadonlyMap<string, number>,
  settings: FourierSeriesSettings,
): FourierSeriesEstimate | null {
  const series = selectFourierSeries(active);
  if (series === null || active === null) return null;

  const key = `${active.entry.id}|${parameterKey(parameterValues)}|${settings.order},${settings.integrationSampleCount}`;
  let workspaceCache = estimateCache.get(workspace);
  if (workspaceCache === undefined) {
    workspaceCache = new Map();
    estimateCache.set(workspace, workspaceCache);
  }
  if (workspaceCache.has(key)) return workspaceCache.get(key) ?? null;

  const estimate = estimateFourierSeries(
    series,
    workspaceEnvironment(workspace, parameterValues),
    settings,
  );
  workspaceCache.set(key, estimate);
  return estimate;
}

export function initialSeriesViewport(
  period: number,
  measuredY: { readonly min: number; readonly max: number },
): SeriesViewport {
  const usablePeriod = Number.isFinite(period) && period > 0 ? period : 2;
  const range = usableRange(measuredY.min, measuredY.max);
  const padding = range === null ? 0.1 : range.max - range.min;
  const yPadding = Math.max(padding * 0.12, 0.1);
  const yMin = range === null ? -1 : range.min - yPadding;
  const yMax = range === null ? 1 : range.max + yPadding;
  return {
    xMin: -usablePeriod / 2,
    xMax: usablePeriod / 2,
    yMin,
    yMax,
  };
}

/** Return a requested fit frame; rendering never calls this implicitly. */
export function fitSeriesViewport(
  current: SeriesViewport,
  estimate: FourierSeriesEstimate,
  sourceRange: { readonly min: number; readonly max: number },
): SeriesViewport | null {
  if (estimate.period === null || !Number.isFinite(estimate.period) || estimate.period <= 0) {
    return null;
  }
  const values: number[] = [];
  const source = usableRange(sourceRange.min, sourceRange.max);
  if (source !== null) values.push(source.min, source.max);

  for (let index = 0; index <= 256; index += 1) {
    const time = -estimate.period / 2 + (estimate.period * index) / 256;
    const value = evaluateFourierSeriesAt(estimate, time);
    if (value !== null && Number.isFinite(value)) values.push(value);
  }
  if (values.length === 0) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max((max - min) * 0.12, 0.1);
  return {
    ...current,
    xMin: -estimate.period / 2,
    xMax: estimate.period / 2,
    yMin: min - padding,
    yMax: max + padding,
  };
}

function usableRange(min: number, max: number): { min: number; max: number } | null {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (max > min) return { min, max };
  const extent = Math.max(Math.abs(min), Math.abs(max), 1);
  return { min: -extent, max: extent };
}

function parameterKey(parameters: ReadonlyMap<string, number>): string {
  return [...parameters.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(';');
}
