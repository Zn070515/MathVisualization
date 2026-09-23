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
import type { ActiveExpression } from '../state/workspaceStore';

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

export function selectFourierTransform(active: ActiveExpression | null): FourierTransformNode | null {
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
  return estimateFourierTransform(transform, workspaceEnvironment(workspace, parameterValues), {
    frequencies: frequencyGrid(),
    timeWindow: DEFAULT_TIME_WINDOW,
    timeSamples: DEFAULT_TIME_SAMPLES,
  });
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

/** A type-only helper for consumers that need to construct the same environment. */
export type FourierEnvironment = EvaluationEnvironment;
