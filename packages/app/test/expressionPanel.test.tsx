/**
 * Expression panel tests.
 *
 * These check the interaction the panel is responsible for: typing produces a
 * type, a bad expression produces a stated reason rather than a blank, a
 * parameter becomes a control, and the keyboard flow works. What is *not* tested
 * here is the mathematics — that is the core's test suite — so the assertions are
 * about what the interface shows and what it sends to the store.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  WorkspaceStore,
  resetLineIds,
  type ViewKind,
} from '../src/state/workspaceStore';
import { ExpressionPanel } from '../src/expression/ExpressionPanel';

function makeStore(
  initialLines: string[] = [],
  kinds: ViewKind[] = [],
): WorkspaceStore {
  void kinds;
  return new WorkspaceStore({
    subsystem: 'complex',
    initialLines,
    drawableKinds: ['complex-function', 'complex-path', 'real-function'],
  });
}

beforeEach(() => {
  cleanup();
  resetLineIds();
});

describe('showing what an expression is', () => {
  it('shows the inferred type once an expression parses', () => {
    render(<ExpressionPanel store={makeStore(['f(z)=z^2'])} />);
    expect(screen.getByText('C → C')).toBeTruthy();
  });

  it('names the kind of object', () => {
    render(<ExpressionPanel store={makeStore(['f(z)=z^2'])} />);
    expect(screen.getByText('complex')).toBeTruthy();
  });

  it('shows no type for an expression that does not parse yet', () => {
    render(<ExpressionPanel store={makeStore(['f(z)=z^'])} />);
    expect(screen.queryByText('C → C')).toBeNull();
  });

  it('types a scalar field differently', () => {
    render(<ExpressionPanel store={makeStore(['f(x,y)=x^2+y^2'])} />);
    expect(screen.getByText('R² → R')).toBeTruthy();
    expect(screen.getByText('scalar field')).toBeTruthy();
  });
});

describe('problems are explained', () => {
  it('offers to explain a problem, and then explains it', async () => {
    const user = userEvent.setup();
    render(<ExpressionPanel store={makeStore(['f(z)=z^'])} />);

    const explain = screen.getByRole('button', { name: 'Why?' });
    await user.click(explain);

    // The message comes from the core, so it says what a mathematician needs.
    expect(screen.getByRole('status').textContent).toContain('Expected an expression');
  });

  it('explains a mathematical problem as well as a syntax one', async () => {
    const user = userEvent.setup();
    render(<ExpressionPanel store={makeStore(['f(z)=wombat*z'])} />);

    await user.click(screen.getByRole('button', { name: 'Why?' }));
    expect(screen.getByRole('status').textContent).toContain('not defined');
  });

  it('marks the input as invalid for a screen reader', () => {
    render(<ExpressionPanel store={makeStore(['f(z)=z^'])} />);
    const input = screen.getByRole('textbox', { name: 'Expression 1' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });
});

describe('editing', () => {
  it('sends each keystroke to the store, and re-types as it goes', async () => {
    const user = userEvent.setup();
    const store = makeStore(['f(z)=z']);
    render(<ExpressionPanel store={store} />);

    const input = screen.getByRole('textbox', { name: 'Expression 1' });
    await user.type(input, '^2');

    expect(store.getState().lines[0]?.source).toBe('f(z)=z^2');
    expect(screen.getByText('C → C')).toBeTruthy();
  });

  it('turns a real assignment into a slider on the rows that use it', async () => {
    const store = makeStore(['f(z)=a*z']);
    render(<ExpressionPanel store={store} />);
    // With no `a` defined there is nothing to slide.
    expect(screen.queryByRole('slider')).toBeNull();

    store.addLine('a=2');
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Expression 1' }), ' ');

    // The slider appears on the row that mentions `a`, not on the definition row.
    const sliders = screen.getAllByRole('slider');
    expect(sliders).toHaveLength(1);
    expect(sliders[0]?.getAttribute('aria-label')).toBe('Value of a');
  });

  it('reports a parameter change to the store', async () => {
    const user = userEvent.setup();
    const store = makeStore(['a=2', 'f(z)=a*z']);
    render(<ExpressionPanel store={store} />);

    const field = screen.getByRole('textbox', { name: 'Exact value of a' });
    await user.clear(field);
    await user.type(field, '7{Enter}');

    expect(store.getState().parameterValues.get('a')).toBe(7);
  });

  it('resets a parameter to the value its definition gives it', async () => {
    const user = userEvent.setup();
    const store = makeStore(['a=2', 'f(z)=a*z']);
    store.setParameter('a', 11);
    render(<ExpressionPanel store={store} />);

    await user.click(screen.getByRole('button', { name: 'Reset a to its defined value' }));
    expect(store.getState().parameterValues.get('a')).toBe(2);
  });
});

describe('keyboard flow', () => {
  it('adds a line below the current one on Enter', async () => {
    const user = userEvent.setup();
    const store = makeStore(['f(z)=z^2']);
    render(<ExpressionPanel store={store} />);

    await user.type(screen.getByRole('textbox', { name: 'Expression 1' }), '{Enter}');

    expect(store.getState().lines).toHaveLength(2);
    expect(store.getState().lines[1]?.source).toBe('');
  });

  it('moves focus between lines with the arrow keys', async () => {
    const user = userEvent.setup();
    const store = makeStore(['f(z)=z^2', 'g(z)=1/z']);
    render(<ExpressionPanel store={store} />);

    const first = screen.getByRole('textbox', { name: 'Expression 1' });
    first.focus();
    await user.keyboard('{ArrowDown}');

    expect(store.getState().focusedLineId).toBe(store.getState().lines[1]?.id);
  });

  it('removes an empty line with Backspace', async () => {
    const user = userEvent.setup();
    const store = makeStore(['f(z)=z^2', '']);
    render(<ExpressionPanel store={store} />);

    const second = screen.getByRole('textbox', { name: 'Expression 2' });
    await user.click(second);
    await user.keyboard('{Backspace}');

    expect(store.getState().lines).toHaveLength(1);
  });
});

describe('adding and removing', () => {
  it('adds an empty line from the footer', async () => {
    const user = userEvent.setup();
    const store = makeStore(['f(z)=z^2']);
    render(<ExpressionPanel store={store} />);

    await user.click(screen.getByRole('button', { name: 'Add expression' }));
    expect(store.getState().lines).toHaveLength(2);
  });

  it('clears a filled line rather than deleting it', async () => {
    const user = userEvent.setup();
    const store = makeStore(['f(z)=z^2']);
    render(<ExpressionPanel store={store} />);

    await user.click(screen.getByRole('button', { name: 'Delete expression 1' }));
    expect(store.getState().lines).toHaveLength(1);
    expect(store.getState().lines[0]?.source).toBe('');
  });
});

describe('the panel as a whole', () => {
  it('is a labelled region listing the expressions in order', () => {
    render(<ExpressionPanel store={makeStore(['f(z)=z^2', 'g(z)=1/z'])} />);
    const panel = screen.getByRole('region', { name: 'Expressions' });
    const inputs = within(panel).getAllByRole('textbox');
    expect(inputs.map((input) => (input as HTMLInputElement).value)).toEqual([
      'f(z)=z^2',
      'g(z)=1/z',
    ]);
  });
});
