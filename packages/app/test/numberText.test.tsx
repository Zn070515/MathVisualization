/**
 * Numbers, written for a reader.
 *
 * The interesting case is the scientific one, and the interesting question is
 * what happens to the value when it is written as a superscript. A superscript is
 * a *layout*, not a character: the text content of `2×10` followed by a raised
 * `8` is `2×108`, and the boundary between the mantissa and the exponent is gone.
 *
 * That is not a defect to be fixed by dropping the superscript — the exponent is
 * genuinely set in smaller type, which is the whole reason the core returns a
 * structured number instead of a string. It is a defect to be *known*, so the
 * value is also carried on the label and in the title, and this file pins both
 * halves: the visual form, and the fact that text content alone cannot recover
 * the number.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import {
  cx,
  displayComplex,
  displayComplexToText,
  displayNumber,
  displayNumberToText,
  type DisplayComplex,
} from '@mathviz/mathcore';
import { ComplexText, NumberText } from '../src/display/NumberText';

beforeEach(() => {
  cleanup();
});

describe('a real number', () => {
  it('writes a decimal as itself, so text content is the number', () => {
    const { container } = render(
      <NumberText value={displayNumber(0.9272952180016122, { digits: 5 })} />,
    );
    expect(container.textContent).toBe('0.9273');
  });

  it('writes a whole number as itself', () => {
    const { container } = render(<NumberText value={displayNumber(4)} />);
    expect(container.textContent).toBe('4');
  });

  it('reports a value that does not exist rather than spelling NaN', () => {
    const { container } = render(<NumberText value={displayNumber(NaN)} />);
    expect(container.textContent).toBe('undefined');
  });

  it('writes an infinity as a mathematical symbol', () => {
    expect(render(<NumberText value={displayNumber(Infinity)} />).container.textContent).toBe('∞');
    expect(render(<NumberText value={displayNumber(-Infinity)} />).container.textContent).toBe(
      '-∞',
    );
  });
});

describe('a number written as a magnitude', () => {
  it('sets the exponent in smaller type', () => {
    const { container } = render(<NumberText value={displayNumber(2e8)} />);
    expect(container.querySelector('sup')?.textContent).toBe('8');
    expect(container.textContent).toBe('2×108');
  });

  it('keeps the value recoverable, because text content cannot carry it', () => {
    const { container } = render(<NumberText value={displayNumber(2e8)} />);
    const element = container.querySelector('.number');
    expect(element?.getAttribute('aria-label')).toBe('2×10^8');
    expect(element?.getAttribute('title')).toBe('2×10^8');
  });

  it('carries the unambiguous text on the label, for every magnitude it typesets', () => {
    for (const value of [2e8, 1.5e-12, -3.25e7]) {
      const number = displayNumber(value);
      const element = render(<NumberText value={number} />).container.querySelector('.number');
      expect(element?.getAttribute('aria-label')).toBe(displayNumberToText(number));
      // The label is the plain projection with a caret, not the visual form, so
      // the exponent cannot be read as part of the mantissa.
      expect(element?.getAttribute('aria-label')).toContain('×10^');
    }
  });

  it('writes a negative exponent with its sign', () => {
    const { container } = render(<NumberText value={displayNumber(0.0000234)} />);
    expect(container.querySelector('sup')?.textContent).toBe('-5');
    expect(container.textContent).toBe('2.34×10-5');
  });
});

describe('a complex number', () => {
  const written = (re: number, im: number): string =>
    render(<ComplexText value={displayComplex(cx(re, im))} />).container.textContent ?? '';

  it('writes the forms mathematics is written in', () => {
    expect(written(2, 0)).toBe('2');
    expect(written(0, 2)).toBe('2i');
    expect(written(0, -1.5)).toBe('-1.5i');
    expect(written(3, 4)).toBe('3 + 4i');
    expect(written(1, -1)).toBe('1 - i');
  });

  it('drops the coefficient of i when it is one', () => {
    expect(written(0, 1)).toBe('i');
    expect(written(0, -1)).toBe('-i');
    expect(written(3, 1)).toBe('3 + i');
  });

  it('reports a value that does not exist as undefined', () => {
    expect(written(NaN, NaN)).toBe('undefined');
  });

  it('says the same thing as the string projection, for every value it can', () => {
    // The two projections — one to text, one to elements — each decide where the
    // sign goes and when to drop a coefficient of one. They must not drift, and
    // this is the assertion that would catch it. The comparison stops at values
    // whose exponent is typeset, because that is the one case where the element
    // form deliberately cannot agree.
    const values: readonly [number, number][] = [
      [2, 0],
      [0, 2],
      [0, -1],
      [3, 4],
      [1, -1],
      [0, 0],
      [NaN, NaN],
      [-12.5, 0.25],
    ];
    for (const [re, im] of values) {
      const structured: DisplayComplex = displayComplex(cx(re, im));
      expect(written(re, im)).toBe(displayComplexToText(structured));
    }
  });
});
