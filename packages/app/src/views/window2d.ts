/**
 * The window a view shows, and the two ways to convert across it.
 *
 * Three views each had half of this: one to turn a pointer position into a plane
 * coordinate, another to turn a plane coordinate into a position on the canvas,
 * written out separately and in different styles — one in percentages for a
 * positioned `div`, one in pixels for the canvas itself. They were inverses of
 * each other by coincidence rather than by construction, so a change to one was
 * a change to neither.
 *
 * The vertical axis flips. Screen `y` grows downward and the imaginary axis grows
 * upward, and every one of those three sites had to remember that.
 */
import type { Viewport } from '../state/workspaceStore';

/** A rectangle of the plane, in plane units. */
export interface Window2d {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

/** A point in plane units, or a point in pixels — the caller knows which. */
export interface Point2d {
  readonly x: number;
  readonly y: number;
}

/**
 * The region of the plane a viewport shows on a canvas of this shape.
 *
 * Only the half-width is stored; the half-height follows from the canvas, so the
 * plane is never stretched. A wide canvas simply shows more of the imaginary
 * axis, which is what a plane is.
 */
export function planeWindow(viewport: Viewport, width: number, height: number): Window2d {
  const halfHeight = width === 0 ? viewport.halfWidth : viewport.halfWidth * (height / width);
  return {
    xMin: viewport.centre.re - viewport.halfWidth,
    xMax: viewport.centre.re + viewport.halfWidth,
    yMin: viewport.centre.im - halfHeight,
    yMax: viewport.centre.im + halfHeight,
  };
}

/** How much margin `fitViewport` leaves around the thing it is framing. */
export const FIT_MARGIN = 0.08;

/**
 * A viewport that frames a rectangle.
 *
 * The scale is the same on both axes — that is what makes it a plane and not two
 * independent rulers — so the frame is the smallest one that covers the rectangle
 * at that shared scale, whichever axis demands more.
 *
 * `aspect` is height divided by width, matching {@link planeWindow}: a tall canvas
 * shows more of the vertical axis for the same horizontal span.
 *
 * This is a *requested* framing, never an automatic one. Fitting a signal whose
 * values run to thousands would push the horizontal span out to thousands too,
 * since the two share a scale, and the curve would collapse into a vertical line.
 * A view that reframes itself that way is worse than one that shows an
 * out-of-frame curve and states its range; the reader can ask for the fit.
 */
export function fitViewport(
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  aspect: number,
): Viewport {
  const halfWidthForX = Math.abs(xMax - xMin) / 2;
  const halfWidthForY = aspect > 0 ? Math.abs(yMax - yMin) / 2 / aspect : halfWidthForX;
  const halfWidth = Math.max(halfWidthForX, halfWidthForY, 1e-9) * (1 + FIT_MARGIN);

  return {
    centre: { re: (xMin + xMax) / 2, im: (yMin + yMax) / 2 },
    halfWidth,
  };
}

/** Where a plane point lands on the canvas, in device pixels. */
export function toScreen(window: Window2d, point: Point2d, width: number, height: number): Point2d {
  return {
    x: ((point.x - window.xMin) / (window.xMax - window.xMin)) * width,
    y: height - ((point.y - window.yMin) / (window.yMax - window.yMin)) * height,
  };
}

/** The plane point under a canvas pixel. The inverse of {@link toScreen}. */
export function fromScreen(
  window: Window2d,
  point: Point2d,
  width: number,
  height: number,
): Point2d {
  return {
    x: window.xMin + (point.x / width) * (window.xMax - window.xMin),
    // Screen y grows downward; the imaginary axis grows upward.
    y: window.yMax - (point.y / height) * (window.yMax - window.yMin),
  };
}
