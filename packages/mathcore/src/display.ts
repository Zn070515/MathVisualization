/**
 * Writing numbers the way mathematics is written.
 *
 * A computed `number` has one honest rendering and several dishonest ones. This
 * module produces a *structured* answer rather than a string, so that each
 * surface can typeset it in its own medium without re-deciding anything:
 *
 * - the readout and the legends render `2×10^8` with a real superscript,
 * - a canvas axis label lays the exponent out in smaller type,
 * - a tooltip, an ARIA label and a test compare against the plain text,
 *
 * and every one of them agrees about the digits, because the decision was made
 * once, here.
 *
 * The policy itself — where a value stops being written with its digits and
 * starts being written with its magnitude — is in `NUMBER_DISPLAY`
 * (`conventions.ts`), not in this file, for the reason that file exists.
 *
 * What this module deliberately does not do is *compute*. Rounding is a display
 * concern and never feeds back into arithmetic (GOAL.md section 13: exact and
 * approximate results must stay distinguishable).
 */
import { type Complex, isUndefined } from './complex';
import { NUMBER_DISPLAY } from './conventions';

/** How much of a number to keep. */
export interface DisplayOptions {
  /** Significant digits to keep. Defaults to `NUMBER_DISPLAY.significantDigits`. */
  readonly digits?: number;
  /**
   * An upper bound on decimal places, which wins over `digits`.
   *
   * A bound rather than a fixed width, so that the ticks of a step of 0.5 read
   * `0`, `0.5`, `1`, `1.5` rather than `0.0`, `0.5`, `1.0`, `1.5`: the trailing
   * zero adds nothing. It is what keeps an accumulated `0.30000000000000004`
   * from being shown as such.
   */
  readonly decimals?: number;
}

/**
 * A number, ready to be typeset.
 *
 * `scientific` splits the magnitude from the exponent because that is the whole
 * point of writing a number this way — the exponent is set in smaller type, and
 * a string could not say which characters those are. The other kinds carry their
 * text because that text *is* the number, with no part of it set differently.
 */
export type DisplayNumber =
  | { readonly kind: 'integer'; readonly text: string }
  | { readonly kind: 'decimal'; readonly text: string }
  | { readonly kind: 'scientific'; readonly mantissa: number; readonly exponent: number }
  | { readonly kind: 'undefined' }
  | { readonly kind: 'infinite'; readonly sign: 1 | -1 };

/**
 * A complex number, ready to be typeset.
 *
 * The imaginary magnitude is kept separate from its sign so that a renderer can
 * place the sign, and so that the coefficient of `i` can be dropped when it is
 * one: `2i` and `i`, never `1i`.
 */
export type DisplayComplex =
  | { readonly kind: 'undefined' }
  | { readonly kind: 'real'; readonly re: DisplayNumber }
  | { readonly kind: 'imaginary'; readonly im: DisplayNumber; readonly sign: 1 | -1 }
  | {
      readonly kind: 'rectangular';
      readonly re: DisplayNumber;
      readonly im: DisplayNumber;
      readonly sign: 1 | -1;
    };

/**
 * Describe a real number for display.
 *
 * Total by construction: every `number` has an answer, including the ones that
 * are not numbers. `NaN` is reported as undefined rather than as a string
 * spelling of it, because a reader looking at a readout is owed the fact that
 * the value does not exist.
 */
export function displayNumber(value: number, options: DisplayOptions = {}): DisplayNumber {
  if (Number.isNaN(value)) return { kind: 'undefined' };
  if (value === Infinity) return { kind: 'infinite', sign: 1 };
  if (value === -Infinity) return { kind: 'infinite', sign: -1 };
  // `-0 === 0` is true, so both are written "0". Mathematics has no signed zero.
  if (value === 0) return { kind: 'integer', text: '0' };

  const magnitude = Math.abs(value);
  const digits = options.digits ?? NUMBER_DISPLAY.significantDigits;

  if (magnitude >= NUMBER_DISPLAY.decimalFrom && magnitude < NUMBER_DISPLAY.decimalUntil) {
    // Round, then read the rounded number back, so that trailing zeros
    // disappear and a value which lands on a whole number is reported as one.
    // Rounding 999999.5 to six significant digits gives 1000000, which is an
    // integer however fractional the value it came from was.
    const rounded =
      options.decimals === undefined
        ? Number(value.toPrecision(digits))
        : Number(value.toFixed(options.decimals));
    return Number.isInteger(rounded)
      ? { kind: 'integer', text: String(rounded) }
      : { kind: 'decimal', text: String(rounded) };
  }

  // toExponential(n) keeps n + 1 significant digits.
  const [mantissa, exponent] = value.toExponential(Math.max(0, digits - 1)).split('e');
  return {
    kind: 'scientific',
    mantissa: Number(mantissa),
    exponent: Number(exponent),
  };
}

/**
 * The plain text of a number: the one string form, for tooltips, ARIA labels,
 * canvas fallback and tests.
 *
 * Scientific notation is written `2×10^8`. The caret is deliberate: a real
 * superscript cannot survive inside a string, and `2×108` would not be a number
 * a reader — or a test — could recover.
 */
export function displayNumberToText(number: DisplayNumber): string {
  switch (number.kind) {
    case 'integer':
    case 'decimal':
      return number.text;
    case 'scientific':
      return `${number.mantissa}×10^${number.exponent}`;
    case 'undefined':
      return 'undefined';
    case 'infinite':
      return number.sign < 0 ? '-∞' : '∞';
  }
}

/**
 * Describe a complex number for display.
 *
 * The real and imaginary parts are thresholded against each other so that a
 * component which is only rounding noise is dropped. `(1 + i)^2` is exactly
 * `2i`; evaluated numerically it has a real part near 1e-16, and showing
 * `1.11022e-16 + 2i` would present rounding as if it were structure. The
 * threshold is relative, so a value whose parts are all genuinely tiny still
 * keeps them.
 */
export function displayComplex(value: Complex, options: DisplayOptions = {}): DisplayComplex {
  if (isUndefined(value)) return { kind: 'undefined' };

  const scale = Math.max(Math.abs(value.re), Math.abs(value.im));
  const threshold = scale * NUMBER_DISPLAY.zeroThreshold;
  const re = Math.abs(value.re) < threshold ? 0 : value.re;
  const im = Math.abs(value.im) < threshold ? 0 : value.im;

  if (im === 0) return { kind: 'real', re: displayNumber(re, options) };

  const magnitude = displayNumber(Math.abs(im), options);
  const sign: 1 | -1 = im < 0 ? -1 : 1;
  if (re === 0) return { kind: 'imaginary', im: magnitude, sign };
  return { kind: 'rectangular', re: displayNumber(re, options), im: magnitude, sign };
}

/** The plain text of a complex number: `2i`, `-i`, `3 + 4i`, `4`, `undefined`. */
export function displayComplexToText(value: DisplayComplex): string {
  switch (value.kind) {
    case 'undefined':
      return 'undefined';
    case 'real':
      return displayNumberToText(value.re);
    case 'imaginary':
      return `${value.sign < 0 ? '-' : ''}${imaginaryPart(value.im)}`;
    case 'rectangular':
      return `${displayNumberToText(value.re)}${value.sign < 0 ? ' - ' : ' + '}${imaginaryPart(value.im)}`;
  }
}

/** The imaginary part as written: `2i`, and `i` rather than `1i`. */
function imaginaryPart(magnitude: DisplayNumber): string {
  const text = displayNumberToText(magnitude);
  return text === '1' ? 'i' : `${text}i`;
}
