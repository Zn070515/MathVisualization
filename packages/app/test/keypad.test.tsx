/**
 * Keypad tests.
 *
 * The keypad's job is to put mathematics where the caret is without disturbing
 * anything else. So the assertions are: a press inserts the right LaTeX, the insertion
 * lands at the caret rather than the end, a selection is wrapped rather than discarded,
 * and pressing a key does not take focus out of the formula.
 *
 * The editor is a test double with a caret (see `setup.ts`). That is enough to check
 * the integration; whether the editor *typesets* the result is MathLive's business and
 * is checked in a browser.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExpressionPanel } from '../src/expression/ExpressionPanel';
import type { FakeMathFieldElement } from './setup';
import { lineSources, makeStore } from './helpers';
import type { WorkspaceStore } from '../src/state/workspaceStore';
import type { SubsystemId } from '../src/subsystems';

function renderWithKeypad(store: WorkspaceStore): void {
  render(<ExpressionPanel store={store} keypadOpen onKeypadToggle={() => {}} />);
}

function field(): FakeMathFieldElement {
  const element = document.querySelector('math-field');
  if (element === null) throw new Error('no math field');
  return element as FakeMathFieldElement;
}

/** Press a keypad key by its accessible name. */
async function press(name: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name }));
}

beforeEach(() => {
  cleanup();
});

describe('page structure', () => {
  it('offers the three tabs', () => {
    renderWithKeypad(makeStore(['f(z)=z^2']));
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['123', 'ABC', 'func']);
  });

  it('opens on the numeric page', () => {
    renderWithKeypad(makeStore(['f(z)=z^2']));
    expect(screen.getByRole('button', { name: 'Fraction: divide by' })).toBeTruthy();
  });

  it('switches page when a tab is chosen', async () => {
    const user = userEvent.setup();
    renderWithKeypad(makeStore(['f(z)=z^2']));

    await user.click(screen.getByRole('tab', { name: 'ABC' }));
    expect(screen.getByRole('button', { name: 'The variable a' })).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: 'func' }));
    expect(screen.getByRole('button', { name: 'Sine' })).toBeTruthy();
  });
});

describe('insertion at the caret', () => {
  it('inserts a digit where the caret is, not at the end', async () => {
    const store = makeStore(['f(z)=z^2']);
    renderWithKeypad(store);

    const element = field();
    element.caret = 0;
    element.selectionEnd = 0;

    await press('7');

    expect(element.value.startsWith('7')).toBe(true);
    expect(lineSources(store)[0]?.startsWith('7')).toBe(true);
  });

  it('builds a fraction from the fraction key and puts the caret in the numerator', async () => {
    const store = makeStore(['']);
    renderWithKeypad(store);

    const element = field();
    await press('Fraction: divide by');

    // A real fraction, and the caret inside it rather than after it.
    expect(element.value).toBe('\\frac{}{}');
    expect(element.caret).toBe('\\frac{'.length);
  });

  it('wraps the selection rather than discarding it', async () => {
    const store = makeStore(['']);
    renderWithKeypad(store);

    const element = field();
    element.value = 'z+1';
    element.selectAll();

    await press('Fraction: divide by');

    expect(element.value).toBe('\\frac{z+1}{}');
  });

  it('inserts a power', async () => {
    const store = makeStore(['']);
    renderWithKeypad(store);

    const element = field();
    element.value = 'z';

    await press('Power');

    expect(element.value).toBe('z^{}');
    expect(element.caret).toBe('z^{'.length);
  });

  it('inserts a Greek letter as a command, not as letters', async () => {
    const user = userEvent.setup();
    makeStore(['']);
    renderWithKeypad(makeStore(['']));

    await user.click(screen.getByRole('tab', { name: 'ABC' }));
    await press('gamma');

    // The five letters would typeset as g·a·m·m·a.
    expect(field().value).toBe('\\gamma');
  });

  it('inserts a function with a place to type its argument', async () => {
    const user = userEvent.setup();
    renderWithKeypad(makeStore(['']));

    await user.click(screen.getByRole('tab', { name: 'func' }));
    await press('Sine');

    expect(field().value).toBe('\\sin\\left(\\right)');
    // The caret sits inside the argument, where the argument goes.
    expect(field().caret).toBe('\\sin\\left('.length);
  });

  it('inserts a square root', async () => {
    renderWithKeypad(makeStore(['']));
    await press('Square root');
    expect(field().value).toBe('\\sqrt{}');
  });

  it('inserts the imaginary unit and pi as the constants they are', async () => {
    renderWithKeypad(makeStore(['']));
    await press('The imaginary unit');
    await press('Pi');
    expect(field().value).toBe('i\\pi');
  });
});

describe('focus is not stolen', () => {
  it('cancels the pointer-down so the formula keeps the caret', () => {
    renderWithKeypad(makeStore(['f(z)=z^2']));
    const key = screen.getByRole('button', { name: 'Fraction: divide by' });

    // jsdom has no PointerEvent, and the mechanism under test does not depend on
    // which event class carries it — only on the handler cancelling it.
    const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    key.dispatchEvent(event);

    // This is the mechanism: without it the button would take focus and the caret
    // would be lost on every press.
    expect(event.defaultPrevented).toBe(true);
  });

  it('cancels the pointer-down on the tabs too', () => {
    renderWithKeypad(makeStore(['f(z)=z^2']));
    const tab = screen.getByRole('tab', { name: 'ABC' });

    const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    tab.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});

describe('editor actions', () => {
  it('deletes backwards from the caret', async () => {
    renderWithKeypad(makeStore(['']));
    const element = field();
    element.value = 'abc';

    await press('Delete backwards');
    expect(element.value).toBe('ab');
  });

  it('starts a new expression from the keypad', async () => {
    const store = makeStore(['f(z)=z^2']);
    renderWithKeypad(store);

    await press('Start a new expression');
    expect(store.getState().lines).toHaveLength(2);
  });
});

describe('each subsystem gets its own functions', () => {
  async function functionPageNames(subsystem: SubsystemId): Promise<string[]> {
    cleanup();
    renderWithKeypad(makeStore([''], subsystem));
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'func' }));
    const panel = screen.getByRole('tabpanel');
    return within(panel)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? '');
  }

  it('gives complex analysis the complex operations', async () => {
    const names = await functionPageNames('complex');
    expect(names).toContain('Complex conjugate');
    expect(names).toContain('Real part');
    expect(names).toContain('Principal argument, in (-π, π]');
    expect(names).toContain('Modulus');
  });

  it('gives integral transforms its signals', async () => {
    const names = await functionPageNames('transforms');
    expect(names).toContain('A Gaussian pulse');
    expect(names).toContain('Exponential decay');
    expect(names).toContain('The time variable');
  });

  it('gives multivariable calculus its lists and fields', async () => {
    const names = await functionPageNames('calculus');
    expect(names).toContain('A point in the plane');
    expect(names).toContain('A saddle');
    expect(names).toContain('The first real variable');
  });

  it('shares the common groups across all three', async () => {
    for (const subsystem of ['complex', 'transforms', 'calculus'] as const) {
      const names = await functionPageNames(subsystem);
      expect(names, subsystem).toContain('Sine');
      expect(names, subsystem).toContain('Natural logarithm');
      expect(names, subsystem).toContain('Fraction');
    }
  });
});

describe('keys for mathematics the language does not have yet', () => {
  it('are present so the roadmap is visible, and are inert', async () => {
    const user = userEvent.setup();
    makeStore(['']);
    renderWithKeypad(makeStore([''], 'complex'));
    await user.click(screen.getByRole('tab', { name: 'func' }));

    // `Res` rather than `∮`: the contour key became a real one when the language
    // learned to read it, and a planned key is evidence only while it is still planned.
    const residues = screen.getByRole('button', { name: 'residues' });
    expect((residues as HTMLButtonElement).disabled).toBe(true);
    // Pressing it must not put anything into the formula.
    expect(field().value).toBe('');
  });

  it('never insert a command the parser does not read', async () => {
    // The invariant that stops the keypad offering a button which produces a broken
    // line: every command in every insertion must be one the LaTeX parser knows.
    // This is the check that would have caught a key inserting `\mathrm{delete}` — and
    // it is why the contour key could be promoted from planned to real at all.
    const { keypadFor } = await import('../src/expression/keypad');
    const { LATEX_KNOWN_COMMANDS } = await import('@mathviz/mathcore');

    const insertions: { subsystem: string; title: string; insert: string }[] = [];
    for (const subsystem of ['complex', 'transforms', 'calculus'] as const) {
      for (const page of keypadFor(subsystem).pages) {
        for (const row of page.rows) {
          if (row.kind !== 'keys' && row.kind !== 'wrap') continue;
          for (const entry of row.keys) {
            if (entry.kind === 'insert') {
              insertions.push({ subsystem, title: entry.title, insert: entry.insert });
            }
          }
        }
      }
    }

    expect(insertions.length).toBeGreaterThan(40);
    for (const { subsystem, title, insert } of insertions) {
      for (const command of insert.matchAll(/\\([A-Za-z]+)/g)) {
        const name = command[1] as string;
        expect(
          LATEX_KNOWN_COMMANDS.has(name),
          `${subsystem} key "${title}" inserts \\${name}`,
        ).toBe(true);
      }
    }
  });

  it('inserts something the parser accepts once the placeholders are filled', async () => {
    const { keypadFor } = await import('../src/expression/keypad');
    const { parseLatexStatement } = await import('@mathviz/mathcore');

    for (const subsystem of ['complex', 'transforms', 'calculus'] as const) {
      for (const page of keypadFor(subsystem).pages) {
        for (const row of page.rows) {
          if (row.kind !== 'keys' && row.kind !== 'wrap') continue;
          for (const entry of row.keys) {
            if (entry.kind !== 'insert') continue;
            // Placeholders are filled but spacing is left alone: the trailing space
            // in `\cdot ` is what separates the command from what follows it.
            const filled = entry.insert.replace(/#@/g, 'z').replace(/#[?0-9]/g, 'z');
            if (filled.trim() === '') continue;

            // A key's fragment is expected to be valid in *some* natural context:
            // on its own, as an infix operator between two expressions, between two
            // digits (the decimal point), or between two list entries (the comma).
            const contexts = [filled, `z${filled}z`, `3${filled}5`, `\\left(z${filled}z\\right)`];
            if (entry.title === 'A numerical Fourier transform') {
              // The transform binds a source function call, so its natural valid
              // context includes the source definition name that the workspace
              // resolves before parsing.
              contexts.push('\\operatorname{Fourier}\\left(f(t)\\right)');
            }
            expect(
              contexts.some((candidate) =>
                parseLatexStatement(
                  candidate,
                  entry.title === 'A numerical Fourier transform'
                    ? { knownFunctions: new Set(['f']) }
                    : undefined,
                ).ok,
              ),
              `${subsystem} key "${entry.title}" inserts ${entry.insert}`,
            ).toBe(true);
          }
        }
      }
    }
  });
});
