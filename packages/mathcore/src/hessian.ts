/**
 * Numerical second-order analysis for a real scalar field.
 *
 * The Hessian is estimated from central second differences at two resolutions.
 * A classification is only returned as a named critical-point type when the
 * gradient and determinant are separated from their respective uncertainty
 * bands; otherwise the result stays explicitly inconclusive.
 */
import { isFiniteComplex, type Complex } from './complex';
import { fail, ok, type MathIssue, type Result } from './errors';
import { gradientAt, type Gradient, type RealFieldEvaluator } from './gradient';

export interface Hessian {
  readonly xx: number;
  readonly xy: number;
  readonly yy: number;
  readonly determinant: number;
  /** Largest component difference between the fine and coarse estimates. */
  readonly estimatedError: number;
  /** Difference between the fine and coarse determinant estimates. */
  readonly determinantEstimatedError: number;
}

export interface HessianOptions {
  /** Base second-difference step in plane units. */
  readonly step?: number;
}

export type CriticalPointClassification =
  | 'local-minimum'
  | 'local-maximum'
  | 'saddle'
  | 'non-critical'
  | 'inconclusive';

export interface CriticalPointOptions extends HessianOptions {
  /** Gradient magnitude below this scale may count as critical. */
  readonly criticalTolerance?: number;
}

export interface CriticalPointAnalysis {
  readonly point: { readonly x: number; readonly y: number };
  readonly value: number;
  readonly gradient: Gradient;
  readonly gradientMagnitude: number;
  readonly hessian: Hessian;
  readonly classification: CriticalPointClassification;
  readonly criticalTolerance: number;
}

/** Estimate the Hessian using central second differences at two resolutions. */
export function hessianAt(
  evaluate: RealFieldEvaluator,
  x: number,
  y: number,
  options: HessianOptions = {},
): Result<Hessian, MathIssue> {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return fail({
      kind: 'invalid-parameter',
      message: 'A Hessian needs a finite selected point.',
      detail: `(${x}, ${y})`,
    });
  }
  const step = options.step ?? defaultStep(x, y);
  if (!Number.isFinite(step) || step <= 0) {
    return fail({
      kind: 'invalid-parameter',
      message: 'The Hessian step must be a positive finite number.',
      detail: String(step),
    });
  }

  const coarse = centralSecondDifferences(evaluate, x, y, step);
  if (!coarse.ok) return coarse;
  const fine = centralSecondDifferences(evaluate, x, y, step / 2);
  if (!fine.ok) return fine;

  const coarseDeterminant = determinant(coarse.value);
  const fineDeterminant = determinant(fine.value);
  return ok({
    ...fine.value,
    determinant: fineDeterminant,
    estimatedError: Math.max(
      Math.abs(fine.value.xx - coarse.value.xx),
      Math.abs(fine.value.xy - coarse.value.xy),
      Math.abs(fine.value.yy - coarse.value.yy),
    ),
    determinantEstimatedError: Math.abs(fineDeterminant - coarseDeterminant),
  });
}

/**
 * Classify a selected point with the second-derivative test when the numerical
 * evidence separates it from the uncertainty boundaries.
 */
export function criticalPointAt(
  evaluate: RealFieldEvaluator,
  x: number,
  y: number,
  options: CriticalPointOptions = {},
): Result<CriticalPointAnalysis, MathIssue> {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return fail({
      kind: 'invalid-parameter',
      message: 'Critical-point analysis needs a finite selected point.',
      detail: `(${x}, ${y})`,
    });
  }

  const criticalTolerance = options.criticalTolerance ?? 1e-6;
  if (!Number.isFinite(criticalTolerance) || criticalTolerance <= 0) {
    return fail({
      kind: 'invalid-parameter',
      message: 'The critical-point tolerance must be a positive finite number.',
      detail: String(criticalTolerance),
    });
  }

  const value = realValue(evaluate(x, y));
  if (!value.ok) return value;
  const gradient = gradientAt(evaluate, x, y, options);
  if (!gradient.ok) return gradient;
  const hessian = hessianAt(evaluate, x, y, options);
  if (!hessian.ok) return hessian;

  const gradientMagnitude = Math.hypot(gradient.value.x, gradient.value.y);
  const gradientLower = Math.max(0, gradientMagnitude - gradient.value.estimatedError);
  const gradientUpper = gradientMagnitude + gradient.value.estimatedError;
  let classification: CriticalPointClassification;

  if (gradientLower > criticalTolerance) {
    classification = 'non-critical';
  } else if (gradientUpper > criticalTolerance) {
    classification = 'inconclusive';
  } else {
    classification = classifyHessian(hessian.value);
  }

  return ok({
    point: { x, y },
    value: value.value,
    gradient: gradient.value,
    gradientMagnitude,
    hessian: hessian.value,
    classification,
    criticalTolerance,
  });
}

interface SecondDifferences {
  readonly xx: number;
  readonly xy: number;
  readonly yy: number;
}

function centralSecondDifferences(
  evaluate: RealFieldEvaluator,
  x: number,
  y: number,
  step: number,
): Result<SecondDifferences, MathIssue> {
  const centre = realValue(evaluate(x, y));
  if (!centre.ok) return centre;
  const plusX = realValue(evaluate(x + step, y));
  if (!plusX.ok) return plusX;
  const minusX = realValue(evaluate(x - step, y));
  if (!minusX.ok) return minusX;
  const plusY = realValue(evaluate(x, y + step));
  if (!plusY.ok) return plusY;
  const minusY = realValue(evaluate(x, y - step));
  if (!minusY.ok) return minusY;

  const plusPlus = realValue(evaluate(x + step, y + step));
  if (!plusPlus.ok) return plusPlus;
  const plusMinus = realValue(evaluate(x + step, y - step));
  if (!plusMinus.ok) return plusMinus;
  const minusPlus = realValue(evaluate(x - step, y + step));
  if (!minusPlus.ok) return minusPlus;
  const minusMinus = realValue(evaluate(x - step, y - step));
  if (!minusMinus.ok) return minusMinus;

  const stepSquared = step * step;
  const denominator = 4 * stepSquared;
  if (!Number.isFinite(stepSquared) || !Number.isFinite(denominator)) {
    return fail({
      kind: 'invalid-parameter',
      message: 'The Hessian step is too large for finite second differences.',
      detail: String(step),
    });
  }

  // Subtract first so a large finite offset does not make `2 * centre`
  // overflow before the curvature is measured.
  const xxNumerator = plusX.value - centre.value + (minusX.value - centre.value);
  const yyNumerator = plusY.value - centre.value + (minusY.value - centre.value);
  const xyNumerator =
    plusPlus.value - plusMinus.value - (minusPlus.value - minusMinus.value);
  if (![xxNumerator, yyNumerator, xyNumerator].every(Number.isFinite)) {
    return fail({
      kind: 'singularity',
      message: 'The Hessian second differences became non-finite at the selected point.',
    });
  }

  const xx = xxNumerator / stepSquared;
  const yy = yyNumerator / stepSquared;
  const xy = xyNumerator / denominator;
  if (![xx, xy, yy].every(Number.isFinite)) {
    return fail({
      kind: 'singularity',
      message: 'The Hessian became non-finite at the selected point.',
    });
  }
  return ok({ xx, xy, yy });
}

function classifyHessian(hessian: Hessian): CriticalPointClassification {
  const determinantError = hessian.determinantEstimatedError;
  const determinantLower = hessian.determinant - determinantError;
  const determinantUpper = hessian.determinant + determinantError;
  const xxError = hessian.estimatedError;
  const xxLower = hessian.xx - xxError;
  const xxUpper = hessian.xx + xxError;

  if (determinantLower > 0 && xxLower > 0) return 'local-minimum';
  if (determinantLower > 0 && xxUpper < 0) return 'local-maximum';
  if (determinantUpper < 0) return 'saddle';
  return 'inconclusive';
}

function determinant(second: SecondDifferences): number {
  return second.xx * second.yy - second.xy * second.xy;
}

function defaultStep(x: number, y: number): number {
  return 1e-3 * Math.max(1, Math.abs(x), Math.abs(y));
}

function realValue(result: Result<Complex, MathIssue>): Result<number, MathIssue> {
  if (!result.ok) return result;
  if (!isFiniteComplex(result.value)) {
    return fail({
      kind: 'singularity',
      message: 'The Hessian is undefined because the field is undefined nearby.',
    });
  }
  const tolerance = 1e-9 * Math.max(1, Math.abs(result.value.re));
  if (Math.abs(result.value.im) > tolerance) {
    return fail({
      kind: 'dimension-mismatch',
      message: 'A Hessian requires a real-valued scalar field.',
    });
  }
  return ok(result.value.re);
}
