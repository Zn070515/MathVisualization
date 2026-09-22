/**
 * Domain coloring: the mapping from a complex value to a colour.
 *
 * This is a *convention*, not an implementation detail, which is why it lives in
 * the mathematical core next to the other conventions rather than inside a
 * renderer. Two implementations of it exist — this one on the CPU and
 * `colorForValue` in the shader prelude — and they must agree. Having a single
 * documented definition is what makes that agreement checkable: the test suite
 * asserts this function's output, and the browser verification samples the
 * shader and compares the two.
 *
 * The recipe (recorded in `CONVENTIONS`/`DOMAIN_COLORING`):
 *
 * - Hue is the argument, mapped from (-π, π] onto a full turn.
 * - Brightness follows the modulus on a logarithmic scale, completing one cycle
 *   per octave of |w|. Both the octave boundaries and the mid-octave peak are
 *   visible, so a zero and a pole look different from a smooth passage through.
 * - Zeros are black, poles are white, undefined points are flat grey. Those
 *   three cases are the ones where colour would otherwise lie, so they are
 *   handled before the hue is computed at all.
 * - Optional phase contours darken the lines where the argument is a multiple of
 *   π/2, which makes the winding of the map readable.
 */
import { type Complex, cabs, principalArg } from './complex';
import { type DomainColoringOptions, DEFAULT_DOMAIN_COLORING } from './conventions';

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const WHITE: Rgb = { r: 1, g: 1, b: 1 };
const UNDEFINED_GREY: Rgb = { r: 0.5, g: 0.5, b: 0.5 };

/** Brightness at an octave boundary, i.e. where |w| is a power of two. */
const OCTAVE_BOUNDARY_BRIGHTNESS = 0.35;

/** Brightness in the middle of an octave, i.e. where |w| is √2 times a power of two. */
const OCTAVE_PEAK_BRIGHTNESS = 1;

/** Brightness when the modulus bands are switched off. */
const FLAT_BRIGHTNESS = 0.75;

/** Saturation of the phase hue. */
const SATURATION = 0.8;

/** Half-width of the phase contours, as a fraction of the full turn. */
const PHASE_CONTOUR_WIDTH = 0.08;

/** How much a phase contour darkens the colour. */
const PHASE_CONTOUR_DARKENING = 0.6;

/** Fractional part, defined as in GLSL `fract` so both implementations agree. */
export function fract(x: number): number {
  return x - Math.floor(x);
}

/** Convert HSV (each in [0, 1]) to RGB. */
export function hsvToRgb(hue: number, saturation: number, value: number): Rgb {
  const sector = Math.floor(hue * 6);
  const fraction = hue * 6 - sector;
  const p = value * (1 - saturation);
  const q = value * (1 - fraction * saturation);
  const t = value * (1 - (1 - fraction) * saturation);

  switch (((sector % 6) + 6) % 6) {
    case 0:
      return { r: value, g: t, b: p };
    case 1:
      return { r: q, g: value, b: p };
    case 2:
      return { r: p, g: value, b: t };
    case 3:
      return { r: p, g: q, b: value };
    case 4:
      return { r: t, g: p, b: value };
    default:
      return { r: value, g: p, b: q };
  }
}

/** Brightness for a modulus, before any phase contours are applied. */
export function brightnessForModulus(magnitude: number, bands: boolean): number {
  if (!bands) return FLAT_BRIGHTNESS;
  const octavePosition = fract(Math.log2(magnitude));
  const triangle = 1 - Math.abs(2 * octavePosition - 1);
  return OCTAVE_BOUNDARY_BRIGHTNESS + (OCTAVE_PEAK_BRIGHTNESS - OCTAVE_BOUNDARY_BRIGHTNESS) * triangle;
}

/**
 * Colour a complex value.
 *
 * Undefined values are checked first: NaN becomes grey, an infinite modulus
 * becomes white, and an exact zero becomes black. Only a value that is an
 * ordinary complex number gets a hue.
 */
export function domainColor(
  value: Complex,
  options: DomainColoringOptions = DEFAULT_DOMAIN_COLORING,
): Rgb {
  if (Number.isNaN(value.re) || Number.isNaN(value.im)) return UNDEFINED_GREY;
  if (!Number.isFinite(value.re) || !Number.isFinite(value.im)) return WHITE;

  const magnitude = cabs(value);
  if (magnitude === 0) return BLACK;
  if (!Number.isFinite(magnitude)) return WHITE;

  const argument = principalArg(value);
  const hue = (argument + Math.PI) / (2 * Math.PI);

  let brightness = brightnessForModulus(magnitude, options.modulusBands);
  if (options.phaseContours && Math.abs(Math.sin(2 * argument)) < PHASE_CONTOUR_WIDTH) {
    brightness *= PHASE_CONTOUR_DARKENING;
  }

  return hsvToRgb(hue, SATURATION, brightness);
}

/** `rgb(...)` string for a colour, for use in stylesheets and SVG. */
export function rgbToCss(color: Rgb): string {
  const channel = (component: number): number => Math.round(Math.min(1, Math.max(0, component)) * 255);
  return `rgb(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)})`;
}

// ---------------------------------------------------------------------------
// Scalar field colouring
// ---------------------------------------------------------------------------

/**
 * How a complex-valued function is turned into a picture.
 *
 * `complex` is domain colouring, which uses both the argument and the modulus.
 * The others project one real quantity, which is what a scalar field view shows.
 */
export type FieldMode = 'complex' | 'magnitude' | 'phase' | 'real' | 'imaginary';

export const FIELD_MODES: readonly FieldMode[] = [
  'complex',
  'magnitude',
  'phase',
  'real',
  'imaginary',
];

export const FIELD_MODE_LABELS: Readonly<Record<FieldMode, string>> = {
  complex: 'Domain colouring',
  magnitude: 'Magnitude |w|',
  phase: 'Phase arg w',
  real: 'Real part Re w',
  imaginary: 'Imaginary part Im w',
};

/** Short descriptions shown alongside the mode selector. */
export const FIELD_MODE_DESCRIPTIONS: Readonly<Record<FieldMode, string>> = {
  complex: 'Argument as hue, modulus as brightness',
  magnitude: 'The modulus, on a logarithmic scale',
  phase: 'The principal argument, over (-π, π]',
  real: 'The real part as a scalar field',
  imaginary: 'The imaginary part as a scalar field',
};

/** Index used by the shader's mode uniform. Kept in step with the array above. */
export const FIELD_MODE_INDEX: Readonly<Record<FieldMode, number>> = {
  complex: 0,
  magnitude: 1,
  phase: 2,
  real: 3,
  imaginary: 4,
};

/** Inclusive range of a real quantity over the region being displayed. */
export interface ScalarRange {
  readonly min: number;
  readonly max: number;
}

export const DEFAULT_SCALAR_RANGE: ScalarRange = { min: -1, max: 1 };

/**
 * The colour ramp for scalar fields: the viridis palette.
 *
 * Chosen because its lightness increases monotonically along the ramp, so the
 * value is readable from luminance alone. That matters for accessibility: where a
 * scalar field is shown, no information is carried by hue by itself, and the same
 * reading is available to a viewer who cannot distinguish the hues (GOAL.md 19).
 *
 * This table is the single source of truth for the ramp. `glsl.ts` generates the
 * shader's copy from it, so the two cannot drift.
 */
export const SCALAR_RAMP: readonly { readonly t: number; readonly rgb: Rgb }[] = [
  { t: 0, rgb: { r: 0.267, g: 0.005, b: 0.329 } },
  { t: 0.142857, rgb: { r: 0.278, g: 0.176, b: 0.484 } },
  { t: 0.285714, rgb: { r: 0.231, g: 0.322, b: 0.545 } },
  { t: 0.428571, rgb: { r: 0.173, g: 0.443, b: 0.557 } },
  { t: 0.571429, rgb: { r: 0.129, g: 0.565, b: 0.551 } },
  { t: 0.714286, rgb: { r: 0.157, g: 0.686, b: 0.502 } },
  { t: 0.857143, rgb: { r: 0.369, g: 0.788, b: 0.383 } },
  { t: 1, rgb: { r: 0.993, g: 0.906, b: 0.144 } },
];

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Sample the ramp at a position in [0, 1], interpolating between stops. */
export function scalarRamp(t: number): Rgb {
  const position = clamp01(t);
  let index = 0;
  for (let i = 0; i < SCALAR_RAMP.length - 1; i += 1) {
    const stop = SCALAR_RAMP[i];
    if (stop !== undefined && position >= stop.t) index = i;
  }
  const lower = SCALAR_RAMP[index];
  const upper = SCALAR_RAMP[index + 1];
  if (lower === undefined || upper === undefined) return { r: 0, g: 0, b: 0 };

  const span = upper.t - lower.t;
  const local = span > 0 ? clamp01((position - lower.t) / span) : 0;
  return {
    r: lower.rgb.r + (upper.rgb.r - lower.rgb.r) * local,
    g: lower.rgb.g + (upper.rgb.g - lower.rgb.g) * local,
    b: lower.rgb.b + (upper.rgb.b - lower.rgb.b) * local,
  };
}

/**
 * Normalise a real quantity to [0, 1] for the ramp.
 *
 * Each mode has its own mapping, and the shader reproduces these exactly:
 *
 * - `magnitude` uses `log(1 + |w|)`, so that a function with a few very large
 *   values does not flatten everywhere else. `log` rather than `log1p` because
 *   GLSL has no `log1p`; the CPU reference uses the same formula so the two
 *   agree.
 * - `phase` maps `(-pi, pi]` onto `[0, 1]` and ignores the range, since the
 *   argument's range is known in advance.
 * - `real` and `imaginary` map the sampled range linearly.
 */
export function normalizeScalar(value: number, mode: FieldMode, range: ScalarRange): number {
  switch (mode) {
    case 'complex':
      return 0.5;
    case 'phase':
      return clamp01((value + Math.PI) / (2 * Math.PI));
    case 'magnitude': {
      const scale = Math.log(1 + Math.max(0, range.max));
      if (!(scale > 0)) return 0.5;
      return clamp01(Math.log(1 + Math.max(0, value)) / scale);
    }
    case 'real':
    case 'imaginary': {
      const span = range.max - range.min;
      if (!(span > 0)) return 0.5;
      return clamp01((value - range.min) / span);
    }
  }
}

/**
 * Colour a value according to the selected mode.
 *
 * Undefined values are grey and infinite ones white in every mode, so a
 * singularity never looks like a large finite number.
 */
export function fieldColor(
  value: Complex,
  mode: FieldMode,
  range: ScalarRange = DEFAULT_SCALAR_RANGE,
): Rgb {
  if (Number.isNaN(value.re) || Number.isNaN(value.im)) return UNDEFINED_GREY;
  if (!Number.isFinite(value.re) || !Number.isFinite(value.im)) return WHITE;
  if (mode === 'complex') return domainColor(value, DEFAULT_DOMAIN_COLORING);

  const scalar =
    mode === 'magnitude'
      ? cabs(value)
      : mode === 'phase'
        ? principalArg(value)
        : mode === 'real'
          ? value.re
          : value.im;

  return scalarRamp(normalizeScalar(scalar, mode, range));
}

