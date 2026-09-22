/**
 * Shared test helpers.
 *
 * The workspace's line sources are LaTeX. Tests are written in the plain syntax
 * because it is far more readable, and converted here through the canonical AST —
 * which is also a quiet check that the conversion works on every expression the tests
 * use.
 */
import { plainToLatex } from '@mathviz/mathcore';
import { WorkspaceStore, resetLineIds } from '../src/state/workspaceStore';
import { subsystemById, type SubsystemId } from '../src/subsystems';

/** Convert readable plain-text expressions into the LaTeX the editor stores. */
export function latex(...expressions: readonly string[]): string[] {
  return expressions.map(plainToLatex);
}

/** The same conversion for a single expression, which is what an edit needs. */
export function toLatex(expression: string): string {
  return plainToLatex(expression);
}

/**
 * A store seeded with expressions written in the plain syntax.
 *
 * The drawable kinds come from the subsystem definition rather than from a second
 * copy here: they decide what every view can draw, and a copy that drifted would
 * make the tests agree with themselves and disagree with the application.
 */
export function makeStore(
  initialExpressions: readonly string[] = [],
  subsystem: SubsystemId = 'complex',
): WorkspaceStore {
  resetLineIds();
  return new WorkspaceStore({
    subsystem,
    initialLines: latex(...initialExpressions),
    drawableKinds: subsystemById(subsystem).drawableKinds,
  });
}

/**
 * A store seeded with LaTeX, for the lines that cannot be written as plain text.
 *
 * `plainToLatex` is context-free — it parses one line at a time — so it reads `f(z)` as
 * `f·z` unless `f` is a builtin. That is right for a converter and wrong for a line that
 * refers to a function another line defines, which a contour integral always does. Such
 * lines are given as the LaTeX the editor would have produced.
 */
export function makeStoreFromLatex(
  initialLatex: readonly string[],
  subsystem: SubsystemId = 'complex',
): WorkspaceStore {
  resetLineIds();
  return new WorkspaceStore({
    subsystem,
    initialLines: [...initialLatex],
    drawableKinds: subsystemById(subsystem).drawableKinds,
  });
}

/** The LaTeX of every line, for assertions about what was typed. */
export function lineSources(store: WorkspaceStore): string[] {
  return store.getState().lines.map((line) => line.latex);
}
