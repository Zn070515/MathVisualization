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
import { WorkspaceStore, resetLineIds } from '../src/state/workspaceStore';
import { ReadoutBar } from '../src/readout/ReadoutBar';

function makeStore(initialLines: string[]): WorkspaceStore {
  return new WorkspaceStore({
    subsystem: 'complex',
    initialLines,
    drawableKinds: ['complex-function', 'complex-path', 'real-function'],
  });
}

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
  resetLineIds();
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
