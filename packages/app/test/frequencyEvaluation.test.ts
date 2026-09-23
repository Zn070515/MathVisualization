import { describe, expect, it } from 'vitest';
import { cx, type FourierEstimate } from '@mathviz/mathcore';
import {
  fitFrequencyViewport,
  frequencyRange,
  estimateActiveFourierTransform,
  projectFourierValue,
  snapFrequency,
  transformModeOf,
  type TransformMode,
} from '../src/views/frequencyEvaluation';
import { makeStoreFromLatex } from './helpers';

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

  it('snaps the cursor to the frequency sample whose value is displayed', () => {
    expect(snapFrequency(0.037, [-8, -0.1, 0, 0.1, 8])).toBe(0);
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
      const range = frequencyRange(estimate, mode);
      expect(range?.min).toBe(-Math.max(Math.abs(mode === 'real' ? 3 : 1), 1e-6));
      expect(range?.max).toBe(Math.max(Math.abs(mode === 'real' ? 3 : 1), 1e-6));
    }
  });

  it('fits only when the caller explicitly requests a new frame', () => {
    const estimate: FourierEstimate = {
      values: [cx(0, 0), cx(4, 0)],
      frequencies: [-1, 1],
      timeWindow: { min: -1, max: 1 },
      timeSamples: 4,
      estimatedError: 0,
      convergence: 'converged',
      diagnostics: [],
    };
    const current = { xMin: -8, xMax: 8, yMin: -2, yMax: 2 };

    expect(fitFrequencyViewport(current, estimate, 'magnitude')).toEqual({
      xMin: -8,
      xMax: 8,
      yMin: -0.48,
      yMax: 4.48,
    });
    expect(current).toEqual({ xMin: -8, xMax: 8, yMin: -2, yMax: 2 });
  });

  it('shares an estimate for the same transform and parameter state', () => {
    const store = makeStoreFromLatex(
      ['f(t)=\\exp\\left(-t^{2}\\right)', 'F(\\omega)=\\operatorname{Fourier}(f(t))'],
      'transforms',
    );
    const active = store.activeExpression();
    expect(active).not.toBeNull();
    if (active === null) return;
    const state = store.getState();
    const first = estimateActiveFourierTransform(active, state.workspace, state.parameterValues);
    const second = estimateActiveFourierTransform(active, state.workspace, state.parameterValues);
    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });
});
