/**
 * The matrix conventions.
 *
 * Every one of these is a thing a scene can be silently wrong about: a mirrored
 * picture, an inside-out depth range, a projection that puts the target off the
 * edge. None of them announces itself — the picture still looks like a picture —
 * so each is pinned here against a value worked out by hand rather than against
 * whatever the implementation happens to produce.
 *
 * The values are chosen so that the answer is known independently: a camera at
 * `z = 5` looking at the origin with a 1..10 depth range has its near plane at
 * world `z = 4` and its far plane at `z = -5`, and that is arithmetic, not
 * agreement.
 */
import { describe, expect, it } from 'vitest';
import {
  identity,
  lookAt,
  multiply,
  perspective,
  projectToScreen,
  vec3,
  type Mat4,
  type Vec3,
} from '../src/render/matrix';

/** Apply a matrix without the perspective divide, to see what it did. */
function apply(matrix: Mat4, point: Vec3): [number, number, number, number] {
  const at = (index: number): number => matrix[index] ?? 0;
  return [
    at(0) * point.x + at(4) * point.y + at(8) * point.z + at(12),
    at(1) * point.x + at(5) * point.y + at(9) * point.z + at(13),
    at(2) * point.x + at(6) * point.y + at(10) * point.z + at(14),
    at(3) * point.x + at(7) * point.y + at(11) * point.z + at(15),
  ];
}

const WIDTH = 200;
const HEIGHT = 200;
const VIEW = lookAt(vec3(0, 0, 5), vec3(0, 0, 0), vec3(0, 1, 0));
const PROJECTION = perspective(Math.PI / 4, 1, 1, 10);
const VIEW_PROJECTION = multiply(PROJECTION, VIEW);

describe('multiplying', () => {
  it('leaves a matrix alone when multiplied by the identity', () => {
    for (const matrix of [identity(), PROJECTION, VIEW, VIEW_PROJECTION]) {
      const point = vec3(0.3, -0.7, 1.1);
      const alone = apply(matrix, point);
      const left = apply(multiply(identity(), matrix), point);
      const right = apply(multiply(matrix, identity()), point);
      for (let index = 0; index < 4; index += 1) {
        expect(left[index]).toBeCloseTo(alone[index] ?? NaN, 6);
        expect(right[index]).toBeCloseTo(alone[index] ?? NaN, 6);
      }
    }
  });

  it('applies the right-hand matrix first', () => {
    // The claim that a transposed multiply would fail. View space is defined by
    // the view matrix, so the projection has to be applied *after* it — which is
    // `projection · view`, in that order.
    const point = vec3(0.4, 0.2, 0.6);
    const stepwise = apply(VIEW, point);
    const expected = apply(PROJECTION, vec3(stepwise[0], stepwise[1], stepwise[2]));
    const combined = apply(VIEW_PROJECTION, point);

    for (let index = 0; index < 4; index += 1) {
      expect(combined[index]).toBeCloseTo(expected[index] ?? NaN, 5);
    }
  });
});

describe('looking at something', () => {
  it('puts the camera at the origin of its own view', () => {
    const eye = vec3(3, 4, 5);
    const view = lookAt(eye, vec3(0, 0, 0), vec3(0, 1, 0));
    const at = apply(view, eye);
    expect(at[0]).toBeCloseTo(0, 6);
    expect(at[1]).toBeCloseTo(0, 6);
    expect(at[2]).toBeCloseTo(0, 6);
    expect(at[3]).toBeCloseTo(1, 6);
  });

  it('puts the target straight ahead, which is down the negative z axis', () => {
    // The handedness, in one assertion: a right-handed camera looks along -z.
    const view = lookAt(vec3(0, 0, 5), vec3(2, 0, 0), vec3(0, 1, 0));
    const at = apply(view, vec3(2, 0, 0));
    expect(at[0]).toBeCloseTo(0, 6);
    expect(at[1]).toBeCloseTo(0, 6);
    expect(at[2]).toBeCloseTo(-Math.hypot(2, 5), 6);
  });
});

describe('projecting', () => {
  it('puts the point being looked at at the centre of the canvas', () => {
    const at = projectToScreen(vec3(0, 0, 0), VIEW_PROJECTION, WIDTH, HEIGHT);
    expect(at.visible).toBe(true);
    expect(at.x).toBeCloseTo(WIDTH / 2, 6);
    expect(at.y).toBeCloseTo(HEIGHT / 2, 6);
  });

  it('puts a higher point higher on the canvas, which is a smaller y', () => {
    const higher = projectToScreen(vec3(0, 1, 0), VIEW_PROJECTION, WIDTH, HEIGHT);
    expect(higher.y).toBeLessThan(HEIGHT / 2);
  });

  it('puts a point to the right on the right', () => {
    const right = projectToScreen(vec3(1, 0, 0), VIEW_PROJECTION, WIDTH, HEIGHT);
    expect(right.x).toBeGreaterThan(WIDTH / 2);
  });

  it('puts the near and far planes at the ends of the depth range', () => {
    // The camera is at world z = 5 looking towards -z with a 1..10 range, so the
    // near plane is world z = 4 and the far plane is world z = -5.
    expect(projectToScreen(vec3(0, 0, 4), VIEW_PROJECTION, WIDTH, HEIGHT).depth).toBeCloseTo(-1, 5);
    expect(projectToScreen(vec3(0, 0, -5), VIEW_PROJECTION, WIDTH, HEIGHT).depth).toBeCloseTo(1, 5);
  });

  it('says so rather than dividing by zero when a point is behind the camera', () => {
    const behind = projectToScreen(vec3(0, 0, 20), VIEW_PROJECTION, WIDTH, HEIGHT);
    expect(behind.visible).toBe(false);
    expect(Number.isNaN(behind.x)).toBe(true);
  });

  it('is closer to the centre for a point nearer the axis', () => {
    const near = projectToScreen(vec3(0.2, 0, 0), VIEW_PROJECTION, WIDTH, HEIGHT);
    const far = projectToScreen(vec3(1.5, 0, 0), VIEW_PROJECTION, WIDTH, HEIGHT);
    expect(near.x - WIDTH / 2).toBeLessThan(far.x - WIDTH / 2);
  });
});
