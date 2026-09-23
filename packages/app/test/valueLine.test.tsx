/**
 * The value of a line that is a value.
 *
 * This is the test the plan called the under-scoped one. `∮_gamma f(z) dz` types
 * correctly, parses, evaluates — and until now appeared in the workspace as nothing at
 * all, which makes a correct answer indistinguishable from a broken one. Rendering the
 * number *is* the feature, so it is the feature that is tested here.
 *
 * The other two assertions are the honesty requirements: the interval is stated, because
 * the line does not say which interval it integrates over, and a contour that does not
 * close says so, because the residue theorem does not apply to one and the number on its
 * own does not admit that.
 *
 * Lines are given as LaTeX, which is what the application stores. `makeStore`'s
 * plain-text convenience cannot be used for the integral line, because it converts one
 * line at a time and would read `f(z)` as a product.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ExpressionPanel } from '../src/expression/ExpressionPanel';
import { makeStore, makeStoreFromLatex } from './helpers';
import type { WorkspaceStore } from '../src/state/workspaceStore';

/** `∮_gamma f(z) dz`, as the editor writes it. */
const INTEGRAL = '\\oint_{\\gamma}f\\left(z\\right)\\,dz';

function seeded(path: string, integrand: string, integral = INTEGRAL): WorkspaceStore {
  return makeStoreFromLatex([
    `\\gamma\\left(t\\right)=${path}`,
    `f\\left(z\\right)=${integrand}`,
    integral,
  ]);
}

function renderPanel(store: WorkspaceStore): HTMLElement {
  const { container } = render(
    <ExpressionPanel store={store} keypadOpen onKeypadToggle={() => {}} />,
  );
  return container;
}

/** The rendered value rows, by the class the stylesheet uses to set them apart. */
function valueRows(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.expr-row__value')];
}

beforeEach(() => {
  cleanup();
});

describe('a line whose result is a number', () => {
  it('shows the number', () => {
    const container = renderPanel(seeded('e^{it}', '\\frac{1}{z}'));
    const rows = valueRows(container);
    expect(rows).toHaveLength(1);
    // `2πi` in the notation the readout uses, so the two cannot disagree about how a
    // complex number is written.
    expect(rows[0]?.textContent).toContain('i');
    expect(rows[0]?.textContent).toContain('6.283');
  });

  it('states the interval it integrated over', () => {
    // The line says `∮_gamma f(z) dz` and nothing about the range of `t`. The answer
    // depends on it, so the answer carries it.
    const container = renderPanel(seeded('e^{it}', '\\frac{1}{z}'));
    expect(container.textContent).toContain('t ∈ [0, 2π]');
  });

  it('states a path interval declared by the definition', () => {
    const container = renderPanel(
      makeStoreFromLatex([
        '\\gamma\\left(t;[0,1]\\right)=t+i t^{2}',
        'f\\left(z\\right)=1',
        INTEGRAL,
      ]),
    );
    expect(container.textContent).toContain('t ∈ [0, 1]');
    expect(container.textContent).not.toContain('t ∈ [0, 2π]');
  });

  it('says when the path does not close, and what that costs', () => {
    // `γ(t) = 1 + t` walks a segment from 1 to 1 + 2π without meeting the pole, so the
    // integral exists — but the contour is not closed, so the number is an answer to
    // `∫` and not to `∮`.
    const container = renderPanel(seeded('1+t', '\\frac{1}{z}'));
    expect(container.textContent).toContain('does not close');
    expect(container.textContent).toContain('residue theorem does not apply');
  });

  it('checks the residue theorem, and says which poles it counted', () => {
    // GOAL.md section 7.17. The two sides come from different methods, so showing them
    // together is a check rather than a restatement.
    const container = renderPanel(seeded('e^{it}', '\\frac{1}{z}'));
    expect(container.textContent).toContain('1 pole inside');
    expect(container.textContent).toContain('Σ');
    expect(container.textContent).toContain(
      'the same number to within the combined error estimate',
    );
  });

  it('counts no poles when the contour does not wind around one', () => {
    // The pole of `1/(z − 2)` is at 2, outside the unit circle. An analysis that reported
    // residues without checking enclosure would claim 2πi here.
    const container = renderPanel(seeded('e^{it}', '\\frac{1}{z-2}'));
    expect(container.textContent).toContain('No poles were detected inside the contour.');
    expect(container.textContent).toContain('inconclusive');
  });

  it('does not call an essential singularity pole-free analytic', () => {
    const container = renderPanel(seeded('e^{it}', 'e^{1/z}'));
    expect(container.textContent).toContain('No poles were detected inside the contour.');
    expect(container.textContent).toContain('inconclusive');
    expect(container.textContent).not.toContain('Cauchy’s theorem says the integral is zero');
  });

  it('shows the evaluator’s reason rather than a blank when there is no value', () => {
    // The contour runs through the pole, so the integral does not exist. An empty space
    // would look like a bug; the reason looks like a reason.
    const container = renderPanel(seeded('e^{it}', '\\frac{1}{z-1}'));
    expect(valueRows(container)).toHaveLength(1);
    expect(valueRows(container)[0]?.textContent).toContain('integrand');
  });
});

describe('lines that are not values', () => {
  it('leave the row alone', () => {
    // A function is drawn, not evaluated to a number, and a parameter is shown by its
    // slider. Neither should grow a result row.
    const container = renderPanel(makeStore(['f(z)=z^2', 'a=2']));
    expect(valueRows(container)).toHaveLength(0);
  });
});

describe('the type badge', () => {
  it('does not describe a value as a function', () => {
    // Inference gives a value the placeholder signature `R → C` so that it has one at
    // all; printing that describes the filler rather than the line.
    const container = renderPanel(makeStore(['2+3']));
    expect(container.textContent).not.toContain('R → C');
    expect(container.textContent).toContain('value');
  });
});
