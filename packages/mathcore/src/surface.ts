/**
 * Sampling a scalar field into a mesh.
 *
 * This is mathematics, not rendering: it takes an evaluator and a rectangle and
 * produces the sampled surface, with no opinion about cameras, colour or
 * triangles. It lives in the core because the later work on this project —
 * gradients, flux, surface integrals — needs the same sampling and should not
 * have to reach into a renderer to get it.
 *
 * The one rule that matters here is what happens at a singularity. `1/(x² + y²)`
 * has no value at the origin, and the tempting thing to do is skip that sample
 * and carry on, which draws a surface that passes smoothly over a point where the
 * function is not defined — a picture that says something false. Instead the
 * sample is marked undefined and every cell that touches it is dropped, so the
 * surface has a hole in it. A hole is the truth.
 *
 * A height is the *real* part of the value. That is right for the object this
 * exists for — a scalar field `R² → R` — and wrong for anything else, so the
 * decision about which expressions are surfaces is made a level up, by the type
 * system, and not silently here. This takes an evaluator and a rectangle because
 * that is all it can honestly be given.
 */
import { type Complex, isUndefined } from './complex';
import { type MathIssue, type Result } from './errors';

/** A sampled scalar field, ready to be drawn. */
export interface SurfaceMesh {
  readonly columns: number;
  readonly rows: number;
  /** `x, y, z` triples, row-major: vertex `(i, j)` is at `3 * (j * columns + i)`. */
  readonly positions: Float64Array;
  /**
   * The sampled value at each vertex.
   *
   * Kept alongside the positions because the colour comes from the value, not
   * from the height: a surface shaded by `z` and a heatmap of the same field must
   * agree, and the only way to guarantee that is for both to read the same number.
   */
  readonly values: Float64Array;
  /** 1 where the vertex is defined, 0 where the expression has no value there. */
  readonly defined: Uint8Array;
  /** Triangle indices, three per corner. Cells touching an undefined vertex are absent. */
  readonly index: Uint32Array;
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
  /** The range of the *defined* samples, which is what a colour ramp spans. */
  readonly zMin: number;
  readonly zMax: number;
}

export interface SurfaceSampling {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
  /** Vertices along the horizontal axis. Two or more. */
  readonly columns: number;
  /** Vertices along the vertical axis. Two or more. */
  readonly rows: number;
}

/** Where a vertex sits in the flat arrays. */
export function vertexIndex(mesh: { columns: number }, column: number, row: number): number {
  return row * mesh.columns + column;
}

/**
 * Sample a field over a rectangle.
 *
 * The evaluator is the same one the readout and the CPU views use, so the surface
 * and the numbers beside it cannot disagree about what the function is.
 */
export function sampleSurface(
  evaluate: (x: number, y: number) => Result<Complex, MathIssue>,
  sampling: SurfaceSampling,
): SurfaceMesh {
  const { xMin, xMax, yMin, yMax } = sampling;
  const columns = Math.max(2, Math.floor(sampling.columns));
  const rows = Math.max(2, Math.floor(sampling.rows));

  const positions = new Float64Array(3 * columns * rows);
  const values = new Float64Array(columns * rows);
  const defined = new Uint8Array(columns * rows);

  const dx = (xMax - xMin) / (columns - 1);
  const dy = (yMax - yMin) / (rows - 1);

  let zMin = Infinity;
  let zMax = -Infinity;

  for (let row = 0; row < rows; row += 1) {
    const y = yMin + row * dy;
    for (let column = 0; column < columns; column += 1) {
      const x = xMin + column * dx;
      const at = vertexIndex({ columns }, column, row);
      const result = evaluate(x, y);

      // A value that is not a number is not a height. It is left at zero and
      // marked undefined, and nothing is drawn through it.
      const z = result.ok ? result.value.re : Number.NaN;
      if (!result.ok || isUndefined(result.value) || !Number.isFinite(z)) continue;

      defined[at] = 1;
      values[at] = z;
      positions[3 * at] = x;
      positions[3 * at + 1] = y;
      positions[3 * at + 2] = z;

      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
    }
  }

  const triangles: number[] = [];
  for (let row = 0; row + 1 < rows; row += 1) {
    for (let column = 0; column + 1 < columns; column += 1) {
      const corner = vertexIndex({ columns }, column, row);
      const right = corner + 1;
      const up = corner + columns;
      const diagonal = up + 1;
      // The hole rule, in one line: a cell is drawn only if every corner of it
      // has a value. Half a cell drawn is a lie about where the function stops.
      if (
        defined[corner] === 0 ||
        defined[right] === 0 ||
        defined[up] === 0 ||
        defined[diagonal] === 0
      ) {
        continue;
      }
      triangles.push(corner, right, diagonal, corner, diagonal, up);
    }
  }

  return {
    columns,
    rows,
    positions,
    values,
    defined,
    index: Uint32Array.from(triangles),
    xMin,
    xMax,
    yMin,
    yMax,
    zMin: Number.isFinite(zMin) ? zMin : 0,
    zMax: Number.isFinite(zMax) ? zMax : 0,
  };
}

/**
 * Unit normals, by central differences over the sampled grid.
 *
 * For a graph `z = f(x, y)` the normal is proportional to `(-f_x, -f_y, 1)`,
 * which points upward — outward, for a surface that is the boundary of the region
 * below it. That orientation is fixed by the `surfaceNormal` convention so that
 * the shading here and the future flux work mean the same thing by it.
 *
 * A vertex whose neighbours are missing — next to a hole — gets the flat normal,
 * because there is no slope to measure across a gap.
 */
export function surfaceNormals(mesh: SurfaceMesh): Float32Array {
  const { columns, rows, positions, defined } = mesh;
  const normals = new Float32Array(3 * columns * rows);

  const dx = (mesh.xMax - mesh.xMin) / (columns - 1);
  const dy = (mesh.yMax - mesh.yMin) / (rows - 1);

  const height = (column: number, row: number): number | null => {
    const at = vertexIndex(mesh, column, row);
    if (defined[at] === 0) return null;
    return positions[3 * at + 2] ?? null;
  };

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const at = vertexIndex(mesh, column, row);
      const target = 3 * at;

      if (defined[at] === 0) continue;

      // One-sided at the edge of the grid, central inside it.
      const left = height(Math.max(0, column - 1), row);
      const right = height(Math.min(columns - 1, column + 1), row);
      const down = height(column, Math.max(0, row - 1));
      const up = height(column, Math.min(rows - 1, row + 1));

      if (left === null || right === null || down === null || up === null) {
        normals[target + 2] = 1;
        continue;
      }

      const spanX = (Math.min(columns - 1, column + 1) - Math.max(0, column - 1)) * dx;
      const spanY = (Math.min(rows - 1, row + 1) - Math.max(0, row - 1)) * dy;
      const slopeX = spanX === 0 ? 0 : (right - left) / spanX;
      const slopeY = spanY === 0 ? 0 : (up - down) / spanY;

      const length = Math.hypot(slopeX, slopeY, 1);
      normals[target] = -slopeX / length;
      normals[target + 1] = -slopeY / length;
      normals[target + 2] = 1 / length;
    }
  }

  return normals;
}
