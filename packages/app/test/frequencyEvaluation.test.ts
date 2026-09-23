import { describe, expect, it } from 'vitest';
import { cx, type FourierEstimate } from '@mathviz/mathcore';
import {
  frequencyRange,
  projectFourierValue,
  transformModeOf,
  type TransformMode,
} from '../src/views/frequencyEvaluation';

describe('frequency-domain projections', () => {
  const value = cx(3, 4);

  it('projects one complex estimate into every supported mode', () => {
    expect(projectFourierValue(value, 'magnitude')).toBe(5);
    expect(projectFourierValue(value, 'real')).toBe(3);
    expect(projectFourierValue(value, 'imaginary')).toBe(4);
    expect(projectFourierValue(value, 'phase')).toBeCloseTo(Math.atan2(4, 3), 12);
  });

  it('does not invent a phase for a numerically zero value', () => {
    expect(projectFourierValue(cx(0, 0), 'phase')).toBeNull();
  });

  it('normalises the legacy complex mode to magnitude', () => {
    expect(transformModeOf('complex')).toBe('magnitude');
    expect(transformModeOf('phase')).toBe('phase');
  });

  it('uses a symmetric range for signed component modes', () => {
    const estimate: FourierEstimate = {
      values: [cx(-2, 1), cx(3, -1)],
      frequencies: [0, 1],
      timeWindow: { min: -1, max: 1 },
      timeSamples: 4,
      estimatedError: 0,
      convergence: 'converged',
      diagnostics: [],
    };
    for (const mode of ['real', 'imaginary'] as const satisfies readonly TransformMode[]) {
      const range = frequencyRange(
        estimate,
        mode,
      );
      expect(range?.min).toBe(-Math.max(Math.abs(mode === 'real' ? 3 : 1), 1e-6));
      expect(range?.max).toBe(Math.max(Math.abs(mode === 'real' ? 3 : 1), 1e-6));
    }
  });
});
