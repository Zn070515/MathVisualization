/**
 * The integral of a function along a contour.
 *
 * `identities.test.ts` checks the answers — `∮ 1/z dz = 2πi`, Cauchy's theorem, the
 * independence of the radius. What is checked here is the part those answers cannot
 * show: that the routine *reports* what it cannot do, and that the two claims it
 * makes about its own accuracy are true.
 *
 * The accuracy claims are the interesting ones, because they are the ones that fail
 * silently. A quadrature that is quietly less accurate than it says is worse than one
 * that says nothing, so there is a test for the derivative's floor that a plain
 * central difference would fail, and a test that the error estimate actually bounds
 * the error on a grid the estimate was not computed from.
 */
import { describe, expect, it } from 'vitest';
import { type Complex, cabs, cadd, csub, cx, cexp } from '../src/complex';
import { contourIntegral, type ContourIntegralResult } from '../src/contour';
import { CONTOUR_INTEGRAL } from '../src/conventions';
import { ok, type MathIssue, type Result } from '../src/errors';

/** A path written as a function of the parameter, which is all the routine wants. */
type Path = (t: number) => Result<Complex, MathIssue>;

const circle =
  (radius: number, centre: Complex = cx(0, 0)): Path =>
  (t) =>
    ok(cx(centre.re + radius * Math.cos(t), centre.im + radius * Math.sin(t)));

/** `e^(it) + 0.3·e^(2it)` — closed, smooth, winds once around the origin, not a circle. */
const roundedTriangle: Path = (t) =>
  ok(cadd(cexp(cx(0, t)), cx(0.3 * Math.cos(2 * t), 0.3 * Math.sin(2 * t))));

const reciprocal: (z: Complex) => Result<Complex, MathIssue> = (z) =>
  z.re === 0 && z.im === 0
    ? { ok: false, issue: { kind: 'division-by-zero', divisor: 'z', message: '"z" is zero here.' } }
    : ok(cx(z.re / (z.re * z.re + z.im * z.im), -z.im / (z.re * z.re + z.im * z.im)));

const ONE: (z: Complex) => Result<Complex, MathIssue> = () => ok(cx(1, 0));

function run(
  path: Path,
  integrand: (z: Complex) => Result<Complex, MathIssue>,
  samples?: number,
): Result<ContourIntegralResult, MathIssue> {
  return contourIntegral({ path, integrand, samples });
}

/** Relative difference, with a floor so that a value near zero is still comparable. */
function relativeError(actual: Complex, expected: Complex): number {
  return cabs(csub(actual, expected)) / Math.max(1, cabs(expected));
}

describe('what the integral is', () => {
  it('is 2 pi i around a closed contour that is not a circle', () => {
    const result = run(roundedTriangle, reciprocal);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Measured at about 4×10⁻¹² absolute. The identity tests assert 10⁻⁹, so this is
    // the same mathematics stated with the margin the method actually has.
    expect(relativeError(result.value.value, cx(0, 2 * Math.PI))).toBeLessThan(1e-10);
  });

  it('accumulates, so the trajectory begins at nothing and ends at the value', () => {
    const result = run(circle(1), reciprocal);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { trajectory, value } = result.value;
    expect(trajectory.length).toBe(result.value.samples + 1);
    expect(trajectory[0]).toEqual(cx(0, 0));
    expect(relativeError(trajectory[trajectory.length - 1] as Complex, value)).toBeLessThan(1e-15);

    // For 1/z the accumulated integral is exactly i·t, so the trajectory runs up the
    // imaginary axis. This is the sharpest statement of the derivative's accuracy in
    // the file: any error in γ′ shows up as a real part that should not be there, and
    // a derivative taken at a step small enough to drown in roundoff leaves about
    // 10⁻¹² of it. The margin here is a factor of ten in both directions.
    for (const point of trajectory) expect(Math.abs(point.re)).toBeLessThan(1e-13);
    for (let index = 1; index < trajectory.length; index += 1) {
      const previous = trajectory[index - 1] as Complex;
      const current = trajectory[index] as Complex;
      expect(current.im).toBeGreaterThanOrEqual(previous.im);
    }
  });
});

describe('what the integral says about itself', () => {
  it('states an error that bounds the error it actually made', () => {
    // The estimate comes from comparing n with 2n, so a run at 8n is a question the
    // estimate was not computed from — and the answer still has to sit inside it, or
    // the number is decoration. Measured: the estimate is about 6×10⁻¹⁰ and the real
    // error about 4×10⁻¹², so the bound holds with a wide margin and no fudge factor.
    const coarse = run(roundedTriangle, reciprocal, 64);
    expect(coarse.ok).toBe(true);
    if (!coarse.ok) return;

    const fine = run(roundedTriangle, reciprocal, 64 * 8);
    expect(fine.ok).toBe(true);
    if (!fine.ok) return;

    const truth = cx(0, 2 * Math.PI);
    expect(cabs(csub(coarse.value.value, truth))).toBeLessThanOrEqual(coarse.value.estimatedError);
    expect(cabs(csub(fine.value.value, truth))).toBeLessThanOrEqual(fine.value.estimatedError);
  });

  it('never claims an error smaller than the derivative allows', () => {
    const result = run(circle(1), reciprocal);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The floor is relative, so it scales with the answer rather than being a fixed
    // number that means nothing for a large integral.
    expect(result.value.estimatedError).toBeGreaterThanOrEqual(
      1e-10 * Math.max(1, cabs(result.value.value)),
    );
  });

  it('does not move when the grid is refined, because the derivative is what limits it', () => {
    // The load-bearing claim of the module. The trapezoid is spectrally accurate on a
    // closed contour, so once the grid resolves the integrand the answer stops
    // improving — what is left is γ′'s error, and refining cannot touch it. Measured:
    // 4.03×10⁻¹² at 64 points and 3.73×10⁻¹² at 4096.
    //
    // This is the test that a degraded rule fails: a quadrature of any fixed order
    // would improve like a power of the step, and a 64-fold refinement would show up
    // as a large difference between these two.
    const coarse = run(roundedTriangle, reciprocal, 64);
    expect(coarse.ok).toBe(true);
    if (!coarse.ok) return;

    const fine = run(roundedTriangle, reciprocal, 4096);
    expect(fine.ok).toBe(true);
    if (!fine.ok) return;

    const truth = cx(0, 2 * Math.PI);
    expect(relativeError(coarse.value.value, truth)).toBeLessThan(1e-10);
    expect(relativeError(fine.value.value, truth)).toBeLessThan(1e-10);
    expect(cabs(csub(fine.value.value, coarse.value.value))).toBeLessThan(1e-11);
  });
});

describe('what the integral refuses to say', () => {
  it('reports a contour that does not come back to where it started', () => {
    const segment: Path = (t) => ok(cx(t, 0));
    const result = contourIntegral({
      path: segment,
      integrand: ONE,
      from: 0,
      to: 2 * Math.PI,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // `∫_γ 1 dz` is γ(b) − γ(a) whatever the path — the fundamental theorem, and a
    // statement the trapezoid cannot get wrong. An open path is not a failure; it is a
    // fact about the contour that the residue theorem depends on.
    expect(result.value.closed).toBe(false);
    expect(result.value.closureGap).toBeCloseTo(2 * Math.PI, 10);
    expect(relativeError(result.value.value, cx(2 * Math.PI, 0))).toBeLessThan(1e-11);
  });

  it('reports a circle as closed', () => {
    const result = run(circle(2), reciprocal);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.closed).toBe(true);
    expect(result.value.closureGap).toBeLessThan(1e-12);
  });

  it('reports a singularity on the contour instead of a number', () => {
    // 1/(z − 1) on the unit circle: the contour passes through the pole at z = 1, at
    // t = 0. The integral is not large there, it does not exist, and the routine has
    // to say so rather than return a plausible number.
    const result = contourIntegral({
      path: circle(1),
      integrand: (z) => {
        const w = csub(z, cx(1, 0));
        if (w.re === 0 && w.im === 0) {
          return {
            ok: false,
            issue: { kind: 'division-by-zero', divisor: 'z-1', message: '"z-1" is zero here.' },
          };
        }
        const scale = w.re * w.re + w.im * w.im;
        return ok(cx(w.re / scale, -w.im / scale));
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.kind).toBe('singularity');
    expect(result.issue.message).toContain('t = 0');
  });

  it('refuses an interval that is not an interval', () => {
    const result = contourIntegral({ path: circle(1), integrand: ONE, from: 1, to: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.kind).toBe('unsupported');
  });
});

describe('the convention it is built on', () => {
  it('integrates a circle once in the positive direction by default', () => {
    // γ(t) = r·e^(it) over the default interval is one counter-clockwise lap, which is
    // what fixes the sign of the answer. Written the other way round the sign flips,
    // and that is the whole of what orientation means.
    expect(CONTOUR_INTEGRAL.from).toBe(0);
    expect(CONTOUR_INTEGRAL.to).toBeCloseTo(2 * Math.PI, 15);

    const defaulted = contourIntegral({ path: circle(1), integrand: reciprocal });
    expect(defaulted.ok).toBe(true);
    if (!defaulted.ok) return;

    const reversed = contourIntegral({
      path: (t) => ok(cexp(cx(0, -t))),
      integrand: reciprocal,
      from: 0,
      to: 2 * Math.PI,
    });
    expect(reversed.ok).toBe(true);
    if (!reversed.ok) return;

    expect(relativeError(defaulted.value.value, cx(0, 2 * Math.PI))).toBeLessThan(1e-10);
    expect(relativeError(reversed.value.value, cx(0, -2 * Math.PI))).toBeLessThan(1e-10);
  });
});
