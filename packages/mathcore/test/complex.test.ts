/**
 * Complex arithmetic and the branch conventions.
 *
 * The branch tests are the important ones: they pin down choices that are
 * ambiguous in mathematics and that a different library would have made
 * differently. If one of these starts failing, a convention has changed and both
 * the shader prelude and the documentation must change with it.
 */
import { describe, expect, it } from 'vitest';
import {
  cabs,
  cadd,
  cconj,
  ccos,
  cdiv,
  cexp,
  cim,
  clog,
  cmul,
  cneg,
  cpow,
  cre,
  csin,
  csqrt,
  csub,
  cx,
  isReal,
  isUndefined,
  principalArg,
} from '../src/complex';
import { expectCloseTo, expectComplexCloseTo } from './helpers';

describe('arithmetic', () => {
  it('adds and subtracts', () => {
    expectComplexCloseTo(cadd(cx(1, 2), cx(3, -4)), cx(4, -2));
    expectComplexCloseTo(csub(cx(1, 2), cx(3, -4)), cx(-2, 6));
  });

  it('multiplies', () => {
    // (1 + 2i)(3 + 4i) = 3 + 4i + 6i + 8i^2 = -5 + 10i
    expectComplexCloseTo(cmul(cx(1, 2), cx(3, 4)), cx(-5, 10));
  });

  it('divides', () => {
    // (1 + 2i)/(3 + 4i) = (11 + 2i)/25
    expectComplexCloseTo(cdiv(cx(1, 2), cx(3, 4)), cx(11 / 25, 2 / 25));
  });

  it('negates and conjugates', () => {
    expectComplexCloseTo(cneg(cx(1, -2)), cx(-1, 2));
    expectComplexCloseTo(cconj(cx(1, -2)), cx(1, 2));
  });

  it('returns NaN rather than throwing for a zero divisor', () => {
    // The evaluator checks for this first and reports a singularity; the raw
    // arithmetic is documented to produce NaN so that the check is the only
    // place the decision is made.
    expect(isUndefined(cdiv(cx(1, 1), cx(0, 0)))).toBe(true);
  });
});

describe('realness is preserved exactly', () => {
  it('keeps a real input real through the elementary functions', () => {
    // Exactness here is what stops a real function from drifting into looking
    // complex in the readout.
    for (const fn of [csin, ccos, cexp, clog, csqrt]) {
      expect(isReal(fn(cx(1.5)))).toBe(true);
    }
    expect(isReal(cmul(cx(3), cx(4)))).toBe(true);
    expect(isReal(cdiv(cx(3), cx(4)))).toBe(true);
    expect(isReal(cpow(cx(3), cx(4)))).toBe(true);
  });

  it('computes the modulus of a real exactly', () => {
    expect(cabs(cx(-7))).toBe(7);
  });
});

describe('branch conventions', () => {
  it('places the principal argument in (-pi, pi]', () => {
    expectCloseTo(principalArg(cx(1, 0)), 0);
    expectCloseTo(principalArg(cx(0, 1)), Math.PI / 2);
    expectCloseTo(principalArg(cx(0, -1)), -Math.PI / 2);
  });

  it('puts the negative real axis on the upper edge of the cut', () => {
    // Not -pi. This is the choice that keeps the range half-open.
    expectCloseTo(principalArg(cx(-1, 0)), Math.PI);
    expectCloseTo(principalArg(cx(-4, 0)), Math.PI);
    expectCloseTo(principalArg(cx(-4, -0)), Math.PI);
  });

  it('takes the principal logarithm with a cut on the negative real axis', () => {
    expectComplexCloseTo(clog(cx(Math.E)), cx(1, 0));
    expectComplexCloseTo(clog(cx(-4)), cx(Math.log(4), Math.PI));
    expectComplexCloseTo(clog(cx(0, 1)), cx(0, Math.PI / 2));
  });

  it('returns the principal square root, never the negative one', () => {
    expectComplexCloseTo(csqrt(cx(-4)), cx(0, 2));
    expectComplexCloseTo(csqrt(cx(4)), cx(2, 0));
    expectComplexCloseTo(csqrt(cx(0, -4)), cx(Math.SQRT2, -Math.SQRT2));
  });

  it('defines 0^0 as 1 through the integer-power path', () => {
    expectComplexCloseTo(cpow(cx(0), cx(0)), cx(1, 0));
  });

  it('defines 0 to a positive power as 0 and other non-integer powers as undefined', () => {
    expectComplexCloseTo(cpow(cx(0), cx(2)), cx(0, 0));
    expectComplexCloseTo(cpow(cx(0), cx(0.5)), cx(0, 0));
    expect(isUndefined(cpow(cx(0), cx(0, 1)))).toBe(true);
  });

  it('uses exact repeated multiplication for integer exponents', () => {
    // Identical operations, so the results are bit for bit equal rather than
    // merely close.
    expect(cpow(cx(1.1, 0.3), cx(3))).toEqual(cmul(cmul(cx(1.1, 0.3), cx(1.1, 0.3)), cx(1.1, 0.3)));
  });
});

describe('mathematical identities', () => {
  const samples = [cx(0.3, 0.7), cx(-1.2, 0.4), cx(2, -3), cx(-0.5, -0.9)];

  it("satisfies Euler's formula", () => {
    for (const z of samples) {
      expectComplexCloseTo(cexp(cx(0, z.re)), cadd(ccos(cx(z.re)), cmul(cx(0, 1), csin(cx(z.re)))));
    }
  });

  it('gives exp(i*pi) = -1', () => {
    expectComplexCloseTo(cexp(cx(0, Math.PI)), cx(-1, 0));
  });

  it('satisfies sin^2 + cos^2 = 1', () => {
    for (const z of samples) {
      const sum = cadd(cmul(csin(z), csin(z)), cmul(ccos(z), ccos(z)));
      expectComplexCloseTo(sum, cx(1, 0));
    }
  });

  it('satisfies exp(z + w) = exp(z) exp(w)', () => {
    const z = samples[0] as ReturnType<typeof cx>;
    const w = samples[1] as ReturnType<typeof cx>;
    expectComplexCloseTo(cexp(cadd(z, w)), cmul(cexp(z), cexp(w)));
  });

  it('satisfies |z|^2 = z * conj(z)', () => {
    for (const z of samples) {
      const modulusSquared = cabs(z) ** 2;
      expectCloseTo(modulusSquared, cre(cmul(z, cconj(z))).re);
    }
  });

  it('inverts the logarithm within the principal strip', () => {
    for (const z of samples) {
      expectComplexCloseTo(cexp(clog(z)), z);
    }
  });

  it('squares the square root back to the original', () => {
    for (const z of samples) {
      expectComplexCloseTo(cmul(csqrt(z), csqrt(z)), z);
    }
  });

  it('separates a complex number into its real and imaginary parts', () => {
    for (const z of samples) {
      expectComplexCloseTo(cadd(cre(z), cmul(cx(0, 1), cim(z))), z);
    }
  });
});
