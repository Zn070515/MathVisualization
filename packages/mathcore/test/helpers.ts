/**
 * Shared test helpers.
 *
 * Comparison uses a stated tolerance rather than exact equality, because the
 * numerical layer is double precision and identities that hold exactly in
 * mathematics hold only to within rounding here. Where a test *can* assert
 * exactness — realness of a real input, an exact rational literal, an integer
 * power — it does so explicitly, and those assertions are the ones that would
 * catch a convention drifting.
 */
import { expect } from 'vitest';
import type { Complex } from '../src/complex';
import { NUMERICS } from '../src/conventions';

/** Assert two real numbers agree to the project tolerance. */
export function expectCloseTo(actual: number, expected: number, tolerance = NUMERICS.relativeTolerance): void {
  const scale = Math.max(1, Math.abs(expected));
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance * scale);
}

/** Assert two complex numbers agree to the project tolerance. */
export function expectComplexCloseTo(actual: Complex, expected: Complex, tolerance = NUMERICS.relativeTolerance): void {
  const scale = Math.max(1, Math.abs(expected.re), Math.abs(expected.im));
  expect(Math.abs(actual.re - expected.re)).toBeLessThanOrEqual(tolerance * scale);
  expect(Math.abs(actual.im - expected.im)).toBeLessThanOrEqual(tolerance * scale);
}
