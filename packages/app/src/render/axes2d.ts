/**
 * The axes, the grid, and the numbers on them.
 *
 * Shared by every two-dimensional view, because a plane and a pair of axes are
 * the same object seen from two directions, and a reader who has learnt to read
 * one should not have to learn the other.
 *
 * Three decisions worth stating:
 *
 * - **An axis is drawn only when it is in view.** Scrolling the origin off the
 *   frame does not slide a line along the edge pretending to be the axis; the
 *   grid still says where the units are, and the numbers stick to the edge so
 *   that they stay readable.
 * - **A label that would collide with the one before it is dropped.** Decided
 *   from measured text widths rather than from a guess about how wide a digit is,
 *   which is the difference between an axis that degrades gracefully at any zoom
 *   and one that overlaps as soon as the values grow a digit.
 * - **Nothing here knows what a curve is.** This draws the paper; the views draw
 *   on it.
 */
import { axisTicks } from '@mathviz/mathcore';
import { CANVAS_COLORS } from './canvasSurface';
import { AXIS_NAME_FONT, drawDisplayNumber, measureDisplayNumber, TICK_FONT } from './canvasText';
import { toScreen, type Window2d } from '../views/window2d';

/** How far a tick mark sticks out from its axis. */
const TICK_LENGTH = 4;

/** The least gap between two labels before one of them is dropped. */
const LABEL_GAP = 8;

/** How much room a label needs to fit inside the frame beneath the axis. */
const LABEL_ROOM = 16;

/**
 * The labels that can be drawn without overlapping, in the order they sit.
 *
 * Greedy along the axis: each label is kept if it clears the last one kept. The
 * alternative — keeping every *n*th label — divides the axis into equal parts and
 * can still collide, because a larger value takes more room than a smaller one.
 *
 * The items are sorted by position first, and this is not a nicety. A horizontal
 * axis hands its ticks over in increasing value, which is increasing pixels; a
 * vertical one hands over increasing value, which is *decreasing* pixels, because
 * screen y grows downward. A pass that trusted the incoming order would work on
 * one axis and silently drop every label but the first on the other — which is
 * exactly what it did.
 */
export function readableLabels<T>(
  items: readonly T[],
  positionOf: (item: T) => number,
  widthOf: (item: T) => number,
  gap: number = LABEL_GAP,
): readonly T[] {
  const byPosition = [...items].sort((left, right) => positionOf(left) - positionOf(right));

  const kept: T[] = [];
  let previousRight = -Infinity;
  for (const item of byPosition) {
    const centre = positionOf(item);
    const half = widthOf(item) / 2;
    if (centre - half < previousRight + gap) continue;
    kept.push(item);
    previousRight = centre + half;
  }
  return kept;
}

export interface AxesOptions {
  readonly window: Window2d;
  readonly width: number;
  readonly height: number;
  readonly ratio: number;
  /** What the horizontal axis is called: the bound variable, or `Re z`. */
  readonly xName: string;
  /** What the vertical axis is called, or `Im z`. */
  readonly yName: string;
}

export function drawGridAndAxes(context: CanvasRenderingContext2D, options: AxesOptions): void {
  const { window, width, height, ratio } = options;

  const screenX = (value: number): number => toScreen(window, { x: value, y: 0 }, width, height).x;
  const screenY = (value: number): number => toScreen(window, { x: 0, y: value }, width, height).y;

  const horizontal = axisTicks(window.xMin, window.xMax);
  const vertical = axisTicks(window.yMin, window.yMax);

  /**
   * Draw a run of grid lines, either vertical (at given x) or horizontal.
   *
   * The two directions are separate calls rather than one pass over both ladders,
   * because a vertical line belongs at an x-coordinate and a horizontal one at a
   * y-coordinate, and mixing the ladders draws lines where nothing is.
   */
  const strokeLines = (
    values: readonly number[],
    atX: boolean,
    colour: string,
    lineWidth: number,
  ): void => {
    context.strokeStyle = colour;
    context.lineWidth = lineWidth;
    context.beginPath();
    for (const value of values) {
      if (atX) {
        const x = screenX(value);
        if (x < 0 || x > width) continue;
        context.moveTo(x, 0);
        context.lineTo(x, height);
      } else {
        const y = screenY(value);
        if (y < 0 || y > height) continue;
        context.moveTo(0, y);
        context.lineTo(width, y);
      }
    }
    context.stroke();
  };

  const minorWidth = Math.max(1, ratio * 0.5);
  const majorWidth = Math.max(1, ratio * 0.75);
  strokeLines(
    horizontal.minor.map((tick) => tick.value),
    true,
    CANVAS_COLORS.gridMinor,
    minorWidth,
  );
  strokeLines(
    vertical.minor.map((tick) => tick.value),
    false,
    CANVAS_COLORS.gridMinor,
    minorWidth,
  );
  strokeLines(
    horizontal.major.map((tick) => tick.value),
    true,
    CANVAS_COLORS.gridMajor,
    majorWidth,
  );
  strokeLines(
    vertical.major.map((tick) => tick.value),
    false,
    CANVAS_COLORS.gridMajor,
    majorWidth,
  );

  const xAxisInView = window.yMin <= 0 && window.yMax >= 0;
  const yAxisInView = window.xMin <= 0 && window.xMax >= 0;
  const xAxisY = clamp(screenY(0), 0, height);
  const yAxisX = clamp(screenX(0), 0, width);

  if (xAxisInView || yAxisInView) {
    context.strokeStyle = CANVAS_COLORS.axis;
    context.lineWidth = Math.max(1, ratio);
    context.beginPath();
    if (xAxisInView) {
      context.moveTo(0, xAxisY);
      context.lineTo(width, xAxisY);
    }
    if (yAxisInView) {
      context.moveTo(yAxisX, 0);
      context.lineTo(yAxisX, height);
    }
    context.stroke();
  }

  // The extent a label occupies is measured *along its axis*: a run of labels
  // along the bottom takes room horizontally, so their widths matter, and a
  // column of labels takes room vertically, so their heights do. Measuring the
  // width of a vertical label would apply a horizontal rule to a vertical stack
  // — conservative here, since a number is wider than it is tall, but the wrong
  // question, and it would start dropping labels that fit as soon as the ticks
  // came closer together than a word.
  const labelHeight = TICK_FONT.size + 2;
  const xLabels = readableLabels(
    horizontal.major,
    (tick) => screenX(tick.value),
    (tick) => measureDisplayNumber(context, tick.label),
  );
  const yLabels = readableLabels(
    vertical.major,
    (tick) => screenY(tick.value),
    () => labelHeight,
  );

  // Below the axis when that leaves room inside the frame, above the bottom edge
  // when it does not — which is what happens once the origin has been scrolled
  // well below the picture.
  const labelsAbove = xAxisY > height - LABEL_ROOM;
  const labelBaseline: CanvasTextBaseline = labelsAbove ? 'bottom' : 'top';
  const labelRow = labelsAbove ? height - 2 : xAxisY + TICK_LENGTH + 2;
  const markDirection = labelsAbove ? -1 : 1;

  context.strokeStyle = CANVAS_COLORS.axis;
  context.lineWidth = Math.max(1, ratio);
  context.beginPath();
  for (const tick of xLabels) {
    const x = screenX(tick.value);
    context.moveTo(x, xAxisY);
    context.lineTo(x, xAxisY + TICK_LENGTH * markDirection);
  }
  for (const tick of yLabels) {
    const y = screenY(tick.value);
    context.moveTo(yAxisX, y);
    context.lineTo(yAxisX + TICK_LENGTH, y);
  }
  context.stroke();

  for (const tick of xLabels) {
    drawDisplayNumber(context, tick.label, screenX(tick.value), labelRow, {
      align: 'center',
      baseline: labelBaseline,
      color: CANVAS_COLORS.tickLabel,
      font: TICK_FONT,
    });
  }
  for (const tick of yLabels) {
    drawDisplayNumber(context, tick.label, yAxisX - TICK_LENGTH - 3, screenY(tick.value), {
      align: 'right',
      baseline: 'middle',
      color: CANVAS_COLORS.tickLabel,
      font: TICK_FONT,
    });
  }

  // The names, placed along their axes so that they read as part of them.
  context.fillStyle = CANVAS_COLORS.axisName;
  context.font = `${AXIS_NAME_FONT.size}px ${AXIS_NAME_FONT.family}`;
  context.textAlign = 'right';
  context.textBaseline = 'bottom';
  context.fillText(options.xName, width - 6, xAxisInView ? xAxisY - 4 : height - 4);

  context.textAlign = 'left';
  context.textBaseline = 'top';
  context.fillText(options.yName, yAxisX + TICK_LENGTH + 4, 4);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
