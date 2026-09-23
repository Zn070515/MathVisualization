/**
 * One line of the expression list.
 *
 * The row is a mathematical expression, and it looks like one. Everything that was
 * previously stacked beside it — a line number, a type badge, a kind label, a "Why?"
 * button and a delete cross — is either gone from the default view or shown only
 * when the row is hovered or focused. The type is still inferred and still
 * available; it simply no longer competes with the mathematics for attention.
 *
 * What is visible without any interaction:
 *
 * - the expression, typeset;
 * - its parameters, as sliders directly beneath it, which is where they belong;
 * - a problem, when there is one, in words.
 *
 * What appears on hover or focus: the inferred type, and the delete control. What
 * is deliberately absent: an index numeral, and any control that would do nothing.
 */
import {
  type MathObjectKind,
  type MathIssue,
  type ParseError,
  type WorkspaceEntry,
  signatureToString,
} from '@mathviz/mathcore';
import type { MathFieldHandle, MoveOutDirection } from './mathInputAdapter';
import { MathExpressionField } from './MathExpressionField';
import { ParameterSlider } from './ParameterSlider';
import type { ExpressionLine } from '../state/workspaceStore';
import type { Ref } from 'react';

export interface ExpressionRowProps {
  readonly line: ExpressionLine;
  readonly entry: WorkspaceEntry | undefined;
  readonly focused: boolean;
  /** Whether this is the line a canvas is currently drawing. */
  readonly drawn: boolean;
  readonly drawable: boolean;
  readonly parameters: readonly {
    readonly name: string;
    readonly value: number;
    readonly defined: number;
  }[];
  readonly handleRef: Ref<MathFieldHandle>;
  readonly onLatexChange: (latex: string) => void;
  readonly onFocus: () => void;
  readonly onBlur?: () => void;
  readonly onRemove: () => void;
  readonly onEnter: () => void;
  readonly onMoveOut: (direction: MoveOutDirection) => void;
  readonly onParameterChange: (name: string, value: number) => void;
  readonly onParameterReset: (name: string) => void;
  /**
   * The computed value of this line, when the line is a value.
   *
   * Passed in as an element rather than computed here: evaluating a line can mean
   * integrating a contour, which is not something to do inside a row that re-renders on
   * hover. Its own component owns that, and its own memo.
   */
  readonly valueLine?: React.ReactNode;
}

/** The kind of object, in words, for the tooltip rather than the row. */
const KIND_LABELS: Readonly<Record<MathObjectKind, string>> = {
  scalar: 'a value',
  'real-function': 'a function of one real variable',
  'complex-function': 'a function of one complex variable',
  'scalar-field': 'a scalar field',
  'vector-field': 'a vector field',
  'complex-path': 'a path in the complex plane',
  'parametric-curve': 'a parametric curve',
  'parametric-surface': 'a parametric surface',
  'transform-pair': 'a transform pair',
  'convolution-pair': 'a convolution pair',
  unknown: 'of a kind not recognised yet',
};

/**
 * True when the source is unfinished rather than wrong.
 *
 * An empty fraction and a mistyped operator are different events. Only the second
 * deserves a sentence while someone is still typing.
 */
function isUnfinished(problem: ParseError | MathIssue | null): boolean {
  return problem !== null && problem.kind === 'parse-error' && problem.incomplete === true;
}

export function ExpressionRow({
  line,
  entry,
  focused,
  drawn,
  drawable,
  parameters,
  handleRef,
  onLatexChange,
  onFocus,
  onBlur,
  onRemove,
  onEnter,
  onMoveOut,
  onParameterChange,
  onParameterReset,
  valueLine,
}: ExpressionRowProps): React.JSX.Element {
  const problem = entry?.parseError ?? entry?.typeIssue ?? null;
  const unfinished = isUnfinished(problem);
  const signature = entry?.type?.signature;
  const kind = entry?.type?.classification.kind;

  return (
    <li
      className={[
        'expr-row',
        focused ? 'expr-row--focused' : '',
        problem !== null && !unfinished ? 'expr-row--problem' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="expr-row__line">
        <MathExpressionField
          value={line.latex}
          onChange={onLatexChange}
          onEnter={onEnter}
          onMoveOut={onMoveOut}
          onDeleteEmpty={onRemove}
          onFocus={onFocus}
          onBlur={onBlur}
          handleRef={handleRef}
          invalid={problem !== null && !unfinished}
          label={
            signature === undefined ? 'Expression' : `Expression, ${KIND_LABELS[kind ?? 'unknown']}`
          }
        />

        <div className="expr-row__aside">
          {signature !== undefined && (
            <span
              className={drawable ? 'expr-row__type expr-row__type--drawn' : 'expr-row__type'}
              title={
                drawable
                  ? `${KIND_LABELS[kind ?? 'unknown']}, drawn by this subsystem`
                  : `${KIND_LABELS[kind ?? 'unknown']}, which this subsystem does not draw`
              }
            >
              {
                // A value is not a function, and `R → C` is the placeholder signature
                // inference gives it so that it has one at all. Printing that would
                // describe the filler rather than the line.
                kind === 'scalar' ? 'value' : signatureToString(signature)
              }
            </span>
          )}
          {drawn && (
            <span className="expr-row__drawn-mark" title="This is the expression being drawn" />
          )}
          <button
            type="button"
            className="expr-row__remove"
            onPointerDown={(event) => {
              event.preventDefault();
            }}
            onClick={onRemove}
            aria-label="Delete this expression"
            title="Delete this expression"
          >
            ×
          </button>
        </div>
      </div>

      {problem !== null && !unfinished && (
        <p className="expr-row__problem" role="status">
          {problem.message}
        </p>
      )}

      {valueLine}

      {parameters.length > 0 && (
        <div className="expr-row__parameters">
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
    </li>
  );
}
