import { describe, expect, it } from 'vitest';
import { cx, radix2Fft } from '../src';
import { expectComplexCloseTo } from './helpers';

describe('radix-2 FFT', () => {
  it('computes the forward transform of an impulse', () => {
    const result = radix2Fft([cx(1, 0), cx(0, 0), cx(0, 0), cx(0, 0)]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const value of result.value) expectComplexCloseTo(value, cx(1, 0));
  });

  it('rejects a sample count that is not a power of two', () => {
    const result = radix2Fft([cx(1, 0), cx(2, 0), cx(3, 0)]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.kind).toBe('invalid-parameter');
  });
});
