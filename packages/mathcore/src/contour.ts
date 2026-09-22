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
import {
  CX_ZERO,
  type Complex,
  cabs,
  cadd,
  cmul,
  cscale,
  csub,
  cx,
  isFiniteComplex,
  principalArg,
} from './complex';
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
   * The contour itself, at the points the rule sampled.
   *
   * Returned because a view has to draw the contour and the callbacks that produce it
   * belong to the caller: sampling it again in the view would be a second evaluation of
   * the same path at the same points, and the two could disagree about where the contour
   * is. GOAL.md section 7.15 asks for the contour and its orientation to be visible, and
   * this is that, at no extra cost.
   */
  readonly path: readonly Complex[];
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

/** Radii a residue is measured at, as fractions of the largest one offered. */
const RESIDUE_RADIUS_STEPS = [1, 1 / 2, 1 / 4, 1 / 8] as const;

/** How closely two radii have to agree before their answer is kept. */
const RESIDUE_AGREEMENT = 1e-8;

/** Samples on a residue's circle. The integrand is periodic on it, so this is ample. */
const RESIDUE_SAMPLES = 256;

/**
 * The residue of `f` at a pole — the coefficient of `1/(z − z₀)` in its Laurent series.
 *
 *     Res(f, z₀) = (1/2πi) ∮ f(z) dz   around a circle holding that pole and no other
 *
 * This is the definition, evaluated, and it reuses the contour integral above because
 * that is literally what it is: the same rule, the same γ′, the same reported accuracy.
 * Nothing here is a second implementation.
 *
 * **The radii have to agree, and that is the whole of the honesty.** A circle drawn too
 * large holds other poles, and the integral around it is then the *sum* of their
 * residues — a correct answer to a different question. So a ladder of radii is tried,
 * descending from `maxRadius`, and the answer kept is the largest one whose neighbours
 * agree with it. A circle that swallows a neighbour is therefore outvoted by the ones
 * that do not, and a function for which no two radii agree gives `null` — no answer,
 * rather than the sum of somebody else's residues.
 *
 * `maxRadius` is the caller's business, because only the caller knows the window it is
 * looking at; the agreement rule is what makes an over-generous one safe.
 */
export function residueAt(
  evaluate: (z: Complex) => Result<Complex, MathIssue>,
  pole: Complex,
  maxRadius: number,
): Complex | null {
  if (!Number.isFinite(maxRadius) || maxRadius <= 0) return null;

  const measured: (Complex | null)[] = RESIDUE_RADIUS_STEPS.map((fraction) =>
    aroundCircle(evaluate, pole, maxRadius * fraction),
  );

  // Largest first: the first radius whose answer the two below it agree with is the one
  // kept, so the answer comes from as large a circle as still isolates the pole — which
  // is the one least affected by the pole's own neighbours being partly resolved.
  for (let index = 0; index + 2 < measured.length; index += 1) {
    const here = measured[index] ?? null;
    const next = measured[index + 1] ?? null;
    const after = measured[index + 2] ?? null;
    if (here === null || next === null || after === null) continue;
    if (agrees(here, next) && agrees(here, after)) return here;
  }

  // The last two, if the ladder ran out before three in a row were available: still two
  // independent measurements of the same coefficient.
  const last = measured[measured.length - 1] ?? null;
  const secondLast = measured[measured.length - 2] ?? null;
  if (last !== null && secondLast !== null && agrees(last, secondLast)) return last;
  return null;
}

/**
 * How many times a contour winds around a point, counted from the contour's samples.
 *
 * The argument principle, applied to the contour rather than to a function: the total
 * change in `arg(γ(t) − p)` over the traversal, divided by a full turn. It is the same
 * idea as `windingNumber` in `zerosAndPoles.ts` and trustworthy for the same reason — the
 * answer is an integer, so sampling error can move it by a millionth and cannot move it
 * by one.
 *
 * The samples come from the caller because the caller already has them: they are the
 * ones the integral was computed on, and counting the turns of a different sampling
 * would be answering about a different curve. A contour that passes exactly through the
 * point has no winding number, and says so rather than returning a zero that would read
 * as "outside".
 */
export function windingAround(path: readonly Complex[], about: Complex): number | null {
  let previous: number | null = null;
  let total = 0;

  for (const point of path) {
    const offset = csub(point, about);
    if (offset.re === 0 && offset.im === 0) return null;
    const argument = principalArg(offset);
    if (!Number.isFinite(argument)) return null;
    if (previous !== null) {
      let step = argument - previous;
      // Wrapped into (-π, π], so a step never spans more than half a turn: the samples
      // of a smooth contour move a fraction of a turn at a time.
      if (step > Math.PI) step -= 2 * Math.PI;
      else if (step <= -Math.PI) step += 2 * Math.PI;
      total += step;
    }
    previous = argument;
  }

  if (!Number.isFinite(total)) return null;
  // `Math.round(-0.0000001)` is `-0`, and a winding of negative zero is a wart a caller
  // should not have to think about.
  return Math.round(total / (2 * Math.PI)) + 0;
}

/** (1/2πi) ∮ f dz around |z − centre| = radius, or null when the circle cannot be walked. */
function aroundCircle(
  evaluate: (z: Complex) => Result<Complex, MathIssue>,
  centre: Complex,
  radius: number,
): Complex | null {
  const integrated = contourIntegral({
    path: (t) => ok(cx(centre.re + radius * Math.cos(t), centre.im + radius * Math.sin(t))),
    integrand: evaluate,
    samples: RESIDUE_SAMPLES,
  });
  if (!integrated.ok) return null;
  // Divide by 2πi, which is the same as multiplying by −i/(2π).
  return cmul(integrated.value.value, cx(0, -1 / (2 * Math.PI)));
}

/** Whether two measurements of the same residue are the same number. */
function agrees(left: Complex, right: Complex): boolean {
  const difference = cabs(csub(left, right));
  return difference <= RESIDUE_AGREEMENT * Math.max(1, cabs(left), cabs(right));
}

/** One pass of the rule: the total, the running sum, and what the path did. */
interface Pass {
  readonly total: Complex;
  readonly path: readonly Complex[];
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
    path: coarse.value.path,
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
  const path: Complex[] = [];
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
    path.push(onPath);

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
  return ok({ total: running, path, trajectory, closureGap, extent });
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
