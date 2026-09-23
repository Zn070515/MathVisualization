/**
 * Readout tests.
 *
 * The readout is where the picture becomes mathematics, so what matters is that
 * the number shown is the value of the function at the shared cursor, and that a
 * point with no value is reported as undefined *with a reason* rather than as a
 * number or a blank.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { cx } from '@mathviz/mathcore';
import { makeStore, makeStoreFromLatex } from './helpers';
import { ReadoutBar } from '../src/readout/ReadoutBar';

/**
 * Read one labelled cell of the readout.
 *
 * Scoped by label rather than by text, because the same number legitimately
 * appears in more than one cell — f(2) = 4 has both a value of 4 and a modulus
 * of 4, and asserting on the bare text could not tell them apart.
 */
function readCell(container: HTMLElement, label: string): string {
  const labelElement = [...container.querySelectorAll('.readout__label')].find(
    (element) => element.textContent === label,
  );
  return labelElement?.parentElement?.querySelector('.readout__value')?.textContent ?? '';
}

beforeEach(() => {
  cleanup();
});

describe('with no cursor', () => {
  it('invites the reader to point at a view', () => {
    render(<ReadoutBar store={makeStore(['f(z)=z^2'])} />);
    expect(screen.getByText(/Move the pointer/)).toBeTruthy();
  });
});

describe('with a cursor', () => {
  it('reads the value of the drawn expression at the shared point', () => {
    const store = makeStore(['f(z)=z^2']);
    store.setHover(cx(2, 0));
    const { container } = render(<ReadoutBar store={store} />);

    // f(2) = 4
    expect(readCell(container, 'value')).toBe('4');
    expect(readCell(container, 'point')).toBe('2');
  });

  it('reads a genuinely complex value, with real and imaginary parts', () => {
    const store = makeStore(['f(z)=z^2']);
    store.setHover(cx(1, 1));
    const { container } = render(<ReadoutBar store={store} />);

    // (1+i)^2 = 2i, and a purely imaginary value prints as 2i rather than 0 + 2i.
    expect(readCell(container, 'value')).toBe('2i');
  });

  it('reports the modulus and the argument', () => {
    const store = makeStore(['f(z)=z']);
    store.setHover(cx(3, 4));
    const { container } = render(<ReadoutBar store={store} />);

    // |3 + 4i| = 5
    expect(readCell(container, '|w|')).toBe('5');
    expect(readCell(container, 'arg')).toBe('0.9273');
  });

  it('shows the colour the field view is painting, so the two are tied together', () => {
    const store = makeStore(['f(z)=z^2']);
    store.setHover(cx(1, 1));
    const { container } = render(<ReadoutBar store={store} />);

    const swatch = container.querySelector('.readout__swatch') as HTMLElement | null;
    expect(swatch).not.toBeNull();
    expect(swatch?.style.background).toMatch(/^rgb/);
  });

  it('follows the pointer until a point is held', () => {
    const store = makeStore(['f(z)=z^2']);
    store.setHover(cx(1, 0));
    render(<ReadoutBar store={store} />);
    expect(screen.getByText('following the pointer')).toBeTruthy();
  });

  it('says a point is held once it has been selected', () => {
    const store = makeStore(['f(z)=z^2']);
    store.setHover(cx(1, 0));
    store.setSelection(cx(1, 0));
    render(<ReadoutBar store={store} />);
    expect(screen.getByText('held')).toBeTruthy();
  });
});

describe('at a discrete Fourier frequency', () => {
  it('reports the same snapped bin used by the DFT view', () => {
    const store = makeStoreFromLatex(
      ['f(t)=1', 'D(\\omega)=\\operatorname{DFT}(f(t))'],
      'transforms',
    );
    store.focusLine(store.getState().lines[1]?.id as string);
    store.setFrequencyHover(0.03);
    const { container } = render(<ReadoutBar store={store} />);

    // The N=64 grid on [-8, 8] snaps 0.03 to the actual k=0 bin at ω=0.
    expect(readCell(container, 'k')).toBe('0');
    expect(readCell(container, 'signed k')).toBe('0');
    expect(readCell(container, 'ω')).toBe('0');
    expect(readCell(container, 'D[k]')).toBe('16');
    expect(readCell(container, '|D[k]|')).toBe('16');
    expect(readCell(container, 'Δt')).toBe('0.25');
    expect(readCell(container, 'alias representatives')).toContain('0');
    expect(screen.getByText(/same samples for ω \+ k·Ωs/)).toBeTruthy();
  });

  it('keeps the raw array index distinct from the signed frequency index', () => {
    const store = makeStoreFromLatex(
      ['f(t)=1', 'D(\\omega)=\\operatorname{DFT}(f(t))'],
      'transforms',
    );
    store.focusLine(store.getState().lines[1]?.id as string);
    store.setFrequencyHover(-0.38);
    const { container } = render(<ReadoutBar store={store} />);

    // On the N=64 grid, the negative first bin is array index 63 but signed k=-1.
    expect(readCell(container, 'k')).toBe('63');
    expect(readCell(container, 'signed k')).toBe('-1');
  });

  it('uses the expression frequency variable in the coordinate readout', () => {
    const store = makeStoreFromLatex(['f(t)=1', 'D(q)=\\operatorname{DFT}(f(t))'], 'transforms');
    store.focusLine(store.getState().lines[1]?.id as string);
    store.setFrequencyHover(0.03);
    const { container } = render(<ReadoutBar store={store} />);

    expect(readCell(container, 'q')).toBe('0');
    expect(readCell(container, 'ω')).toBe('');
  });
});

describe('at a point with no value', () => {
  it('says the value is undefined and gives the mathematical reason', () => {
    const store = makeStore(['f(z)=1/z']);
    store.setHover(cx(0, 0));
    render(<ReadoutBar store={store} />);

    expect(screen.getByText('undefined')).toBeTruthy();
    // The reason is the evaluator's own sentence, which names the vanishing divisor.
    expect(screen.getByText(/is zero here/)).toBeTruthy();
  });

  it('does not present a singularity as a large number', () => {
    const store = makeStore(['f(z)=1/z']);
    store.setHover(cx(0, 0));
    render(<ReadoutBar store={store} />);
    expect(screen.queryByText('∞')).toBeNull();
  });
});

describe('parameter changes are reflected immediately', () => {
  it('reads a different value after a slider moves', () => {
    const store = makeStore(['a=2', 'f(z)=a*z']);
    store.setHover(cx(3, 0));

    const { container, unmount } = render(<ReadoutBar store={store} />);
    expect(readCell(container, 'value')).toBe('6');
    unmount();

    store.setParameter('a', 5);
    const second = render(<ReadoutBar store={store} />);
    expect(readCell(second.container, 'value')).toBe('15');
  });
});
