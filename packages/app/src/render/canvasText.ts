/**
 * Numbers drawn on a canvas.
 *
 * The reason the core returns a *structured* number rather than a string is that
 * the exponent of `2×10⁸` belongs in smaller type, and a string cannot say which
 * characters those are. `NumberText` does that in the document; this does it in a
 * bitmap, where there is no markup and the exponent has to be positioned by hand.
 *
 * Canvas text is drawn from a baseline with no layout engine, so every placement
 * here is arithmetic on the font size — which is also why the axis labels are
 * laid out from measured widths rather than assumed ones.
 */
import { displayNumberToText, type DisplayNumber } from '@mathviz/mathcore';
import { CANVAS_FONTS } from './canvasSurface';

/** A font, named once so measurement and drawing cannot disagree about it. */
export interface CanvasFont {
  readonly size: number;
  readonly family: string;
}

/** The face tick labels are set in: digits and signs, no words. */
export const TICK_FONT: CanvasFont = { size: 11, family: CANVAS_FONTS.math };

/** Axis names are words, so they get the instrument face. */
export const AXIS_NAME_FONT: CanvasFont = { size: 11, family: CANVAS_FONTS.label };

/** How much smaller a superscript exponent is. */
const SUPERSCRIPT_SCALE = 0.72;

/** How far above the baseline a superscript sits, as a fraction of the font size. */
const SUPERSCRIPT_RISE = 0.45;

function setFont(context: CanvasRenderingContext2D, font: CanvasFont, scale = 1): void {
  context.font = `${font.size * scale}px ${font.family}`;
}

/**
 * How wide a number will be when drawn.
 *
 * The exponent is measured in its own smaller face, which is the whole reason
 * this cannot be `measureText(displayNumberToText(...))`: the string form and the
 * typeset form are different widths, and the layout has to be computed from the
 * one that is actually drawn.
 */
export function measureDisplayNumber(
  context: CanvasRenderingContext2D,
  value: DisplayNumber,
  font: CanvasFont = TICK_FONT,
): number {
  if (value.kind !== 'scientific') {
    setFont(context, font);
    return context.measureText(displayNumberToText(value)).width;
  }

  setFont(context, font);
  const mantissa = context.measureText(`${value.mantissa}×10`).width;
  setFont(context, font, SUPERSCRIPT_SCALE);
  return mantissa + context.measureText(String(value.exponent)).width;
}

export interface DrawNumberOptions {
  /** Where the number sits horizontally, interpreted according to `align`. */
  readonly align: CanvasTextAlign;
  readonly baseline: CanvasTextBaseline;
  readonly color: string;
  readonly font?: CanvasFont;
}

/**
 * Draw a number at a point.
 *
 * `align` positions the *whole* number, exponent included, because that is what a
 * caller means by "put this number here" — a label right-aligned at a tick mark
 * has to have its last digit at the tick, not its mantissa.
 */
export function drawDisplayNumber(
  context: CanvasRenderingContext2D,
  value: DisplayNumber,
  x: number,
  y: number,
  options: DrawNumberOptions,
): void {
  const font = options.font ?? TICK_FONT;
  context.fillStyle = options.color;

  if (value.kind !== 'scientific') {
    setFont(context, font);
    context.textAlign = options.align;
    context.textBaseline = options.baseline;
    context.fillText(displayNumberToText(value), x, y);
    return;
  }

  const mantissa = `${value.mantissa}×10`;
  const width = measureDisplayNumber(context, value, font);
  const left =
    options.align === 'right' ? x - width : options.align === 'center' ? x - width / 2 : x;

  // Drawn from its own left edge in both parts, so the pieces cannot drift apart
  // the way two independently aligned draws would.
  setFont(context, font);
  context.textAlign = 'left';
  context.textBaseline = options.baseline;
  const mantissaWidth = context.measureText(mantissa).width;
  context.fillText(mantissa, left, y);

  setFont(context, font, SUPERSCRIPT_SCALE);
  context.fillText(String(value.exponent), left + mantissaWidth, y - font.size * SUPERSCRIPT_RISE);
}
