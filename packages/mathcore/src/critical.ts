/**
 * Finding the points on a curve that are worth naming.
 *
 * A reader looking at a graph wants to know where it crosses the axis and where it
 * turns round. Desmos marks those automatically, and the reason this module exists
 * is that its own documentation admits the marking can be wrong: a minimum at
 * height 0.0001 is drawn as a root, and only zooming in shows that the curve never
 * reaches the axis.
 *
 * So the rule here is that a *crossing* and a *touch* are different claims and are
 * reported as different things:
 *
 * - **A crossing is a fact.** The function changes sign across an interval, and
 *   bisection narrows that interval until the bracket is at the limit of double
 *   precision. Nothing is inferred.
 * - **A touch is a deduction.** It is a local minimum whose height is zero *to
 *   within what the samples can resolve*. That is worth saying — `t²` really does
 *   touch the axis — but it is not the same statement, and it is reported as a
 *   minimum that happens to sit on the axis rather than as a root.
 *
 * And a sign change is not always a crossing. `tan` goes from `+∞` to `-∞` across
 * `π/2`, which every sampler sees as a sign change and no function has a root
 * there. `bisect` below tells the two apart by asking which way the magnitude
 * moved: at a root it shrinks, at a pole it grows.
 *
 * Everything here is a numerical statement about samples, and the product says so
 * elsewhere: a readout is a double-precision number and is presented as one.
 */
import { type Complex } from './complex';
import { type MathIssue, type Result } from './errors';

export type CriticalKind = 'zero' | 'minimum' | 'maximum';

/**
 * A point worth naming, or a point worth being careful about.
 *
 * The two variants are separate rather than one shape with a flag, because a
 * caller that wants to label them differently should not be able to forget which
 * claim it is making.
 */
export type CriticalPoint =
  | {
      readonly kind: 'zero';
      readonly t: number;
      /** `f(t)`. Near zero by construction, and stated so a caller can check. */
      readonly value: number;
    }
  | {
      readonly kind: 'minimum' | 'maximum';
      readonly t: number;
      readonly value: number;
      /**
       * Whether the curve is flat against the axis here.
       *
       * True for `t²` at the origin. It is *not* a claim that the function has a
       * root: it says the turn is closer to the axis than the samples can
       * distinguish, which for `(x − 2)² + 0.0001` is false and is why that curve
       * gets a minimum at height 0.0001 rather than a root.
       */
      readonly touchesAxis: boolean;
    };

export interface CriticalOptions {
  readonly tMin: number;
  readonly tMax: number;
  /** How many places the curve is looked at. More finds more, and costs more. */
  readonly samples?: number;
}

/** Samples across the window. Enough that two nearby features are usually separate. */
const DEFAULT_SAMPLES = 800;

/** Limiting brackets for bisection and for the ternary search. */
const REFINEMENT_STEPS = 80;

/** A sample this close to zero is taken as being on the axis. */
const ON_AXIS = 0;

/**
 * How flat against the axis an extremum has to be to count as touching it.
 *
 * Relative to the range of values in the window, so it means the same thing for a
 * curve in the thousands as for one in the ones. This is a statement about what
 * the samples can resolve, not a proof of tangency, which is why the result says
 * "this minimum sits on the axis" rather than "this is a root".
 */
const TOUCH_TOLERANCE = 1e-6;

/** An upper bound on how many points are reported, for a curve that never settles. */
const MAX_POINTS = 60;

interface Sample {
  readonly t: number;
  /** Null where the function has no value. */
  readonly value: number | null;
}

function valueOf(evaluate: (t: number) => Result<Complex, MathIssue>, t: number): number | null {
  const result = evaluate(t);
  if (!result.ok) return null;
  const value = result.value.re;
  return Number.isFinite(value) ? value : null;
}

/**
 * The root in a bracket, or null if the bracket is not one.
 *
 * The discriminator is the direction the magnitude moves. Bisection at a genuine
 * crossing drives `|f|` towards zero at both ends; at a pole like `tan`'s it drives
 * both ends towards infinity while the sign still flips. Comparing the two is
 * scale-free — no tolerance has to be guessed for a function measured in millions.
 */
function bisect(
  evaluate: (t: number) => Result<Complex, MathIssue>,
  lowT: number,
  highT: number,
  lowValue: number,
): { readonly t: number; readonly value: number } | null {
  const startedAt = Math.max(Math.abs(lowValue), Math.abs(valueOf(evaluate, highT) ?? Infinity));

  let lo = lowT;
  let hi = highT;
  let flo = lowValue;

  for (let step = 0; step < REFINEMENT_STEPS; step += 1) {
    const mid = (lo + hi) / 2;
    const fmid = valueOf(evaluate, mid);
    // A gap in the domain inside the bracket means the two ends are not connected,
    // so a sign change across it says nothing about either end.
    if (fmid === null) return null;
    if (Math.sign(fmid) === Math.sign(flo)) {
      lo = mid;
      flo = fmid;
    } else {
      hi = mid;
    }
    if (hi - lo === 0) break;
  }

  const t = (lo + hi) / 2;
  const value = valueOf(evaluate, t);
  if (value === null) return null;

  // The ends are now this far apart, and their magnitudes say which kind of point
  // this is.
  const lowEnd = Math.abs(valueOf(evaluate, lo) ?? Infinity);
  const highEnd = Math.abs(valueOf(evaluate, hi) ?? Infinity);
  if (!Number.isFinite(lowEnd) || !Number.isFinite(highEnd)) return null;
  if (Math.max(lowEnd, highEnd) > startedAt) return null; // a pole, not a crossing

  return { t, value };
}

/** The extremum on a bracket, by ternary search. */
function ternary(
  evaluate: (t: number) => Result<Complex, MathIssue>,
  lowT: number,
  highT: number,
  maximise: boolean,
): { readonly t: number; readonly value: number } | null {
  let lo = lowT;
  let hi = highT;
  for (let step = 0; step < REFINEMENT_STEPS; step += 1) {
    const third = (hi - lo) / 3;
    const left = lo + third;
    const right = hi - third;
    const fLeft = valueOf(evaluate, left);
    const fRight = valueOf(evaluate, right);
    if (fLeft === null || fRight === null) return null;
    const leftIsBetter = maximise ? fLeft > fRight : fLeft < fRight;
    if (leftIsBetter) hi = right;
    else lo = left;
    if (hi - lo === 0) break;
  }
  const t = (lo + hi) / 2;
  const value = valueOf(evaluate, t);
  return value === null ? null : { t, value };
}

/**
 * The zeros and turning points of a function of one real variable.
 *
 * The function is given as an evaluator rather than as an expression, so this
 * works on whatever the caller has already bound — parameters, the active
 * expression, a user-defined function — and needs to know nothing about any of it.
 */
export function findCriticalPoints(
  evaluate: (t: number) => Result<Complex, MathIssue>,
  options: CriticalOptions,
): readonly CriticalPoint[] {
  const { tMin, tMax } = options;
  if (!Number.isFinite(tMin) || !Number.isFinite(tMax) || tMax <= tMin) return [];

  const samples = Math.max(16, Math.floor(options.samples ?? DEFAULT_SAMPLES));
  const step = (tMax - tMin) / samples;

  const table: Sample[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const t = index === samples ? tMax : tMin + index * step;
    table.push({ t, value: valueOf(evaluate, t) });
  }

  const range = ((): number => {
    let low = Infinity;
    let high = -Infinity;
    for (const sample of table) {
      if (sample.value === null) continue;
      if (sample.value < low) low = sample.value;
      if (sample.value > high) high = sample.value;
    }
    return Number.isFinite(low) && Number.isFinite(high) ? high - low : 0;
  })();
  const touchFloor = range * TOUCH_TOLERANCE;

  const found: CriticalPoint[] = [];

  for (let index = 0; index < table.length; index += 1) {
    const sample = table[index];
    if (sample === undefined || sample.value === null) continue;
    if (Math.abs(sample.value) <= ON_AXIS) {
      found.push({ kind: 'zero', t: sample.t, value: 0 });
    }
  }

  // A crossing that the edge of the window cuts through has no bracket to bisect:
  // the curve meets the axis *at* the boundary. `sin` over a whole number of turns
  // ends on the axis, and its value there is not exactly zero — it is a rounding
  // error away from it — so the near-zero test is what finds it.
  //
  // The tolerance is deliberately far tighter than the one for a touching turn:
  // this is only for values that are zero as far as double precision is concerned.
  const edgeFloor = range * 1e-9;
  for (const sample of [table[0], table[table.length - 1]]) {
    if (sample === undefined || sample.value === null) continue;
    if (sample.value !== 0 && Math.abs(sample.value) <= edgeFloor) {
      found.push({ kind: 'zero', t: sample.t, value: sample.value });
    }
  }

  for (let index = 0; index + 1 < table.length; index += 1) {
    const left = table[index];
    const right = table[index + 1];
    if (left === undefined || right === undefined) continue;
    if (left.value === null || right.value === null) continue;
    // A bracket that includes an exact zero is already reported as one.
    if (Math.abs(left.value) <= ON_AXIS || Math.abs(right.value) <= ON_AXIS) continue;
    if (left.value * right.value >= 0) continue;

    const root = bisect(evaluate, left.t, right.t, left.value);
    if (root !== null) found.push({ kind: 'zero', t: root.t, value: root.value });
  }

  // A turning point shows up as a change in the sign of the slope between
  // neighbouring samples. The slope is a difference quotient rather than a
  // derivative, so it needs no new mathematics — the same evaluator answers it.
  for (let index = 1; index + 1 < table.length; index += 1) {
    const before = table[index - 1];
    const here = table[index];
    const after = table[index + 1];
    if (before === undefined || here === undefined || after === undefined) continue;
    if (before.value === null || here.value === null || after.value === null) continue;

    const rise = here.value - before.value;
    const fall = after.value - here.value;
    if (rise === 0 || fall === 0) continue;
    if (Math.sign(rise) === Math.sign(fall)) continue;

    const maximise = rise > 0;
    const turn = ternary(evaluate, before.t, after.t, maximise);
    if (turn === null) continue;
    found.push({
      kind: maximise ? 'maximum' : 'minimum',
      t: turn.t,
      value: turn.value,
      touchesAxis: Math.abs(turn.value) <= touchFloor,
    });
  }

  found.sort((a, b) => a.t - b.t);

  // Two features found from adjacent samples are one feature. The window is not
  // going to resolve anything narrower than the sample spacing anyway.
  const spacing = step * 2;
  const distinct: CriticalPoint[] = [];
  for (const point of found) {
    const previous = distinct[distinct.length - 1];
    if (previous !== undefined && Math.abs(point.t - previous.t) < spacing) {
      // **A turn wins the place.** If the curve changes direction exactly where it
      // meets the axis, the true statement is that it *touched* — and calling that
      // a crossing is precisely the mistake this module exists to avoid. `t²` and
      // `abs(t)` both land their minimum exactly on a sample, so this is the
      // ordinary case and not an exotic one.
      if (point.kind !== 'zero' && previous.kind === 'zero') {
        distinct[distinct.length - 1] = point;
      }
      continue;
    }
    distinct.push(point);
  }

  return distinct.slice(0, MAX_POINTS);
}
