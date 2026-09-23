import { describe, expect, it } from 'vitest';
import { cx, directionalDerivativeAt, gradientAt, ok } from '../src';
import { expectCloseTo } from './helpers';

describe('numerical gradients', () => {
  const saddle = (x: number, y: number) => ok(cx(x * x - y * y, 0));

  it('estimates both partial derivatives of a scalar field', () => {
    const result = gradientAt(saddle, 2, 3);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectCloseTo(result.value.x, 4);
    expectCloseTo(result.value.y, -6);
    expect(result.value.estimatedError).toBeGreaterThanOrEqual(0);
  });

  it('projects the gradient onto a chosen direction', () => {
    const result = directionalDerivativeAt(saddle, 2, 3, { x: 3, y: 4 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectCloseTo(result.value.value, -2.4);
    expect(result.value.estimatedError).toBeGreaterThanOrEqual(0);
  });

  it('rejects a zero direction instead of inventing a unit vector', () => {
    const result = directionalDerivativeAt(saddle, 2, 3, { x: 0, y: 0 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.kind).toBe('invalid-parameter');
  });
});
