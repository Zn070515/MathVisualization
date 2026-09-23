/**
 * Numerical first-order approximation of a real scalar field.
 *
 * The tangent plane is derived from the same finite-difference gradient used by
 * the gradient view. It is therefore an explicitly numerical approximation, not
 * a claim that a symbolic derivative has been certified.
 */
import { isFiniteComplex, type Complex } from './complex';
import { fail, ok, type MathIssue, type Result } from './errors';
import { gradientAt, type Gradient, type RealFieldEvaluator } from './gradient';

export interface Linearization {
  readonly origin: { readonly x: number; readonly y: number };
  /** The sampled scalar value at the expansion point. */
  readonly value: number;
  readonly gradient: Gradient;
}

export interface LinearizationError {
  readonly actual: number;
  readonly approximation: number;
  readonly absoluteError: number;
}

/** Estimate the first-order Taylor approximation at a selected point. */
export function linearizationAt(
  evaluate: RealFieldEvaluator,
  x: number,
  y: number,
): Result<Linearization, MathIssue> {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return fail({
      kind: 'invalid-parameter',
      message: 'A tangent plane needs a finite selected point.',
      detail: `(${x}, ${y})`,
    });
  }

  const value = realValue(evaluate(x, y));
  if (!value.ok) return value;

  const gradient = gradientAt(evaluate, x, y);
  if (!gradient.ok) return gradient;

  return ok({ origin: { x, y }, value: value.value, gradient: gradient.value });
}

/** Evaluate `L_p(x,y) = f(p) + ∇f(p) · ((x,y) - p)`. */
export function linearizedValue(linearization: Linearization, x: number, y: number): number {
  return (
    linearization.value +
    linearization.gradient.x * (x - linearization.origin.x) +
    linearization.gradient.y * (y - linearization.origin.y)
  );
}

/** Compare the sampled field with its first-order approximation at one point. */
export function linearizationErrorAt(
  evaluate: RealFieldEvaluator,
  linearization: Linearization,
  x: number,
  y: number,
): Result<LinearizationError, MathIssue> {
  const actual = realValue(evaluate(x, y));
  if (!actual.ok) return actual;
  const approximation = linearizedValue(linearization, x, y);
  return ok({
    actual: actual.value,
    approximation,
    absoluteError: Math.abs(actual.value - approximation),
  });
}

function realValue(result: Result<Complex, MathIssue>): Result<number, MathIssue> {
  if (!result.ok) return result;
  if (!isFiniteComplex(result.value)) {
    return fail({
      kind: 'singularity',
      message: 'The tangent plane is undefined because the field is undefined nearby.',
    });
  }
  const tolerance = 1e-9 * Math.max(1, Math.abs(result.value.re));
  if (Math.abs(result.value.im) > tolerance) {
    return fail({
      kind: 'dimension-mismatch',
      message: 'A tangent plane requires a real-valued scalar field.',
    });
  }
  return ok(result.value.re);
}
