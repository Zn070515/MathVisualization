import { describe, expect, it } from 'vitest';
import { cx } from '../src/complex';
import { linearizationAt, linearizationErrorAt, linearizedValue } from '../src/linearization';
import { ok } from '../src/errors';

describe('numerical linearization', () => {
  it('builds the tangent-plane formula from the local gradient', () => {
    const result = linearizationAt((x, y) => ok(cx(x * x - y * y, 0)), 2, 3);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.value).toBeCloseTo(-5, 6);
    expect(result.value.gradient.x).toBeCloseTo(4, 6);
    expect(result.value.gradient.y).toBeCloseTo(-6, 6);
    expect(linearizedValue(result.value, 3, 4)).toBeCloseTo(-7, 6);
  });

  it('reports the actual error of the linear approximation at a nearby point', () => {
    const linearization = linearizationAt((x, y) => ok(cx(x * x + y * y, 0)), 1, 2);
    expect(linearization.ok).toBe(true);
    if (!linearization.ok) return;

    const error = linearizationErrorAt(
      (x, y) => ok(cx(x * x + y * y, 0)),
      linearization.value,
      1.5,
      2.5,
    );

    expect(error.ok).toBe(true);
    if (!error.ok) return;
    expect(error.value.actual).toBeCloseTo(8.5, 6);
    expect(error.value.approximation).toBeCloseTo(8, 6);
    expect(error.value.absoluteError).toBeCloseTo(0.5, 6);
  });
});
