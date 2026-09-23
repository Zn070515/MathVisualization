/** Geometry shared by the directional-derivative handle and its tests. */

export interface PlanePoint {
  readonly x: number;
  readonly y: number;
}

export interface Direction {
  readonly x: number;
  readonly y: number;
}

export function unitDirection(angle: number): Direction {
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

export function directionHandlePoint(
  origin: PlanePoint,
  angle: number,
  length: number,
): PlanePoint {
  const direction = unitDirection(angle);
  return {
    x: origin.x + direction.x * length,
    y: origin.y + direction.y * length,
  };
}

export function directionAngleFromPoints(origin: PlanePoint, handle: PlanePoint): number | null {
  const x = handle.x - origin.x;
  const y = handle.y - origin.y;
  return Math.hypot(x, y) === 0 ? null : Math.atan2(y, x);
}
