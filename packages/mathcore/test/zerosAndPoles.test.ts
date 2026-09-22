/**
 * Where a complex function vanishes, and where it blows up.
 *
 * The claim worth testing is not "the numbers came out about right" but "the counts
 * are *exact*". The argument principle returns an integer, so a test can assert it
 * is exactly 2 and mean it — which is a different kind of assertion from the ones in
 * `pointsOfInterest.test.ts`, where a real root is only ever located numerically and
 * the module is careful never to claim more.
 *
 * The case that would be easy to get wrong is the removable singularity.
 * `sin(z)/z` has no value at the origin *as written*, and the origin is a local
 * maximum of `|f|` — so it is a candidate. Three turns of the argument around it
 * come to zero, so nothing is reported, which is correct: the singularity is
 * removable and there is neither a zero nor a pole there.
 */
import { describe, expect, it } from 'vitest';
import { type Complex, cx } from '../src/complex';
import { type MathIssue, type Result } from '../src/errors';
import { evaluateScalar } from '../src/evaluator';
import { parseExpression } from '../src/parser';
import { findZerosAndPoles, windingNumber, type Singularity } from '../src/zerosAndPoles';

/** A function of the complex variable z, as the analysis sees it. */
function functionOf(source: string): (z: Complex) => Result<Complex, MathIssue> {
  const parsed = parseExpression(source, { knownFunctions: new Set() });
  if (!parsed.ok) throw new Error(`could not parse "${source}": ${parsed.issue.message}`);
  const body = parsed.value;

  return (z) => evaluateScalar(body, { values: new Map([['z', z]]), functions: new Map() });
}

/** A square region, which is what the view would hand over. */
const REGION = { xMin: -2, xMax: 2, yMin: -2, yMax: 2 };

const find = (source: string, region = REGION): readonly Singularity[] =>
  findZerosAndPoles(functionOf(source), region);

const zerosOf = (points: readonly Singularity[]): Singularity[] =>
  points.filter((point) => point.kind === 'zero');

const polesOf = (points: readonly Singularity[]): Singularity[] =>
  points.filter((point) => point.kind === 'pole');

describe('the argument principle', () => {
  it('counts the zeros inside a contour', () => {
    // z² - 1 has its zeros at ±1, so a circle of radius 2 about the origin has both.
    expect(windingNumber(functionOf('z^2 - 1'), cx(0, 0), 2).count).toBe(2);
  });

  it('counts them separately when the contour separates them', () => {
    // The count is what is inside *this* curve, which is the whole point of it being
    // a contour integral.
    expect(windingNumber(functionOf('z^2 - 1'), cx(1, 0), 0.5).count).toBe(1);
    expect(windingNumber(functionOf('z^2 - 1'), cx(-1, 0), 0.5).count).toBe(1);
    expect(windingNumber(functionOf('z^2 - 1'), cx(-1, 0), 0.5).count).toBe(1);
  });

  it('counts a pole as one less, not as nothing', () => {
    // The principle counts zeros *minus* poles, so a pole contributes negatively and
    // a zero and a pole inside the same contour cancel.
    expect(windingNumber(functionOf('1/z'), cx(0, 0), 1).count).toBe(-1);
    expect(windingNumber(functionOf('1/(z - 1)^2'), cx(1, 0), 0.5).count).toBe(-2);
    // z/(z - 1) has one of each inside a circle of radius 2 about the origin.
    expect(windingNumber(functionOf('z/(z - 1)'), cx(0, 0), 2).count).toBe(0);
  });

  it('counts nothing for a function with neither', () => {
    expect(windingNumber(functionOf('exp(z)'), cx(0, 0), 2).count).toBe(0);
  });

  it('refuses to answer when the contour runs through the singularity', () => {
    // A circle of radius 1 about the origin passes exactly through the poles of
    // 1/(z² − 1). There is no value there to take the argument of, so there is
    // nothing to count, and the answer is that there is no answer rather than a
    // number that happens to be nearby.
    const through = windingNumber(functionOf('1/(z^2 - 1)'), cx(0, 0), 1);
    expect(through.count).toBeNull();
  });

  it('refuses to answer for a contour it cannot sample', () => {
    expect(windingNumber(functionOf('z'), cx(0, 0), 0).count).toBeNull();
    expect(windingNumber(functionOf('z'), cx(0, 0), -1).count).toBeNull();
  });
});

describe('finding them', () => {
  it('finds the zeros of a polynomial', () => {
    const found = zerosOf(find('z^2 - 1'));
    expect(found).toHaveLength(2);
    expect(found[0]?.order).toBe(1);
    expect(found[1]?.order).toBe(1);
    // Located to within the refinement, not to the sample grid: the search walks
    // downhill after the grid has pointed at the neighbourhood.
    expect(found[0]?.z.re).toBeCloseTo(-1, 3);
    expect(found[1]?.z.re).toBeCloseTo(1, 3);
    expect(found[0]?.z.im).toBeCloseTo(0, 3);
    expect(found[1]?.z.im).toBeCloseTo(0, 3);
  });

  it('reports the order of a repeated zero, because the winding number knows it', () => {
    // This is what the argument principle buys. A search for "where is |f| small"
    // cannot tell a double zero from a single one; a contour can, exactly.
    const found = zerosOf(find('(z - 1)^2'));
    expect(found).toHaveLength(1);
    expect(found[0]?.order).toBe(2);
  });

  it('finds poles, and their orders', () => {
    const simple = polesOf(find('1/z'));
    expect(simple).toHaveLength(1);
    expect(simple[0]?.order).toBe(1);
    expect(simple[0]?.z.re).toBeCloseTo(0, 3);
    expect(simple[0]?.z.im).toBeCloseTo(0, 3);

    const double = polesOf(find('1/(z - 1)^2'));
    expect(double).toHaveLength(1);
    expect(double[0]?.order).toBe(2);
    expect(double[0]?.z.re).toBeCloseTo(1, 3);
  });

  it('separates zeros from poles in the same function', () => {
    // z/(z² + 1): a zero at the origin, poles at ±i.
    const found = find('z/(z^2 + 1)');
    const zeros = zerosOf(found);
    const poles = polesOf(found);
    expect(zeros).toHaveLength(1);
    expect(zeros[0]?.z.re).toBeCloseTo(0, 3);
    expect(zeros[0]?.z.im).toBeCloseTo(0, 3);
    expect(poles).toHaveLength(2);
    for (const pole of poles) {
      expect(pole.z.re).toBeCloseTo(0, 3);
      expect(Math.abs(pole.z.im)).toBeCloseTo(1, 3);
    }
  });

  it('finds the poles of a function that has poles instead of zeros', () => {
    // tan(z) has poles at ±π/2 and a zero at the origin, and none of them is a place
    // where anything is small.
    const found = find('tan(z)');
    const poles = polesOf(found)
      .map((pole) => pole.z.re)
      .sort((a, b) => a - b);
    expect(poles).toHaveLength(2);
    expect(poles[0]).toBeCloseTo(-Math.PI / 2, 2);
    expect(poles[1]).toBeCloseTo(Math.PI / 2, 2);
    for (const pole of polesOf(found)) expect(pole.order).toBe(1);
    expect(zerosOf(found)).toHaveLength(1);
    expect(zerosOf(found)[0]?.z.re).toBeCloseTo(0, 3);
  });
});

describe('what it refuses to report', () => {
  it('does not report a removable singularity as either', () => {
    // sin(z)/z has no value at 0 as written, so 0 is a candidate and a local maximum
    // of |f|. The turns come to zero: the singularity is removable, and calling it a
    // pole would be wrong, and calling it a zero would be wrong twice.
    const found = find('sin(z)/z', { xMin: -1, xMax: 1, yMin: -1, yMax: 1 });
    const nearOrigin = found.filter((point) => Math.hypot(point.z.re, point.z.im) < 0.5);
    expect(nearOrigin).toHaveLength(0);
  });

  it('reports nothing for a function that has nothing to report', () => {
    expect(find('exp(z)')).toHaveLength(0);
    expect(find('z + 1 + i')).toHaveLength(1); // a zero, and only that
  });

  it('reports only what is in the region it was given', () => {
    // tan has a zero at every multiple of π. A candidate near the edge of [-2, 2]
    // walks downhill and lands on ±π, both of which are *outside* — and a search
    // asked about a region must not report what is not in it.
    const found = zerosOf(find('tan(z)')).map((zero) => zero.z.re);
    expect(found).toHaveLength(1);
    expect(found[0]).toBeCloseTo(0, 3);

    // Widening the window brings them in.
    const wider = zerosOf(find('tan(z)', { xMin: -4, xMax: 4, yMin: -2, yMax: 2 }));
    expect(wider).toHaveLength(3);
    expect(wider.map((zero) => zero.z.re).sort((a, b) => a - b)[0]).toBeCloseTo(-Math.PI, 2);
  });

  it('has nothing to say about a region that is not a region', () => {
    expect(findZerosAndPoles(functionOf('z'), { ...REGION, xMax: -3 })).toHaveLength(0);
    expect(findZerosAndPoles(functionOf('z'), { ...REGION, xMin: NaN })).toHaveLength(0);
  });

  it('reports what a coarse search can resolve, and says so by its order', () => {
    // Two zeros a hundredth of a unit apart, in a region four units across. The
    // search cannot separate them, so it finds one point of order two. That is the
    // truth about the cell it looked at, and it is reported rather than hidden.
    const found = find('(z - 0.01)*(z + 0.01)', { xMin: -1, xMax: 1, yMin: -1, yMax: 1 });
    const zeros = zerosOf(found);
    expect(zeros).toHaveLength(1);
    expect(zeros[0]?.order).toBe(2);
  });
});
