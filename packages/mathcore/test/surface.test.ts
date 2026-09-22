/**
 * Sampling a scalar field.
 *
 * The sampling runs through the real parser and evaluator rather than a stub,
 * because the property that matters is a property of the *product*: the numbers in
 * the surface must be the numbers the readout would print for the same point. A
 * stubbed evaluator would prove only that the loops are written as written.
 *
 * The case worth the most attention is the undefined one. A surface is a picture
 * of where a function has values, so the interesting question is not how it is
 * shaded but what it does at a point where the function has none.
 */
import { describe, expect, it } from 'vitest';
import { type Complex, cx, isUndefined } from '../src/complex';
import { evaluateScalar } from '../src/evaluator';
import { parseExpression } from '../src/parser';
import { sampleSurface, surfaceNormals, vertexIndex } from '../src/surface';
import { type MathIssue, type Result } from '../src/errors';

/** A field of x and y, as the surface sampler sees it. */
function fieldOf(source: string): (x: number, y: number) => Result<Complex, MathIssue> {
  const parsed = parseExpression(source, { knownFunctions: new Set() });
  if (!parsed.ok) throw new Error(`could not parse "${source}": ${parsed.issue.message}`);
  const body = parsed.value;

  return (x, y) => {
    const values = new Map<string, Complex>([
      ['x', cx(x, 0)],
      ['y', cx(y, 0)],
    ]);
    return evaluateScalar(body, { values, functions: new Map() });
  };
}

const GRID = { xMin: -2, xMax: 2, yMin: -2, yMax: 2, columns: 5, rows: 5 };

/** The height of a vertex, or null where the mesh has no value there. */
function heightAt(
  mesh: ReturnType<typeof sampleSurface>,
  column: number,
  row: number,
): number | null {
  const at = vertexIndex(mesh, column, row);
  if (mesh.defined[at] === 0) return null;
  return mesh.positions[3 * at + 2] ?? null;
}

describe('the sampled surface', () => {
  it('puts the values where the evaluator puts them', () => {
    const mesh = sampleSurface(fieldOf('x^2 + y^2'), GRID);
    // The grid runs -2, -1, 0, 1, 2 on both axes, so the corner is 8 and the
    // centre is 0.
    expect(heightAt(mesh, 0, 0)).toBeCloseTo(8, 12);
    expect(heightAt(mesh, 4, 4)).toBeCloseTo(8, 12);
    expect(heightAt(mesh, 2, 2)).toBeCloseTo(0, 12);
    expect(heightAt(mesh, 3, 0)).toBeCloseTo(5, 12);
  });

  it('places each vertex at its own coordinates, not at a neighbour’s', () => {
    const mesh = sampleSurface(fieldOf('x^2 + y^2'), GRID);
    for (let row = 0; row < mesh.rows; row += 1) {
      for (let column = 0; column < mesh.columns; column += 1) {
        const at = 3 * vertexIndex(mesh, column, row);
        expect(mesh.positions[at]).toBeCloseTo(-2 + column, 12);
        expect(mesh.positions[at + 1]).toBeCloseTo(-2 + row, 12);
      }
    }
  });

  it('reports the range of the values it sampled, which is what a ramp spans', () => {
    const mesh = sampleSurface(fieldOf('x^2 + y^2'), GRID);
    expect(mesh.zMin).toBeCloseTo(0, 12);
    expect(mesh.zMax).toBeCloseTo(8, 12);
  });

  it('keeps the sampled value beside the vertex, so colour and height cannot disagree', () => {
    const mesh = sampleSurface(fieldOf('x^2 + y^2'), GRID);
    for (let index = 0; index < mesh.columns * mesh.rows; index += 1) {
      if (mesh.defined[index] === 0) continue;
      expect(mesh.values[index]).toBeCloseTo(mesh.positions[3 * index + 2] ?? NaN, 12);
    }
  });

  it('builds two triangles per cell', () => {
    const mesh = sampleSurface(fieldOf('x^2 + y^2'), GRID);
    // 4 cells by 4 cells, 6 indices each.
    expect(mesh.index.length).toBe(4 * 4 * 6);
    for (const index of mesh.index) {
      expect(index).toBeLessThan(mesh.columns * mesh.rows);
    }
  });

  it('has an answer for a degenerate request', () => {
    const mesh = sampleSurface(fieldOf('x^2 + y^2'), { ...GRID, columns: 1, rows: 0 });
    expect(mesh.columns).toBe(2);
    expect(mesh.rows).toBe(2);
    expect(mesh.index.length).toBe(6);
  });
});

describe('a point where the function has no value', () => {
  const pole = { xMin: -1, xMax: 1, yMin: -1, yMax: 1, columns: 5, rows: 5 };

  it('is marked undefined rather than sampled', () => {
    const mesh = sampleSurface(fieldOf('1/(x^2 + y^2)'), pole);
    expect(mesh.defined[vertexIndex(mesh, 2, 2)]).toBe(0);
    // ... and the grid is 5 by 5, so 24 of the 25 vertices have values.
    expect([...mesh.defined].filter((flag) => flag === 1)).toHaveLength(24);
  });

  it('takes every cell that touches it with it, so the surface has a hole', () => {
    // The rule that keeps the picture honest. Skipping the undefined sample and
    // drawing the rest would carry the surface smoothly over a point where the
    // function is not defined, which is a picture that says something false.
    const mesh = sampleSurface(fieldOf('1/(x^2 + y^2)'), pole);
    expect(mesh.index.length).toBe(12 * 6);

    for (const index of mesh.index) {
      expect(mesh.defined[index]).toBe(1);
    }
  });

  it('leaves the range to the values it does have', () => {
    // The nearest sampled points to the pole are at distance 0.5, so the largest
    // value is 4; the corners give 0.5.
    const mesh = sampleSurface(fieldOf('1/(x^2 + y^2)'), pole);
    expect(mesh.zMax).toBeCloseTo(4, 12);
    expect(mesh.zMin).toBeCloseTo(0.5, 12);
  });

  it('draws nothing at all when the function has no value anywhere', () => {
    const mesh = sampleSurface(fieldOf('1/(x - x)'), pole);
    expect([...mesh.defined].every((flag) => flag === 0)).toBe(true);
    expect(mesh.index.length).toBe(0);
    expect(mesh.zMin).toBe(0);
    expect(mesh.zMax).toBe(0);
  });
});

describe('the normals', () => {
  it('are unit length everywhere', () => {
    const mesh = sampleSurface(fieldOf('x^2 + y^2'), GRID);
    const normals = surfaceNormals(mesh);
    for (let index = 0; index < mesh.columns * mesh.rows; index += 1) {
      if (mesh.defined[index] === 0) continue;
      const length = Math.hypot(
        normals[3 * index] ?? 0,
        normals[3 * index + 1] ?? 0,
        normals[3 * index + 2] ?? 0,
      );
      expect(length).toBeCloseTo(1, 6);
    }
  });

  it('point upward, which for a graph is outward', () => {
    // The `surfaceNormal` convention, made checkable: the normal of a bowl points
    // away from the region it encloses, and that region is below it.
    const mesh = sampleSurface(fieldOf('x^2 + y^2'), GRID);
    const normals = surfaceNormals(mesh);
    for (let index = 0; index < mesh.columns * mesh.rows; index += 1) {
      if (mesh.defined[index] === 0) continue;
      expect(normals[3 * index + 2] ?? 0).toBeGreaterThan(0);
    }
  });

  it('are exact for a plane, where a difference quotient is the derivative', () => {
    // f = x is linear, so the slope is 1 everywhere and the normal is
    // (-1, 0, 1)/sqrt(2) — a value to compare against rather than a sign to check.
    const mesh = sampleSurface(fieldOf('x'), GRID);
    const normals = surfaceNormals(mesh);
    const at = 3 * vertexIndex(mesh, 2, 2);
    expect(normals[at]).toBeCloseTo(-Math.SQRT1_2, 6);
    expect(normals[at + 1]).toBeCloseTo(0, 6);
    expect(normals[at + 2]).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('are flat at a vertex beside a hole, because there is no slope to measure', () => {
    const mesh = sampleSurface(fieldOf('1/(x^2 + y^2)'), {
      xMin: -1,
      xMax: 1,
      yMin: -1,
      yMax: 1,
      columns: 5,
      rows: 5,
    });
    const normals = surfaceNormals(mesh);
    // The vertex straight above the pole, at (0, 0.5), has the pole below it.
    const at = 3 * vertexIndex(mesh, 2, 3);
    expect(mesh.defined[vertexIndex(mesh, 2, 3)]).toBe(1);
    expect(normals[at]).toBeCloseTo(0, 6);
    expect(normals[at + 2]).toBeCloseTo(1, 6);
  });
});

describe('what the sampler refuses to do', () => {
  it('never returns a value that is not a number', () => {
    const mesh = sampleSurface(fieldOf('1/(x^2 + y^2)'), {
      xMin: -1,
      xMax: 1,
      yMin: -1,
      yMax: 1,
      columns: 9,
      rows: 9,
    });
    for (let index = 0; index < mesh.columns * mesh.rows; index += 1) {
      if (mesh.defined[index] === 0) continue;
      expect(Number.isFinite(mesh.positions[3 * index + 2] ?? NaN)).toBe(true);
      expect(isUndefined({ re: mesh.values[index] ?? NaN, im: 0 })).toBe(false);
    }
  });
});
