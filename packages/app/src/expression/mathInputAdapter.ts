/**
 * The adapter between the application and the structured math editor.
 *
 * Why MathLive and not MathQuill
 * ------------------------------
 * MathQuill was the first choice, because Desmos's editing behaviour is the
 * behaviour being reproduced and MathQuill came out of Desmos. It was rejected on
 * evidence, not preference:
 *
 * | | MathQuill | MathLive |
 * |---|---|---|
 * | published version | `0.10.1-a`, a prerelease | `0.110.0` |
 * | last published | 2023, and 2016 before that | three months ago |
 * | runtime dependency | `jquery ^1.12.3` | none in the editor itself |
 * | TypeScript types | none; `@types/mathquill` does not exist (404) | ships its own |
 * | React 19 | manipulates the DOM directly, fighting the reconciler | a web component, framework-agnostic |
 * | accessibility | no meaningful screen-reader support | designed with it, ARIA and spoken maths |
 *
 * A hard jQuery 1.x dependency, no types at all, and unmaintained prerelease
 * releases are not acceptable for the input layer of a project meant to last. The
 * editing semantics that were wanted are not lost by the substitution: MathLive
 * navigates structures with the arrow keys, emits and accepts LaTeX, and reports a
 * cancellable `move-out` event when the caret runs out of structure — which is
 * exactly the hook that turns structural navigation into list navigation.
 *
 * What MathLive is *not* used for
 * -------------------------------
 * It ships its own computer algebra system as a dependency. That system is never
 * called. MathLive here is a text-entry widget that reads and writes LaTeX; the
 * canonical AST stays the only mathematical truth, and `latex.ts` in the core is
 * what turns LaTeX into it. A second CAS evaluating anything would be exactly the
 * dual truth the architecture exists to prevent.
 *
 * The adapter below is deliberately thin, and its surface is deliberately small:
 * what the application needs to do to a field is insert LaTeX, focus it, and read
 * what it holds.
 */

/** LaTeX that MathLive understands as "replace the selection" and "an empty box". */
export const SELECTION = '#@';
export const PLACEHOLDER = '#?';

/**
 * What the rest of the application is allowed to do to a math field.
 *
 * Narrow on purpose. A component holding one of these cannot reach into the
 * editor's internals, so replacing the editor later is a change to one file.
 */
export interface MathFieldHandle {
  /**
   * Insert LaTeX at the caret, replacing any selection.
   *
   * Returns false when there is nothing to insert into, which happens if the field
   * has been unmounted while a keypad press was in flight.
   */
  insert(latex: string): boolean;
  /** Delete the character before the caret. */
  backspace(): void;
  /** Put the caret in the field. */
  focus(): void;
  /** The LaTeX the field currently holds. */
  read(): string;
}

/** The direction the caret was trying to leave in when it ran out of structure. */
export type MoveOutDirection = 'forward' | 'backward' | 'upward' | 'downward';

/** The subset of the MathLive element this application uses. */
export interface MathFieldElementLike extends HTMLElement {
  value: string;
  mathVirtualKeyboardPolicy: string;
  menuItems: readonly unknown[];
  smartFingers: boolean;
  insert(latex: string, options?: Record<string, unknown>): boolean;
  executeCommand(command: string | [string, ...unknown[]]): boolean;
  focus(): void;
}

/**
 * Configuration applied to every field.
 *
 * All three settings exist to hand control to this application rather than share it:
 * the editor's own virtual keyboard is switched off because the keypad below the
 * expression list is the one being designed, its context menu is emptied because
 * the options belong in the interface rather than in a pop-up over the formula, and
 * its sounds are switched off because a mathematics tool should be silent.
 */
export function configureMathField(element: MathFieldElementLike): void {
  element.mathVirtualKeyboardPolicy = 'manual';
  element.menuItems = [];
  element.smartFingers = false;
}

/** Insert LaTeX at the caret, replacing the selection. */
export function insertLatex(element: MathFieldElementLike, latex: string): boolean {
  if (latex === '') return false;
  return element.insert(latex, {
    insertionMode: 'replaceSelection',
    format: 'latex',
  });
}

/** Delete backwards. */
export function backspace(element: MathFieldElementLike): void {
  element.executeCommand('deleteBackward');
}

/**
 * Whether a LaTeX value is effectively empty.
 *
 * A field that has been focused and left alone can hold an empty group rather than
 * an empty string, and an empty group is visually empty. Treating it as content
 * would stop Backspace from removing a blank row.
 */
export function isBlankLatex(latex: string): boolean {
  return latex.replace(/\\left|\\right|\s|\{\}|\(\)|\[|\]/g, '') === '';
}
