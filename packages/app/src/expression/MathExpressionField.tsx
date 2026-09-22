/**
 * The structured math field.
 *
 * A thin React wrapper around MathLive. It does four things the raw element does
 * not do for us:
 *
 * 1. **Controlled value without fighting the caret.** The element owns its own
 *    editing state, so the value is written only when it genuinely differs from
 *    what the element holds. A blind write on every render would reset the caret
 *    to the start on each keystroke.
 * 2. **Structural navigation first, list navigation second.** MathLive emits
 *    `move-out` only when the caret has nowhere left to go *within* the formula, so
 *    arrow keys move between numerator and denominator before they move between
 *    rows. That is the correct precedence, and it comes from the editor rather than
 *    from us guessing.
 * 3. **Enter, and Backspace on an empty line.** Enter in a formula is not a line
 *    break, and Backspace in a blank row should remove the row.
 * 4. **An imperative handle for the keypad.** The keypad inserts at the caret; it
 *    never reaches into the element itself.
 */
import { useCallback, useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import {
  backspace,
  configureMathField,
  insertLatex,
  isBlankLatex,
  type MathFieldElementLike,
  type MathFieldHandle,
  type MoveOutDirection,
} from './mathInputAdapter';

// Registers the `<math-field>` custom element, and brings its fonts in through
// Vite so that nothing is fetched from a content delivery network at run time.
import 'mathlive';
import 'mathlive/fonts.css';

export interface MathExpressionFieldProps {
  /** The LaTeX the field should hold. */
  readonly value: string;
  readonly onChange: (latex: string) => void;
  /** Enter was pressed, or the caret ran off the bottom: start a new expression. */
  readonly onEnter: () => void;
  /** The caret tried to leave in this direction and had nowhere to go inside. */
  readonly onMoveOut: (direction: MoveOutDirection) => void;
  /** Backspace was pressed while the field held nothing. */
  readonly onDeleteEmpty: () => void;
  readonly onFocus?: () => void;
  readonly onBlur?: () => void;
  /** Receives the handle so the keypad can insert at the caret. */
  readonly handleRef?: Ref<MathFieldHandle>;
  /** Describes the field to a screen reader. */
  readonly label: string;
  /** Marks the field as holding a line that could not be read. */
  readonly invalid?: boolean;
}

export function MathExpressionField({
  value,
  onChange,
  onEnter,
  onMoveOut,
  onDeleteEmpty,
  onFocus,
  onBlur,
  handleRef,
  label,
  invalid = false,
}: MathExpressionFieldProps): React.JSX.Element {
  const elementRef = useRef<MathFieldElementLike | null>(null);

  // The handlers are read through refs so that the imperative listeners attached to
  // the custom element never have to be torn down and re-added on a re-render.
  const handlers = useRef({ onChange, onEnter, onMoveOut, onDeleteEmpty, onFocus, onBlur });
  handlers.current = { onChange, onEnter, onMoveOut, onDeleteEmpty, onFocus, onBlur };

  useImperativeHandle(
    handleRef,
    (): MathFieldHandle => ({
      insert: (latex) => {
        const element = elementRef.current;
        return element === null ? false : insertLatex(element, latex);
      },
      backspace: () => {
        const element = elementRef.current;
        if (element !== null) backspace(element);
      },
      focus: () => {
        elementRef.current?.focus();
      },
      read: () => elementRef.current?.value ?? '',
    }),
    [],
  );

  // Write the value only when it differs. This is what keeps the caret still while
  // typing, and what lets an external change — an inserted example, a restored
  // session, an undo — reach the field.
  useEffect(() => {
    const element = elementRef.current;
    if (element === null) return;
    if (element.value !== value) element.value = value;
  }, [value]);

  // The class is set on the element rather than passed as a prop: a custom element
  // takes `class` as an attribute, and React's `className` convention does not
  // apply to it.
  useEffect(() => {
    const element = elementRef.current;
    if (element === null) return;
    element.className = invalid ? 'math-field math-field--invalid' : 'math-field';
  }, [invalid]);

  const attach = useCallback((element: MathFieldElementLike | null) => {
    elementRef.current = element;
    if (element !== null) configureMathField(element);
  }, []);

  useEffect(() => {
    const element = elementRef.current;
    if (element === null) return;

    const handleInput = (): void => {
      handlers.current.onChange(element.value);
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Enter') {
        // Enter in a formula is never a line break here.
        event.preventDefault();
        handlers.current.onEnter();
        return;
      }
      if (event.key === 'Backspace' && isBlankLatex(element.value)) {
        event.preventDefault();
        handlers.current.onDeleteEmpty();
      }
    };

    const handleMoveOut = (event: Event): void => {
      const detail = (event as CustomEvent<{ direction?: MoveOutDirection }>).detail;
      const direction = detail?.direction ?? 'forward';
      // Cancelling tells the editor that focus is being handled here, so it does
      // not also try to move it.
      event.preventDefault();
      handlers.current.onMoveOut(direction);
    };

    const handleFocus = (): void => {
      handlers.current.onFocus?.();
    };
    const handleBlur = (): void => {
      handlers.current.onBlur?.();
    };

    element.addEventListener('input', handleInput);
    element.addEventListener('keydown', handleKeyDown);
    element.addEventListener('move-out', handleMoveOut);
    element.addEventListener('focus', handleFocus);
    element.addEventListener('blur', handleBlur);

    return () => {
      element.removeEventListener('input', handleInput);
      element.removeEventListener('keydown', handleKeyDown);
      element.removeEventListener('move-out', handleMoveOut);
      element.removeEventListener('focus', handleFocus);
      element.removeEventListener('blur', handleBlur);
    };
  }, []);

  // `aria-invalid` is written as a string: a boolean would be dropped on a custom
  // element rather than rendered as "false".
  return <math-field ref={attach} aria-label={label} aria-invalid={invalid ? 'true' : 'false'} />;
}
