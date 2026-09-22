/**
 * The mathematical keypad.
 *
 * Pinned under the expression list, so it is the one part of the panel that does not
 * scroll away. It drives the focused field through the field's handle: a press
 * inserts LaTeX at the caret, and everything about *where* the insertion lands is
 * the editor's business.
 *
 * Two details make the difference between a keypad that works and one that fights
 * the editor:
 *
 * 1. **Focus is never stolen.** Every button cancels its own pointer-down, so
 *    pressing a key does not move focus out of the formula. Without this the caret
 *    would be lost on every press and the insertion would land nowhere.
 * 2. **The insertion goes to the caret, not to the end.** The handle calls the
 *    editor's own insert, which replaces the selection when there is one — so
 *    selecting `z+1` and pressing the fraction key wraps it rather than discarding
 *    it.
 */
import { useState } from 'react';
import type { SubsystemId } from '../subsystems';
import { keypadFor } from './keypad';
import type { KeypadKey, KeypadRow } from './keypad/types';

export interface MathKeypadProps {
  readonly subsystem: SubsystemId;
  /** Insert LaTeX at the caret of the focused field. */
  readonly onInsert: (latex: string) => void;
  /** Act on the editor rather than insert. */
  readonly onAction: (action: 'backspace' | 'enter') => void;
  /** Collapse the keypad. */
  readonly onClose: () => void;
}

export function MathKeypad({
  subsystem,
  onInsert,
  onAction,
  onClose,
}: MathKeypadProps): React.JSX.Element {
  const config = keypadFor(subsystem);
  const [activePageId, setActivePageId] = useState(config.pages[0]?.id ?? 'numeric');
  const activePage = config.pages.find((page) => page.id === activePageId) ?? config.pages[0];

  return (
    <section className="keypad" aria-label="Mathematics keypad">
      <div className="keypad__tabs" role="tablist" aria-label="Keypad pages">
        {config.pages.map((page) => (
          <button
            key={page.id}
            type="button"
            role="tab"
            aria-selected={page.id === activePage?.id}
            aria-controls={`keypad-page-${page.id}`}
            className={
              page.id === activePage?.id ? 'keypad__tab keypad__tab--active' : 'keypad__tab'
            }
            // Cancelling the pointer-down keeps the caret in the formula while the
            // tab itself takes the click.
            onPointerDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              setActivePageId(page.id);
            }}
          >
            {page.label}
          </button>
        ))}
        <button
          type="button"
          className="keypad__close"
          aria-label="Hide the keypad"
          onPointerDown={(event) => {
            event.preventDefault();
          }}
          onClick={onClose}
        >
          ⌄
        </button>
      </div>

      <div
        className="keypad__pages"
        id={`keypad-page-${activePage?.id ?? 'numeric'}`}
        role="tabpanel"
        aria-label={activePage?.title ?? 'Keypad'}
      >
        {activePage?.rows.map((row, index) => (
          <KeypadRowView key={`${activePage.id}-${index}`} row={row} onInsert={onInsert} onAction={onAction} />
        ))}
      </div>
    </section>
  );
}

function KeypadRowView({
  row,
  onInsert,
  onAction,
}: {
  row: KeypadRow;
  onInsert: (latex: string) => void;
  onAction: (action: 'backspace' | 'enter') => void;
}): React.JSX.Element | null {
  switch (row.kind) {
    case 'heading':
      return <h3 className="keypad__heading">{row.title}</h3>;
    case 'note':
      return <p className="keypad__note">{row.text}</p>;
    case 'keys':
      return (
        <div className="keypad__row">
          {row.keys.map((entry) => (
            <KeypadButton
              key={`${entry.label}-${entry.kind}`}
              entry={entry}
              onInsert={onInsert}
              onAction={onAction}
            />
          ))}
        </div>
      );
    case 'wrap':
      return (
        <div className="keypad__wrap">
          {row.keys.map((entry) => (
            <KeypadButton
              key={`${entry.label}-${entry.kind}`}
              entry={entry}
              onInsert={onInsert}
              onAction={onAction}
            />
          ))}
        </div>
      );
  }
}

function KeypadButton({
  entry,
  onInsert,
  onAction,
}: {
  entry: KeypadKey;
  onInsert: (latex: string) => void;
  onAction: (action: 'backspace' | 'enter') => void;
}): React.JSX.Element {
  const wide = entry.wide === true ? ' keypad__key--wide' : '';

  if (entry.kind === 'planned') {
    return (
      <button
        type="button"
        className={`keypad__key keypad__key--planned${wide}`}
        disabled
        title={entry.title}
        aria-label={entry.title}
      >
        <span className="keypad__key-text">{entry.label}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`keypad__key keypad__key--${entry.kind}${wide}`}
      title={entry.title}
      aria-label={entry.title}
      onPointerDown={(event) => {
        // The whole point: the formula keeps the caret.
        event.preventDefault();
      }}
      onClick={() => {
        if (entry.kind === 'action') onAction(entry.action);
        else onInsert(entry.insert);
      }}
    >
      <span className="keypad__key-text">{entry.label}</span>
    </button>
  );
}
