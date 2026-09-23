/**
 * Extract level sets from a sampled scalar field.
 *
 * This is the two-dimensional companion to `sampleSurface`: it consumes the
 * same values and the same definition mask, so a surface and its contours cannot
 * quietly disagree about where the function exists. Undefined corners remove a
 * whole cell. Interpolating across one would make a singularity look continuous.
 */

export interface ContourPoint {
  readonly x: number;
  readonly y: number;
}

export interface ContourPath {
  readonly points: readonly ContourPoint[];
  readonly closed: boolean;
}

export interface ContourLine {
  readonly level: number;
  readonly paths: readonly ContourPath[];
}

/** The regular scalar grid consumed by the marching-squares extractor. */
export interface ContourGrid {
  readonly columns: number;
  readonly rows: number;
  /** Row-major scalar samples, one for each grid vertex. */
  readonly values: ArrayLike<number>;
  /** 1 for a usable sample and 0 where the function is undefined. */
  readonly defined: ArrayLike<number>;
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

interface Segment {
  readonly start: ContourPoint;
  readonly end: ContourPoint;
}

interface Endpoint {
  readonly segment: number;
  readonly side: 'start' | 'end';
}

const EPSILON = 1e-12;

/**
 * Return all requested level sets in the order requested, ignoring levels that
 * are not finite. A level is allowed to be outside the sampled range: it simply
 * produces no paths, which is useful to callers that keep a stable legend.
 */
export function contourLines(grid: ContourGrid, levels: readonly number[]): readonly ContourLine[] {
  const safeGrid = normaliseGrid(grid);
  return levels
    .filter((level) => Number.isFinite(level))
    .map((level) => ({ level, paths: extractLevel(safeGrid, level) }));
}

function normaliseGrid(grid: ContourGrid): ContourGrid {
  return {
    ...grid,
    columns: Math.max(2, Math.floor(grid.columns)),
    rows: Math.max(2, Math.floor(grid.rows)),
  };
}

function extractLevel(grid: ContourGrid, level: number): readonly ContourPath[] {
  const segments: Segment[] = [];
  const dx = (grid.xMax - grid.xMin) / (grid.columns - 1);
  const dy = (grid.yMax - grid.yMin) / (grid.rows - 1);

  for (let row = 0; row + 1 < grid.rows; row += 1) {
    for (let column = 0; column + 1 < grid.columns; column += 1) {
      const sw = sample(grid, column, row);
      const se = sample(grid, column + 1, row);
      const ne = sample(grid, column + 1, row + 1);
      const nw = sample(grid, column, row + 1);
      if (sw === null || se === null || ne === null || nw === null) continue;

      const points = [
        interpolate(
          { x: grid.xMin + column * dx, y: grid.yMin + row * dy },
          sw,
          { x: grid.xMin + (column + 1) * dx, y: grid.yMin + row * dy },
          se,
          level,
        ),
        interpolate(
          { x: grid.xMin + (column + 1) * dx, y: grid.yMin + row * dy },
          se,
          { x: grid.xMin + (column + 1) * dx, y: grid.yMin + (row + 1) * dy },
          ne,
          level,
        ),
        interpolate(
          { x: grid.xMin + column * dx, y: grid.yMin + (row + 1) * dy },
          nw,
          { x: grid.xMin + (column + 1) * dx, y: grid.yMin + (row + 1) * dy },
          ne,
          level,
        ),
        interpolate(
          { x: grid.xMin + column * dx, y: grid.yMin + row * dy },
          sw,
          { x: grid.xMin + column * dx, y: grid.yMin + (row + 1) * dy },
          nw,
          level,
        ),
      ];

      const crossings = [0, 1, 2, 3].filter((side) => points[side] !== null);
      if (crossings.length === 2) {
        addSegment(segments, {
          start: points[crossings[0] as number] as ContourPoint,
          end: points[crossings[1] as number] as ContourPoint,
        });
        continue;
      }
      if (crossings.length !== 4) continue;

      const swHigh = sw >= level;
      const seHigh = se >= level;
      const neHigh = ne >= level;
      const nwHigh = nw >= level;

      // Only alternating corner states have four crossings. The bilinear
      // asymptotic decider below makes the saddle rule deterministic, including
      // the exact-tie case.
      const diagonalHigh = swHigh && neHigh;
      if (diagonalHigh || (seHigh && nwHigh)) {
        // For a bilinear cell, Q = (sw-L)(ne-L) - (se-L)(nw-L) is the
        // asymptotic-decider criterion. The arithmetic mean at the cell centre
        // is not equivalent when the corner magnitudes differ.
        const decider = (sw - level) * (ne - level) - (se - level) * (nw - level);
        const pairs =
          decider >= 0
            ? [
                [0, 1],
                [2, 3],
              ]
            : [
                [0, 3],
                [1, 2],
              ];
        for (const pair of pairs) {
          const first = pair[0] as number;
          const second = pair[1] as number;
          addSegment(segments, {
            start: points[first] as ContourPoint,
            end: points[second] as ContourPoint,
          });
        }
      }
    }
  }

  return stitch(
    segments,
    Math.max(Math.abs(grid.xMax - grid.xMin), Math.abs(grid.yMax - grid.yMin)),
  );
}

function addSegment(segments: Segment[], segment: Segment): void {
  // A tie at a sampled vertex can make two incident edge crossings coincide.
  // It is a point, not a drawable contour segment, and keeping it creates a
  // zero-length closed path that confuses stitching at the same vertex.
  if (Math.hypot(segment.start.x - segment.end.x, segment.start.y - segment.end.y) <= EPSILON) {
    return;
  }
  segments.push(segment);
}

function sample(grid: ContourGrid, column: number, row: number): number | null {
  const index = row * grid.columns + column;
  const value = grid.values[index];
  return grid.defined[index] !== 0 && value !== undefined && Number.isFinite(value) ? value : null;
}

function interpolate(
  from: ContourPoint,
  fromValue: number,
  to: ContourPoint,
  toValue: number,
  level: number,
): ContourPoint | null {
  // Treat an on-level sample as the high side consistently. This tie rule means
  // a contour that passes through a sampled vertex is represented by the two
  // incident edges that actually change sign, rather than producing three
  // crossings and dropping the cell.
  const fromHigh = fromValue >= level;
  const toHigh = toValue >= level;
  if (fromHigh === toHigh) return null;

  const denominator = toValue - fromValue;
  const fraction = Math.abs(denominator) < EPSILON ? 0.5 : (level - fromValue) / denominator;
  const t = Math.min(1, Math.max(0, fraction));
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

function stitch(segments: readonly Segment[], span: number): readonly ContourPath[] {
  if (segments.length === 0) return [];

  const tolerance = Math.max(1e-10, span * 1e-9);
  const keyOf = (point: ContourPoint): string =>
    `${Math.round(point.x / tolerance)}:${Math.round(point.y / tolerance)}`;
  // A level that lands exactly on a grid line is seen from both neighbouring
  // cells. Those cells produce the same segment twice; keep one copy or the
  // stitcher would turn the duplicate into a zero-area closed loop.
  const unique = new Map<string, Segment>();
  for (const segment of segments) {
    const first = keyOf(segment.start);
    const second = keyOf(segment.end);
    const key = first < second ? `${first}|${second}` : `${second}|${first}`;
    if (!unique.has(key)) unique.set(key, segment);
  }
  const distinct = [...unique.values()];
  const endpoints = new Map<string, Endpoint[]>();
  distinct.forEach((segment, index) => {
    for (const [side, point] of [
      ['start', segment.start],
      ['end', segment.end],
    ] as const) {
      const key = keyOf(point);
      const at = endpoints.get(key) ?? [];
      at.push({ segment: index, side });
      endpoints.set(key, at);
    }
  });

  const used = new Uint8Array(distinct.length);
  const paths: ContourPath[] = [];

  for (let index = 0; index < distinct.length; index += 1) {
    if (used[index] !== 0) continue;
    used[index] = 1;
    const segment = distinct[index] as Segment;
    const points: ContourPoint[] = [segment.start, segment.end];

    extend(points, false, endpoints, distinct, used, keyOf);
    extend(points, true, endpoints, distinct, used, keyOf);

    const first = points[0] as ContourPoint;
    const last = points[points.length - 1] as ContourPoint;
    paths.push({
      points,
      closed: keyOf(first) === keyOf(last),
    });
  }

  return paths;
}

function extend(
  points: ContourPoint[],
  atFront: boolean,
  endpoints: ReadonlyMap<string, readonly Endpoint[]>,
  segments: readonly Segment[],
  used: Uint8Array,
  keyOf: (point: ContourPoint) => string,
): void {
  while (true) {
    const anchor = atFront ? points[0] : points[points.length - 1];
    if (anchor === undefined) return;
    const candidates = endpoints.get(keyOf(anchor)) ?? [];
    const next = candidates.find((candidate) => used[candidate.segment] === 0);
    if (next === undefined) return;

    used[next.segment] = 1;
    const segment = segments[next.segment] as Segment;
    const point = next.side === 'start' ? segment.end : segment.start;
    if (atFront) points.unshift(point);
    else points.push(point);
  }
}
