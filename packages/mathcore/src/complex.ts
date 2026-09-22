/**
 * Complex arithmetic with explicit branch conventions.
 *
 * This module is the single numerical definition of the elementary complex
 * functions for the whole project. The WebGL shader prelude in `glsl.ts` must
 * reproduce these definitions exactly; `conventions.ts` records the contract
 * and the test suite checks the two implementations against each other on the
 * CPU side.
 *
 * Written from scratch rather than taken from a third-party complex library so
 * that branch behaviour is ours to define, document and test. No runtime
 * dependency is introduced.
 *
 * Branch conventions (see `conventions.ts` for the authoritative registry):
 *
 * - `principalArg` returns a value in `(-pi, pi]`. The negative real axis is
 *   treated as the *upper* edge of the branch cut, so `principalArg(-4) = pi`.
 * - `clog` is the principal logarithm, `Log z = ln|z| + i Arg z`, with its
 *   branch cut along the negative real axis.
 * - `csqrt` is the principal square root; `csqrt(-4) = 2i`, never `-2i`.
 * - `cpow(z, w)` is `exp(w Log z)` on the principal branch, except for integer
 *   exponents where exact repeated multiplication is used instead. Because
 *   `0` is an integer, `cpow(0, 0) = 1`.
 *
 * Undefined results are represented as `{ re: NaN, im: NaN }` rather than by
 * throwing. The evaluator checks the conditions that produce them (dividing by
 * zero, taking the logarithm of zero, ...) *before* calling in here, so that it
 * can report a mathematically meaningful reason instead of a generic failure.
 * Direct users of this module get NaN and are expected to test for it.
 */
import type { Rational } from './rational';
import { rationalToNumber } from './rational';

export interface Complex {
  readonly re: number;
  readonly im: number;
}

export const CX_ZERO: Complex = { re: 0, im: 0 };
export const CX_ONE: Complex = { re: 1, im: 0 };
export const CX_I: Complex = { re: 0, im: 1 };
export const CX_UNDEFINED: Complex = { re: NaN, im: NaN };

/** Construct a complex value. */
export function cx(re: number, im = 0): Complex {
  return { re, im };
}

export function cxFromRational(r: Rational): Complex {
  return { re: rationalToNumber(r), im: 0 };
}

/** True when the imaginary part is exactly zero (no tolerance). */
export function isReal(z: Complex): boolean {
  return z.im === 0;
}

export function isFiniteComplex(z: Complex): boolean {
  return Number.isFinite(z.re) && Number.isFinite(z.im);
}

export function isUndefined(z: Complex): boolean {
  return Number.isNaN(z.re) || Number.isNaN(z.im);
}

export function isZero(z: Complex): boolean {
  return z.re === 0 && z.im === 0;
}

export function cadd(a: Complex, b: Complex): Complex {
  return { re: a.re + b.re, im: a.im + b.im };
}

export function csub(a: Complex, b: Complex): Complex {
  return { re: a.re - b.re, im: a.im - b.im };
}

export function cneg(a: Complex): Complex {
  return { re: -a.re, im: -a.im };
}

export function cmul(a: Complex, b: Complex): Complex {
  // Real operands are common in practice; the shortcuts also keep realness exact.
  if (a.im === 0) return { re: a.re * b.re, im: a.re * b.im };
  if (b.im === 0) return { re: a.re * b.re, im: a.im * b.re };
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

/** Multiply by a real scalar. */
export function cscale(a: Complex, k: number): Complex {
  return { re: a.re * k, im: a.im * k };
}

/**
 * Complex division.
 *
 * A zero divisor yields NaN. The evaluator is responsible for detecting that
 * case first and reporting it as a singularity.
 */
export function cdiv(a: Complex, b: Complex): Complex {
  if (b.im === 0) {
    if (b.re === 0) return CX_UNDEFINED;
    return { re: a.re / b.re, im: a.im / b.re };
  }
  const denom = b.re * b.re + b.im * b.im;
  if (denom === 0) return CX_UNDEFINED;
  return { re: (a.re * b.re + a.im * b.im) / denom, im: (a.im * b.re - a.re * b.im) / denom };
}

export function cconj(a: Complex): Complex {
  return { re: a.re, im: -a.im };
}

/** Modulus `|z|`. Exact for real inputs. */
export function cabs(a: Complex): number {
  return Math.hypot(a.re, a.im);
}

/**
 * Principal argument, in `(-pi, pi]`.
 *
 * The negative real axis maps to `+pi`, matching the branch-cut convention of
 * {@link clog}. `atan2` would return `-pi` for a negative zero imaginary part,
 * so that single case is remapped.
 */
export function principalArg(a: Complex): number {
  const theta = Math.atan2(a.im, a.re);
  return theta === -Math.PI ? Math.PI : theta;
}

/** Alias of {@link principalArg}, for readability at call sites. */
export const carg = principalArg;

export function cexp(a: Complex): Complex {
  if (a.im === 0) return { re: Math.exp(a.re), im: 0 };
  const magnitude = Math.exp(a.re);
  return { re: magnitude * Math.cos(a.im), im: magnitude * Math.sin(a.im) };
}

/**
 * Principal logarithm `Log z = ln|z| + i Arg z`.
 *
 * `z = 0` yields `-Infinity + 0i`; the evaluator reports the singularity.
 */
export function clog(a: Complex): Complex {
  if (a.im === 0 && a.re > 0) return { re: Math.log(a.re), im: 0 };
  return { re: Math.log(cabs(a)), im: principalArg(a) };
}

/**
 * Principal square root.
 *
 * Uses the numerically stable half-angle form rather than `exp(Log z / 2)`,
 * which loses precision for arguments near the negative real axis. The sign of
 * the imaginary part follows the branch cut convention: `-4` maps to `2i`.
 */
export function csqrt(a: Complex): Complex {
  if (a.im === 0) {
    if (a.re >= 0) return { re: Math.sqrt(a.re), im: 0 };
    return { re: 0, im: Math.sqrt(-a.re) };
  }
  const magnitude = cabs(a);
  const re = Math.sqrt((magnitude + a.re) / 2);
  const imMagnitude = Math.sqrt(Math.max(0, (magnitude - a.re) / 2));
  return { re, im: a.im < 0 ? -imMagnitude : imMagnitude };
}

/** Exact repeated multiplication for integer exponents. */
function integerPower(base: Complex, exponent: number): Complex {
  if (exponent === 0) return CX_ONE;
  const negative = exponent < 0;
  let remaining = Math.abs(exponent);
  let result = CX_ONE;
  let factor = base;
  while (remaining > 0) {
    if (remaining & 1) result = cmul(result, factor);
    remaining >>>= 1;
    if (remaining > 0) factor = cmul(factor, factor);
  }
  return negative ? cdiv(CX_ONE, result) : result;
}

/** Largest integer exponent handled by the exact path. */
const MAX_EXACT_EXPONENT = 1024;

/**
 * Complex power `z^w` on the principal branch.
 *
 * Integer exponents take the exact path so that identities such as
 * `z^2 = z * z` hold bit for bit and `0^0 = 1` by the same convention as the
 * integer path.
 */
export function cpow(z: Complex, w: Complex): Complex {
  if (w.im === 0 && Number.isInteger(w.re) && Math.abs(w.re) <= MAX_EXACT_EXPONENT) {
    return integerPower(z, w.re);
  }
  if (isZero(z)) {
    // 0^w for non-integer w: 0 when Re w > 0, undefined otherwise.
    return w.re > 0 ? CX_ZERO : CX_UNDEFINED;
  }
  return cexp(cmul(w, clog(z)));
}

export function csin(a: Complex): Complex {
  if (a.im === 0) return { re: Math.sin(a.re), im: 0 };
  return { re: Math.sin(a.re) * Math.cosh(a.im), im: Math.cos(a.re) * Math.sinh(a.im) };
}

export function ccos(a: Complex): Complex {
  if (a.im === 0) return { re: Math.cos(a.re), im: 0 };
  return { re: Math.cos(a.re) * Math.cosh(a.im), im: -Math.sin(a.re) * Math.sinh(a.im) };
}

export function ctan(a: Complex): Complex {
  if (a.im === 0) return { re: Math.tan(a.re), im: 0 };
  const cos = ccos(a);
  if (cos.re === 0 && cos.im === 0) return CX_UNDEFINED;
  return cdiv(csin(a), cos);
}

export function csinh(a: Complex): Complex {
  if (a.im === 0) return { re: Math.sinh(a.re), im: 0 };
  return { re: Math.sinh(a.re) * Math.cos(a.im), im: Math.cosh(a.re) * Math.sin(a.im) };
}

export function ccosh(a: Complex): Complex {
  if (a.im === 0) return { re: Math.cosh(a.re), im: 0 };
  return { re: Math.cosh(a.re) * Math.cos(a.im), im: Math.sinh(a.re) * Math.sin(a.im) };
}

export function ctanh(a: Complex): Complex {
  if (a.im === 0) return { re: Math.tanh(a.re), im: 0 };
  const cosh = ccosh(a);
  if (cosh.re === 0 && cosh.im === 0) return CX_UNDEFINED;
  return cdiv(csinh(a), cosh);
}

/** Real part as a complex value, for uniform downstream handling. */
export function cre(a: Complex): Complex {
  return { re: a.re, im: 0 };
}

export function cim(a: Complex): Complex {
  return { re: a.im, im: 0 };
}

/** `|z|` as a complex value. */
export function cmodulus(a: Complex): Complex {
  return { re: cabs(a), im: 0 };
}
