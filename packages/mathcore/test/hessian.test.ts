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

  it('does not overflow when a finite field has a very large constant offset', () => {
    const result = hessianAt(
      (x, y) => ok(cx(1e308 + x * x + y * y, 0)),
      0,
      0,
      { step: 1e153 },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Number.isFinite(result.value.xx)).toBe(true);
    expect(Number.isFinite(result.value.yy)).toBe(true);
  });

  it('rejects non-finite coordinates even when the step is supplied', () => {
    const result = hessianAt(() => ok(cx(1, 0)), Number.NaN, 0, { step: 1 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.kind).toBe('invalid-parameter');
  });

  it('reports a positive-definite Hessian at a numerically near-critical minimum', () => {
    const result = criticalPointAt((x, y) => ok(cx(x * x + 2 * y * y, 0)), 0, 0);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.classification).toBe('near-critical-minimum');
    expect(result.value.stationarity).toBe('near-critical');
    expect(result.value.hessianShape).toBe('positive-definite');
  });

  it('reports a negative-definite Hessian at a numerically near-critical maximum', () => {
    const result = criticalPointAt((x, y) => ok(cx(-x * x - 2 * y * y, 0)), 0, 0);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.classification).toBe('near-critical-maximum');
  });

  it('reports an indefinite Hessian at a numerically near-critical saddle', () => {
    const result = criticalPointAt((x, y) => ok(cx(x * x - y * y, 0)), 0, 0);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.classification).toBe('near-critical-saddle');
  });

  it('does not call a point critical when its gradient is non-zero', () => {
    const result = criticalPointAt((x, y) => ok(cx(x + y, 0)), 0, 0);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.classification).toBe('non-critical');
  });

  it('does not call a merely small scaled gradient a critical point', () => {
    const result = criticalPointAt(
      (x, y) => ok(cx(1e-8 * ((x - 10) * (x - 10) + y * y), 0)),
      0,
      0,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.classification).toBe('non-critical');
    expect(result.value.stationarity).toBe('non-critical');
    expect(result.value.hessianShape).toBe('positive-definite');
  });

  it('does not let an additive field offset hide a non-zero gradient', () => {
    const result = criticalPointAt((x) => ok(cx(1e10 + x, 0)), 0, 0);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.classification).toBe('non-critical');
    expect(result.value.stationarity).toBe('non-critical');
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
