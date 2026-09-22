/**
 * Where the ticks on an axis go, and what they say.
 *
 * Two things make a numbered axis trustworthy, and both are easy to get subtly
 * wrong:
 *
 * - the ticks must land on steps a reader can do arithmetic with. Nobody counts
 *   in 0.6667; they count in 0.5 and 2 and 5×10⁴.
 * - the number printed beside a tick must be the coordinate that tick is at. The
 *   obvious loop — start at the edge and add the step until you run out —
 *   accumulates error, and a tick a hair off 0.3 gets labelled `0.30000000000000004`
 *   or `0.29999999999999999`. Every tick here is computed as *index × step*, so
 *   the value and its label cannot disagree.
 *
 * The rule and its numbers live in `TICK_STEP` (`conventions.ts`); this module is
 * the only implementation of them.
 */
import { TICK_STEP } from './conventions';
import { displayNumber, type DisplayNumber } from './display';

/** A tick: the coordinate it sits at, and how to write it. */
export interface Tick {
  readonly value: number;
  readonly label: DisplayNumber;
}

/** The whole ladder of ticks for one axis, major and minor. */
export interface AxisTicks {
  /** Spacing of the numbered ticks. */
  readonly step: number;
  /** Spacing of the unnumbered subdivision. */
  readonly minorStep: number;
  /** The numbered ticks, in increasing order. */
  readonly major: readonly Tick[];
  /** The subdivision ticks, in increasing order, including the major ones. */
  readonly minor: readonly Tick[];
}

const SAFE_UNIT_STEP = 1;

/**
 * How close to a whole index an edge must be to count as one.
 *
 * In index units, so it scales with the window rather than with the step. It is
 * far larger than the float error of a division (about 1e-16 relative) and far
 * smaller than any gap a caller could mean, so it only ever rescues an edge.
 */
const INDEX_TOLERANCE = 1e-9;

/**
 * A round step near `span / targetCount`, from the 1-2-5 ladder.
 *
 * This is the one place the ladder is applied. The fragment shader receives the
 * result of this function as its grid spacing, so the GPU grid and the numbered
 * ticks agree about where a unit is by construction rather than by coincidence.
 */
export function niceStep(span: number, targetCount: number = TICK_STEP.targetMajorTicks): number {
  if (!Number.isFinite(span) || span <= 0) return SAFE_UNIT_STEP;
  if (!Number.isFinite(targetCount) || targetCount <= 0) return SAFE_UNIT_STEP;

  const target = span / targetCount;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const normalized = target / magnitude;
  const leading =
    normalized < TICK_STEP.snapToTwoBelow ? 1 : normalized < TICK_STEP.snapToFiveBelow ? 2 : 5;
  return leading * magnitude;
}

/**
 * The unnumbered subdivision of a major step.
 *
 * A step of 2×10ⁿ divides into four, not five: fifths would land on
 * 0.4×10ⁿ, and a grid drawn at 0.4 does not help anyone read a grid drawn at 2.
 */
export function minorStepFor(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return SAFE_UNIT_STEP;
  const divisions =
    leadingDigit(step) === 2
      ? TICK_STEP.minorDivisionsForTwo
      : TICK_STEP.minorDivisionsForOneOrFive;
  return step / divisions;
}

/**
 * How many decimal places a step needs to be written exactly.
 *
 * A step of 0.05 needs two, a step of 2 needs none. Passing this to
 * `displayNumber` as the `decimals` bound is what makes a whole-number tick read
 * `2` rather than `2.00`, and what keeps float noise out of a labelled axis.
 */
export function decimalsForStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  return Math.max(0, -Math.floor(Math.log10(step)));
}

/**
 * Every tick of `step` inside `[min, max]`, in increasing order.
 *
 * Returns nothing when the window would need more ticks than `TICK_STEP.maxTicks`
 * — a step far too fine for the window it was asked to cover is a mistake, and
 * drawing half a million grid lines is a worse way to report it than drawing
 * none. Callers derive their step from {@link niceStep}, so in practice the
 * window holds about `targetCount` ticks.
 */
export function ticksInRange(
  min: number,
  max: number,
  step: number,
  options: { readonly decimals?: number } = {},
): readonly Tick[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step) || step <= 0)
    return [];
  if (max < min) return [];

  // The index of an edge is very rarely a whole number in floating point even
  // when it should be: -2 / 0.1 is -19.999999999999996, so a plain ceil would
  // drop the tick that belongs exactly on the edge of the window. The tolerance
  // is in index units, so it rescues an edge and cannot admit a tick that is
  // genuinely inside the window but off the ladder.
  const first = Math.ceil(min / step - INDEX_TOLERANCE);
  const last = Math.floor(max / step + INDEX_TOLERANCE);
  if (last < first) return [];
  if (last - first + 1 > TICK_STEP.maxTicks) return [];

  const decimals = options.decimals;
  const ticks: Tick[] = [];
  for (let index = first; index <= last; index += 1) {
    // index × step, never a running total: this is what keeps the label honest.
    const value = index * step;
    ticks.push({
      value,
      label: displayNumber(value, decimals === undefined ? {} : { decimals }),
    });
  }
  return ticks;
}

/**
 * The whole tick ladder for an axis spanning `[min, max]`.
 *
 * The single entry point a renderer needs: the step it should use, the
 * subdivision of that step, and both sets of ticks already labelled.
 */
export function axisTicks(
  min: number,
  max: number,
  targetCount: number = TICK_STEP.targetMajorTicks,
): AxisTicks {
  const step = niceStep(max - min, targetCount);
  const minorStep = minorStepFor(step);
  return {
    step,
    minorStep,
    major: ticksInRange(min, max, step, { decimals: decimalsForStep(step) }),
    minor: ticksInRange(min, max, minorStep, { decimals: decimalsForStep(minorStep) }),
  };
}

/** The leading digit of a 1-2-5 step: 1, 2 or 5. */
function leadingDigit(step: number): number {
  return Math.round(step / 10 ** Math.floor(Math.log10(step)));
}
