import { describe, expect, it } from 'vitest';
import { contourLines, type ContourGrid } from '../src/contours';

function grid(
  values: readonly (number | null)[],
  columns: number,
  rows: number,
  bounds: Partial<Pick<ContourGrid, 'xMin' | 'xMax' | 'yMin' | 'yMax'>> = {},
): ContourGrid {
  const defined = new Uint8Array(values.length);
  const sampled = new Float64Array(values.length);
  values.forEach((value, index) => {
    if (value === null) return;
    defined[index] = 1;
    sampled[index] = value;
  });
  return {
    columns,
    rows,
    values: sampled,
    defined,
    xMin: bounds.xMin ?? -1,
    xMax: bounds.xMax ?? 1,
    yMin: bounds.yMin ?? -1,
    yMax: bounds.yMax ?? 1,
  };
}

describe('contour lines', () => {
  it('draws one straight level set across a rectangular grid', () => {
    // f(x, y) = x, sampled at x = -1, 0, 1 and y = -1, 0, 1.
    const result = contourLines(grid([-1, 0, 1, -1, 0, 1, -1, 0, 1], 3, 3), [0]);

    expect(result).toHaveLength(1);
    expect(result[0]?.paths).toHaveLength(1);
    const path = result[0]?.paths[0];
    expect(path?.closed).toBe(false);
    expect(path?.points[0]).toEqual({ x: 0, y: -1 });
    expect(path?.points.at(-1)).toEqual({ x: 0, y: 1 });
  });

  it('stitches a closed level set instead of returning one segment per cell', () => {
    // A 3×3 sample of x² + y² has a square-ish level set at 1/2.
    const result = contourLines(grid([2, 1, 2, 1, 0, 1, 2, 1, 2], 3, 3), [0.5]);

    expect(result[0]?.paths).toHaveLength(1);
    expect(result[0]?.paths[0]?.closed).toBe(true);
    // Four cell edges plus the repeated first point close the loop.
    expect(result[0]?.paths[0]?.points.length).toBe(5);
  });

  it('does not draw a contour through an undefined cell', () => {
    const result = contourLines(
      grid(
        [
          -1,
          1,
          -1,
          1,
          -1,
          1,
          -1,
          1,
          -1,
          1,
          null,
          1,
          -1,
          1,
          -1,
          1,
          -1,
          1,
          -1,
          1,
          -1,
          1,
          -1,
          1,
          -1,
          1,
          -1,
        ],
        5,
        5,
      ),
      [0],
    );

    expect(result[0]?.paths.length).toBeGreaterThan(0);
    expect(
      result[0]?.paths.every((path) =>
        path.points.every((point) => point.x !== 0 || point.y !== 0),
      ),
    ).toBe(true);
  });

  it('chooses a deterministic topology for a saddle cell', () => {
    const result = contourLines(grid([1, -1, -1, 1], 2, 2), [0]);
    const paths = result[0]?.paths ?? [];

    // The cell centre is zero, so the tie is resolved consistently rather than
    // producing a four-way junction whose topology depends on iteration order.
    expect(paths).toHaveLength(2);
    expect(paths.every((path) => path.points)).toBe(true);
  });
});
