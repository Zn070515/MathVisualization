/**
 * Shared test helpers.
 *
 * The workspace's line sources are LaTeX. Tests are written in the plain syntax
 * because it is far more readable, and converted here through the canonical AST —
 * which is also a quiet check that the conversion works on every expression the tests
 * use.
 */
import { plainToLatex, type MathObjectKind } from '@mathviz/mathcore';
import { WorkspaceStore, resetLineIds } from '../src/state/workspaceStore';
import type { SubsystemId } from '../src/subsystems';

const DRAWABLE_KINDS: Readonly<Record<SubsystemId, readonly MathObjectKind[]>> = {
  complex: ['complex-function', 'complex-path', 'real-function'],
  transforms: ['real-function', 'complex-path'],
  calculus: ['scalar-field', 'real-function'],
};

/** Convert readable plain-text expressions into the LaTeX the editor stores. */
export function latex(...expressions: readonly string[]): string[] {
  return expressions.map(plainToLatex);
}

/** A store seeded with expressions written in the plain syntax. */
export function makeStore(
  initialExpressions: readonly string[] = [],
  subsystem: SubsystemId = 'complex',
): WorkspaceStore {
  resetLineIds();
  return new WorkspaceStore({
    subsystem,
    initialLines: latex(...initialExpressions),
    drawableKinds: DRAWABLE_KINDS[subsystem],
  });
}

/** The LaTeX of every line, for assertions about what was typed. */
export function lineSources(store: WorkspaceStore): string[] {
  return store.getState().lines.map((line) => line.latex);
}
