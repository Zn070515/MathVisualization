import {
  type Complex,
  type ConvolutionEstimate,
  type ConvolutionNode,
  type EvaluationEnvironment,
  type FieldMode,
  type Workspace,
  cabs,
  estimateConvolution,
  workspaceEnvironment,
} from '@mathviz/mathcore';
import type { ActiveExpression } from '../state/workspaceStore';

export interface ConvolutionSettings {
  readonly integrationWindow: { readonly min: number; readonly max: number };
  readonly outputWindow: { readonly min: number; readonly max: number };
  readonly outputSampleCount: number;
  readonly integrationSampleCount: number;
}

export const DEFAULT_CONVOLUTION_SETTINGS: ConvolutionSettings = {
  integrationWindow: { min: -8, max: 8 },
  outputWindow: { min: -8, max: 8 },
  outputSampleCount: 64,
  integrationSampleCount: 64,
};

const estimateCache = new WeakMap<Workspace, Map<string, ConvolutionEstimate | null>>();

export function selectConvolution(active: ActiveExpression | null): ConvolutionNode | null {
  const statement = active?.entry.statement;
  if (statement?.kind !== 'function-definition' || statement.body.kind !== 'convolution') {
    return null;
  }
  return statement.body;
}

export function estimateActiveConvolution(
  active: ActiveExpression | null,
  workspace: Workspace,
  parameterValues: ReadonlyMap<string, number>,
  settings: ConvolutionSettings = DEFAULT_CONVOLUTION_SETTINGS,
): ConvolutionEstimate | null {
  const convolution = selectConvolution(active);
  if (convolution === null) return null;

  const key = `${active?.entry.id ?? 'none'}|${parameterKey(parameterValues)}|${settingsKey(settings)}`;
  let workspaceCache = estimateCache.get(workspace);
  if (workspaceCache === undefined) {
    workspaceCache = new Map();
    estimateCache.set(workspace, workspaceCache);
  }
  if (workspaceCache.has(key)) return workspaceCache.get(key) ?? null;

  const estimate = estimateConvolution(
    convolution,
    workspaceEnvironment(workspace, parameterValues),
    settings,
  );
  workspaceCache.set(key, estimate);
  return estimate;
}

export function projectConvolutionValue(value: Complex, mode: FieldMode): number | null {
  switch (mode) {
    case 'complex':
    case 'real':
      return value.re;
    case 'imaginary':
      return value.im;
    case 'magnitude':
      return cabs(value);
    case 'phase':
      return cabs(value) < 1e-9 ? null : Math.atan2(value.im, value.re);
  }
}

export interface ConvolutionCurve {
  readonly times: readonly number[];
  readonly values: readonly number[];
}

export function projectConvolutionCurve(
  times: readonly number[],
  values: readonly Complex[],
  mode: FieldMode,
): ConvolutionCurve {
  const projectedTimes: number[] = [];
  const projectedValues: number[] = [];
  for (let index = 0; index < Math.min(times.length, values.length); index += 1) {
    const time = times[index];
    const value = values[index];
    if (time === undefined || value === undefined) continue;
    const projected = projectConvolutionValue(value, mode);
    if (projected === null || !Number.isFinite(projected)) continue;
    projectedTimes.push(time);
    projectedValues.push(projected);
  }
  return { times: projectedTimes, values: projectedValues };
}

/** Type-only helper for callers that need the same evaluator contract. */
export type ConvolutionEnvironment = EvaluationEnvironment;

function parameterKey(parameters: ReadonlyMap<string, number>): string {
  return [...parameters.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(';');
}

function settingsKey(settings: ConvolutionSettings): string {
  return [
    settings.integrationWindow.min,
    settings.integrationWindow.max,
    settings.outputWindow.min,
    settings.outputWindow.max,
    settings.outputSampleCount,
    settings.integrationSampleCount,
  ].join(',');
}
