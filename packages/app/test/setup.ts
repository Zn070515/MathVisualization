/**
 * Test environment setup.
 *
 * Two things are stood up here, both for stated reasons.
 *
 * **jsdom gaps.** It provides neither `ResizeObserver` nor a canvas backend, and
 * layout is not computed. Both are stubbed rather than papered over with a native
 * canvas: the DOM tests are about state and interaction, not pixels, and the drawing
 * paths are verified in a real browser instead.
 *
 * **A test double for the math editor.** MathLive is a web component that runs a TeX
 * engine; loading it in jsdom would be slow, and it is not the code under test here.
 * What *is* under test is this application's integration with it — does a keypad press
 * reach the caret, does Enter make a row, does Backspace on a blank row delete it — and
 * that needs an element that behaves like an editable field, not one that typesets.
 *
 * The double models the two things the integration depends on: a value, and a caret
 * that insertions land at. It does not parse LaTeX. The real editor's behaviour is
 * verified in a browser, which the round's acceptance criteria require separately.
 */
import { vi } from 'vitest';

// The component imports these for their side effects only; the double below replaces
// what the side effect would have done.
vi.mock('mathlive', () => ({}));
vi.mock('mathlive/fonts.css', () => ({}));

interface EditingState {
  caret: number;
  selectionEnd: number;
}

/**
 * A stand-in for `<math-field>`.
 *
 * `insert` follows MathLive's placeholders as far as they matter for caret
 * placement: `#@` becomes whatever is selected, and the caret lands where the first
 * `#?` was, with the placeholder markers themselves removed.
 */
class FakeMathFieldElement extends HTMLElement implements EditingState {
  caret = 0;
  selectionEnd = 0;
  mathVirtualKeyboardPolicy = 'auto';
  menuItems: readonly unknown[] = [];
  smartFingers = true;

  private current = '';

  get value(): string {
    return this.current;
  }

  set value(next: string) {
    this.current = next;
    // Placing the caret at the end mirrors what a fresh value looks like. No input
    // event is fired: a programmatic write is not a user edit, and firing one would
    // make the controlled-value effect loop.
    this.caret = next.length;
    this.selectionEnd = next.length;
  }

  /** Select everything, as a test would before pressing a wrapping key. */
  selectAll(): void {
    this.caret = 0;
    this.selectionEnd = this.current.length;
  }

  insert(latex: string): boolean {
    const selected = this.current.slice(this.caret, this.selectionEnd);
    // The caret lands on the *first* placeholder, which may be `#@` — where the
    // selection went — rather than `#?`. Text before any `#@` substitution is
    // unchanged by it, so its position in the fragment is the position to land on.
    const atSelection = latex.indexOf('#@');
    const atBox = latex.indexOf('#?');
    const firstPlaceholder =
      atSelection === -1 ? atBox : atBox === -1 ? atSelection : Math.min(atSelection, atBox);

    const filled = latex.replace(/#@/g, selected);
    const inserted = filled.replace(/#[?0-9]/g, '');

    this.current =
      this.current.slice(0, this.caret) + inserted + this.current.slice(this.selectionEnd);
    this.caret =
      firstPlaceholder === -1 ? this.caret + inserted.length : this.caret + firstPlaceholder;
    this.selectionEnd = this.caret;

    this.dispatchEvent(new Event('input'));
    return true;
  }

  executeCommand(): boolean {
    // Deleting backwards, for the keypad's backspace key.
    if (this.caret > 0) {
      this.current = this.current.slice(0, this.caret - 1) + this.current.slice(this.caret);
      this.caret -= 1;
      this.selectionEnd = this.caret;
      this.dispatchEvent(new Event('input'));
    }
    return true;
  }

  /** Mimic a keystroke, so the component's own key handling can be exercised. */
  press(key: string): void {
    this.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  }

  /** Mimic the editor reporting that the caret had nowhere to go. */
  moveOut(direction: 'forward' | 'backward' | 'upward' | 'downward'): void {
    this.dispatchEvent(
      new CustomEvent('move-out', { detail: { direction }, bubbles: true, cancelable: true }),
    );
  }
}

if (!customElements.get('math-field')) {
  customElements.define('math-field', FakeMathFieldElement);
}

if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe(): void {
      // Views redraw on state changes in tests, so no callback is needed.
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: ResizeObserverStub,
    writable: true,
  });
}

if (typeof globalThis.localStorage === 'undefined') {
  /**
   * Node's own experimental `localStorage` is defined but unusable without
   * `--localstorage-file`, so it wins the name over jsdom's and reads back
   * undefined — `'localStorage' in window` is true and `typeof localStorage` is
   * `'undefined'`. Node says so itself, in a warning, which is how this was
   * tracked down rather than guessed at.
   *
   * The application guards on that `typeof` and correctly concludes it cannot
   * persist, so without a stand-in the whole persistence layer would be skipped
   * by its own tests. A memory-backed one is enough: the layer uses `getItem` and
   * `setItem` and nothing else, and what needs testing is the *reading* — which
   * versions are consulted, what a partly-unreadable record degrades to — rather
   * than the browser's storage.
   */
  class MemoryStorage {
    private readonly items = new Map<string, string>();

    get length(): number {
      return this.items.size;
    }

    clear(): void {
      this.items.clear();
    }

    getItem(key: string): string | null {
      return this.items.get(key) ?? null;
    }

    key(index: number): string | null {
      return [...this.items.keys()][index] ?? null;
    }

    removeItem(key: string): void {
      this.items.delete(key);
    }

    setItem(key: string, value: string): void {
      this.items.set(key, String(value));
    }
  }

  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    writable: true,
  });
}

if (typeof HTMLCanvasElement !== 'undefined') {
  // jsdom logs a "not implemented" error for canvas contexts. Returning null is the
  // honest answer here, and every view handles a missing context by showing its
  // explanatory overlay.
  HTMLCanvasElement.prototype.getContext = function getContext(): null {
    return null;
  } as typeof HTMLCanvasElement.prototype.getContext;

  Object.defineProperty(HTMLCanvasElement.prototype, 'getBoundingClientRect', {
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 640,
      bottom: 400,
      width: 640,
      height: 400,
      toJSON: () => ({}),
    }),
    writable: true,
  });
}

export { FakeMathFieldElement };
