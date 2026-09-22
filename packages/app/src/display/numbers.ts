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

/**
 * A located value rounded to the place the picture can support.
 *
 * A point the analysis *found* is not a point it *solved for*. The refinement that
 * locates the zero of `z²` puts it at `-1.06×10⁻¹⁶`, and the maximum of `exp(-t²)`
 * lands a hair under one; both are artefacts of the search, not facts about the
 * function, and writing them out claims a precision the method does not have.
 *
 * The place is read off the span, so zooming in keeps showing the digits that
 * zooming in was for. It is a number of decimal *places* and not a grid of multiples
 * of `span/1000`, because a grid anchored at the origin has none of the round numbers
 * on it: a crossing the analysis found at exactly `2` would come out of a grid as
 * `2.002`.
 */
export function roundForScale(value: number, span: number): number {
  if (!Number.isFinite(value)) return value;
  const places = Math.min(
    MAX_DECIMAL_PLACES,
    Math.max(0, Math.ceil(Math.log10(SPAN_SUBDIVISIONS / Math.max(span, 1e-12)))),
  );
  const rounded = Number(value.toFixed(places));
  // Rounding a negative number to zero leaves the sign behind, and a coordinate of
  // `-0` is the coordinate `0`: the sign is an artefact of the arithmetic.
  return rounded === 0 ? 0 : rounded;
}

/**
 * How finely a located value is stated: to about a thousandth of the span it is drawn
 * on. A thousandth of a picture is below what a reader can point at, so the digits kept
 * are the ones the picture can actually tell apart, and no more.
 */
const SPAN_SUBDIVISIONS = 1000;

/** Beyond this the places are past what a double carries, and `toFixed` stops being useful. */
const MAX_DECIMAL_PLACES = 15;

/**
 * Read a number back the way it may have been written.
 *
 * The other half of `parameterInputText`, and the half that was missing for a
 * while: a field that *displays* `2×10^8` has to accept `2×10^8`, or the interface
 * shows a number it cannot read back — which is a worse property than showing an
 * ugly number. Every value the field writes must survive a round trip through it.
 *
 * Accepts three notations, because all three turn up in the same box: the one this
 * project writes (`2×10^8`), the ones people type (`2*10^8`, `2e8`, a Unicode minus
 * sign from a mathematical keyboard), and plain decimal.
 */
export function parseNumberText(text: string): number | null {
  // U+2212 MINUS SIGN — what a mathematical keyboard produces, and what `Number`
  // does not understand.
  const normalised = text.trim().replace(/−/g, '-');
  if (normalised === '') return null;

  const scientific = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*[×x*·]\s*10\s*\^\s*([+-]?\d+)$/.exec(
    normalised,
  );
  if (scientific !== null) {
    const mantissa = Number(scientific[1]);
    const exponent = Number(scientific[2]);
    if (!Number.isFinite(mantissa) || !Number.isFinite(exponent)) return null;
    // A mantissa times ten to a large enough power overflows to Infinity, and a
    // parameter that is Infinity is not a value anyone asked for.
    const value = mantissa * 10 ** exponent;
    return Number.isFinite(value) ? value : null;
  }

  const plain = Number(normalised);
  return Number.isFinite(plain) ? plain : null;
}
