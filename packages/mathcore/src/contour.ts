/**
 * The integral of a function along a contour.
 *
 *     ∫_γ f(z) dz  =  ∫ f(γ(t)) · γ′(t) dt
 *
 * The contour is a function of one real parameter, which is what a path already is
 * in this language (`R → C`), so nothing here needs to know how the path was
 * written. The integral is a quadrature, and the three things that make a quadrature
 * honest are all reported rather than assumed:
 *
 * - **The rule.** The composite trapezoid on the uniform grid. For a *closed* path
 *   the integrand is a periodic function of the parameter and the trapezoid is
 *   spectrally accurate — the error falls faster than any power of the step, which is
 *   why a thousand points reach the floating-point noise floor on the textbook
 *   examples. For an open path it is second order, and much worse, which is the first
 *   thing a caller has to be told.
 * - **The derivative.** γ′ has to be approximated, because a path is written as a
 *   formula and this language has no symbolic differentiation of its own. A plain
 *   central difference is not accurate enough to justify the answers the reference
 *   identities expect, so it is extrapolated once (Richardson), which cancels the
 *   step-squared term and leaves the step-to-the-fourth term balanced against
 *   roundoff. That balance sets a floor on the accuracy, and the floor is reported.
 * - **The error.** The estimate comes from running the rule at `n` and at `2n` and
 *   comparing — a statement about *this* integrand on *this* grid, not a promise. It
 *   is never allowed below the derivative's floor, because no part of the answer is
 *   more accurate than the derivative that produced it.
 *
 * What this module deliberately does not decide is *which poles are enclosed*. That
 * is a different question with an exact answer (`windingNumber`, in
 * `zerosAndPoles.ts`), and a quadrature cannot see a pole the grid steps over. The
 * two are used together — see GOAL.md section 7.17 — and never one in place of the
 * other.
 */
import { CX_ZERO, type Complex, cabs, cadd, cmul, cscale, csub, isFiniteComplex } from './complex';
import { CONTOUR_INTEGRAL, NUMERICS } from './conventions';
import { type MathIssue, type Result, fail, ok } from './errors';
import { formatReal } from './format';

export interface ContourIntegralOptions {
  readonly integrand: (z: Complex) => Result<Complex, MathIssue>;
  readonly path: (t: number) => Result<Complex, MathIssue>;
  /** Start of the parameter interval. Defaults to the convention's lower end. */
  readonly from?: number;
  /** End of the parameter interval. Defaults to the convention's upper end. */
  readonly to?: number;
  /** Points on the grid. Defaults to `NUMERICS.contourSamples`. */
  readonly samples?: number;
}

export interface ContourIntegralResult {
  readonly value: Complex;
  /**
   * The accumulated integral at each point of the grid — where `∫` has got to by the
   * time the parameter reaches `t`, starting at zero. GOAL.md section 7.15 calls this
   * the trajectory, and it is free to compute here: the running sum is already the
   * answer, and a view that re-integrated to draw it would be a second implementation
   * of the same mathematics.
   */
  readonly trajectory: readonly Complex[];
  /**
   * Whether the path comes back to where it started. The residue theorem applies to a
   * closed contour and to nothing else, so this is computed whether or not anyone
   * asks: a `∮` over an open path is a claim the picture cannot make good on.
   */
  readonly closed: boolean;
  /** How far apart the ends are, in absolute terms, so a caller can judge `closed`. */
  readonly closureGap: number;
  readonly from: number;
  readonly to: number;
  readonly samples: number;
  /**
   * The gap between the `n` and `2n` estimates, raised to the derivative's floor. A
   * number, not a promise: it says how much this particular grid moved the answer.
   */
  readonly estimatedError: number;
}

/**
 * The parameter interval, written the way mathematics writes it.
 *
 * `[0, 2π]` and not `[0, 6.283]`: it is a convention rather than a measurement, and a
 * reader recognises the first instantly. One wording, here, so that every place stating
 * the convention states the same thing — and a test holds it to `CONTOUR_INTEGRAL`, so
 * it cannot drift from the numbers it describes.
 */
export const CONTOUR_PARAMETER_TEXT = 't ∈ [0, 2π]';

/** One pass of the rule: the total, the running sum, and what the path did. */
interface Pass {
  readonly total: Complex;
  readonly trajectory: readonly Complex[];
  readonly closureGap: number;
  /** The largest `|γ|` on the grid, which is the scale the closure test is judged at. */
  readonly extent: number;
}

/**
 * Integrate along a contour.
 *
 * A point where the contour, or the integrand on it, has no value is *reported*: the
 * integral of a function through its own pole is not a large number, it is not a
 * number, and returning one would be the failure this project exists to avoid.
 */
export function contourIntegral(
  options: ContourIntegralOptions,
): Result<ContourIntegralResult, MathIssue> {
  const from = options.from ?? CONTOUR_INTEGRAL.from;
  const to = options.to ?? CONTOUR_INTEGRAL.to;
  const samples = Math.max(8, Math.floor(options.samples ?? NUMERICS.contourSamples));

  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return fail({
      kind: 'unsupported',
      detail: 'contour parameter range',
      message:
        'A contour is integrated over an interval, so its parameter needs a start below its end.',
    });
  }

  const coarse = integrateAt(options, from, to, samples);
  if (!coarse.ok) return coarse;

  // The same rule on twice the grid. The difference between the two is the only
  // honest thing to say about accuracy here: it is measured, not assumed.
  const fine = integrateAt(options, from, to, samples * 2);
  if (!fine.ok) return fine;

  const halving = cabs(csub(fine.value.total, coarse.value.total));
  const floor = NUMERICS.contourDerivativeFloor * Math.max(1, cabs(coarse.value.total));

  return ok({
    value: coarse.value.total,
    trajectory: coarse.value.trajectory,
    closed: coarse.value.closureGap <= NUMERICS.contourClosureTolerance * (1 + coarse.value.extent),
    closureGap: coarse.value.closureGap,
    from,
    to,
    samples,
    estimatedError: Math.max(halving, floor),
  });
}

/** One run of the trapezoid rule on a grid of `samples` intervals. */
function integrateAt(
  options: ContourIntegralOptions,
  from: number,
  to: number,
  samples: number,
): Result<Pass, MathIssue> {
  const step = (to - from) / samples;
  const derivativeStep = (to - from) * NUMERICS.contourDerivativeStepFraction;

  // The composite trapezoid, accumulated one interval at a time. Writing it as a
  // running sum rather than as weights over the whole grid produces the trajectory
  // for nothing, and it is the same arithmetic: the two half-weights at the ends of a
  // closed contour meet to make the single full weight the periodic rule would have
  // used.
  let running: Complex = CX_ZERO;
  const trajectory: Complex[] = [running];
  let previous: Complex | null = null;
  let first: Complex | null = null;
  let last: Complex = CX_ZERO;
  let extent = 0;

  for (let index = 0; index <= samples; index += 1) {
    // The last point is placed rather than computed, so the grid ends exactly at `to`
    // instead of a rounding step away from it.
    const t = index === samples ? to : from + index * step;
    const point = finiteValue(options.path, t, 'The contour');
    if (!point.ok) return point;
    const onPath = point.value;

    if (first === null) first = onPath;
    last = onPath;
    extent = Math.max(extent, cabs(onPath));

    const value = options.integrand(onPath);
    if (!value.ok) {
      return fail({
        kind: 'singularity',
        detail: `integrand at t = ${formatReal(t)}`,
        message: `The contour passes through a place where the integrand has no value, at t = ${formatReal(t)} (${value.issue.message})`,
      });
    }
    if (!isFiniteComplex(value.value)) {
      return fail({
        kind: 'singularity',
        detail: `integrand at t = ${formatReal(t)}`,
        message: `The integrand is not finite on the contour at t = ${formatReal(t)}.`,
      });
    }

    const derivative = derivativeAt(options.path, t, derivativeStep);
    if (!derivative.ok) return derivative;
    const term = cmul(value.value, derivative.value);

    if (previous !== null) {
      running = cadd(running, cscale(cadd(previous, term), step / 2));
      trajectory.push(running);
    }
    previous = term;
  }

  const closureGap = first === null ? Number.POSITIVE_INFINITY : cabs(csub(last, first));
  return ok({ total: running, trajectory, closureGap, extent });
}

/**
 * γ′(t), by a central difference extrapolated once.
 *
 * The plain central difference has error of order h² and a roundoff term of order
 * ε/h, so its best achievable accuracy is around `sqrt(ε) ≈ 10⁻⁸` — worse than the
 * answers the reference identities are stated to. Extrapolating one step removes the
 * h² term, leaving h⁴ against ε/h; the step in `NUMERICS` is chosen so those two are
 * comparable, which is where the accuracy floor comes from.
 *
 * The extrapolation needs γ at `t ± 2h` and `t ± h`, and a path is a formula rather
 * than a curve with ends, so evaluating it just outside the integration interval is
 * legitimate and is what keeps the endpoints as accurate as the interior. A path that
 * genuinely has no value there — `sqrt(t)` started at zero — falls back to a
 * one-sided difference at the cost of that accuracy, rather than failing.
 */
function derivativeAt(
  path: (t: number) => Result<Complex, MathIssue>,
  t: number,
  step: number,
): Result<Complex, MathIssue> {
  const centred = centralDifference(path, t, step);
  if (centred.ok) return centred;

  const forward = oneSidedDifference(path, t, step, 1);
  if (forward.ok) return forward;

  const backward = oneSidedDifference(path, t, step, -1);
  if (backward.ok) return backward;

  return fail(centred.issue);
}

/** (4·D(h/2) − D(h))/3, which is the central difference with its h² term cancelled. */
function centralDifference(
  path: (t: number) => Result<Complex, MathIssue>,
  t: number,
  step: number,
): Result<Complex, MathIssue> {
  const farLeft = finiteValue(path, t - step, 'The contour');
  if (!farLeft.ok) return farLeft;
  const farRight = finiteValue(path, t + step, 'The contour');
  if (!farRight.ok) return farRight;
  const nearLeft = finiteValue(path, t - step / 2, 'The contour');
  if (!nearLeft.ok) return nearLeft;
  const nearRight = finiteValue(path, t + step / 2, 'The contour');
  if (!nearRight.ok) return nearRight;

  const coarse = cscale(csub(farRight.value, farLeft.value), 1 / (2 * step));
  const fine = cscale(csub(nearRight.value, nearLeft.value), 1 / step);
  return ok(cscale(csub(cscale(fine, 4), coarse), 1 / 3));
}

/**
 * (−3γ(t) + 4γ(t±h) ∓ γ(t±2h)) / 2h, second order, for a path with an edge at `t`.
 *
 * `direction` is the way the stencil leans, and it is also the sign the whole
 * expression takes, because leaning the other way turns the same three samples into a
 * different formula rather than into the same one with the step reversed.
 */
function oneSidedDifference(
  path: (t: number) => Result<Complex, MathIssue>,
  t: number,
  step: number,
  direction: 1 | -1,
): Result<Complex, MathIssue> {
  const here = finiteValue(path, t, 'The contour');
  if (!here.ok) return here;
  const next = finiteValue(path, t + direction * step, 'The contour');
  if (!next.ok) return next;
  const after = finiteValue(path, t + direction * 2 * step, 'The contour');
  if (!after.ok) return after;

  const numerator = csub(cadd(cscale(here.value, -3), cscale(next.value, 4)), after.value);
  return ok(cscale(numerator, direction / (2 * step)));
}

/** Evaluate the path, reporting a value that is not finite as a place, not as a number. */
function finiteValue(
  path: (t: number) => Result<Complex, MathIssue>,
  t: number,
  what: string,
): Result<Complex, MathIssue> {
  const at = path(t);
  if (!at.ok) return at;
  if (!isFiniteComplex(at.value)) {
    return fail({
      kind: 'singularity',
      detail: `contour at t = ${formatReal(t)}`,
      message: `${what} has no finite value at t = ${formatReal(t)}.`,
    });
  }
  return ok(at.value);
}
