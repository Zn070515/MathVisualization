/**
 * Where a complex function vanishes, and where it blows up.
 *
 * The honest way to ask this question is not "where is |f| small". That is a
 * *deduction* from a threshold, and it is wrong in the same way a minimum at height
 * 0.0001 is wrong when it is called a root: the number is a statement about the
 * samples, not about the function.
 *
 * Complex analysis has a better answer, and it is a fact. The **argument principle**
 * says that for a closed curve with no zero or pole on it,
 *
 *     (1/2π) · Δarg f along the curve  =  N − P
 *
 * the number of zeros minus the number of poles *inside*. That count is an integer,
 * and it is exact — the sampling error can move it by a millionth, not by one.
 *
 * So the division of labour here is:
 *
 * - **Which kind of point it is, and of what order, is a fact.** Take a small
 *   circle around a candidate and count the argument's turns: `+k` is a zero of
 *   order `k`, `−k` is a pole of order `k`, `0` is neither. Nothing is thresholded.
 * - **Where exactly it is, is a deduction.** A candidate is found by looking for
 *   local extrema of `|f|`, and its coordinates are then refined numerically, so
 *   they are approximate — and stated as such by being numbers. Moving the point a
 *   hundredth of a unit cannot change the order, because the order never depended on
 *   where the point is.
 *
 * A contour so close to a singularity that the samples cannot resolve it gives a
 * value that is not near a whole number, and that is reported as *no answer* rather
 * than rounded to the nearest one. `sin(z)/z` at the origin is a removable
 * singularity: three contours around it agree on zero, so nothing is reported, which
 * is correct — there is no zero there and no pole.
 */
import { type Complex, cabs, isUndefined, principalArg } from './complex';
import { type MathIssue, type Result } from './errors';

/** How many times the argument of `f` turns as a circle is walked. */
export interface Winding {
  /**
   * The winding number, when it is a whole number, and null when the samples cannot
   * say. Null is an answer: it means the contour is too close to something, and
   * rounding the near-integer anyway would be inventing a count.
   */
  readonly count: number | null;
  /** The value before rounding, so a caller can see how close it came. */
  readonly raw: number;
}

export interface Singularity {
  /** Where it is — approximate, because a search found it. */
  readonly z: Complex;
  /**
   * What it is, from the winding number and not from a threshold. Positive turn is
   * a zero, negative is a pole.
   */
  readonly kind: 'zero' | 'pole';
  /** How many, and therefore the order: an integer. */
  readonly order: number;
}

export interface ZerosAndPolesOptions {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
  /** How finely the region is searched before candidates are tested. */
  readonly resolution?: number;
}

/** Places a contour is sampled. Enough that a turn of a few radians is resolved. */
const CONTOUR_SAMPLES = 512;

/** How near a whole number a winding has to land to be taken as one. */
const INTEGER_TOLERANCE = 1e-4;

/** How finely the region is searched by default. */
const DEFAULT_RESOLUTION = 40;

/** An upper bound on what is reported, for a function that has no end of either. */
const MAX_FOUND = 40;

/** An upper bound on how many grid points are worth refining, for the same reason. */
const MAX_CANDIDATES = MAX_FOUND * 4;

/** A grid point that might be standing in for a singularity. */
interface Candidate {
  readonly at: Complex;
  /**
   * Which way to walk: `|f|` towards a zero, `1/|f|` towards a pole. A guess, and
   * only a guess — the winding number afterwards is what settles the question.
   */
  readonly minimise: boolean;
}

/**
 * The number of zeros minus the number of poles inside a circle.
 *
 * The contour is walked once, the argument of `f` is tracked continuously across
 * the samples — each step is wrapped into `(-π, π]`, the same convention the rest of
 * the project uses — and the total turn is divided by a full turn.
 *
 * A function with no value anywhere on the contour cannot be counted, and says so.
 */
export function windingNumber(
  evaluate: (z: Complex) => Result<Complex, MathIssue>,
  centre: Complex,
  radius: number,
  samples: number = CONTOUR_SAMPLES,
): Winding {
  if (!Number.isFinite(radius) || radius <= 0 || samples < 4) {
    return { count: null, raw: Number.NaN };
  }

  let previous: number | null = null;
  let total = 0;

  // The last sample repeats the first, so the walk closes and the final turn is
  // included.
  for (let index = 0; index <= samples; index += 1) {
    const angle = (index / samples) * 2 * Math.PI;
    const at = {
      re: centre.re + radius * Math.cos(angle),
      im: centre.im + radius * Math.sin(angle),
    };
    const result = evaluate(at);
    if (!result.ok || isUndefined(result.value)) return { count: null, raw: Number.NaN };

    const argument = principalArg(result.value);
    if (previous !== null) {
      let step = argument - previous;
      // Wrapped into (-π, π], so a step never spans more than half a turn and the
      // running total is continuous.
      if (step > Math.PI) step -= 2 * Math.PI;
      else if (step <= -Math.PI) step += 2 * Math.PI;
      total += step;
    }
    previous = argument;
  }

  const raw = total / (2 * Math.PI);
  if (!Number.isFinite(raw)) return { count: null, raw: Number.NaN };

  const nearest = Math.round(raw);
  if (Math.abs(raw - nearest) > INTEGER_TOLERANCE) return { count: null, raw };
  // `Math.round(-0.0000001)` is `-0`, and a count of negative zero is a wart a
  // caller should not have to think about.
  return { count: nearest + 0, raw };
}

/**
 * The zeros and poles of a function in a region.
 *
 * Candidates come from the local extrema of `|f|` — a zero is a place where the
 * modulus bottoms out, a pole is a place where it peaks or where the function has no
 * value at all — and each candidate is then *classified* by the argument principle.
 * That order matters: the candidate rule is a heuristic, and the classification is
 * not, so a candidate that is neither a zero nor a pole is discarded by a zero
 * winding rather than by a tolerance.
 *
 * The resolution bounds what can be told apart. Two zeros inside one cell of the
 * search are found once, with the combined order — which is the truth about that
 * cell, and is reported rather than hidden.
 */
export function findZerosAndPoles(
  evaluate: (z: Complex) => Result<Complex, MathIssue>,
  options: ZerosAndPolesOptions,
): readonly Singularity[] {
  const { xMin, xMax, yMin, yMax } = options;
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax)) return [];
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) return [];
  if (xMax <= xMin || yMax <= yMin) return [];

  const resolution = Math.max(8, Math.floor(options.resolution ?? DEFAULT_RESOLUTION));
  const stepX = (xMax - xMin) / (resolution - 1);
  const stepY = (yMax - yMin) / (resolution - 1);

  /** `|f|` at a grid point, or null where there is no value. */
  const magnitudeAt = (column: number, row: number): number | null => {
    const result = evaluate({ re: xMin + column * stepX, im: yMin + row * stepY });
    if (!result.ok || isUndefined(result.value)) return null;
    const magnitude = cabs(result.value);
    return Number.isFinite(magnitude) ? magnitude : null;
  };

  const table: (number | null)[][] = [];
  for (let row = 0; row < resolution; row += 1) {
    const line: (number | null)[] = [];
    for (let column = 0; column < resolution; column += 1) line.push(magnitudeAt(column, row));
    table.push(line);
  }

  const candidates: Candidate[] = [];
  for (let row = 0; row < resolution; row += 1) {
    for (let column = 0; column < resolution; column += 1) {
      const here = table[row]?.[column];
      const at = { re: xMin + column * stepX, im: yMin + row * stepY };

      // No value here at all: a pole, or a hole in the domain. Either way it is
      // worth testing, and the winding number decides which.
      if (here === null || here === undefined) {
        candidates.push({ at, minimise: false });
        continue;
      }

      let higher = false;
      let lower = false;
      for (let dRow = -1; dRow <= 1; dRow += 1) {
        for (let dColumn = -1; dColumn <= 1; dColumn += 1) {
          if (dRow === 0 && dColumn === 0) continue;
          const neighbour = table[row + dRow]?.[column + dColumn];
          if (neighbour === null || neighbour === undefined) continue;
          if (neighbour > here) higher = true;
          if (neighbour < here) lower = true;
        }
      }
      // An extremum of the modulus. A bottom is *probably* a zero and a top is
      // *probably* a pole — and that guess is only used to decide which way to walk
      // downhill. The contour below decides what the point actually is.
      if (!lower) candidates.push({ at, minimise: true });
      else if (!higher) candidates.push({ at, minimise: false });
    }
  }

  const contourRadius = Math.min(stepX, stepY) * 0.5;
  const found: Singularity[] = [];

  for (const candidate of candidates.slice(0, MAX_CANDIDATES)) {
    // **Walk to the extremum before measuring anything.** A grid point can be most
    // of a cell away from the singularity it is standing in for, and a contour drawn
    // around the grid point then misses it entirely — which is what the first
    // version did, and why a pole that does not land on a sample is invisible.
    const z = refine(evaluate, candidate.at, Math.max(stepX, stepY), candidate.minimise);

    // The walk can leave the region, and a singularity it finds out there is not one
    // this search was asked about. `tan` has a zero at every multiple of π, so a
    // candidate near the window's edge descends straight out of the window and
    // reports a zero that is not in it.
    if (z.re < xMin || z.re > xMax || z.im < yMin || z.im > yMax) continue;

    const winding = windingNumber(evaluate, z, contourRadius);
    if (winding.count === null || winding.count === 0) continue;
    found.push({
      z,
      kind: winding.count > 0 ? 'zero' : 'pole',
      order: Math.abs(winding.count),
    });
  }

  found.sort((left, right) => left.z.re - right.z.re || left.z.im - right.z.im);

  // Two candidates in one cell are one point; the order found there already counts
  // everything inside it.
  const spacing = Math.min(stepX, stepY) * 0.5;
  const distinct: Singularity[] = [];
  for (const point of found) {
    const duplicate = distinct.some(
      (kept) => Math.hypot(kept.z.re - point.z.re, kept.z.im - point.z.im) < spacing,
    );
    if (!duplicate) distinct.push(point);
  }

  return distinct.slice(0, MAX_FOUND);
}

/** What is being driven to zero: the modulus, or its reciprocal. */
function objectiveOf(
  evaluate: (z: Complex) => Result<Complex, MathIssue>,
  minimise: boolean,
): (z: Complex) => number {
  return (z) => {
    const result = evaluate(z);
    const noValue = !result.ok || isUndefined(result.value);
    // Where there is no value, one of the two searches has arrived: a pole is a
    // perfect answer to "where is 1/|f| smallest" and a hopeless one to "where is
    // |f| smallest".
    if (noValue) return minimise ? Number.POSITIVE_INFINITY : 0;

    const magnitude = cabs(result.value);
    if (magnitude === 0) return minimise ? 0 : Number.POSITIVE_INFINITY;
    return minimise ? magnitude : 1 / magnitude;
  };
}

/**
 * Walk downhill from a candidate, halving the step when no direction helps.
 *
 * The coordinates this produces are approximate and that is the point: the *order*
 * was settled by the winding number before this ran, and moving the point about
 * cannot change it.
 */
function refine(
  evaluate: (z: Complex) => Result<Complex, MathIssue>,
  start: Complex,
  scale: number,
  minimise: boolean,
): Complex {
  const objective = objectiveOf(evaluate, minimise);
  const directions: readonly (readonly [number, number])[] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];

  let best = start;
  let bestValue = objective(start);
  let step = scale * 0.5;

  for (let round = 0; round < 60 && step > 1e-13; round += 1) {
    let improved = false;
    for (const [alongRe, alongIm] of directions) {
      const candidate = { re: best.re + alongRe * step, im: best.im + alongIm * step };
      const value = objective(candidate);
      if (value < bestValue) {
        bestValue = value;
        best = candidate;
        improved = true;
      }
    }
    if (!improved) step /= 2;
  }

  return best;
}
