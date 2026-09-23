/**
 * Numerical differential quantities for a real scalar field.
 *
 * A gradient is derived from the same evaluator that draws a surface or a
 * contour map. It is intentionally a small, transport-independent operation:
 * the core owns the finite-difference convention and the error estimate, while
 * a view decides how the vectors should be shown.
 */
import { isFiniteComplex, type Complex } from './complex';
import { fail, ok, type MathIssue, type Result } from './errors';

export interface Gradient {
  readonly x: number;
  readonly y: number;
  /** Difference between two central-difference resolutions, in field units. */
  readonly estimatedError: number;
}

export interface DirectionalDerivative {
  /** The derivative along the normalised direction. */
  readonly value: number;
  readonly direction: { readonly x: number; readonly y: number };
  readonly estimatedError: number;
}

export interface GradientOptions {
  /** Base finite-difference step in plane units. */
  readonly step?: number;
}

export type RealFieldEvaluator = (x: number, y: number) => Result<Complex, MathIssue>;

/** Estimate `∇f(x,y)` using central differences at two resolutions. */
export function gradientAt(
  evaluate: RealFieldEvaluator,
  x: number,
  y: number,
  options: GradientOptions = {},
): Result<Gradient, MathIssue> {
  const step = options.step ?? defaultStep(x, y);
  if (!Number.isFinite(step) || step <= 0) {
    return fail({
      kind: 'invalid-parameter',
      message: 'The gradient step must be a positive finite number.',
      detail: String(step),
    });
  }

  const coarse = centralDifference(evaluate, x, y, step);
  if (!coarse.ok) return coarse;
  const fine = centralDifference(evaluate, x, y, step / 2);
  if (!fine.ok) return fine;

  return ok({
    x: fine.value.x,
    y: fine.value.y,
    estimatedError: Math.hypot(fine.value.x - coarse.value.x, fine.value.y - coarse.value.y),
  });
}

/** Estimate the rate of change in a specified direction. */
export function directionalDerivativeAt(
  evaluate: RealFieldEvaluator,
  x: number,
  y: number,
  direction: { readonly x: number; readonly y: number },
  options: GradientOptions = {},
): Result<DirectionalDerivative, MathIssue> {
  const length = Math.hypot(direction.x, direction.y);
  if (!Number.isFinite(length) || length === 0) {
    return fail({
      kind: 'invalid-parameter',
      message: 'A directional derivative needs a non-zero finite direction.',
      detail: `(${direction.x}, ${direction.y})`,
    });
  }

  const unit = { x: direction.x / length, y: direction.y / length };
  const gradient = gradientAt(evaluate, x, y, options);
  if (!gradient.ok) return gradient;

  return ok({
    value: gradient.value.x * unit.x + gradient.value.y * unit.y,
    direction: unit,
    estimatedError:
      Math.abs(unit.x) * gradient.value.estimatedError +
      Math.abs(unit.y) * gradient.value.estimatedError,
  });
}

function defaultStep(x: number, y: number): number {
  return 1e-4 * Math.max(1, Math.abs(x), Math.abs(y));
}

function centralDifference(
  evaluate: RealFieldEvaluator,
  x: number,
  y: number,
  step: number,
): Result<{ readonly x: number; readonly y: number }, MathIssue> {
  const plusX = realValue(evaluate(x + step, y));
  if (!plusX.ok) return plusX;
  const minusX = realValue(evaluate(x - step, y));
  if (!minusX.ok) return minusX;
  const plusY = realValue(evaluate(x, y + step));
  if (!plusY.ok) return plusY;
  const minusY = realValue(evaluate(x, y - step));
  if (!minusY.ok) return minusY;

  return ok({
    x: (plusX.value - minusX.value) / (2 * step),
    y: (plusY.value - minusY.value) / (2 * step),
  });
}

function realValue(result: Result<Complex, MathIssue>): Result<number, MathIssue> {
  if (!result.ok) return result;
  if (!isFiniteComplex(result.value)) {
    return fail({
      kind: 'singularity',
      message: 'The gradient is undefined because the field is undefined nearby.',
    });
  }
  const tolerance = 1e-9 * Math.max(1, Math.abs(result.value.re));
  if (Math.abs(result.value.im) > tolerance) {
    return fail({
      kind: 'dimension-mismatch',
      message: 'A gradient requires a real-valued scalar field.',
    });
  }
  return ok(result.value.re);
}
