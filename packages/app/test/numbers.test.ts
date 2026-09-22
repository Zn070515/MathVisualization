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
import { PARAMETER_INPUT_DIGITS, parameterInputText, viewNumber } from '../src/display/numbers';

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
