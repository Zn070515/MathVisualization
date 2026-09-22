/**
 * One line of the expression panel.
 *
 * Three things are shown at three levels of prominence, which is the whole of the
 * progressive-disclosure idea (GOAL.md 5.2):
 *
 * 1. Always: the expression, its inferred type badge, and whether it is
 *    drawable. That is enough to use the product.
 * 2. On focus: the parameter sliders the expression depends on.
 * 3. On request: the canonical form of the tree, what the parser built, and any
 *    problem with it.
 *
 * The input is a text field with a mathematical face rather than a rich editor.
 * Stating that plainly: a visual mathematical editor with real fractions,
 * integrals and contour notation is a component in its own right (GOAL.md 12) and
 * is not built yet. What is here is honest about being a text field, styled and
 * wired so that the rest of the system — parsing, typing, drawing — is real.
 */
import { useEffect, useRef, useState } from 'react';
import {
  type MathObjectKind,
  type WorkspaceEntry,
  exprToText,
  signatureToString,
} from '@mathviz/mathcore';
import type { ExpressionLine } from '../state/workspaceStore';
import { ParameterSlider } from './ParameterSlider';

export interface ExpressionRowProps {
  readonly line: ExpressionLine;
  readonly entry: WorkspaceEntry | undefined;
  readonly index: number;
  readonly focused: boolean;
  readonly drawable: boolean;
  readonly parameters: readonly { name: string; value: number; defined: number }[];
  readonly onSourceChange: (source: string) => void;
  readonly onFocus: () => void;
  readonly onBlur?: () => void;
  readonly onRemove: () => void;
  readonly onEnterAtEnd: () => void;
  readonly onNavigate: (direction: -1 | 1) => void;
  readonly onParameterChange: (name: string, value: number) => void;
  readonly onParameterReset: (name: string) => void;
}

/** The kind badge: compact, and the same vocabulary the type system uses. */
const KIND_LABELS: Readonly<Record<MathObjectKind, string>> = {
  scalar: 'value',
  'real-function': 'function',
  'complex-function': 'complex',
  'scalar-field': 'scalar field',
  'vector-field': 'vector field',
  'complex-path': 'path',
  'parametric-curve': 'curve',
  'parametric-surface': 'surface',
  'transform-pair': 'transform pair',
  unknown: 'unknown',
};

export function ExpressionRow({
  line,
  entry,
  index,
  focused,
  drawable,
  parameters,
  onSourceChange,
  onFocus,
  onBlur,
  onRemove,
  onEnterAtEnd,
  onNavigate,
  onParameterChange,
  onParameterReset,
}: ExpressionRowProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [showDetail, setShowDetail] = useState(false);

  // A line created for the user should be ready to type into.
  useEffect(() => {
    if (focused && line.source === '' && document.activeElement !== inputRef.current) {
      inputRef.current?.focus();
    }
  }, [focused, line.source]);

  const parseError = entry?.parseError ?? null;
  const typeIssue = entry?.typeIssue ?? null;
  const problem = parseError ?? typeIssue;
  const signature = entry?.type?.signature;
  const kind = entry?.type?.classification.kind;

  const status =
    problem !== null ? 'invalid' : signature === undefined ? 'incomplete' : 'valid';

  return (
    <li
      className={[
        'row',
        focused ? 'row--focused' : '',
        status === 'invalid' ? 'row--invalid' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="row__main">
        <span className="row__index" aria-hidden="true">
          {String(index + 1).padStart(2, '0')}
        </span>

        <label className="row__field">
          <span className="visually-hidden">Expression {index + 1}</span>
          <input
            ref={inputRef}
            className="row__input"
            value={line.source}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            aria-invalid={status === 'invalid'}
            aria-describedby={problem === null ? undefined : `${line.id}-problem`}
            onChange={(event) => {
              onSourceChange(event.target.value);
            }}
            onFocus={onFocus}
            onBlur={onBlur}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onEnterAtEnd();
                return;
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                onNavigate(1);
                return;
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                onNavigate(-1);
                return;
              }
              // Backspace in an empty line removes it, as a list of expressions
              // should behave.
              if (
                event.key === 'Backspace' &&
                line.source === '' &&
                event.currentTarget.selectionStart === 0
              ) {
                event.preventDefault();
                onRemove();
              }
            }}
          />
        </label>

        <div className="row__badges">
          {signature !== undefined && (
            <span
              className={`badge badge--type${drawable ? ' badge--drawable' : ''}`}
              title={
                drawable
                  ? `${KIND_LABELS[kind ?? 'unknown']}, drawn in this subsystem`
                  : `${KIND_LABELS[kind ?? 'unknown']}, not drawn in this subsystem`
              }
            >
              {signatureToString(signature)}
            </span>
          )}
          {signature !== undefined && (
            <span className="row__kind">{KIND_LABELS[kind ?? 'unknown']}</span>
          )}
        </div>

        <div className="row__actions">
          {problem !== null && (
            <button
              type="button"
              className="row__detail-toggle"
              aria-expanded={showDetail}
              onClick={() => {
                setShowDetail((open) => !open);
              }}
            >
              {showDetail ? 'Hide' : 'Why?'}
            </button>
          )}
          <button
            type="button"
            className="row__remove"
            onClick={onRemove}
            title="Delete this line"
            aria-label={`Delete expression ${index + 1}`}
          >
            ×
          </button>
        </div>
      </div>

      {parameters.length > 0 && (
        <div className="row__parameters">
          {parameters.map((parameter) => (
            <ParameterSlider
              key={parameter.name}
              name={parameter.name}
              value={parameter.value}
              defined={parameter.defined}
              onChange={(value) => {
                onParameterChange(parameter.name, value);
              }}
              onReset={() => {
                onParameterReset(parameter.name);
              }}
            />
          ))}
        </div>
      )}

      {showDetail && problem !== null && (
        <p className="row__problem" id={`${line.id}-problem`} role="status">
          {problem.message}
        </p>
      )}

      {showDetail && entry?.statement != null && entry.type !== null && (
        <dl className="row__detail">
          <dt>Canonical form</dt>
          <dd className="row__detail-math">{exprToText(entry.statement.body)}</dd>
          <dt>Object</dt>
          <dd>{entry.type.classification.description}</dd>
          <dt>Tree node</dt>
          <dd className="row__detail-math">{entry.statement.kind}</dd>
        </dl>
      )}
    </li>
  );
}
