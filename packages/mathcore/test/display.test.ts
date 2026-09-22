/**
 * How a number is written.
 *
 * Two things are being pinned here, and they are different kinds of claim.
 *
 * The first is a *regression net*: the strings the readout and the tests already
 * depend on must keep coming out the same. `0.9273`, `2i`, `4`, `undefined` and
 * `∞` are what the interface has been showing, and a change to how numbers are
 * written must not quietly move them.
 *
 * The second is the *fix*. The previous formatter wrote `2e8` as
 * `2.00000e+8` and `0.0000234` as `2.34000e-5`, which is a computer's way of
 * writing a number and not a reader's. The `CHANGED` table below states what the
 * old policy produced, so that every deliberate difference is visible in one
 * place rather than discovered by a user.
 */
import { describe, expect, it } from 'vitest';
import { cx } from '../src/complex';
import { NUMBER_DISPLAY } from '../src/conventions';
import {
  displayComplex,
  displayComplexToText,
  displayNumber,
  displayNumberToText,
  type DisplayNumber,
} from '../src/display';
import { formatComplex, formatReal } from '../src/format';

/** Values written the same way before and after the display layer existed. */
const UNCHANGED: readonly (readonly [number, string])[] = [
  [0, '0'],
  [1, '1'],
  [4, '4'],
  [5, '5'],
  [15, '15'],
  [-12.34, '-12.34'],
  [0.5, '0.5'],
  [0.1, '0.1'],
  // The rounding is a display concern, and it was already not leaking noise.
  [0.1 + 0.2, '0.3'],
  [999999, '999999'],
  [1e-4, '0.0001'],
];

/**
 * Values this change deliberately writes differently.
 *
 * The old strings are in the comment beside each: they are the reason the
 * display layer exists.
 */
const CHANGED: readonly (readonly [number, string, string])[] = [
  [1e6, '1×10^6', '1000000'],
  [1e7, '1×10^7', '1.00000e+7'],
  [2e8, '2×10^8', '2.00000e+8'],
  [1e15, '1×10^15', '1.00000e+15'],
  [1e-5, '1×10^-5', '1.00000e-5'],
  [0.0000234, '2.34×10^-5', '2.34000e-5'],
  [1e-16, '1×10^-16', '1.00000e-16'],
];

/** Read a structured number back as a number, to check nothing was lost. */
function valueOf(number: DisplayNumber): number {
  switch (number.kind) {
    case 'integer':
    case 'decimal':
      return Number(number.text);
    case 'scientific':
      return number.mantissa * 10 ** number.exponent;
    case 'undefined':
      return NaN;
    case 'infinite':
      return number.sign < 0 ? -Infinity : Infinity;
  }
}

describe('writing a real number', () => {
  it.each(UNCHANGED)('writes %s as %s', (value, text) => {
    expect(displayNumberToText(displayNumber(value))).toBe(text);
  });

  it.each(CHANGED)('writes %s as %s, not %s', (value, text) => {
    expect(displayNumberToText(displayNumber(value))).toBe(text);
  });

  it('states a magnitude rather than spelling it out', () => {
    // The headline case: digits stop helping well before they stop being writable.
    expect(displayNumber(200000000)).toEqual({ kind: 'scientific', mantissa: 2, exponent: 8 });
    expect(displayNumber(0.0000234)).toEqual({
      kind: 'scientific',
      mantissa: 2.34,
      exponent: -5,
    });
  });

  it('keeps the sign of a negative magnitude', () => {
    expect(displayNumberToText(displayNumber(-2e8))).toBe('-2×10^8');
    expect(displayNumberToText(displayNumber(-0.5))).toBe('-0.5');
  });

  it('treats negative zero as zero, because mathematics has no signed zero', () => {
    expect(displayNumberToText(displayNumber(-0))).toBe('0');
  });

  it('is total: every number has an answer, including the ones that are not numbers', () => {
    expect(displayNumber(NaN)).toEqual({ kind: 'undefined' });
    expect(displayNumber(Infinity)).toEqual({ kind: 'infinite', sign: 1 });
    expect(displayNumber(-Infinity)).toEqual({ kind: 'infinite', sign: -1 });
    expect(displayNumberToText(displayNumber(NaN))).toBe('undefined');
    expect(displayNumberToText(displayNumber(Infinity))).toBe('∞');
    expect(displayNumberToText(displayNumber(-Infinity))).toBe('-∞');
  });

  it('never writes a value in exponential notation outside the scientific kind', () => {
    // A `2e8` escaping to a reader is the failure this whole module prevents, so
    // the guard is asserted rather than assumed.
    for (const [value] of [...UNCHANGED, ...CHANGED]) {
      const written = displayNumber(value);
      if (written.kind === 'integer' || written.kind === 'decimal') {
        expect(written.text).not.toMatch(/[eE]/);
      }
    }
  });

  it('says where the switch to scientific notation happens', () => {
    // The boundary belongs to the convention, not to this test.
    expect(NUMBER_DISPLAY.decimalFrom).toBe(1e-4);
    expect(NUMBER_DISPLAY.decimalUntil).toBe(1e6);
    expect(displayNumber(1e-4).kind).toBe('decimal');
    expect(displayNumber(0.99999e-4).kind).toBe('scientific');
    expect(displayNumber(999999).kind).toBe('integer');
    expect(displayNumber(1e6).kind).toBe('scientific');
  });

  it('keeps the value recoverable from what it wrote', () => {
    // Compared with a relative-or-absolute tolerance rather than a ratio,
    // because one of the cases is zero and every ratio of zero is either zero
    // or NaN.
    for (const [value] of [...UNCHANGED, ...CHANGED]) {
      const recovered = valueOf(displayNumber(value));
      expect(Math.abs(recovered - value)).toBeLessThanOrEqual(Math.abs(value) * 1e-5 + 1e-12);
    }
  });
});

describe('significant digits', () => {
  it('keeps six by default, without trailing zeros', () => {
    expect(displayNumberToText(displayNumber(1.5))).toBe('1.5');
    expect(displayNumberToText(displayNumber(0.9272952180016122))).toBe('0.927295');
  });

  it('honours an explicit count, which is what the readout asks for', () => {
    // The value behind the readout's `arg` cell. Five digits, and no trailing
    // zero from the rounding, so a reader sees 0.9273.
    expect(displayNumberToText(displayNumber(0.9272952180016122, { digits: 5 }))).toBe('0.9273');
    expect(displayNumberToText(displayNumber(0.9272952180016122, { digits: 3 }))).toBe('0.927');
  });
});

describe('a bound on decimal places', () => {
  it('keeps an accumulated float from being shown as such', () => {
    expect(displayNumberToText(displayNumber(0.30000000000000004, { decimals: 1 }))).toBe('0.3');
  });

  it('is a bound and not a width, so a whole number stays whole', () => {
    expect(displayNumberToText(displayNumber(1, { decimals: 2 }))).toBe('1');
    expect(displayNumberToText(displayNumber(2, { decimals: 2 }))).toBe('2');
  });

  it('reports a value that rounds onto a whole number as one', () => {
    // 999999.5 to six significant digits is 1000000, which has no fractional
    // part however fractional the value it came from was.
    expect(displayNumber(999999.5)).toEqual({ kind: 'integer', text: '1000000' });
  });
});

describe('writing a complex number', () => {
  const text = (re: number, im: number, options?: { digits?: number }): string =>
    displayComplexToText(displayComplex(cx(re, im), options));

  it('writes a real value as a real number', () => {
    expect(text(2, 0)).toBe('2');
    expect(text(-12.34, 0)).toBe('-12.34');
  });

  it('writes a purely imaginary value without a zero real part', () => {
    expect(text(0, 2)).toBe('2i');
    expect(text(0, -1.5)).toBe('-1.5i');
  });

  it('drops the coefficient of i when it is one', () => {
    expect(text(0, 1)).toBe('i');
    expect(text(0, -1)).toBe('-i');
    expect(text(3, 1)).toBe('3 + i');
  });

  it('writes a rectangular value as mathematics is written', () => {
    expect(text(3, 4)).toBe('3 + 4i');
    expect(text(1, -1)).toBe('1 - i');
  });

  it('drops a component that is only rounding noise', () => {
    // (1 + i)^2 is exactly 2i; computed in doubles it has a real part near 1e-16,
    // and showing that would present rounding as if it were structure.
    expect(text(1.1102230246251565e-16, 2)).toBe('2i');
    expect(text(1.1102230246251565e-16, 2)).not.toContain('e');
  });

  it('keeps components that are genuinely small, because the threshold is relative', () => {
    // An absolute threshold would erase both parts and report a perfectly good
    // value as zero. The threshold is a fraction of the larger component, so a
    // value whose parts are all tiny keeps them.
    const written = displayComplex(cx(3e-20, 4e-20));
    expect(written.kind).toBe('rectangular');
    expect(displayComplexToText(written)).toBe('3×10^-20 + 4×10^-20i');
  });

  it('reports a value that does not exist as undefined, not as a number', () => {
    expect(displayComplexToText(displayComplex(cx(NaN, NaN)))).toBe('undefined');
    expect(displayComplexToText(displayComplex(cx(1, NaN)))).toBe('undefined');
  });

  it('exposes the parts structurally, so a renderer can set the exponent differently', () => {
    // A real part of 1.2e-5 against an imaginary part of 3.4e6: both are stated
    // as magnitudes, and a string would not say which characters are the
    // exponents. The imaginary part is large enough relative to the real one to
    // survive the noise threshold, which is what makes this a rectangular value.
    const written = displayComplex(cx(1.2e-5, 3.4e6));
    expect(written.kind).toBe('rectangular');
    if (written.kind !== 'rectangular') return;
    expect(written.re.kind).toBe('scientific');
    expect(written.im.kind).toBe('scientific');
    expect(displayComplexToText(written)).toBe('1.2×10^-5 + 3.4×10^6i');
  });

  it('drops a part that is noise at the scale of the other, however scientific it looks', () => {
    // 3e-5 against 2e8 is 1.5e-13 relative — below double precision's grip on
    // the larger value, so it is rounding and not structure.
    const written = displayComplex(cx(2e8, 3e-5));
    expect(written.kind).toBe('real');
    expect(displayComplexToText(written)).toBe('2×10^8');
  });
});

describe('the printers are projections of the structure', () => {
  it('agrees with formatReal for every case above', () => {
    for (const [value] of [...UNCHANGED, ...CHANGED]) {
      expect(formatReal(value)).toBe(displayNumberToText(displayNumber(value)));
    }
  });

  it('agrees with formatComplex, and keeps the options it was given', () => {
    const values = [cx(2, 0), cx(0, 2), cx(1, 1), cx(1, -1), cx(0, 0), cx(NaN, NaN)];
    for (const value of values) {
      expect(formatComplex(value)).toBe(displayComplexToText(displayComplex(value)));
      expect(formatComplex(value, { digits: 3 })).toBe(
        displayComplexToText(displayComplex(value, { digits: 3 })),
      );
    }
  });
});
