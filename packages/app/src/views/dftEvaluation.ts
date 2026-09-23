import {
  type Complex,
  type DftBin,
  type DftEstimate,
  type DftTransformNode,
  type EvaluationEnvironment,
  type FieldMode,
  type Workspace,
  cabs,
  estimateDft,
  workspaceEnvironment,
} from '@mathviz/mathcore';
import {
  DEFAULT_DFT_SAMPLING,
  type ActiveExpression,
  type FrequencyViewport,
  type SamplingSettings,
} from '../state/workspaceStore';

const estimateCache = new WeakMap<Workspace, Map<string, DftEstimate | null>>();

export type DftMode = Exclude<FieldMode, 'complex'>;
export { DEFAULT_DFT_SAMPLING };

const DISPLAY_GREEK_NAMES: Readonly<Record<string, string>> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  eta: 'η',
  theta: 'θ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  pi: 'π',
  rho: 'ρ',
  sigma: 'σ',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
};

export function selectDftTransform(active: ActiveExpression | null): DftTransformNode | null {
  const statement = active?.entry.statement;
  if (statement?.kind !== 'function-definition') return null;
  return statement.body.kind === 'dft-transform' ? statement.body : null;
}

export function dftFrequencyVariable(active: ActiveExpression | null): string {
  const statement = active?.entry.statement;
  if (statement?.kind !== 'function-definition') return 'ω';
  if (selectDftTransform(active) === null) return 'ω';
  const name = statement.parameters[0] ?? 'omega';
  return DISPLAY_GREEK_NAMES[name] ?? name;
}

export function estimateActiveDft(
  active: ActiveExpression | null,
  workspace: Workspace,
  parameterValues: ReadonlyMap<string, number>,
  sampling: SamplingSettings = DEFAULT_DFT_SAMPLING,
): DftEstimate | null {
  const transform = selectDftTransform(active);
  if (transform === null) return null;
  const key = `${active?.entry.id ?? 'none'}|${parameterKey(parameterValues)}|${samplingKey(sampling)}`;
  let workspaceCache = estimateCache.get(workspace);
  if (workspaceCache === undefined) {
    workspaceCache = new Map();
    estimateCache.set(workspace, workspaceCache);
  }
  if (workspaceCache.has(key)) return workspaceCache.get(key) ?? null;

  const estimate = estimateDft(
    transform,
    workspaceEnvironment(workspace, parameterValues),
    sampling,
  );
  workspaceCache.set(key, estimate);
  return estimate;
}

export function projectDftValue(value: Complex, mode: DftMode): number | null {
  switch (mode) {
    case 'magnitude':
      return cabs(value);
    case 'phase':
      return cabs(value) < 1e-9 ? null : Math.atan2(value.im, value.re);
    case 'real':
      return value.re;
    case 'imaginary':
      return value.im;
  }
}

export function dftRange(
  estimate: DftEstimate,
  mode: DftMode,
): { min: number; max: number } | null {
  const values = estimate.values
    .map((value) => projectDftValue(value, mode))
    .filter((value): value is number => value !== null && Number.isFinite(value));
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (mode === 'magnitude') return { min: 0, max: Math.max(max, 1e-6) };
  const extent = Math.max(Math.abs(min), Math.abs(max), 1e-6);
  return { min: -extent, max: extent };
}

export interface DftStemValue {
  readonly frequency: number;
  readonly value: number;
}

export function dftStemValues(
  estimate: DftEstimate,
  mode: DftMode,
): readonly DftStemValue[] {
  const stems: DftStemValue[] = [];
  for (let index = 0; index < estimate.bins.length; index += 1) {
    const bin = estimate.bins[index];
    const value = estimate.values[index];
    if (bin === undefined || value === undefined) continue;
    const projected = projectDftValue(value, mode);
    if (projected === null || !Number.isFinite(projected)) continue;
    stems.push({ frequency: bin.angularFrequency, value: projected });
  }
  return stems;
}

export function fitDftViewport(
  current: FrequencyViewport,
  estimate: DftEstimate,
  mode: DftMode,
): FrequencyViewport | null {
  const range = dftRange(estimate, mode);
  if (range === null) return null;
  const padding = Math.max((range.max - range.min) * 0.12, 0.1);
  return {
    ...current,
    yMin: range.min - padding,
    yMax: range.max + padding,
  };
}

export interface SnappedDftBin {
  readonly bin: DftBin;
  readonly frequency: number;
  readonly value: Complex;
}

export function snapDftBin(frequency: number, estimate: DftEstimate): SnappedDftBin | null {
  if (!Number.isFinite(frequency) || estimate.bins.length === 0) return null;
  let nearest = estimate.bins[0] as DftBin;
  let distance = Math.abs(nearest.angularFrequency - frequency);
  for (const candidate of estimate.bins.slice(1)) {
    const candidateDistance = Math.abs(candidate.angularFrequency - frequency);
    if (candidateDistance < distance) {
      nearest = candidate;
      distance = candidateDistance;
    }
  }
  const value = estimate.values[nearest.index];
  if (value === undefined) return null;
  return { bin: nearest, frequency: nearest.angularFrequency, value };
}

export interface DftBinReadout extends SnappedDftBin {
  readonly magnitude: number;
  readonly sampleInterval: number;
  readonly nyquistAngularFrequency: number;
  readonly stability: DftEstimate['stability'];
}

export function readoutAtFrequency(
  frequency: number,
  estimate: DftEstimate,
): DftBinReadout | null {
  const snapped = snapDftBin(frequency, estimate);
  if (snapped === null) return null;
  return {
    ...snapped,
    magnitude: cabs(snapped.value),
    sampleInterval: estimate.sampleInterval,
    nyquistAngularFrequency: estimate.nyquistAngularFrequency,
    stability: estimate.stability,
  };
}

export function nyquistBoundaryFrequencies(estimate: DftEstimate): readonly number[] {
  const nyquist = estimate.nyquistAngularFrequency;
  if (!Number.isFinite(nyquist) || nyquist <= 0) return [];
  return [-nyquist, nyquist];
}

export interface SampleMarker {
  readonly t: number;
  readonly value: number;
}

export function sampleMarkerValues(estimate: DftEstimate): readonly SampleMarker[] {
  const markers: SampleMarker[] = [];
  for (let index = 0; index < estimate.samples.length; index += 1) {
    const sample = estimate.samples[index] as Complex;
    const time = estimate.sampleTimes[index];
    if (time === undefined || !Number.isFinite(sample.re)) continue;
    markers.push({ t: time, value: sample.re });
  }
  return markers;
}

function parameterKey(parameters: ReadonlyMap<string, number>): string {
  return [...parameters.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(';');
}

function samplingKey(sampling: SamplingSettings): string {
  return `${sampling.timeWindow.min},${sampling.timeWindow.max},${sampling.sampleCount}`;
}

/** A type-only helper for consumers that need to construct the same environment. */
export type DftEnvironment = EvaluationEnvironment;
