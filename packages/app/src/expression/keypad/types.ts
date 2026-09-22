/**
 * What a keypad entry is.
 *
 * A key that inserts mathematics carries **LaTeX**, not a command name or a
 * callback. That is deliberate: the LaTeX goes straight into the math field, which
 * is the same representation the field reads and writes, so the keypad cannot
 * drift into a second vocabulary the parser does not understand. A key whose
 * LaTeX the canonical AST cannot read is a key that should not exist, which is why
 * `plannedKey` disables rather than pretends.
 *
 * `insert` may contain placeholders, which MathLive understands:
 *
 * - `#@` stands for whatever is currently selected, so pressing a fraction key
 *   with something selected moves it into the numerator rather than discarding it;
 * - `#?` is an empty box the caret lands in;
 * - `#0`, `#1`, ... are further boxes.
 *
 * Some keys cannot be expressed as LaTeX at all — backspace and Enter act on the
 * editor rather than on the formula. Those are `actionKey`.
 */
interface KeyBase {
  /**
   * What the button shows.
   *
   * Written as plain text with Unicode mathematics — `÷`, `√`, `xⁿ`, `a⁄b`, `π` —
   * rather than typeset LaTeX. Typesetting each face would mean one editor instance
   * per key, which is dozens of TeX engines for a keypad; and a key's face is an
   * icon, not a formula, so plain text is both cheaper and clearer.
   */
  readonly label: string;
  /** Read aloud by a screen reader, and shown as a tooltip. */
  readonly title: string;
  /** Span two columns, for the keys that deserve a larger target. */
  readonly wide?: boolean;
}

/** A key that inserts LaTeX at the caret. */
export interface InsertKey extends KeyBase {
  readonly kind: 'insert';
  readonly insert: string;
  readonly disabled?: false;
}

/** A key that acts on the editor rather than inserting anything. */
export interface ActionKey extends KeyBase {
  readonly kind: 'action';
  readonly action: 'backspace' | 'enter';
}

/**
 * A key for mathematics the expression language does not read yet.
 *
 * It inserts nothing and cannot be pressed. It exists so the roadmap is visible
 * where someone would reach for it, without a button that returns a wrong answer.
 */
export interface PlannedKey extends KeyBase {
  readonly kind: 'planned';
}

export type KeypadKey = InsertKey | ActionKey | PlannedKey;

/**
 * A row of the keypad.
 *
 * `keys` lays its entries out in equal columns, so a digit grid stays aligned.
 * `wrap` lets entries flow and wrap, which is what a list of function names wants.
 */
export type KeypadRow =
  | { readonly kind: 'keys'; readonly keys: readonly KeypadKey[] }
  | { readonly kind: 'wrap'; readonly keys: readonly KeypadKey[] }
  | { readonly kind: 'heading'; readonly title: string }
  | { readonly kind: 'note'; readonly text: string };

export interface KeypadPage {
  readonly id: string;
  /** The tab label. */
  readonly label: string;
  /** Read aloud for the tab. */
  readonly title: string;
  readonly rows: readonly KeypadRow[];
}

export interface KeypadConfig {
  readonly pages: readonly KeypadPage[];
}

/** A key that inserts a plain LaTeX fragment. */
export function key(label: string, insert: string, title: string): InsertKey {
  return { kind: 'insert', label, insert, title };
}

/** A key whose face is a mathematical glyph. */
export function mathKey(label: string, insert: string, title: string): InsertKey {
  return { kind: 'insert', label, insert, title };
}

/** A key that acts on the editor. */
export function actionKey(
  label: string,
  action: ActionKey['action'],
  title: string,
  wide = false,
): ActionKey {
  return { kind: 'action', label, action, title, wide };
}

/** A key for mathematics that the expression language does not have yet. */
export function plannedKey(label: string, title: string): PlannedKey {
  return { kind: 'planned', label, title };
}

/**
 * A function key: inserts the command followed by an empty argument box, and shows
 * the function's own name as its face.
 */
export function functionKey(command: string, title: string): InsertKey {
  return key(command, `\\${command}\\left(#?\\right)`, title);
}
