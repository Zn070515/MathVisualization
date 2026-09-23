import {
  type Complex,
  type ConvolutionEstimate,
  type ConvolutionNode,
  type DftStability,
  type DftTransformNode,
  type EvaluationEnvironment,
  type FieldMode,
  type Workspace,
  cabs,
  dftOfPeriodicSamples,
  estimateConvolution,
  estimateDft,
  periodicSampledConvolution,
  phaseCorrectedDftProduct,
  workspaceEnvironment,
} from '@mathviz/mathcore';
import type { ActiveExpression, SamplingSettings } from '../state/workspaceStore';

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
const dftProductCache = new WeakMap<Workspace, Map<string, DftProductCheck | null>>();

export interface DftProductCheck {
  readonly values: readonly Complex[];
  readonly maxAbsoluteDifference: number;
  /** Scale-aware floating-point tolerance for the fixed-grid identity. */
  readonly identityTolerance: number;
  /** Separate refinement indicator for the sampled representations. */
  readonly samplingEstimatedError: number;
  readonly samplingStatus: DftStability;
  readonly status: 'consistent' | 'inconclusive' | 'inconsistent';
  readonly diagnostics: readonly string[];
}

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

/**
 * Compare circular sampled convolution with the phase-corrected DFT product.
 *
 * This is intentionally separate from the direct finite-window convolution: the
 * former is a periodic sample-grid identity, while the latter is a quadrature
 * estimate over a finite integration window. Neither one certifies a whole-line
 * continuous convolution theorem.
 */
export function estimateActiveDftProduct(
  active: ActiveExpression | null,
  workspace: Workspace,
  parameterValues: ReadonlyMap<string, number>,
  sampling: SamplingSettings,
): DftProductCheck | null {
  const convolution = selectConvolution(active);
  if (convolution === null) return null;

  const key = `${active?.entry.id ?? 'none'}|${parameterKey(parameterValues)}|${samplingKey(sampling)}`;
  let workspaceCache = dftProductCache.get(workspace);
  if (workspaceCache === undefined) {
    workspaceCache = new Map();
    dftProductCache.set(workspace, workspaceCache);
  }
  if (workspaceCache.has(key)) return workspaceCache.get(key) ?? null;

  const environment = workspaceEnvironment(workspace, parameterValues);
  const left = estimateDft(
    sourceAsDft(convolution.left, convolution.sourceVariable),
    environment,
    sampling,
  );
  const right = estimateDft(
    sourceAsDft(convolution.right, convolution.sourceVariable),
    environment,
    sampling,
  );
  const direct = estimateActiveConvolution(active, workspace, parameterValues, {
    integrationWindow: sampling.timeWindow,
    outputWindow: sampling.timeWindow,
    outputSampleCount: sampling.sampleCount,
    integrationSampleCount: sampling.sampleCount,
  });
  const baseDiagnostics = [
    'Periodic sampled convolution uses circular wrap-around on the shared DFT grid.',
    'The product includes the origin phase exp(i·ω·t_min).',
    'This compares sampled periodic data; it does not certify the continuous whole-line convolution theorem.',
  ];

  const samplingStatus = combinedSamplingStatus(
    left.stability,
    right.stability,
    direct?.stability ?? 'unresolved',
  );
  if (left.stability === 'unresolved' || right.stability === 'unresolved') {
    const result = unresolvedProduct(baseDiagnostics, [...left.diagnostics, ...right.diagnostics]);
    workspaceCache.set(key, result);
    return result;
  }

  const circular = periodicSampledConvolution(left.samples, right.samples, left.sampleInterval);
  if (!circular.ok) {
    const result = unresolvedProduct(baseDiagnostics, [circular.issue.message]);
    workspaceCache.set(key, result);
    return result;
  }
  const product = phaseCorrectedDftProduct(left, right);
  if (!product.ok) {
    const result = unresolvedProduct(baseDiagnostics, [product.issue.message]);
    workspaceCache.set(key, result);
    return result;
  }
  const transformed = dftOfPeriodicSamples(circular.value, left);
  if (!transformed.ok) {
    const result = unresolvedProduct(baseDiagnostics, [transformed.issue.message]);
    workspaceCache.set(key, result);
    return result;
  }

  const maxAbsoluteDifference = maximumDifference(transformed.value, product.value);
  const samplingEstimatedError =
    left.estimatedError +
    right.estimatedError +
    (direct?.estimatedError ?? Number.POSITIVE_INFINITY);
  const scale = Math.max(1, ...product.value.map(cabs), ...transformed.value.map(cabs));
  const identityTolerance = Number.EPSILON * scale * Math.max(1, left.values.length) * 256;
  const status =
    Number.isFinite(maxAbsoluteDifference) && Number.isFinite(identityTolerance)
      ? maxAbsoluteDifference <= identityTolerance
        ? 'consistent'
        : 'inconsistent'
      : 'inconclusive';
  const result: DftProductCheck = {
    values: [...product.value],
    maxAbsoluteDifference,
    identityTolerance,
    samplingEstimatedError,
    samplingStatus,
    status,
    diagnostics: [
      ...baseDiagnostics,
      `Maximum sampled DFT difference is ${maxAbsoluteDifference}.`,
      `Fixed-grid identity tolerance is ${identityTolerance}.`,
      `Sampling representation is ${samplingStatus}; its combined refinement indicator is ${samplingEstimatedError}.`,
    ],
  };
  workspaceCache.set(key, result);
  return result;
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

function sourceAsDft(source: ConvolutionNode['left'], sourceVariable: string): DftTransformNode {
  return {
    kind: 'dft-transform',
    source,
    sourceVariable,
    span: source.span,
  };
}

function samplingKey(sampling: SamplingSettings): string {
  return `${sampling.timeWindow.min},${sampling.timeWindow.max},${sampling.sampleCount},${sampling.algorithm}`;
}

function maximumDifference(left: readonly Complex[], right: readonly Complex[]): number {
  if (left.length !== right.length || left.length === 0) return Number.POSITIVE_INFINITY;
  let maximum = 0;
  for (let index = 0; index < left.length; index += 1) {
    const first = left[index];
    const second = right[index];
    if (first === undefined || second === undefined) return Number.POSITIVE_INFINITY;
    maximum = Math.max(maximum, cabs({ re: first.re - second.re, im: first.im - second.im }));
  }
  return maximum;
}

function unresolvedProduct(
  baseDiagnostics: readonly string[],
  details: readonly string[],
): DftProductCheck {
  return {
    values: [],
    maxAbsoluteDifference: Number.POSITIVE_INFINITY,
    identityTolerance: Number.POSITIVE_INFINITY,
    samplingEstimatedError: Number.POSITIVE_INFINITY,
    samplingStatus: 'unresolved',
    status: 'inconclusive',
    diagnostics: [...baseDiagnostics, 'The sampled product check is inconclusive.', ...details],
  };
}

function combinedSamplingStatus(...statuses: readonly DftStability[]): DftStability {
  if (statuses.some((status) => status === 'unresolved')) return 'unresolved';
  if (statuses.some((status) => status === 'sampling-sensitive')) return 'sampling-sensitive';
  return 'stable';
}
