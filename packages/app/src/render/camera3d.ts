/**
 * Where a 3D view is looking from.
 *
 * An orbit camera: it always looks at a target point, and the viewer moves around
 * that point on a sphere. That is the right model for looking at a surface,
 * because the thing being looked at does not move and the question is only which
 * side of it you are on.
 *
 * The camera is data, like everything else that interaction touches, so orbiting,
 * dollying and panning are pure functions and can be tested without a canvas —
 * which matters more here than anywhere, since a wrong matrix produces a picture
 * that looks plausible and is mirrored.
 *
 * Screen y grows downward and world y grows upward, so a drag has to be flipped
 * somewhere. It is flipped here, once, in `panTarget`.
 */
import {
  add,
  cross,
  lookAt,
  multiply,
  normalize,
  perspective,
  scale,
  subtract,
  vec3,
  type Mat4,
  type Vec3,
} from './matrix';

/** The vertical field of view, in radians. Also what sets the drag scale. */
export const FIELD_OF_VIEW_Y = Math.PI / 4;

/**
 * How near vertical the camera may go.
 *
 * Not quite π/2: looking straight down makes the up vector parallel to the view
 * direction, and the basis that `lookAt` builds from them collapses. A margin of
 * about a degree keeps the picture stable at the limit without being noticeable.
 */
const MAX_ELEVATION = Math.PI / 2 - 0.02;

const MIN_DISTANCE = 0.5;
const MAX_DISTANCE = 500;

/**
 * The world's up axis is `+z`.
 *
 * This is the convention mathematics uses for a graph: `x` and `y` span the
 * plane, and `z` is the height. It has to be `+z` here and not `+y`, because the
 * mesh is uploaded as `(x, y, f(x, y))` with nothing swapped — a camera that
 * treated `y` as up would lay the graph on its side, with the axis labelled `z`
 * running across the screen instead of up it.
 */
const WORLD_UP = vec3(0, 0, 1);

export interface Camera3d {
  /** Rotation about the vertical axis, in radians. */
  readonly azimuth: number;
  /** Height above the horizontal plane, in radians. Clamped away from vertical. */
  readonly elevation: number;
  /** How far from the target. */
  readonly distance: number;
  /** The point the camera looks at, and orbits around. */
  readonly target: Vec3;
}

/**
 * Where a surface is first seen from: above and to one side.
 *
 * A graph is read with `z` up, so the starting view is above the `xy` plane
 * looking down at it — the angle a surface is usually drawn at on paper. Starting
 * level with the plane would hide half the surface behind the other half.
 */
export const DEFAULT_CAMERA_3D: Camera3d = {
  azimuth: Math.PI / 4,
  elevation: Math.PI / 7,
  distance: 6,
  target: vec3(0, 0, 0),
};

/**
 * Where the camera is, in world coordinates.
 *
 * Azimuth turns about the vertical axis and elevation lifts away from the
 * horizontal plane, so the eye rises in `z` — the height axis — and moves within
 * `x` and `y`.
 */
export function cameraEye(camera: Camera3d): Vec3 {
  const horizontal = Math.cos(camera.elevation) * camera.distance;
  return vec3(
    camera.target.x + horizontal * Math.sin(camera.azimuth),
    camera.target.y + horizontal * Math.cos(camera.azimuth),
    camera.target.z + Math.sin(camera.elevation) * camera.distance,
  );
}

export interface CameraBasis {
  /** Unit vector pointing right across the screen. */
  readonly right: Vec3;
  /** Unit vector pointing up the screen. */
  readonly up: Vec3;
  /** Unit vector pointing from the eye towards the target. */
  readonly forward: Vec3;
}

/** The camera's own axes, used for placing the eye and for panning in screen space. */
export function cameraBasis(camera: Camera3d): CameraBasis {
  const forward = normalize(subtract(camera.target, cameraEye(camera)));
  const right = normalize(cross(forward, WORLD_UP));
  // Orthogonalised against `right`, so a rounding error in `forward` does not tilt
  // the picture.
  const up = cross(right, forward);
  return { right, up, forward };
}

export function cameraViewMatrix(camera: Camera3d): Mat4 {
  return lookAt(cameraEye(camera), camera.target, WORLD_UP);
}

/**
 * The projection for a canvas of this shape.
 *
 * The canvas is given as two numbers rather than as an aspect ratio, and that is
 * deliberate. `perspective` wants width over height, and a single float parameter
 * called `aspect` is a coin flip at every call site: passing height over width
 * instead zooms the picture in horizontally, which looks like a camera that is
 * merely too close and is invisible on a square canvas. Two named dimensions
 * cannot be got backwards.
 */
export function cameraProjectionMatrix(camera: Camera3d, width: number, height: number): Mat4 {
  const near = Math.max(0.1, camera.distance / 50);
  const far = camera.distance * 100;
  const aspect = width <= 0 || height <= 0 ? 1 : width / height;
  return perspective(FIELD_OF_VIEW_Y, aspect, near, far);
}

/** The view and projection together, which is what a vertex shader wants. */
export function cameraViewProjection(camera: Camera3d, width: number, height: number): Mat4 {
  return multiply(cameraProjectionMatrix(camera, width, height), cameraViewMatrix(camera));
}

/** Move around the target. Elevation is clamped so the view never turns over. */
export function orbit(camera: Camera3d, deltaAzimuth: number, deltaElevation: number): Camera3d {
  return {
    ...camera,
    azimuth: camera.azimuth + deltaAzimuth,
    elevation: Math.min(MAX_ELEVATION, Math.max(-MAX_ELEVATION, camera.elevation + deltaElevation)),
  };
}

/** Move closer or further away, within limits that keep the surface in view. */
export function dolly(camera: Camera3d, factor: number): Camera3d {
  const distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, camera.distance * factor));
  return distance === camera.distance ? camera : { ...camera, distance };
}

/**
 * Point the camera at a scene, from far enough away to see all of it.
 *
 * Both halves matter, and for the same reason: the scene is not fixed. Its *size*
 * is not — `f(x, y) = x² − y²` over `[-2.4, 2.4]` reaches nearly six units up, and
 * a camera at a fixed distance ends up inside the surface looking at the back of
 * it. And its *place* is not either: a surface samples the shared viewport, so
 * panning a plane view to `x ≈ 100` moves the region the surface covers while a
 * camera still orbiting the origin would be framing the wrong part of the world.
 *
 * The distance that puts a sphere of radius `r` inside the vertical field of view
 * is `r / sin(fov / 2)` — arithmetic rather than a constant chosen by taste, so
 * changing the field of view cannot leave the framing wrong by a factor nobody
 * notices until the next surface is several times bigger.
 *
 * Applied when the scene changes rather than every frame, so it never fights a
 * deliberate dolly or orbit.
 */
export function frameScene(camera: Camera3d, centre: Vec3, radius: number): Camera3d {
  const wanted = Math.max(radius, 1e-6) / Math.sin(FIELD_OF_VIEW_Y / 2);
  const distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, wanted));
  const unmoved =
    distance === camera.distance &&
    camera.target.x === centre.x &&
    camera.target.y === centre.y &&
    camera.target.z === centre.z;
  return unmoved ? camera : { ...camera, distance, target: centre };
}

/**
 * How much of the world one pixel covers at the target's depth.
 *
 * A perspective projection makes the world-per-pixel depend on how far away the
 * thing is, which is why panning has to be scaled by the distance: a drag should
 * carry the picture with the pointer at any zoom.
 */
export function worldPerPixel(camera: Camera3d, height: number): number {
  return (2 * camera.distance * Math.tan(FIELD_OF_VIEW_Y / 2)) / Math.max(1, height);
}

/**
 * Slide the target across the screen by a drag, in pixels.
 *
 * The sign is chosen so the picture moves *with* the pointer: dragging right
 * carries the surface right, which means the camera's target moves left.
 */
export function panTarget(
  camera: Camera3d,
  deltaX: number,
  deltaY: number,
  height: number,
): Camera3d {
  const perPixel = worldPerPixel(camera, height);
  const { right, up } = cameraBasis(camera);
  const offset = add(scale(right, -deltaX * perPixel), scale(up, deltaY * perPixel));
  return { ...camera, target: add(camera.target, offset) };
}
