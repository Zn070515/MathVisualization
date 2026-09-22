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
  FIELD_OF_VIEW_Y,
  cameraBasis,
  cameraEye,
  cameraProjectionMatrix,
  cameraViewMatrix,
  cameraViewProjection,
  dolly,
  frameScene,
  orbit,
  panTarget,
  worldPerPixel,
} from '../src/render/camera3d';
import { dot, multiply, projectToScreen, subtract, vec3 } from '../src/render/matrix';

const HEIGHT = 400;

describe('the default view', () => {
  it('looks down at the surface from above and to one side', () => {
    const eye = cameraEye(DEFAULT_CAMERA_3D);
    // Above the plane, and starting level with it would hide half the surface
    // behind the other half.
    expect(eye.z).toBeGreaterThan(0);
    expect(eye.x).toBeGreaterThan(0);
  });

  it('treats z as the world’s up axis, because that is how a graph is read', () => {
    // The regression this exists for. The mesh is uploaded as `(x, y, f(x, y))`
    // with nothing swapped, so a camera that lifted the eye in `y` would lay the
    // graph on its side: the axis labelled `z` would run across the screen instead
    // of up it.
    //
    // The discriminator is the camera's own up vector. With `y` up it points along
    // `y` and has no `z` component at all, so this is not a value that happens to
    // pass either way.
    const { up } = cameraBasis(DEFAULT_CAMERA_3D);
    expect(up.z).toBeGreaterThan(0.5);
    expect(Math.abs(up.y)).toBeLessThan(0.5);
  });

  it('draws a taller point higher up the picture', () => {
    // The same claim end to end: raising `z` moves the point up the screen.
    const viewProjection = cameraViewProjection(DEFAULT_CAMERA_3D, 400, 300);
    const onPlane = projectToScreen({ x: 0, y: 0, z: 0 }, viewProjection, 400, 300);
    const above = projectToScreen({ x: 0, y: 0, z: 1 }, viewProjection, 400, 300);
    expect(above.y).toBeLessThan(onPlane.y);
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

describe('framing a scene', () => {
  it('pulls back far enough to see all of it', () => {
    // A camera at a fixed distance ends up inside a scene that is several times
    // bigger, looking at the back of the surface. The distance that fits a sphere
    // of radius r is r / sin(fov / 2).
    const framed = frameScene(DEFAULT_CAMERA_3D, vec3(0, 0, 0), 7);
    expect(framed.distance).toBeCloseTo(7 / Math.sin(FIELD_OF_VIEW_Y / 2), 6);
    expect(framed.distance).toBeGreaterThan(DEFAULT_CAMERA_3D.distance);
  });

  it('moves the target to where the scene actually is', () => {
    // The other half of the same problem, and the one that grows teeth once two
    // views are open: the surface samples the *shared* viewport, so panning a
    // plane view to x ≈ 100 moves the region the surface covers. A camera still
    // orbiting the origin frames the wrong part of the world — the scene is in
    // shot only because the radius happened to grow, and it sits off to one side.
    const framed = frameScene(DEFAULT_CAMERA_3D, vec3(100, -4, 2), 7);
    expect(framed.target).toEqual({ x: 100, y: -4, z: 2 });
  });

  it('leaves a camera alone when it is already framing that scene', () => {
    // So that a re-frame cannot undo a deliberate dolly on the next render.
    const framed = frameScene(DEFAULT_CAMERA_3D, vec3(1, 2, 3), 4);
    expect(frameScene(framed, vec3(1, 2, 3), 4)).toBe(framed);
  });

  it('has an answer for a scene with no extent', () => {
    const framed = frameScene(DEFAULT_CAMERA_3D, vec3(0, 0, 0), 0);
    expect(Number.isFinite(framed.distance)).toBe(true);
    expect(framed.distance).toBeGreaterThan(0);
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
