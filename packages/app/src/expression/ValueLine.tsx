/**
 * The value of a line that is a value.
 *
 * Every other line in the workspace is a *function*, and what you do with one is draw it.
 * A line with no free variables is a number, and until now the workspace had nowhere to
 * put a number: `∮_gamma f(z) dz` typed correctly and showed nothing at all, which makes a
 * correct answer indistinguishable from a broken one.
 *
 * What is shown, and why each part is more than formatting:
 *
 * - **the value**, in the same notation the readout uses, so the two cannot disagree
 *   about how a complex number is written;
 * - **the interval**, because the integral is over one and the line does not say which;
 * - **whether the path closed**, when it did not. A `∮` over an open path is a claim the
 *   picture cannot make good on — the residue theorem applies to closed contours and to
 *   nothing else — so the number is shown with the fact that qualifies it;
 * - **the residue theorem's own answer**, when the contour is closed. GOAL.md section 7.17
 *   asks for the comparison, and it is worth having because the two sides come from
 *   *different* methods: quadrature along the reader's contour, against circle quadrature
 *   at each enclosed pole. Checking an answer against itself would prove nothing, which is
 *   why which poles are inside is settled by the winding number — an integer, from the
 *   argument principle — and not by the quadrature it is being compared with.
 *
 * Nothing is guessed when evaluation fails: the evaluator's own sentence is shown, which
 * is the same discipline the analysis panel uses for the symbolic engine.
 */
import { useMemo } from 'react';
import {
  CONTOUR_PARAMETER_TEXT,
  asComplex,
  cabs,
  csub,
  displayComplex,
  displayNumberToText,
  evaluate,
  evaluateContourDetails,
  workspaceEnvironment,
  type ContourDetails,
  type DisplayComplex,
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
      readonly value: DisplayComplex;
      readonly contour: ContourDetails | null;
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
    // integral whose interval, closure or residues could be stated, and saying nothing is
    // better than picking one of them at random.
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

  const contour = outcome.contour;

  return (
    <p className="expr-row__value">
      <span className="expr-row__value-equals">=</span>
      <span className="expr-row__value-number">
        <ComplexText value={outcome.value} />
      </span>

      {contour !== null && (
        <>
          <span className="expr-row__value-note">over {CONTOUR_PARAMETER_TEXT}</span>

          {!contour.integral.closed && (
            <span className="expr-row__value-warning">
              the path does not close — its ends miss each other by{' '}
              {displayNumberToText(viewNumber(contour.integral.closureGap))} — so this is an
              integral over an open contour, and the residue theorem does not apply
            </span>
          )}

          {contour.integral.closed && <ResidueCheck contour={contour} />}
        </>
      )}
    </p>
  );
}

/**
 * The residue theorem's side of the comparison.
 *
 * The verdict is stated against the integral's *own* error estimate rather than a
 * tolerance invented here: that number is the quadrature's measured accuracy, so asking
 * whether the other side falls inside it is asking a real question, and a disagreement
 * that falls outside is worth the ink it takes to say so.
 */
function ResidueCheck({ contour }: { readonly contour: ContourDetails }): React.JSX.Element {
  const { integral, enclosed, residueSum } = contour;

  if (enclosed.length === 0) {
    return (
      <span className="expr-row__value-note">
        no poles inside, so Cauchy&rsquo;s theorem says the integral is zero
      </span>
    );
  }

  const unmeasured = enclosed.filter((pole) => pole.residue === null).length;
  if (unmeasured > 0) {
    return (
      <span className="expr-row__value-note">
        {enclosed.length} pole{enclosed.length === 1 ? '' : 's'} inside, but{' '}
        {unmeasured === 1 ? 'one has' : 'some have'} no residue a circle can isolate, so the
        theorem is not being checked here
      </span>
    );
  }

  const difference = cabs(csub(integral.value, residueSum));
  const within = difference <= integral.estimatedError;
  const tolerance = displayNumberToText(viewNumber(integral.estimatedError));

  return (
    <span className={within ? 'expr-row__value-note' : 'expr-row__value-warning'}>
      {enclosed.length} pole{enclosed.length === 1 ? '' : 's'} inside · 2&pi;i&thinsp;&Sigma;&thinsp;Res
      = <ComplexText value={displayComplex(residueSum, { digits: 6 })} /> ·{' '}
      {within
        ? `the same number to within the integral's error estimate (${tolerance})`
        : `which differs from the integral by more than its error estimate (${tolerance})`}
    </span>
  );
}
