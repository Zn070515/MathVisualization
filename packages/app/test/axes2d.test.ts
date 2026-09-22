/**
 * Which axis labels survive.
 *
 * The decision of whether two labels collide is arithmetic on measured widths,
 * which is exactly the kind of thing that should not need a canvas to test — and
 * cannot be tested through one here, because jsdom has no 2D context at all.
 *
 * So the rule is a pure function and this tests the rule. What it does *not*
 * cover is whether the widths passed in are the real ones; that is the axis
 * drawing's job, and it is checked in a browser.
 */
import { describe, expect, it } from 'vitest';
import { readableLabels } from '../src/render/axes2d';

/** Labels all of the same width. */
const fixed = (width: number) => (): number => width;

describe('choosing the labels that fit', () => {
  it('keeps all of them when they all fit', () => {
    expect(readableLabels([0, 100, 200, 300], (value) => value, fixed(30), 8)).toEqual([
      0, 100, 200, 300,
    ]);
  });

  it('drops one that would collide, and resumes as soon as there is room again', () => {
    // Positions every 30 pixels, labels 40 wide: each one spans its centre ±20,
    // so consecutive labels overlap. The one after a dropped label is kept.
    expect(readableLabels([0, 30, 60, 90], (value) => value, fixed(40), 8)).toEqual([0, 60]);
  });

  it('takes the width it is given rather than assuming one', () => {
    // The same positions, and the same rule, reach different answers — which is
    // the point of measuring instead of guessing.
    expect(readableLabels([0, 50], (value) => value, fixed(20), 8)).toEqual([0, 50]);
    expect(
      readableLabels(
        [0, 50],
        (value) => value,
        (value) => (value === 0 ? 20 : 200),
        8,
      ),
    ).toEqual([0]);
  });

  it('honours the gap it is given', () => {
    // Adjacent boxes that touch exactly: kept when no gap is demanded, dropped
    // when one is.
    expect(readableLabels([0, 40], (value) => value, fixed(40), 0)).toEqual([0, 40]);
    expect(readableLabels([0, 40], (value) => value, fixed(40), 8)).toEqual([0]);
  });

  it('has an answer for an axis with no ticks', () => {
    expect(readableLabels([], (value: number) => value, fixed(20))).toEqual([]);
  });

  it('thins a long run rather than keeping only the first', () => {
    expect(readableLabels([0, 30, 60, 90, 120], (value) => value, fixed(40), 8)).toEqual([
      0, 60, 120,
    ]);
  });

  it('does not care which order the labels arrive in', () => {
    // The regression this exists for. A vertical axis hands its ticks over in
    // increasing *value*, which is decreasing *pixels* — so a pass that trusted
    // the incoming order kept the first label and dropped every other one, and
    // the axis came out with a single number on it. Feeding the same positions
    // in the opposite order must select the same labels.
    const ascending = readableLabels([0, 30, 60, 90, 120], (value) => value, fixed(40), 8);
    const descending = readableLabels([120, 90, 60, 30, 0], (value) => value, fixed(40), 8);
    expect(ascending).toEqual([0, 60, 120]);
    expect(descending).toEqual([0, 60, 120]);
  });

  it('thins a vertical axis the same way, from the top down', () => {
    // Rows as a screen gives them: a larger value is higher up, which is a
    // smaller row number. This is the shape that used to fail.
    const rows = (value: number): number => 400 - value;
    // 120 sits at row 280 and 40 at row 360; the two between them do not fit.
    expect(readableLabels([0, 40, 80, 120], rows, fixed(50), 8)).toEqual([120, 40]);
  });
});
