/**
 * The points worth naming on a curve.
 *
 * These run through the real parser and evaluator rather than a stub, because the
 * properties that matter are properties of the product: whether a curve really
 * crosses where it is said to, and — the case this module exists for — whether a
 * place the function blows up is *not* reported as a crossing.
 *
 * What is deliberately *not* tested here is where the zeros of a function are. That
 * is a different question, and the case below says so out loud: `t²` has a double
 * zero at the origin and this module reports a turn, not a crossing.
 */
import { describe, expect, it } from 'vitest';
import { type Complex, cx } from '../src/complex';
import { findPointsOfInterest, type PointOfInterest } from '../src/pointsOfInterest';
import { type MathIssue, type Result } from '../src/errors';
import { evaluateScalar } from '../src/evaluator';
import { parseExpression } from '../src/parser';

/** A curve of one real variable, as the analysis sees it. */
function curveOf(source: string): (t: number) => Result<Complex, MathIssue> {
  const parsed = parseExpression(source, { knownFunctions: new Set() });
  if (!parsed.ok) throw new Error(`could not parse "${source}": ${parsed.issue.message}`);
  const body = parsed.value;

  return (t) => {
    const values = new Map<string, Complex>([['t', cx(t, 0)]]);
    return evaluateScalar(body, { values, functions: new Map() });
  };
}

const crossings = (points: readonly PointOfInterest[]): number[] =>
  points.filter((point) => point.kind === 'crossing').map((point) => point.t);

const turns = (points: readonly PointOfInterest[]): { t: number; kind: string; touches: boolean }[] =>
  points
    .filter((point) => point.kind !== 'crossing')
    // `filter` narrows the union, so `touchesAxis` is known to exist here.
    .map((point) => ({ t: point.t, kind: point.kind, touches: point.touchesAxis }));

const analyse = (source: string, tMin: number, tMax: number): readonly PointOfInterest[] =>
  findPointsOfInterest(curveOf(source), { tMin, tMax });

describe('crossings', () => {
  it('finds where a curve crosses the axis', () => {
    // sin over two full turns: five crossings, at -2π, -π, 0, π and 2π.
    const found = crossings(analyse('sin(t)', -2 * Math.PI, 2 * Math.PI));
    expect(found).toHaveLength(5);
    for (const [index, expected] of [-2, -1, 0, 1, 2].entries()) {
      expect(found[index]).toBeCloseTo(expected * Math.PI, 6);
    }
  });

  it('finds crossings that are not evenly spaced', () => {
    // t³ - 3t crosses at -√3, 0 and √3.
    const found = crossings(analyse('t^3 - 3*t', -3, 3));
    expect(found).toHaveLength(3);
    expect(found[0]).toBeCloseTo(-Math.sqrt(3), 5);
    expect(found[1]).toBeCloseTo(0, 6);
    expect(found[2]).toBeCloseTo(Math.sqrt(3), 5);
  });

  it('reports the value it found, so a caller can check the claim', () => {
    for (const point of analyse('sin(t)', -4, 4)) {
      if (point.kind !== 'crossing') continue;
      expect(Math.abs(point.value)).toBeLessThan(1e-9);
    }
  });
});

describe('a place the function blows up', () => {
  it('is not reported as a crossing, though every sampler sees a sign change', () => {
    // The case this module exists for. `1/t` goes from very negative to very
    // positive across zero and has no root there. Bisection at a crossing drives
    // |f| towards zero at both ends; at a pole it drives them towards infinity
    // while the sign still flips, and that is the whole discriminator.
    const found = crossings(analyse('1/t', -1, 1));
    expect(found).toHaveLength(0);
  });

  it('is not reported as a crossing for a curve with several poles', () => {
    // tan(t) crosses the axis at 0 and has a pole at ±π/2. Only the crossing is
    // a crossing.
    const found = crossings(analyse('tan(t)', -2, 2));
    expect(found).toHaveLength(1);
    expect(found[0]).toBeCloseTo(0, 6);
  });

  it('does not report a crossing from one side of a gap to the other', () => {
    // Undefined on the whole of (-1, 1) and finite outside it, with opposite
    // signs: there is a sign change across the window and no curve joining it.
    const found = crossings(analyse('1/(t^2 - 1)', -3, 3));
    for (const t of found) {
      expect(Math.abs(t)).toBeGreaterThan(1);
    }
  });
});

describe('turning points', () => {
  it('finds the minimum of a parabola', () => {
    const found = turns(analyse('t^2', -2, 2));
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('minimum');
    expect(found[0]?.t).toBeCloseTo(0, 6);
  });

  it('finds both kinds, in order', () => {
    const found = turns(analyse('t^3 - 3*t', -3, 3));
    expect(found.map((point) => point.kind)).toEqual(['maximum', 'minimum']);
    expect(found[0]?.t).toBeCloseTo(-1, 5);
    expect(found[1]?.t).toBeCloseTo(1, 5);
  });

  it('finds a corner, where the slope changes sign without passing through zero', () => {
    // |t| has no derivative at 0 and a minimum there all the same.
    const found = turns(analyse('abs(t)', -2, 2));
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('minimum');
    expect(found[0]?.t).toBeCloseTo(0, 6);
  });

  it('does not invent a turning point on a straight line', () => {
    expect(turns(analyse('3*t + 1', -2, 2))).toHaveLength(0);
  });
});

describe('a turn that sits on the axis', () => {
  it('is reported as a minimum that touches it, not as a root', () => {
    // t² really does touch the axis at the origin, and that is worth saying. It is
    // a different claim from a crossing, and the two are different variants so a
    // caller cannot confuse them.
    const found = analyse('t^2', -2, 2);
    expect(crossings(found)).toHaveLength(0);
    const turning = turns(found)[0];
    expect(turning?.kind).toBe('minimum');
    expect(turning?.touches).toBe(true);
  });

  it('does not pretend to be root analysis', () => {
    // The boundary, asserted rather than remembered. `t²` has a double zero at the
    // origin; this module reports the *turn* and deliberately no crossing, because
    // a crossing is a claim about a sign change and there is none here. Reading the
    // double root off `min (0, 0)` is the mathematician's job. Finding zeros and
    // their multiplicities is a different question, for a module that does not exist
    // yet: it needs exact factoring where the symbolic engine can manage it, and an
    // order estimate from the derivatives where it cannot.
    const found = analyse('t^2', -2, 2);
    expect(found.some((point) => point.kind === 'crossing')).toBe(false);
    expect(found.some((point) => point.kind === 'minimum')).toBe(true);
  });

  it('is not claimed for a turn that only comes close', () => {
    // The case Desmos gets wrong and documents itself as getting wrong: this curve
    // has its minimum at height 0.0001 and never reaches the axis. Reporting a root
    // here would be showing a picture that says something false.
    const found = analyse('(t - 2)^2 + 0.0001', 0, 4);
    expect(crossings(found)).toHaveLength(0);
    const turning = turns(found)[0];
    expect(turning?.kind).toBe('minimum');
    expect(turning?.t).toBeCloseTo(2, 4);
    expect(turning?.touches).toBe(false);
  });
});

describe('what it refuses to do', () => {
  it('has nothing to say about a constant', () => {
    expect(analyse('5', -2, 2)).toHaveLength(0);
  });

  it('has nothing to say about a function with no values', () => {
    expect(analyse('1/(t - t)', -2, 2)).toHaveLength(0);
  });

  it('has nothing to say about a window that is not a window', () => {
    expect(findPointsOfInterest(curveOf('sin(t)'), { tMin: 2, tMax: 2 })).toHaveLength(0);
    expect(findPointsOfInterest(curveOf('sin(t)'), { tMin: 1, tMax: -1 })).toHaveLength(0);
    expect(findPointsOfInterest(curveOf('sin(t)'), { tMin: NaN, tMax: 1 })).toHaveLength(0);
  });

  it('stops before a curve that never settles buries the picture', () => {
    // A hundred and sixty crossings and as many turns, reported as a bounded list
    // rather than as a wall of labels.
    const found = analyse('sin(50*t)', 0, 20);
    expect(found.length).toBeLessThanOrEqual(60);
    expect(found.length).toBeGreaterThan(10);
  });

  it('returns the points in order along the axis', () => {
    const found = analyse('sin(t)', -2 * Math.PI, 2 * Math.PI);
    for (let index = 1; index < found.length; index += 1) {
      expect(found[index]?.t ?? 0).toBeGreaterThan(found[index - 1]?.t ?? 0);
    }
  });
});
