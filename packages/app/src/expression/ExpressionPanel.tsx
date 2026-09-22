/**
 * The expression panel.
 *
 * Owns the list, focus, keyboard flow and the parameters the focused expression
 * depends on. Everything mathematical comes from the store, which in turn comes
 * from the core; this component decides only what to show and when.
 *
 * Keyboard flow is deliberately list-like, because a mathematician entering an
 * expression should not have to reach for the mouse: Enter appends a line, the
 * arrow keys move between lines, and Backspace in an empty line deletes it.
 */
import { useCallback, useMemo } from 'react';
import { parametersUsedBy, type WorkspaceStore } from '../state/workspaceStore';
import { useStore } from '../state/store';
import { ExpressionRow } from './ExpressionRow';
import { subsystemById } from '../subsystems';

export function ExpressionPanel({ store }: { store: WorkspaceStore }): React.JSX.Element {
  const state = useStore(store, (current) => current);
  const { lines, workspace, focusedLineId, parameterValues } = state;

  const definition = subsystemById(state.subsystem);
  const drawableKinds = useMemo(() => new Set(definition.drawableKinds), [definition]);

  const focusIndex = lines.findIndex((line) => line.id === focusedLineId);

  const navigate = useCallback(
    (fromIndex: number, direction: -1 | 1) => {
      const target = lines[fromIndex + direction];
      if (target !== undefined) store.focusLine(target.id);
    },
    [lines, store],
  );

  return (
    <section className="panel" aria-label="Expressions">
      <header className="panel__header">
        <h2 className="panel__title">Expressions</h2>
        <span className="panel__hint">Enter for a new line</span>
      </header>

      <ol className="panel__list">
        {lines.map((line, index) => {
          const entry = workspace.entries.find((candidate) => candidate.id === line.id);
          const drawable =
            entry?.type !== undefined &&
            entry.type !== null &&
            drawableKinds.has(entry.type.classification.kind);

          // Only the parameters this expression actually mentions become sliders
          // on its row. The core answers which those are, from the tree.
          const mentioned = entry === undefined ? [] : parametersUsedBy(entry, workspace);
          const parameters = workspace.parameters
            .filter(
              (parameter) => parameter.slider && mentioned.includes(parameter.name),
            )
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
              index={index}
              focused={line.id === focusedLineId}
              drawable={drawable}
              parameters={parameters}
              onSourceChange={(source) => {
                store.setLineSource(line.id, source);
              }}
              onFocus={() => {
                store.focusLine(line.id);
              }}
              onRemove={() => {
                store.clearOrRemoveLine(line.id);
              }}
              onEnterAtEnd={() => {
                // The new line goes directly below the one being edited, which is
                // where a list of expressions grows from.
                store.insertLineAfter(line.id);
              }}
              onNavigate={(direction) => {
                navigate(index, direction);
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

      <div className="panel__footer">
        <button
          type="button"
          className="panel__add"
          onClick={() => {
            store.addLine('');
          }}
        >
          Add expression
        </button>
        <a
          className="panel__examples"
          href={`#${definition.id}-examples`}
          onClick={(event) => {
            event.preventDefault();
            const example =
              definition.examples[Math.floor(Math.random() * definition.examples.length)];
            if (example !== undefined) store.addLine(example);
          }}
        >
          Insert an example
        </a>
      </div>

      {focusIndex === -1 && lines.length === 0 && (
        <p className="panel__empty">
          Nothing here yet. Write an expression, for example {definition.examples[0]}.
        </p>
      )}

    </section>
  );
}
