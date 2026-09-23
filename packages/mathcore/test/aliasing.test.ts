import { describe, expect, it } from 'vitest';
import { describeAliasing } from '../src';

describe('sampling aliasing', () => {
  it('folds a frequency into the positive-Nyquist representative interval', () => {
    const result = describeAliasing((7 * Math.PI) / 4, 1, 0);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.samplingAngularFrequency).toBeCloseTo(2 * Math.PI);
    expect(result.value.nyquistAngularFrequency).toBeCloseTo(Math.PI);
    expect(result.value.representative).toBeCloseTo(-Math.PI / 4);
    expect(result.value.aliases[0]).toBeCloseTo((-9 * Math.PI) / 4);
    expect(result.value.aliases[1]).toBeCloseTo(-Math.PI / 4);
    expect(result.value.aliases[2]).toBeCloseTo((7 * Math.PI) / 4);
  });

  it('uses the positive Nyquist boundary as the single edge representative', () => {
    const positive = describeAliasing(Math.PI, 1, 0);
    const negative = describeAliasing(-Math.PI, 1, 0);

    expect(positive.ok).toBe(true);
    expect(negative.ok).toBe(true);
    if (!positive.ok || !negative.ok) return;
    expect(positive.value.representative).toBeCloseTo(Math.PI);
    expect(negative.value.representative).toBeCloseTo(Math.PI);
  });

  it('rejects non-finite frequencies and non-positive sampling intervals', () => {
    const invalidFrequency = describeAliasing(Number.NaN, 1, 0);
    const invalidInterval = describeAliasing(1, 0, 0);

    expect(invalidFrequency.ok).toBe(false);
    expect(invalidInterval.ok).toBe(false);
    if (invalidFrequency.ok || invalidInterval.ok) return;
    expect(invalidFrequency.issue.kind).toBe('invalid-parameter');
    expect(invalidInterval.issue.kind).toBe('invalid-parameter');
  });

  it('reports the phase introduced by a non-grid-aligned sample origin', () => {
    const result = describeAliasing(0, 1, 0.25);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sampleOrigin).toBe(0.25);
    expect(result.value.phasePerSamplingFrequency.re).toBeCloseTo(0);
    expect(result.value.phasePerSamplingFrequency.im).toBeCloseTo(-1);
  });

  it('does not fold a frequency merely because it is close to Nyquist', () => {
    const nearBoundary = describeAliasing(-Math.PI + 1e-14, 1, 0);
    const tinyRate = describeAliasing(0, 1e-20, 0);

    expect(nearBoundary.ok).toBe(true);
    expect(tinyRate.ok).toBe(true);
    if (!nearBoundary.ok || !tinyRate.ok) return;
    expect(nearBoundary.value.representative).toBeGreaterThan(-Math.PI);
    expect(nearBoundary.value.representative).toBeLessThan(0);
    expect(tinyRate.value.representative).toBe(0);
  });
});
