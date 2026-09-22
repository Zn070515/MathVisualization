/**
 * Getting a canvas ready to draw on.
 *
 * Every CPU view needs the same four things before it can put a mark down, and
 * all three of them were computing them by hand in a block that had been copied
 * verbatim — including the one line that matters most and is easiest to forget:
 * the backing store must be sized from the *CSS* box times the device pixel
 * ratio, or the picture is blurry on a high-density display.
 *
 * The ratio is capped at 2. A 3× or 4× buffer costs nine to sixteen times the
 * pixels of the CSS box for a difference nobody can see on a line drawing.
 */

/**
 * The colours a canvas draws with.
 *
 * A canvas cannot read a CSS custom property, so these are written out. They
 * mirror `styles/tokens.css` and a change there has to be made here too, which is
 * the price of drawing into a bitmap instead of into the document. The
 * alternative — `getComputedStyle` on every frame — buys a style recalculation
 * per draw for values that only change when somebody edits a stylesheet.
 */
export const CANVAS_COLORS = {
  /** --paper-raised: the sheet the CPU views are drawn on. */
  paper: '#fdfcfa',
  /** --paper-grid: the finest line that still reads as a line. */
  gridMinor: 'rgba(25, 23, 20, 0.055)',
  gridMajor: 'rgba(25, 23, 20, 0.1)',
  /** The axes themselves, which must read as structure and not as data. */
  axis: 'rgba(25, 23, 20, 0.32)',
  /** --ink-soft: the faintest ink that still clears 4.6:1 on paper. */
  tickLabel: '#4f4a43',
  /** --ink-muted: quieter still, because an axis *name* is not a value. */
  axisName: '#6c665d',
  /** --ink: the curve. */
  curve: '#191714',
  /** --accent: the second curve, and the shared cursor. */
  curveSecondary: '#ab2f1c',
  cursor: 'rgba(171, 47, 28, 0.5)',
} as const;

/**
 * The families a canvas draws text in.
 *
 * Mirrors `--font-math` and `--font-label` for the same reason as the colours
 * above. Numbers are set in the mathematical face, where digits and minus signs
 * have the right shapes and widths; the axis names are labels, so they get the
 * instrument-like monospace.
 */
export const CANVAS_FONTS = {
  math: "'Cambria Math', 'STIX Two Math', 'Latin Modern Math', 'Cambria', Georgia, serif",
  label: "'Cascadia Mono', 'Consolas', 'SF Mono', 'DejaVu Sans Mono', ui-monospace, monospace",
} as const;

/** The ratio is capped here; see the note above. */
export const MAX_PIXEL_RATIO = 2;

export interface PixelSize {
  /** Backing-store width in device pixels. */
  readonly width: number;
  /** Backing-store height in device pixels. */
  readonly height: number;
  readonly ratio: number;
}

/**
 * The backing-store size an element's CSS box calls for.
 *
 * Separate from assigning it, because the field view hands the numbers to the
 * WebGL renderer and lets *it* size the canvas.
 */
export function pixelSize(element: Element): PixelSize {
  const bounds = element.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
  return {
    width: Math.max(1, Math.round(bounds.width * ratio)),
    height: Math.max(1, Math.round(bounds.height * ratio)),
    ratio,
  };
}

export interface CanvasSurface extends PixelSize {
  readonly context: CanvasRenderingContext2D;
}

export interface PrepareOptions {
  /**
   * Whether to lay the paper down, or to leave the canvas transparent.
   *
   * A view that is the only thing in its pane wants the paper. A view stacked over
   * another — the labels over a WebGL surface — must be transparent, or it hides
   * the layer beneath it.
   */
  readonly fill?: boolean;
}

/**
 * Size a canvas for its CSS box, clear the transform, and lay down the paper.
 *
 * Returns null when there is no 2D context, which is how the views discover they
 * are running somewhere that cannot draw — a test environment, most often.
 */
export function prepareCanvas2d(
  canvas: HTMLCanvasElement,
  options: PrepareOptions = {},
): CanvasSurface | null {
  const context = canvas.getContext('2d');
  if (context === null) return null;

  const { width, height, ratio } = pixelSize(canvas);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  // A resized canvas keeps its transform, so a rotation or scale set by a
  // previous draw would otherwise accumulate.
  context.setTransform(1, 0, 0, 1, 0, 0);
  if (options.fill === false) {
    context.clearRect(0, 0, width, height);
  } else {
    context.fillStyle = CANVAS_COLORS.paper;
    context.fillRect(0, 0, width, height);
  }

  return { context, width, height, ratio };
}
