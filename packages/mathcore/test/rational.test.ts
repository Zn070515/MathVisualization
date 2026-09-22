import { describe, expect, it } from 'vitest';
import {
  type Rational,
  rational,
  rationalFromInteger,
  rationalFromLiteralText,
  rationalToFractionString,
  rationalToNumber,
  rationalAdd,
  rationalDiv,
  rationalIsInteger,
  rationalMul,
  rationalPowInt,
  rationalSub,
} from '../src/rational';

describe('rational construction', () => {
  it('normalises sign onto the numerator', () => {
    expect(rational(1n, -2n)).toEqual({ n: -1n, d: 2n });
  });

  it('reduces to lowest terms', () => {
    expect(rational(2n, 4n)).toEqual({ n: 1n, d: 2n });
    expect(rational(-6n, 9n)).toEqual({ n: -2n, d: 3n });
  });

  it('keeps a zero numerator with denominator one', () => {
    expect(rational(0n, 5n)).toEqual({ n: 0n, d: 1n });
  });

  it('rejects a zero denominator', () => {
    expect(() => rational(1n, 0n)).toThrow(RangeError);
  });
});

describe('decimal literals are exact', () => {
  it('parses a decimal fraction without rounding', () => {
    // 0.1 is not representable in binary, which is exactly why the literal is
    // kept as a rational rather than converted at the lexing stage.
    expect(rationalFromLiteralText('0.1')).toEqual({ n: 1n, d: 10n });
    expect(rationalFromLiteralText('1.25')).toEqual({ n: 5n, d: 4n });
  });

  it('parses a negative exponent', () => {
    expect(rationalFromLiteralText('1e-3')).toEqual({ n: 1n, d: 1000n });
    expect(rationalFromLiteralText('2.5E-2')).toEqual({ n: 1n, d: 40n });
  });

  it('parses a positive exponent', () => {
    expect(rationalFromLiteralText('2e3')).toEqual({ n: 2000n, d: 1n });
  });

  it('parses a bare integer', () => {
    expect(rationalFromLiteralText('42')).toEqual({ n: 42n, d: 1n });
  });

  it('rejects text that is not a literal', () => {
    expect(rationalFromLiteralText('2e')).toBeNull();
    expect(rationalFromLiteralText('z')).toBeNull();
    expect(rationalFromLiteralText('1.2.3')).toBeNull();
  });

  it('rejects an exponent beyond the representable range', () => {
    expect(rationalFromLiteralText('1e999')).toBeNull();
  });
});

describe('rational arithmetic', () => {
  it('adds exactly', () => {
    expect(rationalAdd(rational(1n, 3n), rational(1n, 6n))).toEqual({ n: 1n, d: 2n });
  });

  it('subtracts exactly', () => {
    expect(rationalSub(rational(1n, 2n), rational(1n, 3n))).toEqual({ n: 1n, d: 6n });
  });

  it('multiplies exactly', () => {
    expect(rationalMul(rational(2n, 3n), rational(3n, 4n))).toEqual({ n: 1n, d: 2n });
  });

  it('divides exactly', () => {
    expect(rationalDiv(rational(1n, 2n), rational(1n, 4n))).toEqual({ n: 2n, d: 1n });
  });

  it('raises to an integer power exactly, including negative powers', () => {
    expect(rationalPowInt(rational(2n, 3n), 3)).toEqual({ n: 8n, d: 27n });
    expect(rationalPowInt(rational(2n, 3n), -2)).toEqual({ n: 9n, d: 4n });
    expect(rationalPowInt(rational(5n, 7n), 0)).toEqual({ n: 1n, d: 1n });
  });

  it('refuses a non-integer exponent', () => {
    expect(() => rationalPowInt(rational(2n), 0.5)).toThrow(RangeError);
  });
});

describe('conversion out of the exact domain', () => {
  it('converts to a double', () => {
    expect(rationalToNumber(rational(1n, 4n))).toBe(0.25);
    expect(rationalToNumber(rational(-3n, 2n))).toBe(-1.5);
  });

  it('saturates rather than producing NaN for an enormous denominator', () => {
    const huge: Rational = { n: 1n, d: 10n ** 500n };
    expect(rationalToNumber(huge)).toBe(0);
  });

  it('saturates to infinity for an enormous numerator', () => {
    const huge: Rational = { n: 10n ** 500n, d: 1n };
    expect(rationalToNumber(huge)).toBe(Infinity);
  });

  it('reports integrality and prints fractions readably', () => {
    expect(rationalIsInteger(rationalFromInteger(4n))).toBe(true);
    expect(rationalIsInteger(rational(1n, 2n))).toBe(false);
    expect(rationalToFractionString(rational(1n, 2n))).toBe('1/2');
    expect(rationalToFractionString(rationalFromInteger(7n))).toBe('7');
  });
});
