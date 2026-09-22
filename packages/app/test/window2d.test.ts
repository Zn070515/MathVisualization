/**
 * The window, and the two ways across it.
 *
 * Pure geometry, which is the point: what a pointer position means and where a
 * point is drawn are decisions that can be made without a canvas, and jsdom has
 * no canvas to make them in. Testing them here is the only way this arithmetic
 * gets tested at all.
 *
 * The property that matters is that the two directions are inverses. They were
 * written out separately in three places before, which made them inverses by
 * coincidence.
 */
import { describe, expect, it } from 'vitest';
import { cx } from '@mathviz/mathcore';
import { fitViewport, fromScreen, planeWindow, toScreen } from '../src/views/window2d';

const WIDTH = 800;
const HEIGHT = 400;
const viewport = { centre: cx(1, -2), halfWidth: 3 };

describe('the window a viewport shows', () => {
  it('is centred on the viewport, with the half-width on both axes', () => {
    const window = planeWindow(viewport, WIDTH, HEIGHT);
    expect(window.xMin).toBeCloseTo(-2, 12);
    expect(window.xMax).toBeCloseTo(4, 12);
    expect((window.yMin + window.yMax) / 2).toBeCloseTo(-2, 12);
  });

  it('follows the canvas aspect, so the plane is never stretched', () => {
    // A wide canvas shows more of the imaginary axis and the same real one.
    const wide = planeWindow(viewport, 800, 400);
    const square = planeWindow(viewport, 400, 400);
    expect(wide.xMax - wide.xMin).toBeCloseTo(square.xMax - square.xMin, 12);
    expect(wide.yMax - wide.yMin).toBeCloseTo((square.yMax - square.yMin) / 2, 12);
  });
});

describe('drawing a point and reading one back', () => {
  it('puts the top-left corner of the window at the top-left of the canvas', () => {
    const window = planeWindow(viewport, WIDTH, HEIGHT);
    const corner = toScreen(window, { x: window.xMin, y: window.yMax }, WIDTH, HEIGHT);
    expect(corner.x).toBeCloseTo(0, 9);
    expect(corner.y).toBeCloseTo(0, 9);
  });

  it('puts the bottom-right corner of the window at the bottom-right of the canvas', () => {
    const window = planeWindow(viewport, WIDTH, HEIGHT);
    const corner = toScreen(window, { x: window.xMax, y: window.yMin }, WIDTH, HEIGHT);
    expect(corner.x).toBeCloseTo(WIDTH, 9);
    expect(corner.y).toBeCloseTo(HEIGHT, 9);
  });

  it('flips the vertical axis, because screen y grows downward', () => {
    const window = planeWindow(viewport, WIDTH, HEIGHT);
    const low = toScreen(window, { x: 0, y: window.yMin }, WIDTH, HEIGHT);
    const high = toScreen(window, { x: 0, y: window.yMax }, WIDTH, HEIGHT);
    expect(high.y).toBeLessThan(low.y);
    // ... and the horizontal one does not flip.
    const left = toScreen(window, { x: window.xMin, y: 0 }, WIDTH, HEIGHT);
    const right = toScreen(window, { x: window.xMax, y: 0 }, WIDTH, HEIGHT);
    expect(left.x).toBeLessThan(right.x);
  });

  it('is its own inverse', () => {
    const window = planeWindow(viewport, WIDTH, HEIGHT);
    for (const pixel of [
      { x: 0, y: 0 },
      { x: 200, y: 150 },
      { x: WIDTH, y: HEIGHT },
      { x: 37, y: 311 },
    ]) {
      const plane = fromScreen(window, pixel, WIDTH, HEIGHT);
      const back = toScreen(window, plane, WIDTH, HEIGHT);
      expect(back.x).toBeCloseTo(pixel.x, 9);
      expect(back.y).toBeCloseTo(pixel.y, 9);
    }
  });

  it('puts the centre of the window at the centre of the canvas', () => {
    const window = planeWindow(viewport, WIDTH, HEIGHT);
    const centre = toScreen(
      window,
      { x: viewport.centre.re, y: viewport.centre.im },
      WIDTH,
      HEIGHT,
    );
    expect(centre.x).toBeCloseTo(WIDTH / 2, 9);
    expect(centre.y).toBeCloseTo(HEIGHT / 2, 9);
  });
});

describe('framing a range', () => {
  it('covers the rectangle it was asked to frame', () => {
    const window = planeWindow(fitViewport(-2, 3, -1, 4, 0.5), 400, 200);
    expect(window.xMin).toBeLessThanOrEqual(-2);
    expect(window.xMax).toBeGreaterThanOrEqual(3);
    expect(window.yMin).toBeLessThanOrEqual(-1);
    expect(window.yMax).toBeGreaterThanOrEqual(4);
  });

  it('keeps one scale on both axes, because it is framing a plane', () => {
    const window = planeWindow(fitViewport(-2, 3, -1, 4, 0.5), 400, 200);
    const horizontal = window.xMax - window.xMin;
    const vertical = window.yMax - window.yMin;
    expect(horizontal / vertical).toBeCloseTo(400 / 200, 9);
  });

  it('is driven by whichever axis asks for more room', () => {
    // A wide x range on a tall canvas: x decides, and y gets more than it asked
    // for rather than being stretched independently.
    const window = planeWindow(fitViewport(-100, 100, -1, 1, 2), 200, 400);
    expect(window.xMin).toBeLessThanOrEqual(-100);
    expect(window.xMax).toBeGreaterThanOrEqual(100);
    expect(window.yMin).toBeLessThan(-1);
  });

  it('leaves a margin, so the range does not sit exactly on the frame', () => {
    const window = planeWindow(fitViewport(-1, 1, -1, 1, 1), 100, 100);
    expect(window.xMin).toBeLessThan(-1);
    expect(window.xMax).toBeGreaterThan(1);
    expect(window.yMin).toBeLessThan(-1);
    expect(window.yMax).toBeGreaterThan(1);
  });

  it('has an answer for a range with no extent', () => {
    // A constant function has min === max, and a frame is still needed.
    const viewport2 = fitViewport(1, 1, 2, 2, 1);
    expect(Number.isFinite(viewport2.halfWidth)).toBe(true);
    expect(viewport2.halfWidth).toBeGreaterThan(0);
    expect(viewport2.centre).toEqual({ re: 1, im: 2 });
  });
});
