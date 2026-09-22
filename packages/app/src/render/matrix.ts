/**
 * The small amount of linear algebra a 3D view needs.
 *
 * Written out rather than taken from a library, for the reason the rest of this
 * project writes its own mathematics: six functions of matrix arithmetic are not
 * an engine, and the renderer next door was already hand-written rather than
 * delegating to one. If the conventions below ever prove to be the source of
 * repeated mistakes, `gl-matrix` (MIT, and itself dependency-free) can replace
 * this file and nothing else, because everything else calls the functions rather
 * than the layout.
 *
 * ## The conventions, stated once
 *
 * These are the four that a scene can be silently wrong about, so they are fixed
 * here and nowhere else:
 *
 * - **Right-handed**, so `x × y = z`. Which axis points *up* in the world is not
 *   decided here: `lookAt` takes the up direction as an argument, and
 *   `camera3d.ts` is where the world's vertical axis is chosen (it is `+z`, the
 *   convention a graph is read with).
 * - **Looking down `-z`.** The camera's forward direction is negative z in its own
 *   frame, which is what `lookAt` and `perspective` below assume.
 * - **Column-major**, the layout OpenGL wants: element `(row, column)` is at
 *   index `column * 4 + row`. A `Float32Array` of 16 values can be handed to
 *   `uniformMatrix4fv` with `transpose = false` and nothing else has to know.
 * - **Clip space** is the usual cube: `x, y ∈ [-1, 1]`, and `z ∈ [-1, 1]` with
 *   `-1` at the near plane and `+1` at the far one.
 *
 * A sign error in any of these produces a scene that is mirrored, inside out, or
 * behind the camera — all of which look like "the projection is broken" and none
 * of which announce themselves. The tests pin each one against a value computed
 * by hand.
 */

/** A point or direction in space. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Sixteen numbers, column-major. */
export type Mat4 = Float32Array;

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.x + b.x, a.y + b.y, a.z + b.z);
}

export function subtract(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function scale(a: Vec3, factor: number): Vec3 {
  return vec3(a.x * factor, a.y * factor, a.z * factor);
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

export function length(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

export function normalize(a: Vec3): Vec3 {
  const magnitude = length(a);
  return magnitude === 0 ? vec3(0, 0, 0) : scale(a, 1 / magnitude);
}

export function identity(): Mat4 {
  const out = new Float32Array(16);
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  return out;
}

/**
 * The product `a · b`, applying `b` first.
 *
 * Written as the sum over `k` rather than as an unrolled expression because the
 * index arithmetic is where a transposed multiply hides, and `a[k * 4 + row]`
 * says plainly which way round the layout is.
 */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += (a[k * 4 + row] ?? 0) * (b[column * 4 + k] ?? 0);
      }
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/**
 * A perspective projection.
 *
 * `fovY` is the full vertical field of view in radians. The result takes a point
 * in view space to clip space, where the near plane is `z = -1` and the far plane
 * is `z = +1`.
 */
export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const out = new Float32Array(16);
  const focal = 1 / Math.tan(fovY / 2);

  out[0] = focal / aspect;
  out[5] = focal;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

/**
 * A view matrix looking from `eye` towards `target`.
 *
 * `up` is a hint rather than a guarantee: the basis is re-orthogonalised, so a
 * slightly wrong up vector tilts nothing.
 */
export function lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const backward = normalize(subtract(eye, target));
  const right = normalize(cross(up, backward));
  const upward = cross(backward, right);

  const out = new Float32Array(16);
  out[0] = right.x;
  out[1] = upward.x;
  out[2] = backward.x;
  out[4] = right.y;
  out[5] = upward.y;
  out[6] = backward.y;
  out[8] = right.z;
  out[9] = upward.z;
  out[10] = backward.z;
  out[12] = -dot(right, eye);
  out[13] = -dot(upward, eye);
  out[14] = -dot(backward, eye);
  out[15] = 1;
  return out;
}

/** A projected point, in normalised device coordinates and in pixels. */
export interface Projected {
  /** Pixels from the left. */
  readonly x: number;
  /** Pixels from the *top*, because that is how a canvas is addressed. */
  readonly y: number;
  /** Clip-space depth: `-1` at the near plane, `+1` at the far one. */
  readonly depth: number;
  /** False when the point is behind the camera, where the divide is meaningless. */
  readonly visible: boolean;
}

/**
 * Project a world point through a view-projection matrix.
 *
 * Depth is returned as well as position because the caller usually needs both:
 * the labels are placed by position, and the picking works out which vertex is in
 * front. Doing it in one pass means the two can never disagree about where a
 * point is.
 */
export function projectToScreen(
  world: Vec3,
  viewProjection: Mat4,
  width: number,
  height: number,
): Projected {
  const m = viewProjection;
  const x = (m[0] ?? 0) * world.x + (m[4] ?? 0) * world.y + (m[8] ?? 0) * world.z + (m[12] ?? 0);
  const y = (m[1] ?? 0) * world.x + (m[5] ?? 0) * world.y + (m[9] ?? 0) * world.z + (m[13] ?? 0);
  const z = (m[2] ?? 0) * world.x + (m[6] ?? 0) * world.y + (m[10] ?? 0) * world.z + (m[14] ?? 0);
  const w = (m[3] ?? 0) * world.x + (m[7] ?? 0) * world.y + (m[11] ?? 0) * world.z + (m[15] ?? 0);

  if (w <= 0) {
    return { x: Number.NaN, y: Number.NaN, depth: Number.NaN, visible: false };
  }

  const ndcX = x / w;
  const ndcY = y / w;
  return {
    x: (ndcX * 0.5 + 0.5) * width,
    // Screen y grows downward and clip-space y grows upward.
    y: (1 - (ndcY * 0.5 + 0.5)) * height,
    depth: z / w,
    visible: true,
  };
}
