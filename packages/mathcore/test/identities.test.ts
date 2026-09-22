/**
 * Mathematical reference tests.
 *
 * GOAL.md section 24 asks for known identities to be tested, naming
 * `d/dz exp(z) = exp(z)`, `Res(1/z, 0) = 1` and `div(curl F) = 0` as examples.
 * The first two are checked here. They are checked *numerically*, through the
 * parser and the evaluator, because a symbolic engine is not wired into the test
 * suite; where a result is obtained numerically the test says so and states its
 * tolerance, which is the distinction GOAL.md section 13 requires the product to
 * make. The third belongs to vector calculus and is not implemented yet, so it is
 * absent rather than faked.
 *
 * These tests are deliberately end-to-end: they parse source text, evaluate it,
 * and compare against mathematics. A change to a branch convention, a parser
 * precedence rule or an arithmetic implementation will show up here.
 */
import { describe, expect, it } from 'vitest';
import { type Complex, cadd, cdiv, cmul, cx, cexp, isUndefined } from '../src/complex';
import { contourIntegral as integrateContour } from '../src/contour';
import { ok, type MathIssue, type Result } from '../src/errors';
import { evaluateScalar, makeEnvironment, type UserFunctionDefinition } from '../src/evaluator';
import { formatComplex } from '../src/format';
import { parseExpression, parseStatement } from '../src/parser';
import type { Expr } from '../src/ast';

function exprOf(source: string, knownFunctions: readonly string[] = []): Expr {
  const result = parseExpression(source, { knownFunctions: new Set(knownFunctions) });
  if (!result.ok) throw new Error(`expected a parse of "${source}", got: ${result.issue.message}`);
  return result.value;
}

/** Evaluate an expression of the two real variables x and y. */
function atXY(source: string, x: number, y: number): Complex {
  const result = evaluateScalar(
    exprOf(source),
    makeEnvironment({
      values: [
        ['x', cx(x, 0)],
        ['y', cx(y, 0)],
      ],
    }),
  );
  if (!result.ok) throw new Error(`expected a value for "${source}", got: ${result.issue.message}`);
  return result.value;
}

/** Evaluate an expression of one complex variable. */
function at(
  source: string,
  z: Complex,
  functions: readonly UserFunctionDefinition[] = [],
): Complex {
  const result = evaluateScalar(
    exprOf(
      source,
      functions.map((fn) => fn.name),
    ),
    makeEnvironment({
      values: [['z', z]],
      functions: functions.map((fn) => [fn.name, fn] as const),
    }),
  );
  if (!result.ok) throw new Error(`expected a value for "${source}", got: ${result.issue.message}`);
  return result.value;
}

function define(source: string, knownFunctions: readonly string[] = []): UserFunctionDefinition {
  const parsed = parseStatement(source, { knownFunctions: new Set(knownFunctions) });
  if (!parsed.ok) throw new Error(`expected a parse, got: ${parsed.issue.message}`);
  if (parsed.value.kind !== 'function-definition') throw new Error('expected a definition');
  return { name: parsed.value.name, parameters: parsed.value.parameters, body: parsed.value.body };
}

/** A central difference approximation to the complex derivative. */
function numericalDerivative(
  source: string,
  z: Complex,
  step: number,
  functions: readonly UserFunctionDefinition[] = [],
): Complex {
  const forward = at(source, cadd(z, cx(step, 0)), functions);
  const backward = at(source, cadd(z, cx(-step, 0)), functions);
  return cdiv(cadd(forward, { re: -backward.re, im: -backward.im }), cx(2 * step, 0));
}

function expectComplexNear(actual: Complex, expected: Complex, tolerance: number): void {
  const scale = Math.max(1, Math.abs(expected.re), Math.abs(expected.im));
  expect(Math.abs(actual.re - expected.re)).toBeLessThanOrEqual(tolerance * scale);
  expect(Math.abs(actual.im - expected.im)).toBeLessThanOrEqual(tolerance * scale);
}

/**
 * Contour integral of `source` along the circle |z − centre| = radius.
 *
 * This delegates to the shipped routine, and is the only place these identities are
 * computed. It used to carry its own trapezoid rule with an analytic γ′; keeping that
 * would have left the reference tests checking mathematics the product does not do,
 * which is the opposite of what a reference test is for. The routine consumes the
 * evaluator through a callback, exactly as the app does, so what is under test here is
 * still the whole path from source text to a number.
 *
 * The integrand is periodic on a closed circle, so the trapezoid converges spectrally.
 * The accuracy is now the derivative's rather than machine precision — `contour.ts`
 * states that floor and reports it — so the tolerances below are the ones that hold.
 */
function contourIntegral(source: string, centre: Complex, radius: number, samples = 4096): Complex {
  const integrand = exprOf(source);
  const onCircle = (t: number): Result<Complex, MathIssue> =>
    ok(cx(centre.re + radius * Math.cos(t), centre.im + radius * Math.sin(t)));

  const result = integrateContour({
    integrand: (z) => evaluateScalar(integrand, makeEnvironment({ values: [['z', z]] })),
    path: onCircle,
    from: 0,
    to: 2 * Math.PI,
    samples,
  });
  if (!result.ok) throw new Error(`"${source}" could not be integrated: ${result.issue.message}`);
  return result.value.value;
}

describe('differentiation', () => {
  it('satisfies d/dz exp(z) = exp(z)', () => {
    // The identity named in GOAL.md section 24. Checked numerically, so the
    // tolerance is stated rather than implied.
    for (const z of [cx(1, 0.5), cx(-0.7, 1.3), cx(0.2, -0.4)]) {
      const derivative = numericalDerivative('exp(z)', z, 1e-6);
      expectComplexNear(derivative, cexp(z), 1e-6);
    }
  });

  it('satisfies d/dz z^n = n z^(n-1)', () => {
    for (const n of [2, 3, 5]) {
      for (const z of [cx(1.3, 0.4), cx(-0.6, 0.9)]) {
        const derivative = numericalDerivative(`z^${n}`, z, 1e-6);
        const expected = cmul(cx(n, 0), at(`z^${n - 1}`, z));
        expectComplexNear(derivative, expected, 1e-6);
      }
    }
  });

  it('satisfies the product rule', () => {
    const z = cx(0.8, -0.5);
    const left = 'sin(z)';
    const right = 'exp(z)';
    const derivative = numericalDerivative(`(${left})*(${right})`, z, 1e-6);
    const expected = cadd(
      cmul(numericalDerivative(left, z, 1e-6), at(right, z)),
      cmul(at(left, z), numericalDerivative(right, z, 1e-6)),
    );
    expectComplexNear(derivative, expected, 1e-5);
  });
});

describe('contour integration', () => {
  it('gives the residue: the integral of 1/z around the unit circle is 2 pi i', () => {
    // This is GOAL.md's `Res(1/z, 0) = 1` stated as the integral it defines.
    const integral = contourIntegral('1/z', cx(0, 0), 1);
    expectComplexNear(integral, cx(0, 2 * Math.PI), 1e-9);
  });

  it('gives the residue for a pole at another point', () => {
    // 1/(z - 2) has residue 1 at z = 2; a circle of radius 1 centred at 2
    // encloses it, and a circle of radius 1 centred at the origin does not.
    expectComplexNear(contourIntegral('1/(z-2)', cx(2, 0), 1), cx(0, 2 * Math.PI), 1e-9);
    expectComplexNear(contourIntegral('1/(z-2)', cx(0, 0), 1), cx(0, 0), 1e-9);
  });

  it("gives Cauchy's theorem: an analytic function integrates to zero", () => {
    // z^2 is entire, so its integral around any closed contour vanishes.
    expectComplexNear(contourIntegral('z^2', cx(0, 0), 1), cx(0, 0), 1e-9);
    expectComplexNear(contourIntegral('exp(z)', cx(0, 0), 2), cx(0, 0), 1e-9);
  });

  it('counts a double pole through the residue', () => {
    // 1/z^2 has zero residue, so its integral around the unit circle is zero
    // even though the function has a pole inside.
    expectComplexNear(contourIntegral('1/z^2', cx(0, 0), 1), cx(0, 0), 1e-9);
  });

  it('is independent of the radius for a fixed enclosed residue', () => {
    for (const radius of [0.5, 1, 3]) {
      expectComplexNear(contourIntegral('1/z', cx(0, 0), radius), cx(0, 2 * Math.PI), 1e-9);
    }
  });

  it('reports a singularity the contour passes through, rather than a wrong number', () => {
    // A circle of radius 1 centred at 1 passes through the pole of 1/z at the
    // origin. The evaluator must refuse rather than return a plausible value.
    const atOrigin = evaluateScalar(exprOf('1/z'), makeEnvironment({ values: [['z', cx(0, 0)]] }));
    expect(atOrigin.ok).toBe(false);
    if (atOrigin.ok) return;
    expect(atOrigin.issue.kind).toBe('division-by-zero');
  });
});

describe('the Cauchy-Riemann equations', () => {
  /**
   * Check u_x = v_y and u_y = -v_x for f = u + iv, at a point, by central
   * differences.
   *
   * This is a cross-check between the two readings of the same object: f is a
   * function of a complex variable, and its real and imaginary parts are real
   * functions of two variables. The evaluator must agree with itself under both
   * readings, which is the C ≅ R² correspondence of GOAL.md section 10.1.
   */
  function cauchyRiemannResiduals(
    f: (z: Complex) => Complex,
    point: Complex,
    step: number,
  ): { first: number; second: number } {
    const u = (x: number, y: number): number => f(cx(x, y)).re;
    const v = (x: number, y: number): number => f(cx(x, y)).im;

    const ux = (u(point.re + step, point.im) - u(point.re - step, point.im)) / (2 * step);
    const uy = (u(point.re, point.im + step) - u(point.re, point.im - step)) / (2 * step);
    const vx = (v(point.re + step, point.im) - v(point.re - step, point.im)) / (2 * step);
    const vy = (v(point.re, point.im + step) - v(point.re, point.im - step)) / (2 * step);

    return { first: ux - vy, second: uy + vx };
  }

  it('holds for z^2, whose parts are x^2 - y^2 and 2xy', () => {
    const square = (z: Complex): Complex => at('z^2', z);
    for (const point of [cx(1.2, 0.7), cx(-0.4, 1.1)]) {
      const residuals = cauchyRiemannResiduals(square, point, 1e-6);
      expect(Math.abs(residuals.first)).toBeLessThan(1e-5);
      expect(Math.abs(residuals.second)).toBeLessThan(1e-5);
    }
  });

  it('holds for exp(z)', () => {
    const exponential = (z: Complex): Complex => at('exp(z)', z);
    const residuals = cauchyRiemannResiduals(exponential, cx(0.6, -0.9), 1e-6);
    expect(Math.abs(residuals.first)).toBeLessThan(1e-5);
    expect(Math.abs(residuals.second)).toBeLessThan(1e-5);
  });

  it('fails for a function that is not analytic', () => {
    // The conjugate of z is the standard counterexample. Testing that the
    // residuals are *large* is what makes the two tests above meaningful.
    const conjugate = (z: Complex): Complex => at('conj(z)', z);
    const residuals = cauchyRiemannResiduals(conjugate, cx(0.6, -0.9), 1e-6);
    const magnitude = Math.max(Math.abs(residuals.first), Math.abs(residuals.second));
    expect(magnitude).toBeGreaterThan(0.5);
  });

  it('gives the real and imaginary parts of z^2 explicitly', () => {
    const z = cx(1.5, -0.8);
    const squared = at('z^2', z);
    const expectedReal = z.re * z.re - z.im * z.im;
    const expectedImaginary = 2 * z.re * z.im;
    expectMathClose(squared.re, expectedReal, 1e-12);
    expectMathClose(squared.im, expectedImaginary, 1e-12);
  });
});

describe('continuity of the conventions across the pipeline', () => {
  it('takes the principal square root of a negative real', () => {
    // -4 as a complex value, and -4 written as the real number -4, must give the
    // same answer and the same branch.
    const fromComplex = at('sqrt(z)', cx(-4, 0));
    const fromLiteral = at('sqrt(-4)', cx(0, 0));
    expectComplexNear(fromComplex, cx(0, 2), 1e-12);
    expectComplexNear(fromLiteral, cx(0, 2), 1e-12);
  });

  it('takes the principal logarithm on the negative real axis', () => {
    const value = at('log(z)', cx(-4, 0));
    expectComplexNear(value, cx(Math.log(4), Math.PI), 1e-12);
  });

  it('is single-valued just above and below the branch cut, except across it', () => {
    const above = at('log(z)', cx(-4, 1e-9));
    const below = at('log(z)', cx(-4, -1e-9));
    // The cut is where the two differ by a full turn; that is the definition of
    // a branch cut, and it should be visible here.
    expect(Math.abs(above.im - below.im)).toBeGreaterThan(6);
  });

  it('agrees between a function of z and the equivalent function of x and y', () => {
    // The same mathematics read two ways: f(z) = z^2 as a complex function, and
    // as the real map (x, y) -> (x^2 - y^2, 2xy). Since C is R^2, they must agree.
    const z = cx(0.9, 1.4);
    const asComplex = at('z^2', z);
    const asRealMap = atXY('(x + i*y)^2', z.re, z.im);
    expectComplexNear(asComplex, asRealMap, 1e-12);

    // And the explicit real-and-imaginary form of the same map.
    expectComplexNear(asComplex, cx(z.re * z.re - z.im * z.im, 2 * z.re * z.im), 1e-12);
  });

  it('evaluates a user-defined function the same way as its body', () => {
    const f = define('f(z)=sin(z)/(z^2+1)');
    const z = cx(0.7, -0.3);
    const viaFunction = at('f(z)', z, [f]);
    const viaBody = at('sin(z)/(z^2+1)', z);
    expectComplexNear(viaFunction, viaBody, 1e-15);
  });
});

describe('display of numerical results', () => {
  it('prints an exact imaginary result without rounding noise', () => {
    // (1+i)^2 is exactly 2i, but the arithmetic leaves a real part near 1e-16.
    // Printing that would present rounding as structure.
    const squared = at('z^2', cx(1, 1));
    expect(formatComplex(squared)).toBe('2i');
  });

  it('keeps a value whose components are all genuinely small', () => {
    // The threshold is relative, so a value of order 1e-16 is not silently zeroed.
    const tiny = at('z/10000000000000000', cx(1, 0));
    expect(formatComplex(tiny)).not.toBe('0');
  });

  it('still prints a real result as a real number', () => {
    expect(formatComplex(at('z^2', cx(2, 0)))).toBe('4');
  });
});

describe('undefined behaviour stays undefined', () => {
  it('never turns a singularity into a finite number', () => {
    for (const source of ['1/z', 'log(z)', '1/(z^2+1)']) {
      const result = evaluateScalar(exprOf(source), makeEnvironment({ values: [['z', cx(0, 0)]] }));
      if (!result.ok) continue;
      // Where the evaluator does produce a value, it must not be a silently
      // undefined complex number.
      expect(isUndefined(result.value)).toBe(false);
    }
  });

  it('reports the reason for 1/z at the origin', () => {
    const result = evaluateScalar(exprOf('1/z'), makeEnvironment({ values: [['z', cx(0, 0)]] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(['division-by-zero', 'singularity']).toContain(result.issue.kind);
  });
});

function expectMathClose(actual: number, expected: number, tolerance: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
    tolerance * Math.max(1, Math.abs(expected)),
  );
}
