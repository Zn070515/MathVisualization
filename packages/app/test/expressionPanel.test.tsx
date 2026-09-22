/**
 * Expression panel tests.
 *
 * What is checked here is the interaction the panel owns: typing produces a type and a
 * tree, a bad expression is explained while an unfinished one stays quiet, a parameter
 * becomes a slider, and the keyboard flows between rows. The mathematics itself is the
 * core's test suite; these assertions are about what the interface shows and what it
 * sends to the store.
 *
 * The math editor is a test double (see `setup.ts`), so the field here is an editable
 * box with a caret rather than a TeX engine. The real editor's typesetting and
 * structural navigation are verified in a browser.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { exprToText, parseLatexStatement } from '@mathviz/mathcore';
import { ExpressionPanel } from '../src/expression/ExpressionPanel';
import type { FakeMathFieldElement } from './setup';
import { lineSources, makeStore } from './helpers';
import type { WorkspaceStore } from '../src/state/workspaceStore';

function renderPanel(store: WorkspaceStore, options: { keypadOpen?: boolean } = {}): {
  container: HTMLElement;
  toggle: () => void;
} {
  let open = options.keypadOpen ?? false;
  const view = render(
    <ExpressionPanel
      store={store}
      keypadOpen={open}
      onKeypadToggle={() => {
        open = !open;
      }}
    />,
  );
  return { container: view.container, toggle: () => view.rerender(
    <ExpressionPanel store={store} keypadOpen={open} onKeypadToggle={() => {}} />,
  ) };
}

/** The editor element for a row, by its accessible name. */
function fieldAt(index: number): FakeMathFieldElement {
  const fields = document.querySelectorAll('math-field');
  const field = fields[index];
  if (field === undefined) throw new Error(`no field at index ${index}`);
  return field as FakeMathFieldElement;
}

beforeEach(() => {
  cleanup();
});

describe('showing what an expression is', () => {
  it('types an expression and shows its type only on the row', () => {
    renderPanel(makeStore(['f(z)=z^2']));
    expect(screen.getByText('C → C')).toBeTruthy();
  });

  it('shows a scalar field differently', () => {
    renderPanel(makeStore(['f(x,y)=x^2+y^2'], 'calculus'));
    expect(screen.getByText('R² → R')).toBeTruthy();
  });

  it('shows no type for an expression that is still being written', () => {
    renderPanel(makeStore(['f(z)=z^']));
    expect(screen.queryByText('C → C')).toBeNull();
  });

  it('carries no line numbers, kind labels or heading', () => {
    const { container } = renderPanel(makeStore(['f(z)=z^2']));
    // The engineering metadata that used to crowd the row.
    expect(screen.queryByText('EXPRESSIONS')).toBeNull();
    expect(screen.queryByText('01')).toBeNull();
    expect(screen.queryByText('complex')).toBeNull();
    expect(screen.queryByText('Why?')).toBeNull();
    expect(container.querySelector('.panel__header')).toBeNull();
  });
});

describe('problems are explained, unfinished input is not', () => {
  it('explains a genuine problem in words', () => {
    renderPanel(makeStore(['f(z)=wombat*z']));
    expect(screen.getByRole('status').textContent).toContain('not defined');
  });

  it('stays quiet about an unfinished expression', () => {
    renderPanel(makeStore(['f(z)=z^']));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('marks the field invalid for a screen reader only when it is wrong', () => {
    renderPanel(makeStore(['f(z)=z^']));
    expect(fieldAt(0).getAttribute('aria-invalid')).toBe('false');

    cleanup();
    renderPanel(makeStore(['f(z)=wombat*z']));
    expect(fieldAt(0).getAttribute('aria-invalid')).toBe('true');
  });
});

describe('editing', () => {
  it('sends what the editor holds to the store, and re-types as it goes', () => {
    const store = makeStore(['f(z)=z']);
    renderPanel(store);

    const field = fieldAt(0);
    field.value = 'f\\left(z\\right)=z^{2}';
    field.dispatchEvent(new Event('input'));

    expect(lineSources(store)[0]).toBe('f\\left(z\\right)=z^{2}');
    expect(screen.getByText('C → C')).toBeTruthy();
  });

  it('reads the LaTeX the field holds into the canonical tree', () => {
    renderPanel(makeStore(['f(z)=sin(z)/(z^2+1)']));
    const parsed = parseLatexStatement(lineSources(makeStore(['f(z)=sin(z)/(z^2+1)']))[0] ?? '');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    if (parsed.value.kind !== 'function-definition') throw new Error('expected a definition');
    // The fraction survives: the denominator did not swallow the addition.
    expect(exprToText(parsed.value.body)).toBe('sin(z) / (z ^ 2 + 1)');
  });
});

describe('parameters', () => {
  it('puts a slider on the rows that use the parameter, not on the definition', () => {
    renderPanel(makeStore(['a=2', 'f(z)=a*z']));
    const sliders = screen.getAllByRole('slider');
    expect(sliders).toHaveLength(1);
    expect(sliders[0]?.getAttribute('aria-label')).toBe('Value of a');
  });

  it('reports a parameter change to the store and resets it', async () => {
    const user = userEvent.setup();
    const store = makeStore(['a=2', 'f(z)=a*z']);
    renderPanel(store);

    const field = screen.getByRole('textbox', { name: 'Exact value of a' });
    await user.clear(field);
    await user.type(field, '7{Enter}');
    expect(store.getState().parameterValues.get('a')).toBe(7);

    await user.click(screen.getByRole('button', { name: 'Reset a to its defined value' }));
    expect(store.getState().parameterValues.get('a')).toBe(2);
  });

  it('offers no slider for a complex parameter', () => {
    renderPanel(makeStore(['a=2i']));
    expect(screen.queryAllByRole('slider')).toHaveLength(0);
  });
});

describe('keyboard flow between rows', () => {
  it('starts a new expression on Enter', () => {
    const store = makeStore(['f(z)=z^2']);
    renderPanel(store);

    fieldAt(0).press('Enter');

    expect(store.getState().lines).toHaveLength(2);
    expect(lineSources(store)[1]).toBe('');
  });

  it('goes to the next expression on a downward move', () => {
    const store = makeStore(['f(z)=z^2', 'g(z)=1/z']);
    renderPanel(store);

    fieldAt(0).moveOut('downward');
    expect(store.getState().focusedLineId).toBe(store.getState().lines[1]?.id);
  });

  it('goes to the previous expression on an upward move', () => {
    const store = makeStore(['f(z)=z^2', 'g(z)=1/z']);
    renderPanel(store);
    store.focusLine(store.getState().lines[1]?.id ?? null);

    fieldAt(1).moveOut('upward');
    expect(store.getState().focusedLineId).toBe(store.getState().lines[0]?.id);
  });

  it('adds a row when leaving the last one downwards', () => {
    const store = makeStore(['f(z)=z^2']);
    renderPanel(store);

    fieldAt(0).moveOut('downward');
    expect(store.getState().lines).toHaveLength(2);
  });

  it('removes a blank expression on Backspace', () => {
    const store = makeStore(['f(z)=z^2', '']);
    renderPanel(store);

    fieldAt(1).press('Backspace');
    expect(store.getState().lines).toHaveLength(1);
  });

  it('does not remove a row that has content', () => {
    const store = makeStore(['f(z)=z^2']);
    renderPanel(store);

    fieldAt(0).press('Backspace');
    expect(store.getState().lines).toHaveLength(1);
  });
});

describe('adding and removing', () => {
  it('adds an expression from the + control', async () => {
    const user = userEvent.setup();
    const store = makeStore(['f(z)=z^2']);
    renderPanel(store);

    await user.click(screen.getByRole('button', { name: 'Add an expression' }));
    expect(store.getState().lines).toHaveLength(2);
  });

  it('clears a filled row rather than deleting it', async () => {
    const user = userEvent.setup();
    const store = makeStore(['f(z)=z^2']);
    renderPanel(store);

    await user.click(screen.getByRole('button', { name: 'Delete this expression' }));
    expect(store.getState().lines).toHaveLength(1);
    expect(lineSources(store)[0]).toBe('');
  });
});

describe('the panel as a whole', () => {
  it('is a labelled region listing the expressions in order', () => {
    renderPanel(makeStore(['f(z)=z^2', 'g(z)=1/z']));
    const panel = screen.getByRole('region', { name: 'Expressions' });
    const fields = within(panel).getAllByLabelText(/^Expression/);
    expect(fields).toHaveLength(2);
  });

  it('toggles the keypad, which is absent until asked for', async () => {
    const user = userEvent.setup();
    const { toggle } = renderPanel(makeStore(['f(z)=z^2']));
    expect(screen.queryByRole('region', { name: 'Mathematics keypad' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Show the mathematical keypad' }));
    toggle();
    expect(screen.getByRole('region', { name: 'Mathematics keypad' })).toBeTruthy();
  });
});
