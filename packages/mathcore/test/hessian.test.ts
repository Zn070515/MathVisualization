import { describe, expect, it } from 'vitest';
import { cx, criticalPointAt, hessianAt, ok } from '../src';
import { expectCloseTo } from './helpers';

describe('numerical Hessians', () => {
  it('estimates second partials and a stable determinant', () => {
    const result = hessianAt((x, y) => ok(cx(3 * x * x + 2 * x * y + 4 * y * y, 0)), 1, -2);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectCloseTo(result.value.xx, 6);
    expectCloseTo(result.value.xy, 2);
    expectCloseTo(result.value.yy, 8);
    expectCloseTo(result.value.determinant, 44);
    expect(result.value.estimatedError).toBeGreaterThanOrEqual(0);
    expect(result.value.determinantEstimatedError).toBeGreaterThanOrEqual(0);
  });

  it('classifies a positive-definite quadratic as a local minimum', () => {
    const result = criticalPointAt((x, y) => ok(cx(x * x + 2 * y * y, 0)), 0, 0);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.classification).toBe('local-minimum');
  });

  it('classifies a negative-definite quadratic as a local maximum', () => {
    const result = criticalPointAt((x, y) => ok(cx(-x * x - 2 * y * y, 0)), 0, 0);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.classification).toBe('local-maximum');
  });

  it('classifies an indefinite quadratic as a saddle', () => {
    const result = criticalPointAt((x, y) => ok(cx(x * x - y * y, 0)), 0, 0);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.classification).toBe('saddle');
  });

  it('does not call a point critical when its gradient is non-zero', () => {
    const result = criticalPointAt((x, y) => ok(cx(x + y, 0)), 0, 0);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.classification).toBe('non-critical');
  });

  it('reports unresolved sampling instead of classifying an undefined Hessian', () => {
    const result = criticalPointAt(
      (x, y) => (x === 0 && y === 0 ? ok(cx(0, 0)) : { ok: false, issue: { kind: 'singularity', message: 'undefined nearby' } }),
      0,
      0,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.kind).toBe('singularity');
  });
});
