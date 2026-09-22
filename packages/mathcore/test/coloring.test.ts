/**
 * Domain-colouring tests.
 *
 * These pin down the colouring convention. The shader must reproduce it, so a
 * change here is a change to the shader prelude and to the documentation too.
 */
import { describe, expect, it } from 'vitest';
import { cx } from '../src/complex';
import { DEFAULT_DOMAIN_COLORING } from '../src/conventions';
import {
  DEFAULT_SCALAR_RANGE,
  FIELD_MODES,
  SCALAR_RAMP,
  brightnessForModulus,
  domainColor,
  fieldColor,
  fract,
  hsvToRgb,
  normalizeScalar,
  rgbToCss,
  scalarRamp,
} from '../src/coloring';
import { expectCloseTo } from './helpers';

const options = DEFAULT_DOMAIN_COLORING;

describe('fractional part', () => {
  it('matches the definition used in the shader', () => {
    expect(fract(0.25)).toBeCloseTo(0.25, 12);
    expect(fract(1.25)).toBeCloseTo(0.25, 12);
    // Negative values wrap upwards, as GLSL fract does, rather than towards zero.
    expect(fract(-0.25)).toBeCloseTo(0.75, 12);
  });
});

describe('hsv conversion', () => {
  it('produces the primary colours at full saturation', () => {
    expect(hsvToRgb(0, 1, 1)).toEqual({ r: 1, g: 0, b: 0 });
    expect(hsvToRgb(1 / 3, 1, 1)).toEqual({ r: 0, g: 1, b: 0 });
    expect(hsvToRgb(2 / 3, 1, 1)).toEqual({ r: 0, g: 0, b: 1 });
  });

  it('produces white at zero saturation and black at zero value', () => {
    expect(hsvToRgb(0.3, 0, 1)).toEqual({ r: 1, g: 1, b: 1 });
    expect(hsvToRgb(0.3, 1, 0)).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe('the three cases that are not an ordinary complex number', () => {
  it('draws a zero of the function as black', () => {
    expect(domainColor(cx(0, 0), options)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('draws a pole as white', () => {
    expect(domainColor(cx(Infinity, 0), options)).toEqual({ r: 1, g: 1, b: 1 });
    expect(domainColor(cx(-Infinity, Infinity), options)).toEqual({ r: 1, g: 1, b: 1 });
  });

  it('draws an undefined point as a flat grey, distinct from black', () => {
    const grey = domainColor(cx(NaN, NaN), options);
    expect(grey).toEqual({ r: 0.5, g: 0.5, b: 0.5 });
    expect(grey).not.toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe('hue follows the argument', () => {
  // The convention is h = (Arg w + pi) / 2pi, so the argument is shifted by half
  // a turn before being mapped onto the colour wheel. The point of these tests is
  // to record, in executable form, which direction gets which colour.
  it('puts the positive real axis at cyan', () => {
    const cyan = domainColor(cx(1, 0), options);
    expect(cyan.g).toBeGreaterThan(cyan.r);
    expect(cyan.b).toBeGreaterThan(cyan.r);
  });

  it('puts the negative real axis at red, half a turn away', () => {
    const red = domainColor(cx(-1, 0), options);
    expect(red.r).toBeGreaterThan(red.g);
    expect(red.r).toBeGreaterThan(red.b);
  });

  it('puts the positive imaginary axis at blue', () => {
    const blue = domainColor(cx(0, 1), options);
    expect(blue.b).toBeGreaterThan(blue.r);
    expect(blue.b).toBeGreaterThan(blue.g);
  });

  it('puts the negative imaginary axis at green', () => {
    const green = domainColor(cx(0, -1), options);
    expect(green.g).toBeGreaterThan(green.r);
    expect(green.g).toBeGreaterThan(green.b);
  });

  it('gives opposite arguments different colours', () => {
    expect(domainColor(cx(0.5, 0.5), options)).not.toEqual(domainColor(cx(-0.5, -0.5), options));
  });
});

describe('brightness follows the modulus', () => {
  it('cycles once per octave', () => {
    // Brightness is a triangle wave in log2|w|: lowest at exact powers of two,
    // highest half an octave later.
    const boundary = brightnessForModulus(1, true);
    const peak = brightnessForModulus(Math.SQRT2, true);
    expect(boundary).toBeLessThan(peak);
    expect(boundary).toBeCloseTo(0.35, 12);
    expect(peak).toBeCloseTo(1, 12);
  });

  it('repeats one octave later', () => {
    expectCloseTo(brightnessForModulus(3, true), brightnessForModulus(6, true));
  });

  it('is flat when the bands are switched off', () => {
    expect(brightnessForModulus(1, false)).toBeCloseTo(0.75, 12);
    expect(brightnessForModulus(1000, false)).toBeCloseTo(0.75, 12);
  });
});

describe('phase contours', () => {
  it('darkens the lines where the argument is a multiple of pi/2', () => {
    const withoutContours = domainColor(cx(1, 0), { phaseContours: false, modulusBands: true });
    const withContours = domainColor(cx(1, 0), { phaseContours: true, modulusBands: true });
    expect(withContours.r).toBeLessThan(withoutContours.r);
  });

  it('leaves a general direction alone', () => {
    const angle = 0.7;
    const value = cx(Math.cos(angle), Math.sin(angle));
    const withoutContours = domainColor(value, { phaseContours: false, modulusBands: true });
    const withContours = domainColor(value, { phaseContours: true, modulusBands: true });
    expect(withContours).toEqual(withoutContours);
  });
});

describe('css output', () => {
  it('converts to a css colour', () => {
    expect(rgbToCss({ r: 1, g: 0.5, b: 0 })).toBe('rgb(255, 128, 0)');
  });
});

describe('the scalar ramp', () => {
  it('reproduces the endpoint colours of the table', () => {
    expect(scalarRamp(0)).toEqual(SCALAR_RAMP[0]?.rgb);
    expect(scalarRamp(1)).toEqual(SCALAR_RAMP[SCALAR_RAMP.length - 1]?.rgb);
  });

  it('clamps outside the unit interval', () => {
    expect(scalarRamp(-5)).toEqual(scalarRamp(0));
    expect(scalarRamp(5)).toEqual(scalarRamp(1));
  });

  it('increases in lightness along the ramp', () => {
    // The reason this palette was chosen: the value is readable from luminance
    // alone, so nothing is carried by hue by itself.
    let previous = -1;
    for (let step = 0; step <= 10; step += 1) {
      const color = scalarRamp(step / 10);
      const lightness = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
      expect(lightness).toBeGreaterThan(previous);
      previous = lightness;
    }
  });
});

describe('normalising a scalar for the ramp', () => {
  it('maps the phase onto the full turn', () => {
    expect(normalizeScalar(-Math.PI, 'phase', DEFAULT_SCALAR_RANGE)).toBeCloseTo(0, 12);
    expect(normalizeScalar(0, 'phase', DEFAULT_SCALAR_RANGE)).toBeCloseTo(0.5, 12);
    expect(normalizeScalar(Math.PI, 'phase', DEFAULT_SCALAR_RANGE)).toBeCloseTo(1, 12);
  });

  it('maps the modulus logarithmically against its maximum', () => {
    const range = { min: 0, max: 100 };
    expect(normalizeScalar(0, 'magnitude', range)).toBeCloseTo(0, 12);
    expect(normalizeScalar(100, 'magnitude', range)).toBeCloseTo(1, 12);
    // Halfway in log space, not in value space.
    const geometricMiddle = Math.sqrt(1 * 101) - 1;
    expect(normalizeScalar(geometricMiddle, 'magnitude', range)).toBeCloseTo(
      Math.log(1 + geometricMiddle) / Math.log(101),
      12,
    );
  });

  it('maps a signed quantity linearly over its range', () => {
    const range = { min: -2, max: 2 };
    expect(normalizeScalar(-2, 'real', range)).toBeCloseTo(0, 12);
    expect(normalizeScalar(0, 'real', range)).toBeCloseTo(0.5, 12);
    expect(normalizeScalar(2, 'imaginary', range)).toBeCloseTo(1, 12);
  });

  it('degrades gracefully when the range has no extent', () => {
    expect(normalizeScalar(5, 'real', { min: 1, max: 1 })).toBe(0.5);
    expect(normalizeScalar(5, 'magnitude', { min: 0, max: 0 })).toBe(0.5);
  });
});

describe('colouring by mode', () => {
  it('agrees with domain colouring in the complex mode', () => {
    const value = cx(0.7, -0.4);
    expect(fieldColor(value, 'complex')).toEqual(domainColor(value, options));
  });

  it('shades the four scalar modes differently from one another', () => {
    const value = cx(0.7, -0.4);
    const range = { min: -1, max: 1 };
    const colors = (['magnitude', 'phase', 'real', 'imaginary'] as const).map((mode) =>
      fieldColor(value, mode, range),
    );
    const distinct = new Set(colors.map((color) => `${color.r},${color.g},${color.b}`));
    expect(distinct.size).toBe(4);
  });

  it('uses the top of the ramp for the largest value in the range', () => {
    expect(fieldColor(cx(2, 0), 'real', { min: -2, max: 2 })).toEqual(scalarRamp(1));
    expect(fieldColor(cx(-2, 0), 'real', { min: -2, max: 2 })).toEqual(scalarRamp(0));
  });

  it('shows an undefined value as grey in every mode', () => {
    for (const mode of FIELD_MODES) {
      expect(fieldColor(cx(NaN, NaN), mode)).toEqual({ r: 0.5, g: 0.5, b: 0.5 });
    }
  });

  it('shows an infinite value as white in every mode', () => {
    for (const mode of FIELD_MODES) {
      expect(fieldColor(cx(Infinity, 0), mode)).toEqual({ r: 1, g: 1, b: 1 });
    }
  });
});
