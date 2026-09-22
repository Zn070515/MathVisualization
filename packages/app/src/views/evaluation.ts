/**
 * Evaluating the active expression at a point.
 *
 * Four places needed this and each built it: the field view, the mapped grid, the
 * plot, and the readout. They agreed by maintenance rather than by construction,
 * which is the kind of agreement that holds until someone changes one of them —
 * and the readout is the one place where a disagreement would be worst, because
 * its whole job is to print the value of what the view is drawing.
 *
 * The rule they all encode is what the plane coordinate *means*, and it comes
 * from the bindings rather than from an assumption:
 *
 * - a complex variable *is* the point,
 * - a real variable of a scalar field is one coordinate of it, so `f(x, y)`
 *   takes `x` from the horizontal axis and `y` from the vertical one.
 *
 * `f(z)` and `f(x, y)` are then the same code path, which is the same statement
 * the type system makes one level up.
 */
import {
  type Complex,
  type MathIssue,
  type Result,
  type UserFunctionDefinition,
  cx,
  evaluateScalar,
  makeEnvironment,
} from '@mathviz/mathcore';
import type { ActiveExpression } from '../state/workspaceStore';

export interface PointEvaluation {
  /**
   * Whether the point is bound to anything.
   *
   * False means the expression has no variable living on the plane — a function
   * of a single real parameter, say — so a view that draws a plane has nothing
   * meaningful to draw and should say so rather than draw a constant.
   */
  readonly hasComplexVariable: boolean;

  /**
   * The expression's free variables, in the order the bindings give them.
   *
   * A view that lays one of them along an axis has to name that axis, and the
   * name belongs to the mathematician — `t` for a signal, `x` for a function —
   * not to the view.
   */
  readonly variableNames: readonly string[];

  /** The value at a plane point, carrying the evaluator's reason when there is none. */
  evaluate(point: Complex): Result<Complex, MathIssue>;

  /**
   * The value, or null where there is none.
   *
   * What a view wants: a view either puts a mark down or leaves a gap, and the
   * gap is the same gap whether the expression was undefined there or the
   * variable was never bound. The readout is the caller that needs the reason
   * instead, which is why both exist.
   */
  valueAt(point: Complex): Complex | null;
}

/**
 * Bind the active expression's variables, ready to evaluate at a point.
 *
 * Returns null when there is nothing to evaluate — no expression, or one that
 * has not parsed — so that callers keep the plain "nothing to draw" path rather
 * than having to distinguish an absent expression from an undefined value.
 */
export function makePointEvaluation(
  active: ActiveExpression | null,
  parameterValues: ReadonlyMap<string, number>,
  functions: ReadonlyMap<string, UserFunctionDefinition>,
): PointEvaluation | null {
  const body = active?.entry.statement?.body;
  const bindings = active?.bindings;
  if (body === undefined || bindings === undefined) return null;

  // Built once per expression, not once per sample: measuring a field's range
  // evaluates thousands of points, and rebuilding the environment for each of
  // them would dominate the cost of drawing.
  const environment = makeEnvironment({
    values: [...parameterValues].map(([name, value]) => [name, cx(value, 0)] as const),
    functions: [...functions],
  });

  const hasComplexVariable = [...bindings.values()].some((binding) => binding.kind === 'complex');

  const evaluate = (point: Complex): Result<Complex, MathIssue> => {
    const values = new Map(environment.values);
    for (const [name, binding] of bindings) {
      values.set(
        name,
        binding.kind === 'complex' ? point : cx(binding.axis === 0 ? point.re : point.im, 0),
      );
    }
    return evaluateScalar(body, { values, functions: environment.functions });
  };

  return {
    hasComplexVariable,
    variableNames: [...bindings.keys()],
    evaluate,
    valueAt: (point) => {
      const result = evaluate(point);
      return result.ok ? result.value : null;
    },
  };
}
