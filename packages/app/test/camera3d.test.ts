/**
 * Where the camera is, and what moving it does.
 *
 * The camera is data and the moves are pure functions, which is the point: a
 * wrong orbit or a pan that goes the wrong way produces a picture that looks
 * fine and is disorienting, and there is no way to notice that from a screenshot.
 * Here the answers are directional facts that can be asserted — the target is in
 * front, dragging right carries the picture right — rather than pixel values.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAMERA_3D,
  cameraBasis,
  cameraEye,
  cameraProjectionMatrix,
  cameraViewMatrix,
  cameraViewProjection,
  dolly,
  orbit,
  panTarget,
  worldPerPixel,
} from '../src/render/camera3d';
import { dot, projectToScreen, subtract, multiply } from '../src/render/matrix';

const HEIGHT = 400;

describe('the default view', () => {
  it('looks down at the surface from above and to one side', () => {
    const eye = cameraEye(DEFAULT_CAMERA_3D);
    // A graph is read with z up, so the camera starts above the plane; starting
    // level with it would hide half the surface behind the other half.
    expect(eye.y).toBeGreaterThan(0);
    expect(eye.x).toBeGreaterThan(0);
    expect(eye.z).toBeGreaterThan(0);
  });

  it('puts the point it is looking at at the centre of the canvas', () => {
    const viewProjection = multiply(
      cameraProjectionMatrix(DEFAULT_CAMERA_3D, 400, HEIGHT),
      cameraViewMatrix(DEFAULT_CAMERA_3D),
    );
    const at = projectToScreen(DEFAULT_CAMERA_3D.target, viewProjection, 400, HEIGHT);
    expect(at.visible).toBe(true);
    expect(at.x).toBeCloseTo(200, 5);
    expect(at.y).toBeCloseTo(HEIGHT / 2, 5);
  });

  it('shows more to the sides on a wide canvas than on a square one', () => {
    // The regression this exists for. The projection's ratio is width over
    // height; passing it inverted zooms in horizontally, and a square canvas
    // cannot tell the difference — so this compares a wide one against a square
    // one and asserts the direction, not a value.
    const probe = { x: 1.2, y: 0, z: 0 };
    const offset = (width: number, height: number): number => {
      const at = projectToScreen(
        probe,
        cameraViewProjection(DEFAULT_CAMERA_3D, width, height),
        width,
        height,
      );
      return Math.abs(at.x - width / 2) / width;
    };

    expect(offset(800, 400)).toBeLessThan(offset(400, 400));
  });
});

describe('orbiting', () => {
  it('comes back to where it started after a full turn', () => {
    const once = orbit(DEFAULT_CAMERA_3D, Math.PI * 2, 0);
    const before = cameraEye(DEFAULT_CAMERA_3D);
    const after = cameraEye(once);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(after.z).toBeCloseTo(before.z, 9);
  });

  it('refuses to go over the top, where the up vector would collapse', () => {
    // Looking straight down makes the view direction parallel to the up vector
    // and the basis built from them undefined. The elevation stops short.
    const skyward = orbit(DEFAULT_CAMERA_3D, 0, Math.PI);
    expect(skyward.elevation).toBeLessThan(Math.PI / 2);
    expect(skyward.elevation).toBeGreaterThan(0);

    const downward = orbit(DEFAULT_CAMERA_3D, 0, -Math.PI);
    expect(downward.elevation).toBeGreaterThan(-Math.PI / 2);
  });

  it('changes the direction without changing the distance', () => {
    const moved = orbit(DEFAULT_CAMERA_3D, 1, 0.2);
    expect(moved.distance).toBe(DEFAULT_CAMERA_3D.distance);
    expect(moved.target).toEqual(DEFAULT_CAMERA_3D.target);
  });
});

describe('dollying', () => {
  it('scales the distance', () => {
    expect(dolly(DEFAULT_CAMERA_3D, 0.5).distance).toBe(DEFAULT_CAMERA_3D.distance / 2);
  });

  it('stops before the camera reaches the surface, and before it loses it', () => {
    expect(dolly(DEFAULT_CAMERA_3D, 1e-6).distance).toBeGreaterThan(0);
    expect(dolly(DEFAULT_CAMERA_3D, 1e6).distance).toBeLessThan(Infinity);
    // ... and asking for a move it will not make returns the camera it was given,
    // so nothing downstream re-renders for a no-op.
    const far = dolly(DEFAULT_CAMERA_3D, 1e6);
    expect(dolly(far, 1e6)).toBe(far);
  });
});

describe('panning', () => {
  it('covers the same world distance per pixel however far away the camera is', () => {
    // A perspective projection makes that distance depend on the distance, which
    // is exactly why panning has to be scaled by it.
    expect(worldPerPixel(dolly(DEFAULT_CAMERA_3D, 2), HEIGHT)).toBeCloseTo(
      2 * worldPerPixel(DEFAULT_CAMERA_3D, HEIGHT),
      9,
    );
  });

  it('carries the picture with the pointer', () => {
    // Dragging right moves the surface right, which means the camera's target
    // moves left. Asserting the sign, because a pan that goes the wrong way still
    // looks like a pan.
    const { right, up } = cameraBasis(DEFAULT_CAMERA_3D);
    const perPixel = worldPerPixel(DEFAULT_CAMERA_3D, HEIGHT);

    const sideways = subtract(
      panTarget(DEFAULT_CAMERA_3D, 10, 0, HEIGHT).target,
      DEFAULT_CAMERA_3D.target,
    );
    expect(dot(sideways, right)).toBeCloseTo(-10 * perPixel, 9);

    const vertical = subtract(
      panTarget(DEFAULT_CAMERA_3D, 0, 10, HEIGHT).target,
      DEFAULT_CAMERA_3D.target,
    );
    expect(dot(vertical, up)).toBeCloseTo(10 * perPixel, 9);
  });

  it('moves the target, not the camera’s angle', () => {
    const moved = panTarget(DEFAULT_CAMERA_3D, 5, -5, HEIGHT);
    expect(moved.azimuth).toBe(DEFAULT_CAMERA_3D.azimuth);
    expect(moved.elevation).toBe(DEFAULT_CAMERA_3D.elevation);
    expect(moved.distance).toBe(DEFAULT_CAMERA_3D.distance);
  });
});

describe('the starting view', () => {
  it('is a fixed value, so that resetting it is possible at all', () => {
    // `StoreProvider` restores to this, and the store's reset action assigns it,
    // so it has to be a plain immutable value rather than something computed.
    expect(DEFAULT_CAMERA_3D).toEqual({
      azimuth: Math.PI / 4,
      elevation: Math.PI / 7,
      distance: 6,
      target: { x: 0, y: 0, z: 0 },
    });
  });

  it('is a different view from a wandered one', () => {
    const wandered = panTarget(dolly(orbit(DEFAULT_CAMERA_3D, 2, 0.4), 3), 40, -20, HEIGHT);
    expect(wandered.target).not.toEqual(DEFAULT_CAMERA_3D.target);
    expect(wandered.distance).not.toBe(DEFAULT_CAMERA_3D.distance);
  });
});
