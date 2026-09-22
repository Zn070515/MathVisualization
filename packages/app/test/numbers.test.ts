/**
 * How a view states a number.
 *
 * This is the audit for the change, and it is written as one on purpose. Three
 * views each had their own way of writing a bound or a range end, and the three
 * disagreed — so "the tests still pass" could not have shown that the numbers on
 * screen did not move, because nothing tested those numbers at all.
 *
 * So the three formatters this replaced are kept here, verbatim, as the
 * reference. Every value below is written out under all three of them and under
 * the one that replaces them, and the differences are stated rather than
 * discovered in a legend.
 */
import { describe, expect, it } from 'vitest';
import { displayNumberToText } from '@mathviz/mathcore';
import {
  PARAMETER_INPUT_DIGITS,
  parameterInputText,
  parseNumberText,
  roundForScale,
  viewNumber,
} from '../src/display/numbers';

/** The field view's `formatRange`, and the plot view's `formatBound`: identical. */
function legacyFieldOrPlot(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  if (Math.abs(value) >= 1000 || Math.abs(value) < 0.01) return value.toExponential(2);
  return value.toFixed(2);
}

/** The mapped grid's inner `format`, from `formatBounds`. */
function legacyMappedGrid(value: number): string {
  return Math.abs(value) >= 100 || (Math.abs(value) < 0.01 && value !== 0)
    ? value.toExponential(1)
    : value.toFixed(2);
}

const written = (value: number): string => displayNumberToText(viewNumber(value));

describe('the policy the three views now share', () => {
  it('writes a bound with the digits it has, and no more', () => {
    expect(written(0)).toBe('0');
    expect(written(1)).toBe('1');
    expect(written(1.5)).toBe('1.5');
    expect(written(-12.34)).toBe('-12.34');
    expect(written(0.005)).toBe('0.005');
  });

  it('states a magnitude rather than spelling it out', () => {
    expect(written(200000000)).toBe('2×10^8');
    expect(written(1e-16)).toBe('1×10^-16');
  });

  it('never lets a non-number reach a legend as text', () => {
    // The mapped grid's version printed `NaN` and `Infinity` — literal JavaScript
    // words, inside a sentence about a range of values.
    expect(legacyMappedGrid(NaN)).toBe('NaN');
    expect(legacyMappedGrid(Infinity)).toBe('Infinity');
    expect(written(NaN)).toBe('undefined');
    expect(written(Infinity)).toBe('∞');
  });
});

describe('what the three views disagreed about', () => {
  it('wrote zero two ways', () => {
    expect(legacyFieldOrPlot(0)).toBe('0');
    expect(legacyMappedGrid(0)).toBe('0.00');
    expect(written(0)).toBe('0');
  });

  it('switched to exponential form at different magnitudes', () => {
    // A bound of 500 is written the same way by both; 1500 and 500.5 are not.
    expect(legacyFieldOrPlot(500)).toBe('500.00');
    expect(legacyMappedGrid(500)).toBe('5.0e+2');
    expect(written(500)).toBe('500');

    expect(legacyFieldOrPlot(1500)).toBe('1.50e+3');
    expect(legacyMappedGrid(1500)).toBe('1.5e+3');
    expect(written(1500)).toBe('1500');
  });

  it('kept different numbers of digits', () => {
    expect(legacyFieldOrPlot(1.23456)).toBe('1.23');
    expect(legacyMappedGrid(1.23456)).toBe('1.23');
    // ... but one digit once it went exponential, and the two views disagreed
    // about how many to keep there as well.
    expect(legacyMappedGrid(1.23456e6)).toBe('1.2e+6');
    expect(legacyFieldOrPlot(1.23456e6)).toBe('1.23e+6');
    expect(written(1.23456e6)).toBe('1.235×10^6');
  });

  it('forced trailing zeros onto whole numbers', () => {
    expect(legacyFieldOrPlot(2)).toBe('2.00');
    expect(written(2)).toBe('2');
  });
});

describe('a located point, as a label writes it', () => {
  // Spans taken from the two pictures this is used on: the cartesian graph of
  // `exp(-t²)` on a wide canvas, where the axes carry different spans.
  const SPAN_X = 4.8;
  const SPAN_Y = 1.95;

  it('writes a found extremum as the number it is', () => {
    // The refinement lands a hair under one. Rounding the height by the *horizontal*
    // span — one span for both coordinates — turns this into 0.9984, which is not
    // this function's maximum and is visibly not one.
    const located = 0.9999999999999999;
    expect(roundForScale(located, SPAN_Y)).toBe(1);
    expect(written(roundForScale(located, SPAN_Y))).toBe('1');
  });

  it('writes a found zero as zero', () => {
    expect(roundForScale(-1.06e-16, SPAN_X)).toBe(0);
  });

  it('leaves a round number round', () => {
    // A grid of multiples of `span/1000` is anchored at the origin and does not have
    // `2` on it, so a crossing found at exactly 2 would come out as `2.002`.
    const onAGrid = Math.round(2.0000001 / (SPAN_X / 1000)) * (SPAN_X / 1000);
    expect(onAGrid).toBeCloseTo(2.0016, 10);
    expect(roundForScale(2.0000001, SPAN_X)).toBe(2);
  });

  it('keeps more of the number as the picture zooms in', () => {
    // Rounding to the visible scale rather than to a fixed number of places is the
    // whole point: zooming in is asking for the digits.
    expect(roundForScale(0.1234567, SPAN_X)).toBe(0.123);
    expect(roundForScale(0.1234567, 0.001)).toBe(0.123457);
  });

  it('rounds to whole numbers when the span is large', () => {
    expect(roundForScale(1234567.8, 1e6)).toBe(1234568);
    expect(roundForScale(500.4, 1e7)).toBe(500);
  });

  it('passes a value it cannot round straight through', () => {
    expect(roundForScale(Infinity, SPAN_X)).toBe(Infinity);
    expect(Number.isNaN(roundForScale(NaN, SPAN_X))).toBe(true);
  });
});

describe('the exact-value field of a parameter', () => {
  it('does not show the noise in the last place of a double', () => {
    // `String(0.1 + 0.2)` is `0.30000000000000004`, which is the shortest decimal
    // that round-trips — it is not a formatting mistake, the double really is
    // that. Showing it to someone dragging a slider is still wrong.
    expect(String(0.1 + 0.2)).toBe('0.30000000000000004');
    expect(parameterInputText(0.1 + 0.2)).toBe('0.3');
  });

  it('keeps nearly all of the precision, because this field is where an exact value is typed', () => {
    // Fifteen digits is one below what a double carries, so the noise goes and
    // nothing a reader could have meant does.
    expect(PARAMETER_INPUT_DIGITS).toBe(15);
    expect(parameterInputText(1 / 3)).toBe('0.333333333333333');
    expect(parameterInputText(2)).toBe('2');
    expect(parameterInputText(-4)).toBe('-4');
  });

  it('is what the reset control states, so a tooltip is not the only unformatted number', () => {
    expect(parameterInputText(0.1 + 0.2)).toBe('0.3');
  });
});

describe('reading a number back', () => {
  it('accepts the notation it writes', () => {
    // The half that was missing for a while. The field *displays* `2×10^8`, and
    // `Number("2×10^8")` is `NaN` — so the box rejected the very number it was
    // showing, and an edit to it was silently discarded.
    expect(parseNumberText('2×10^8')).toBe(2e8);
    expect(parseNumberText('2.34×10^-5')).toBeCloseTo(2.34e-5, 18);
    expect(parseNumberText('-1.5×10^3')).toBe(-1500);
  });

  it('accepts the notation people type', () => {
    expect(parseNumberText('2*10^8')).toBe(2e8);
    expect(parseNumberText('2x10^8')).toBe(2e8);
    expect(parseNumberText('2e8')).toBe(2e8);
    expect(parseNumberText('2E8')).toBe(2e8);
    expect(parseNumberText(' 2e-8 ')).toBe(2e-8);
  });

  it('accepts a mathematical minus sign, which Number does not understand', () => {
    // U+2212, which is what a mathematical keyboard produces.
    expect(parseNumberText('−3.5')).toBe(-3.5);
    expect(parseNumberText('−2×10^3')).toBe(-2000);
  });

  it('refuses what is not a number', () => {
    expect(parseNumberText('')).toBeNull();
    expect(parseNumberText('   ')).toBeNull();
    expect(parseNumberText('two')).toBeNull();
    expect(parseNumberText('2×10^')).toBeNull();
    expect(parseNumberText('NaN')).toBeNull();
    expect(parseNumberText('Infinity')).toBeNull();
  });

  it('refuses a value it cannot represent', () => {
    // Ten to a large enough power overflows to Infinity, and a parameter that is
    // Infinity is not a value anybody asked for.
    expect(parseNumberText('2×10^400')).toBeNull();
  });

  it('round-trips every value the field writes', () => {
    // The property that makes these two functions a pair rather than two
    // functions. Anything the field can display, the field can read back.
    const values = [
      0,
      1,
      2,
      -4,
      0.3,
      0.1 + 0.2,
      1 / 3,
      2.5,
      -12.34,
      1e-16,
      2e8,
      1.5e-12,
      -3.25e7,
      123456,
    ];
    for (const value of values) {
      const read = parseNumberText(parameterInputText(value));
      expect(read).not.toBeNull();
      // Relative, with an absolute floor so that zero is comparable at all.
      expect(Math.abs((read ?? NaN) - value)).toBeLessThanOrEqual(
        Math.abs(value) * 1e-14 + Number.MIN_VALUE,
      );
    }
  });
});
