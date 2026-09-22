/**
 * How a view states a number.
 *
 * A view shows numbers in two places: a readout of the cursor, and a legend that
 * states the range it is drawing over. Both are the same claim — *this* is what
 * the picture spans — and each of the three views had grown its own way of
 * writing it, with three different thresholds and two different digit counts. The
 * same magnitude could be written one way in the field legend and another in the
 * mapped-grid legend, which is exactly the kind of disagreement the conventions
 * file exists to prevent.
 *
 * This is that one way. The decision about how a number is written is in
 * `display.ts` in the core; what lives here is only how much of it a view keeps.
 */
import { displayNumber, displayNumberToText, type DisplayNumber } from '@mathviz/mathcore';

/**
 * Significant digits a stated bound keeps.
 *
 * Four is enough to place a range on a picture — a reader comparing a legend to
 * an axis needs to know the scale, not the last digit of it — and few enough
 * that a legend stays short.
 */
export const VIEW_NUMBER_DIGITS = 4;

/** A number as a view states it: a bound, a range end, or a coordinate. */
export function viewNumber(value: number): DisplayNumber {
  return displayNumber(value, { digits: VIEW_NUMBER_DIGITS });
}

/**
 * Significant digits the parameter value field shows.
 *
 * A double carries about 16 significant decimal digits, and the noise in a
 * computed value lives in the last one or two of them: `0.1 + 0.2` is
 * `0.30000000000000004`. Fifteen digits is just below that, so the noise goes and
 * nothing a reader could have meant does — which matters here more than anywhere
 * else, because this field is where an exact value is *typed*, and what it shows
 * is what gets committed.
 */
export const PARAMETER_INPUT_DIGITS = 15;

/** A parameter's value as the exact-value field writes it. */
export function parameterInputText(value: number): string {
  return displayNumberToText(displayNumber(value, { digits: PARAMETER_INPUT_DIGITS }));
}
