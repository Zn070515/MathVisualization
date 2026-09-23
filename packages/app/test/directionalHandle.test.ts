import { describe, expect, it } from 'vitest';
import {
  directionAngleFromPoints,
  directionHandlePoint,
  unitDirection,
} from '../src/views/directionalHandle';

describe('direction handle geometry', () => {
  it('turns an angle into a unit direction', () => {
    expect(unitDirection(Math.PI / 2).x).toBeCloseTo(0, 12);
    expect(unitDirection(Math.PI / 2).y).toBeCloseTo(1, 12);
  });

  it('reads the direction from the selected point to the handle', () => {
    expect(directionAngleFromPoints({ x: 2, y: 3 }, { x: 2, y: 4 })).toBeCloseTo(Math.PI / 2, 12);
    expect(directionAngleFromPoints({ x: 2, y: 3 }, { x: 2, y: 3 })).toBeNull();
  });

  it('places the handle at a stated plane distance', () => {
    expect(directionHandlePoint({ x: -1, y: 2 }, Math.PI, 0.5)).toEqual({ x: -1.5, y: 2 });
  });
});
