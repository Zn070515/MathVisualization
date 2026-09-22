/**
 * The value of a line that is a value.
 *
 * Every other line in the workspace is a *function*, and what you do with one is draw
 * it. A line with no free variables is a number, and until now the workspace had
 * nowhere to put a number: `∮_gamma f(z) dz` typed correctly and showed nothing at all,
 * which makes a correct answer indistinguishable from a broken one.
 *
 * Three things are shown, and the second and third are the reason this is more than a
 * formatted number:
 *
 * - **the value**, in the same notation the readout uses, so the two cannot disagree
 *   about how a complex number is written;
 * - **the interval**, because the integral is over one and the line does not say which;
 * - **whether the path closed**, when it did not. A `∮` over an open path is a claim the
 *   picture cannot make good on — the residue theorem applies to closed contours and to
 *   nothing else — so the number is shown with the fact that qualifies it rather than on
 *   its own.
 *
 * Nothing is guessed when evaluation fails: the evaluator's own sentence is shown, which
 * is the same discipline the analysis panel uses for the symbolic engine.
 */
import { useMemo } from 'react';
import {
  CONTOUR_PARAMETER_TEXT,
  asComplex,
  displayComplex,
  displayNumberToText,
  evaluate,
  evaluateContourDetails,
  workspaceEnvironment,
  type ContourIntegralResult,
  type WorkspaceEntry,
} from '@mathviz/mathcore';
import { ComplexText } from '../display/NumberText';
import { viewNumber } from '../display/numbers';
import { useStore } from '../state/store';
import type { WorkspaceStore } from '../state/workspaceStore';

/** What a value line computed, or why it could not. */
type Outcome =
  | {
      readonly status: 'value';
      readonly value: ReturnType<typeof displayComplex>;
      readonly contour: ContourIntegralResult | null;
    }
  | { readonly status: 'failed'; readonly message: string };

export function ValueLine({
  store,
  entry,
}: {
  readonly store: WorkspaceStore;
  readonly entry: WorkspaceEntry | undefined;
}): React.JSX.Element | null {
  const workspace = useStore(store, (current) => current.workspace);
  const parameterValues = useStore(store, (current) => current.parameterValues);

  const statement = entry?.statement ?? null;
  const isValue = entry?.type?.classification.kind === 'scalar' && statement?.kind === 'expression';

  const outcome = useMemo((): Outcome | null => {
    if (!isValue || statement === null || statement.kind !== 'expression') return null;
    const environment = workspaceEnvironment(workspace, parameterValues);

    const result = evaluate(statement.body, environment);
    if (!result.ok) return { status: 'failed', message: result.issue.message };

    const value = asComplex(result.value);
    if (value === null) return null;

    // Only when the line *is* a contour integral: for `∮ f dz + 1` there is no single
    // integral whose interval or closure could be stated, and saying nothing is better
    // than picking one of them.
    const details = evaluateContourDetails(statement.body, environment);
    return {
      status: 'value',
      value: displayComplex(value, { digits: 6 }),
      contour: details !== null && details.ok ? details.value : null,
    };
  }, [isValue, statement, workspace, parameterValues]);

  if (outcome === null) return null;

  if (outcome.status === 'failed') {
    return (
      <p className="expr-row__value expr-row__value--problem" role="status">
        {outcome.message}
      </p>
    );
  }

  return (
    <p className="expr-row__value">
      <span className="expr-row__value-equals">=</span>
      <span className="expr-row__value-number">
        <ComplexText value={outcome.value} />
      </span>
      {outcome.contour !== null && (
        <>
          <span className="expr-row__value-note">over {CONTOUR_PARAMETER_TEXT}</span>
          {!outcome.contour.closed && (
            <span className="expr-row__value-warning">
              the path does not close — its ends miss each other by{' '}
              {displayNumberToText(viewNumber(outcome.contour.closureGap))} — so this is an integral
              over an open contour, and the residue theorem does not apply
            </span>
          )}
        </>
      )}
    </p>
  );
}
