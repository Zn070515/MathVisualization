/**
 * Where the ticks on an axis go, and what they say.
 *
 * The claim being tested is not "the numbers look round". It is the pair of
 * properties that make a numbered axis trustworthy:
 *
 * - the tick labelled `0.3` is *at* 0.3, and not one rounding step away from it;
 * - the ticks do not drift, so the gap between the first and last tick is the
 *   number of steps it should be.
 *
 * The second one is why the implementation multiplies an index by the step
 * instead of adding the step repeatedly, and it is the property a naive loop
 * fails after a few dozen iterations.
 */
import { describe, expect, it } from 'vitest';
import { TICK_STEP } from '../src/conventions';
import { displayNumberToText } from '../src/display';
import {
  axisTicks,
  decimalsForStep,
  minorStepFor,
  niceStep,
  ticksInRange,
  type Tick,
} from '../src/ticks';

/**
 * The spacing the field view computed before this module existed, kept verbatim
 * as the reference the generalised rule has to reproduce.
 *
 * The fragment shader receives `niceStep`'s answer as its grid spacing, so if
 * these two ever disagree the GPU grid and the numbered ticks would disagree
 * about where a unit is — silently, and only visibly as a grid that looks
 * slightly wrong.
 */
function legacyGridSpacing(halfWidth: number): number {
  const target = halfWidth / 5;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const normalized = target / magnitude;
  const step = normalized < 1.5 ? 1 : normalized < 3.5 ? 2 : 5;
  return step * magnitude;
}

/** Read an axis's labels in order. */
function labelsOf(ticks: readonly Tick[]): string[] {
  return ticks.map((tick) => displayNumberToText(tick.label));
}

describe('a round step', () => {
  it('lands on 1, 2 or 5 times a power of ten', () => {
    for (const span of [0.003, 0.07, 0.4, 1, 3.5, 12, 90, 640, 5000, 123456]) {
      const step = niceStep(span);
      const leading = step / 10 ** Math.floor(Math.log10(step));
      expect([1, 2, 5]).toContain(Math.round(leading));
    }
  });

  it('reproduces the spacing the shader grid was built on', () => {
    // The generalisation must not move the grid. Compared as a ratio so the
    // check is the same claim at every magnitude.
    const halfWidths = [
      0.002, 0.01, 0.05, 0.1, 0.24, 0.5, 1, 1.5, 2, 2.4, 3, 4, 5, 7.5, 10, 24, 100, 1000, 1e4,
    ];
    for (const halfWidth of halfWidths) {
      const generalised = niceStep(halfWidth * 2, TICK_STEP.targetMajorTicks);
      expect(generalised / legacyGridSpacing(halfWidth)).toBeCloseTo(1, 12);
    }
  });

  it('fits about ten major ticks across a window', () => {
    for (const span of [0.5, 1, 2, 5, 12, 100, 1234]) {
      expect(axisTicks(0, span).major.length).toBeGreaterThanOrEqual(4);
      expect(axisTicks(0, span).major.length).toBeLessThanOrEqual(21);
    }
  });

  it('has an answer for a window it cannot make sense of', () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(-1)).toBe(1);
    expect(niceStep(NaN)).toBe(1);
    expect(niceStep(Infinity)).toBe(1);
    expect(niceStep(1, 0)).toBe(1);
  });
});

describe('the subdivision of a step', () => {
  it('divides a 1 or 5 step into five', () => {
    expect(minorStepFor(1)).toBeCloseTo(0.2, 12);
    expect(minorStepFor(5)).toBeCloseTo(1, 12);
    expect(minorStepFor(0.1)).toBeCloseTo(0.02, 12);
  });

  it('divides a 2 step into four, so the minors land on halves and not on 0.4', () => {
    // Fifths of 2 are 0.4, which nobody uses to read a grid drawn at 2.
    expect(minorStepFor(2)).toBeCloseTo(0.5, 12);
    expect(minorStepFor(0.2)).toBeCloseTo(0.05, 12);
  });
});

describe('decimal places for a step', () => {
  it('gives a whole step no decimals and a fractional one what it needs', () => {
    expect(decimalsForStep(1)).toBe(0);
    expect(decimalsForStep(2)).toBe(0);
    expect(decimalsForStep(5)).toBe(0);
    expect(decimalsForStep(0.5)).toBe(1);
    expect(decimalsForStep(0.2)).toBe(1);
    expect(decimalsForStep(0.05)).toBe(2);
    expect(decimalsForStep(0.01)).toBe(2);
    expect(decimalsForStep(1e-5)).toBe(5);
  });
});

describe('the ticks of an axis', () => {
  it('places every tick at index × step, so the label is the coordinate', () => {
    // The point of the whole module. A running total would put the fourth tick
    // at 0.30000000000000004 and label it as such.
    expect(labelsOf(axisTicks(0, 1).major)).toEqual([
      '0',
      '0.1',
      '0.2',
      '0.3',
      '0.4',
      '0.5',
      '0.6',
      '0.7',
      '0.8',
      '0.9',
      '1',
    ]);
  });

  it('writes the labels of a known window', () => {
    const axis = axisTicks(-2, 2);
    expect(axis.step).toBeCloseTo(0.5, 12);
    expect(labelsOf(axis.major)).toEqual(['-2', '-1.5', '-1', '-0.5', '0', '0.5', '1', '1.5', '2']);
  });

  it('reaches the edge of the window even when the division says otherwise', () => {
    // -2 / 0.1 is -19.999999999999996, so a plain ceil would start the minor
    // ladder one tick inside the frame.
    const axis = axisTicks(-2, 2);
    const values = axis.minor.map((tick) => tick.value);
    expect(values[0]).toBeCloseTo(-2, 12);
    expect(values[values.length - 1]).toBeCloseTo(2, 12);
    expect(axis.minor.length).toBe(41);
  });

  it('carries every major tick in the minor ladder, so the grid and the numbers agree', () => {
    const axis = axisTicks(-2, 2);
    for (const major of axis.major) {
      expect(axis.minor.some((minor) => Math.abs(minor.value - major.value) < 1e-12)).toBe(true);
    }
  });

  it('increases and never repeats', () => {
    const axis = axisTicks(-3.7, 12.4);
    const values = axis.major.map((tick) => tick.value);
    // Sorted-and-unchanged plus no repeats is exactly "strictly increasing".
    expect(values).toEqual([...values].sort((left, right) => left - right));
    expect(new Set(values).size).toBe(values.length);
    expect(new Set(labelsOf(axis.major)).size).toBe(axis.major.length);
  });

  it('returns nothing rather than a million lines for a step too fine to be a grid', () => {
    expect(ticksInRange(0, 1000, 1e-6)).toEqual([]);
  });

  it('returns nothing for a window that is not a window', () => {
    expect(ticksInRange(2, -2, 0.5)).toEqual([]);
    expect(ticksInRange(0, 1, 0)).toEqual([]);
    expect(ticksInRange(0, 1, -0.5)).toEqual([]);
    expect(ticksInRange(0, 1, NaN)).toEqual([]);
    expect(ticksInRange(NaN, 1, 0.5)).toEqual([]);
  });

  it('still returns a tick that is only just inside the window', () => {
    const ticks = ticksInRange(0.999, 1.001, 0.5);
    expect(ticks.map((tick) => tick.value)).toEqual([1]);
  });
});
