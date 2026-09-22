/**
 * The expression panel.
 *
 * The whole learning surface, in the order it is used:
 *
 * ```text
 * ┌──────────────────────────┐
 * │                          │
 * │   the expression list    │   scrolls
 * │                          │
 * ├──────────────────────────┤
 * │ +                    ⌨   │   fixed
 * ├──────────────────────────┤
 * │   the mathematical       │   fixed, and toggled by ⌨
 * │   keypad                 │
 * └──────────────────────────┘
 * ```
 *
 * There is no panel heading. Someone looking at a list of formulas knows what it is,
 * and a title reading "Expressions" is chrome that pushes the first formula down.
 * The first row is focused when the subsystem opens, so typing can start without any
 * preliminary click.
 *
 * The keypad holds the bottom of the panel, because it is fixed: it must not scroll
 * away with the list, and the analysis disclosure that used to live here has moved
 * to the canvas side, where it does not compete with input.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  parametersUsedBy,
  selectActiveExpression,
  type WorkspaceStore,
} from '../state/workspaceStore';
import { useStore } from '../state/store';
import { ExpressionRow } from './ExpressionRow';
import { ValueLine } from './ValueLine';
import { MathKeypad } from './MathKeypad';
import type { MathFieldHandle, MoveOutDirection } from './mathInputAdapter';

export interface ExpressionPanelProps {
  readonly store: WorkspaceStore;
  /** Whether the keypad is open. Owned by the page so the canvas can respond to it. */
  readonly keypadOpen: boolean;
  readonly onKeypadToggle: () => void;
}

export function ExpressionPanel({
  store,
  keypadOpen,
  onKeypadToggle,
}: ExpressionPanelProps): React.JSX.Element {
  const state = useStore(store, (current) => current);
  const { lines, workspace, focusedLineId, parameterValues } = state;

  // One handle per line, so the keypad can insert into whichever line is focused.
  const handles = useRef(new Map<string, MathFieldHandle>());
  const registerHandle = useCallback((lineId: string, handle: MathFieldHandle | null) => {
    if (handle === null) handles.current.delete(lineId);
    else handles.current.set(lineId, handle);
  }, []);

  // Which line a canvas is drawing, marked on the row. Depends on exactly what decides
  // it — the workspace and the focus — so that moving the pointer does not recompute it.
  const drawnLineId = useMemo(
    () => selectActiveExpression(workspace, focusedLineId, store.drawableKinds)?.entry.id ?? null,
    [workspace, focusedLineId, store.drawableKinds],
  );

  /**
   * Put the caret in the line the store says is focused.
   *
   * This is what makes the keyboard flow work end to end: Enter, the keypad's return
   * key, and an arrow that runs out of structure all move the *store's* focus to
   * another line, and the caret has to follow or the next keystroke lands in the wrong
   * formula. It also focuses the first line when a subsystem opens, so typing can start
   * without a preliminary click.
   *
   * Calling focus on the element that already has it is a no-op, so a click into a row
   * is not overridden — and a keypad press never changes the focused line, so it cannot
   * pull the caret away from the formula being written.
   */
  useEffect(() => {
    if (focusedLineId === null) return;
    handles.current.get(focusedLineId)?.focus();
  }, [focusedLineId, lines.length]);

  // Moving the focused line is enough: the effect above carries the caret with it.
  const focusLineAt = useCallback(
    (index: number) => {
      const target = lines[index];
      if (target !== undefined) store.focusLine(target.id);
    },
    [lines, store],
  );

  const activeIndex = lines.findIndex((line) => line.id === focusedLineId);

  const moveOut = useCallback(
    (fromIndex: number, direction: MoveOutDirection) => {
      if (direction === 'upward' || direction === 'backward') {
        focusLineAt(fromIndex - 1);
        return;
      }
      if (direction === 'downward' || direction === 'forward') {
        // Leaving the last row downwards creates a new one, which is how a list of
        // expressions grows from the keyboard.
        if (fromIndex === lines.length - 1) store.addLine('');
        else focusLineAt(fromIndex + 1);
      }
    },
    [focusLineAt, lines.length, store],
  );

  const insertAtCaret = useCallback(
    (latex: string) => {
      const handle = focusedLineId === null ? undefined : handles.current.get(focusedLineId);
      if (handle === undefined) {
        // Nothing is focused: start a line, then insert into it.
        const id = store.addLine('');
        queueMicrotask(() => {
          handles.current.get(id)?.insert(latex);
        });
        return;
      }
      handle.insert(latex);
    },
    [focusedLineId, store],
  );

  const actOnEditor = useCallback(
    (action: 'backspace' | 'enter') => {
      if (action === 'enter') {
        if (focusedLineId === null) store.addLine('');
        else store.insertLineAfter(focusedLineId);
        return;
      }
      const handle = focusedLineId === null ? undefined : handles.current.get(focusedLineId);
      handle?.backspace();
    },
    [focusedLineId, store],
  );

  return (
    <section className="panel" aria-label="Expressions">
      <div className="panel__scroll">
        <ol className="panel__list">
          {lines.map((line, index) => {
            const entry = workspace.entries.find((candidate) => candidate.id === line.id);
            const drawable =
              entry?.type != null && store.drawableKinds.has(entry.type.classification.kind);

            const mentioned = entry === undefined ? [] : parametersUsedBy(entry, workspace);
            const parameters = workspace.parameters
              .filter((parameter) => parameter.slider && mentioned.includes(parameter.name))
              .map((parameter) => ({
                name: parameter.name,
                value: parameterValues.get(parameter.name) ?? parameter.value.re,
                defined: parameter.value.re,
              }));

            return (
              <ExpressionRow
                key={line.id}
                line={line}
                entry={entry}
                valueLine={<ValueLine store={store} entry={entry} />}
                focused={line.id === focusedLineId}
                drawn={line.id === drawnLineId}
                drawable={drawable}
                parameters={parameters}
                handleRef={(handle: MathFieldHandle | null) => {
                  registerHandle(line.id, handle);
                }}
                onLatexChange={(latex) => {
                  store.setLineLatex(line.id, latex);
                }}
                onFocus={() => {
                  store.focusLine(line.id);
                }}
                onRemove={() => {
                  store.clearOrRemoveLine(line.id);
                }}
                onEnter={() => {
                  store.insertLineAfter(line.id);
                }}
                onMoveOut={(direction) => {
                  moveOut(index, direction);
                }}
                onParameterChange={(name, value) => {
                  store.setParameter(name, value);
                }}
                onParameterReset={(name) => {
                  store.resetParameter(name);
                }}
              />
            );
          })}
        </ol>

        {lines.length === 0 && (
          <p className="panel__empty">
            Nothing here yet. Press + to add an expression, or open the keypad.
          </p>
        )}
      </div>

      <div className="panel__actions">
        <button
          type="button"
          className="panel__add"
          onClick={() => {
            store.addLine('');
          }}
          aria-label="Add an expression"
          title="Add an expression"
        >
          +
        </button>
        <button
          type="button"
          className={
            keypadOpen ? 'panel__keypad-toggle panel__keypad-toggle--on' : 'panel__keypad-toggle'
          }
          aria-expanded={keypadOpen}
          aria-controls="math-keypad"
          onClick={onKeypadToggle}
          title={keypadOpen ? 'Hide the keypad' : 'Show the keypad'}
        >
          <span aria-hidden="true">⌨</span>
          <span className="visually-hidden">
            {keypadOpen ? 'Hide the mathematical keypad' : 'Show the mathematical keypad'}
          </span>
        </button>
      </div>

      {keypadOpen && (
        <div id="math-keypad">
          <MathKeypad
            subsystem={state.subsystem}
            onInsert={insertAtCaret}
            onAction={actOnEditor}
            onClose={onKeypadToggle}
          />
        </div>
      )}

      {activeIndex === -1 && lines.length === 0 && (
        <p className="panel__note">Type mathematics directly, or use the keypad below.</p>
      )}
    </section>
  );
}
