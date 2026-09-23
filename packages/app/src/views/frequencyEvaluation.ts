import {
  type Complex,
  type EvaluationEnvironment,
  type FieldMode,
  type FourierEstimate,
  type FourierTransformNode,
  type Workspace,
  estimateFourierTransform,
  workspaceEnvironment,
} from '@mathviz/mathcore';
import type { ActiveExpression, FrequencyViewport } from '../state/workspaceStore';

/** Estimates are shared by the frequency canvas and the readout. */
const estimateCache = new WeakMap<Workspace, Map<string, FourierEstimate | null>>();

export type TransformMode = Exclude<FieldMode, 'complex'>;

export const DEFAULT_FREQUENCY_WINDOW = { min: -8, max: 8 } as const;
export const DEFAULT_TIME_WINDOW = { min: -8, max: 8 } as const;
export const DEFAULT_FREQUENCY_SAMPLES = 161;
export const DEFAULT_TIME_SAMPLES = 256;

export function transformModeOf(mode: FieldMode): TransformMode {
  return mode === 'complex' ? 'magnitude' : mode;
}

export function frequencyGrid(
  window = DEFAULT_FREQUENCY_WINDOW,
  samples = DEFAULT_FREQUENCY_SAMPLES,
): readonly number[] {
  if (samples < 2) return [window.min, window.max];
  return Array.from(
    { length: samples },
    (_, index) => window.min + ((window.max - window.min) * index) / (samples - 1),
  );
}

/** Return the frequency bin whose sampled value is drawn and read out. */
export function snapFrequency(frequency: number, frequencies: readonly number[]): number | null {
  if (!Number.isFinite(frequency) || frequencies.length === 0) return null;
  let nearest = frequencies[0] ?? null;
  if (nearest === null) return null;
  let distance = Math.abs(nearest - frequency);
  for (const candidate of frequencies.slice(1)) {
    const candidateDistance = Math.abs(candidate - frequency);
    if (candidateDistance < distance) {
      nearest = candidate;
      distance = candidateDistance;
    }
  }
  return nearest;
}

export function selectFourierTransform(
  active: ActiveExpression | null,
): FourierTransformNode | null {
  const statement = active?.entry.statement;
  if (statement?.kind !== 'function-definition') return null;
  return statement.body.kind === 'fourier-transform' ? statement.body : null;
}

export function estimateActiveFourierTransform(
  active: ActiveExpression | null,
  workspace: Workspace,
  parameterValues: ReadonlyMap<string, number>,
): FourierEstimate | null {
  const transform = selectFourierTransform(active);
  if (transform === null) return null;
  const key = `${active?.entry.id ?? 'none'}|${parameterKey(parameterValues)}`;
  let workspaceCache = estimateCache.get(workspace);
  if (workspaceCache === undefined) {
    workspaceCache = new Map();
    estimateCache.set(workspace, workspaceCache);
  }
  if (workspaceCache.has(key)) return workspaceCache.get(key) ?? null;

  const estimate = estimateFourierTransform(
    transform,
    workspaceEnvironment(workspace, parameterValues),
    {
      frequencies: frequencyGrid(),
      timeWindow: DEFAULT_TIME_WINDOW,
      timeSamples: DEFAULT_TIME_SAMPLES,
    },
  );
  workspaceCache.set(key, estimate);
  return estimate;
}

function parameterKey(parameters: ReadonlyMap<string, number>): string {
  return [...parameters.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(';');
}

export function projectFourierValue(value: Complex, mode: TransformMode): number | null {
  switch (mode) {
    case 'magnitude':
      return Math.hypot(value.re, value.im);
    case 'phase':
      return Math.hypot(value.re, value.im) < 1e-9 ? null : Math.atan2(value.im, value.re);
    case 'real':
      return value.re;
    case 'imaginary':
      return value.im;
  }
}

export function frequencyRange(
  estimate: FourierEstimate,
  mode: TransformMode,
): { min: number; max: number } | null {
  const values = estimate.values
    .map((value) => projectFourierValue(value, mode))
    .filter((value): value is number => value !== null && Number.isFinite(value));
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (mode === 'magnitude') return { min: 0, max: Math.max(max, 1e-6) };
  const extent = Math.max(Math.abs(min), Math.abs(max), 1e-6);
  return { min: -extent, max: extent };
}

/** Return a requested frame for the explicit Fit action, never for rendering. */
export function fitFrequencyViewport(
  current: FrequencyViewport,
  estimate: FourierEstimate,
  mode: TransformMode,
): FrequencyViewport | null {
  const range = frequencyRange(estimate, mode);
  if (range === null) return null;
  const padding = Math.max((range.max - range.min) * 0.12, 0.1);
  return {
    ...current,
    yMin: range.min - padding,
    yMax: range.max + padding,
  };
}

/** A type-only helper for consumers that need to construct the same environment. */
export type FourierEnvironment = EvaluationEnvironment;
