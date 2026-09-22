/**
 * Exact rational arithmetic for numeric literals.
 *
 * Numeric literals in a source expression are stored exactly rather than as
 * binary floating point. This matters for two reasons:
 *
 * 1. Mathematical correctness. `1/3` in an expression must not silently become
 *    a binary approximation before the symbolic layer ever sees it. Keeping the
 *    literal exact means the symbolic adapter can receive `Rational(1, 3)` and
 *    the numerical evaluator can decide for itself when to approximate.
 * 2. Convention transparency. The project distinguishes exact from approximate
 *    results (see GOAL.md section 13), which is only possible if the exact
 *    representation survives parsing.
 *
 * Every decimal literal is exactly a rational: `0.1` is `1/10`, `1.25e-3` is
 * `1/800`. Conversion is therefore lossless and no rounding is introduced at
 * the lexing stage.
 *
 * Only literals are exact. Arithmetic performed by the numerical evaluator is
 * ordinary double precision, because that is what the numerical layer is for.
 */

export interface Rational {
  /** Numerator. Carries the sign. */
  readonly n: bigint;
  /** Denominator. Always strictly positive. */
  readonly d: bigint;
}

/** Largest decimal exponent accepted in a literal. Beyond this the literal is rejected. */
export const MAX_LITERAL_EXPONENT = 308;

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/** Build a normalized rational. Throws on a zero denominator. */
export function rational(n: bigint, d: bigint = 1n): Rational {
  if (d === 0n) throw new RangeError('rational(): zero denominator');
  let nn = n;
  let dd = d;
  if (dd < 0n) {
    nn = -nn;
    dd = -dd;
  }
  const g = gcd(nn, dd);
  return g > 1n ? { n: nn / g, d: dd / g } : { n: nn, d: dd };
}

export function rationalFromInteger(n: bigint): Rational {
  return { n, d: 1n };
}

export const RATIONAL_ZERO: Rational = { n: 0n, d: 1n };
export const RATIONAL_ONE: Rational = { n: 1n, d: 1n };

/** Matches a plain decimal literal, optionally with a fraction part and exponent. */
const DECIMAL_LITERAL = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/**
 * Parse the textual form of a decimal literal into an exact rational.
 *
 * Returns `null` when the text is not a literal or the exponent is out of range;
 * the caller turns that into a source-located parse error.
 */
export function rationalFromLiteralText(raw: string): Rational | null {
  const match = DECIMAL_LITERAL.exec(raw);
  if (match === null) return null;

  const integerPart = match[1] ?? '0';
  const fractionPart = match[2] ?? '';
  const exponentPart = Number(match[3] ?? '0');
  if (!Number.isFinite(exponentPart) || Math.abs(exponentPart) > MAX_LITERAL_EXPONENT) {
    return null;
  }

  let n = BigInt(integerPart + fractionPart);
  let d = 10n ** BigInt(fractionPart.length);

  if (exponentPart > 0) {
    n *= 10n ** BigInt(exponentPart);
  } else if (exponentPart < 0) {
    d *= 10n ** BigInt(-exponentPart);
  }

  return rational(n, d);
}

/**
 * Lossy conversion to double precision.
 *
 * Callers must cap literal exponents (see {@link rationalFromLiteralText}) for
 * this to stay finite. That cap is enforced at parse time, so any rational that
 * reaches the evaluator is representable.
 */
export function rationalToNumber(r: Rational): number {
  const num = Number(r.n);
  const den = Number(r.d);
  if (Number.isFinite(num) && Number.isFinite(den)) return num / den;
  // Components individually exceed double range. Fall back to a scaled
  // conversion so the result saturates instead of producing NaN.
  const sign = r.n < 0n ? -1 : 1;
  const absN = r.n < 0n ? -r.n : r.n;
  const digits = absN.toString().length - r.d.toString().length;
  if (digits > 400) return sign * Infinity;
  if (digits < -400) return sign * 0;
  return sign * (Number(absN) / Number(r.d));
}

export function rationalIsInteger(r: Rational): boolean {
  return r.d === 1n;
}

export function rationalIsZero(r: Rational): boolean {
  return r.n === 0n;
}

export function rationalNegate(r: Rational): Rational {
  return { n: -r.n, d: r.d };
}

export function rationalAdd(a: Rational, b: Rational): Rational {
  return rational(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function rationalSub(a: Rational, b: Rational): Rational {
  return rational(a.n * b.d - b.n * a.d, a.d * b.d);
}

export function rationalMul(a: Rational, b: Rational): Rational {
  return rational(a.n * b.n, a.d * b.d);
}

export function rationalDiv(a: Rational, b: Rational): Rational {
  return rational(a.n * b.d, a.d * b.n);
}

/** Exact integer power. Undefined (throws) for zero base with negative exponent. */
export function rationalPowInt(base: Rational, exponent: number): Rational {
  if (!Number.isInteger(exponent)) {
    throw new RangeError('rationalPowInt(): exponent must be an integer');
  }
  if (exponent === 0) return RATIONAL_ONE;
  const magnitude = Math.abs(exponent);
  const n = base.n ** BigInt(magnitude);
  const d = base.d ** BigInt(magnitude);
  return exponent > 0 ? rational(n, d) : rational(d, n);
}

/** `"n/d"` for non-integers, `"n"` for integers. Exact, never lossy. */
export function rationalToFractionString(r: Rational): string {
  return r.d === 1n ? r.n.toString() : `${r.n}/${r.d}`;
}
