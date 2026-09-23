/**
 * The workspace: the mathematical content of a document.
 *
 * A workspace is a list of lines, each of which is a function definition, a
 * parameter, or a bare expression. Analysing it produces the things the rest of
 * the application needs: the canonical AST of every line, the inferred type of
 * every line, the signatures of the defined functions, the parameters that can
 * be driven by a slider, and an evaluation environment.
 *
 * Everything here is pure. There is no React, no DOM and no storage in this
 * module, which is what makes workspace behaviour directly testable and what
 * keeps the mathematical model independent of the presentation layer.
 *
 * Two properties the model guarantees:
 *
 * - Order independence. `f` may be used before it is defined, and parameters may
 *   be written in any order, because function names are collected up front and
 *   parameter values are resolved on demand.
 * - A bare expression is a function. Writing `z^2` with no definition is
 *   understood as a function of `z`, with the variable's space taken from the
 *   documented naming table. This is what lets the expression-first interaction
 *   work: the user writes mathematics and the system works out what it is.
 */
import { type Expr, type Statement, collectVariableNames } from './ast';
import { type Complex, cx, isZero } from './complex';
import { spaceNameForVariable } from './conventions';
import { type MathIssue, type ParseError, type Result, fail, ok } from './errors';
import {
  type EvaluationEnvironment,
  type UserFunctionDefinition,
  evaluate,
  makeEnvironment,
} from './evaluator';
import {
  type InferenceContext,
  type InferredType,
  classifyDefinitionWith,
  classifySignatureWith,
  inferSignature,
  inferSpace,
  inferDomain,
  spaceForConventionLetter,
} from './infer';
import { detectLatexDefinition, detectLatexParameter, parseLatexStatement } from './latex';
import { detectDefinitionHeader, detectParameterName, parseStatement } from './parser';
import { type Signature, type Space, spaceToString } from './types';

/**
 * Source text of one line, with a stable identity for the UI to key on.
 *
 * `syntax` names the surface language the text is written in. Both produce the
 * same canonical AST, so nothing downstream of parsing needs to know which was
 * used. The default is plain text, which keeps every existing caller working.
 */
export interface WorkspaceInput {
  readonly id: string;
  readonly source: string;
  readonly syntax?: 'plain' | 'latex';
}

/** What a line turned out to be. */
export type EntryRole = 'definition' | 'parameter' | 'expression' | 'invalid';

/**
 * A parameter: a name bound to a value that the user can drive.
 *
 * `slider` is true when the value is real, which is what a slider can express. A
 * complex parameter such as `a = 2i` is perfectly valid mathematics but has no
 * one-dimensional slider, so it is bound without one.
 */
export interface WorkspaceParameter {
  readonly name: string;
  readonly expression: Expr;
  readonly value: Complex;
  readonly slider: boolean;
  readonly entryId: string;
}

/** One analysed line. */
export interface WorkspaceEntry {
  readonly id: string;
  readonly source: string;
  readonly role: EntryRole;
  /** The parsed statement, or null when the line did not parse. */
  readonly statement: Statement | null;
  readonly parseError: ParseError | null;
  /** Inferred type of a definition or bare expression; null when not applicable. */
  readonly type: InferredType | null;
  /** Why the line could not be given a mathematical meaning, if it could not. */
  readonly typeIssue: MathIssue | null;
}

export interface Workspace {
  readonly entries: readonly WorkspaceEntry[];
  readonly parameters: readonly WorkspaceParameter[];
  readonly functions: ReadonlyMap<string, UserFunctionDefinition>;
  readonly signatures: ReadonlyMap<string, Signature>;
  /** Every function name the workspace defines, for the parser and for completion. */
  readonly functionNames: ReadonlySet<string>;
}

/** An empty workspace, useful as an initial value and in tests. */
export const EMPTY_WORKSPACE: Workspace = {
  entries: [],
  parameters: [],
  functions: new Map(),
  signatures: new Map(),
  functionNames: new Set(),
};

/**
 * Analyse a set of lines.
 *
 * Runs in three passes. First, collect the function names so the parser can tell
 * a call from a product. Second, parse and classify every line. Third, resolve
 * signatures and parameter values, iterating until nothing new is learned, so
 * that definitions and parameters may refer to each other in any order.
 */
export function buildWorkspace(inputs: readonly WorkspaceInput[]): Workspace {
  const defined = collectNamesAcrossSyntaxes(inputs);
  const functionNames = defined.functions;

  const drafts = inputs.map((input) => {
    const parsed =
      input.syntax === 'latex'
        ? parseLatexStatement(input.source, { knownFunctions: defined.functions })
        : parseStatement(input.source, {
            knownFunctions: defined.functions,
            knownValues: defined.values,
          });

    if (!parsed.ok) {
      const entry: WorkspaceEntry = {
        id: input.id,
        source: input.source,
        role: 'invalid',
        statement: null,
        parseError: parsed.issue,
        type: null,
        typeIssue: null,
      };
      return { entry, statement: null as Statement | null };
    }
    return { entry: null as WorkspaceEntry | null, statement: parsed.value };
  });

  const duplicates = findDuplicateNames(drafts.map((draft) => draft.statement));

  // Parameter values, resolved against each other.
  const parameterValues = resolveParameterValues(drafts.map((draft) => draft.statement));

  const parameters: WorkspaceParameter[] = [];
  for (let index = 0; index < drafts.length; index += 1) {
    const statement = drafts[index]?.statement;
    if (statement?.kind !== 'parameter') continue;
    const value = parameterValues.get(statement.name);
    if (value === undefined) continue;
    parameters.push({
      name: statement.name,
      expression: statement.body,
      value,
      slider: value.im === 0,
      entryId: inputs[index]?.id ?? '',
    });
  }

  // Signatures, resolved to a fixed point so definition order does not matter.
  const { signatures, failures } = resolveSignatures(
    drafts.map((draft) => draft.statement),
    parameterValues,
  );

  const functions = new Map<string, UserFunctionDefinition>();
  for (const statement of drafts.map((draft) => draft.statement)) {
    if (statement?.kind === 'function-definition') {
      functions.set(statement.name, {
        name: statement.name,
        parameters: statement.parameters,
        ...(statement.interval === undefined
          ? {}
          : { interval: { from: statement.interval.from, to: statement.interval.to } }),
        body: statement.body,
      });
    }
  }

  const entries: WorkspaceEntry[] = drafts.map((draft, index) => {
    if (draft.entry !== null) return draft.entry;

    const statement = draft.statement as Statement;
    const id = inputs[index]?.id ?? '';
    const source = inputs[index]?.source ?? '';
    const duplicate = duplicates.get(statement) ?? null;

    const { type, issue } = analyzeStatement(statement, signatures, failures, parameterValues);

    const role: EntryRole =
      statement.kind === 'function-definition'
        ? 'definition'
        : statement.kind === 'parameter'
          ? 'parameter'
          : 'expression';

    const reportedIssue = duplicate ?? issue;
    return {
      id,
      source,
      role: reportedIssue === null ? role : 'invalid',
      statement,
      parseError: null,
      type: reportedIssue === null ? type : null,
      typeIssue: reportedIssue,
    };
  });

  return { entries, parameters, functions, signatures, functionNames };
}

/**
 * Every name the document defines, whichever syntax each line is written in.
 *
 * Function names are collected for lines of both syntaxes, because both parsers
 * need them to tell a call from a product. Value names are only needed by the
 * plain-text parser: LaTeX writes `ab` as two letter tokens, which already
 * multiplies, so there is no ambiguity to resolve.
 */
function collectNamesAcrossSyntaxes(inputs: readonly WorkspaceInput[]): {
  functions: Set<string>;
  values: Set<string>;
} {
  const functions = new Set<string>();
  const values = new Set<string>();

  for (const input of inputs) {
    if (input.syntax === 'latex') {
      const header = detectLatexDefinition(input.source);
      if (header !== null) {
        functions.add(header.name);
        for (const parameter of header.parameters) values.add(parameter);
        continue;
      }
      const parameter = detectLatexParameter(input.source);
      if (parameter !== null) values.add(parameter);
      continue;
    }

    const header = detectDefinitionHeader(input.source);
    if (header !== null) {
      functions.add(header.name);
      for (const parameter of header.parameters) values.add(parameter);
      continue;
    }
    const parameter = detectParameterName(input.source);
    if (parameter !== null) values.add(parameter);
  }

  return { functions, values };
}

/** Names defined twice in one workspace, mapped to the statement that repeats. */
function findDuplicateNames(statements: readonly (Statement | null)[]): Map<Statement, MathIssue> {
  const seenNames = new Map<string, Statement>();
  const duplicates = new Map<Statement, MathIssue>();

  for (const statement of statements) {
    if (statement === null) continue;
    const name = statement.kind === 'expression' ? null : statement.name;
    if (name === null) continue;

    const previous = seenNames.get(name);
    if (previous === undefined) {
      seenNames.set(name, statement);
      continue;
    }
    duplicates.set(statement, {
      kind: 'unsupported',
      detail: `Duplicate definition of ${name}`,
      message: `"${name}" is already defined by another line. Give this one a different name.`,
      span: statement.span,
    });
  }

  return duplicates;
}

/**
 * Resolve every parameter to a complex value.
 *
 * Parameters may refer to one another, so this iterates until no further
 * progress is possible. A parameter that can never be resolved is left out of the
 * map, which is what makes it show up as undefined at its use sites rather than
 * as a wrong value. Leaving it out also means a circular definition such as
 * `a = b` and `b = a` terminates instead of recursing.
 */
function resolveParameterValues(statements: readonly (Statement | null)[]): Map<string, Complex> {
  const parameterStatements = statements.filter(
    (statement): statement is Extract<Statement, { kind: 'parameter' }> =>
      statement?.kind === 'parameter',
  );

  const values = new Map<string, Complex>();
  let changed = true;
  let passes = 0;

  while (changed && passes <= parameterStatements.length) {
    changed = false;
    passes += 1;
    for (const statement of parameterStatements) {
      if (values.has(statement.name)) continue;
      const environment = makeEnvironment({ values });
      const result = evaluate(statement.body, environment);
      if (result.ok && result.value.kind === 'scalar') {
        values.set(statement.name, result.value.value);
        changed = true;
      }
    }
  }

  return values;
}

/**
 * Resolve the signature of every definition to a fixed point.
 *
 * A fixed point rather than a single pass because `f(z) = g(z)` and
 * `g(z) = z^2` may appear in either order.
 *
 * The reasons for failures are kept, not discarded. A definition whose signature
 * cannot be resolved is usually unresolvable because of something specific —
 * an undefined symbol, a mismatched dimension — and reporting the generic
 * "could not be resolved" instead would hide the actual mistake. The last pass's
 * reason is kept, because later passes know about more signatures and so fail
 * with better information.
 */
function resolveSignatures(
  statements: readonly (Statement | null)[],
  parameterValues: ReadonlyMap<string, Complex>,
): { signatures: Map<string, Signature>; failures: Map<string, MathIssue> } {
  const definitions = statements.filter(
    (statement): statement is Extract<Statement, { kind: 'function-definition' }> =>
      statement?.kind === 'function-definition',
  );

  const signatures = new Map<string, Signature>();
  const failures = new Map<string, MathIssue>();
  const spaceOfParameter = (name: string): Space =>
    spaceForConventionLetter(spaceNameForVariable(name));
  const valueVariables: [string, Space][] = [...parameterValues.keys()].map((name) => [
    name,
    { kind: 'R', dim: 1 } as Space,
  ]);

  let changed = true;
  let passes = 0;
  while (changed && passes <= definitions.length + 1) {
    changed = false;
    passes += 1;
    for (const definition of definitions) {
      if (signatures.has(definition.name)) continue;
      const context: InferenceContext = {
        variables: new Map(valueVariables),
        functions: signatures,
      };
      const signature = inferSignature(
        definition.parameters,
        definition.body,
        context,
        spaceOfParameter,
      );
      if (signature.ok) {
        signatures.set(definition.name, signature.value);
        failures.delete(definition.name);
        changed = true;
      } else {
        failures.set(definition.name, signature.issue);
      }
    }
  }

  return { signatures, failures };
}

/**
 * Type a single line.
 *
 * A definition and a bare expression are both functions mathematically; the
 * difference is only whether the user wrote the parameter list. A bare
 * expression's domain comes from its free variables, which is why `z^2` on its
 * own is understood as a complex function.
 */
function analyzeStatement(
  statement: Statement,
  signatures: ReadonlyMap<string, Signature>,
  failures: ReadonlyMap<string, MathIssue>,
  parameterValues: ReadonlyMap<string, Complex>,
): { type: InferredType | null; issue: MathIssue | null } {
  const valueVariables: [string, Space][] = [...parameterValues.keys()].map((name) => [
    name,
    { kind: 'R', dim: 1 } as Space,
  ]);

  if (statement.kind === 'parameter') {
    const context: InferenceContext = { variables: new Map(), functions: signatures };
    const space = inferSpace(statement.body, context);
    if (!space.ok) return { type: null, issue: space.issue };
    // The value itself is resolved elsewhere; what matters here is that it is a
    // value, not a function.
    return {
      type: {
        signature: { domain: { kind: 'R', dim: 1 }, codomain: space.value },
        classification: {
          kind: 'scalar',
          description: `Parameter with value ${statement.name}`,
        },
      },
      issue: null,
    };
  }

  if (statement.kind === 'function-definition') {
    // The signature was already resolved; report the definition's own type.
    const signature = signatures.get(statement.name);
    if (signature === undefined) {
      return {
        type: null,
        issue: unresolvedDefinitionIssue(statement, failures.get(statement.name)),
      };
    }
    const context: InferenceContext = {
      variables: new Map([
        ...valueVariables,
        ...statement.parameters.map(
          (parameter) =>
            [parameter, spaceForConventionLetter(spaceNameForVariable(parameter))] as [
              string,
              Space,
            ],
        ),
      ]),
      functions: new Map([...signatures].filter(([name]) => name !== statement.name)),
    };
    const bodyCheck = inferSpace(statement.body, context);
    if (!bodyCheck.ok) return { type: null, issue: bodyCheck.issue };
    return { type: classifyDefinitionWith(signature, statement.body), issue: null };
  }

  // A bare expression: it is a function of its free variables.
  //
  // A name bound as a parameter is not free. Until this filter the two were the same,
  // and a line such as `a*z` with `a = 2` came out as a function of a real *and* a
  // complex variable, failing as a mixed domain — which is what it looks like and not
  // what it is. It matters more now that `∮_γ a*z dz` is a value whose only dependence
  // on `a` is through the parameter: without the filter that line would be typed as a
  // function of `a`, and a value would be presented as something to plot.
  const freeNames = collectVariableNames(statement.body).filter(
    (name) => !parameterValues.has(name),
  );
  const context: InferenceContext = {
    variables: new Map([
      ...valueVariables,
      ...freeNames.map(
        (name) => [name, spaceForConventionLetter(spaceNameForVariable(name))] as [string, Space],
      ),
    ]),
    functions: signatures,
  };

  const codomain = inferSpace(statement.body, context);
  if (!codomain.ok) return { type: null, issue: codomain.issue };

  if (freeNames.length === 0) {
    return {
      type: {
        signature: { domain: { kind: 'R', dim: 1 }, codomain: codomain.value },
        classification: {
          kind: 'scalar',
          description: 'Value with no free variables',
        },
      },
      issue: null,
    };
  }

  const domain = inferDomain(
    freeNames,
    (name) => spaceForConventionLetter(spaceNameForVariable(name)),
    statement.body,
  );
  if (!domain.ok) return { type: null, issue: domain.issue };

  return {
    type: classifySignatureWith({ domain: domain.value, codomain: codomain.value }),
    issue: null,
  };
}

/**
 * Why a definition's signature could not be worked out.
 *
 * The inference failure is reported as it stands, except when it is the
 * definition referring to itself, which the raw failure would describe as an
 * unknown function. A cycle is worth naming as a cycle.
 */
function unresolvedDefinitionIssue(
  statement: Extract<Statement, { kind: 'function-definition' }>,
  failure: MathIssue | undefined,
): MathIssue {
  if (
    failure !== undefined &&
    !(failure.kind === 'unknown-function' && failure.name === statement.name)
  ) {
    return failure;
  }
  return {
    kind: 'unsupported',
    detail: `Could not resolve the signature of ${statement.name}`,
    message: `The definition of "${statement.name}" refers to itself, so it has no type.`,
    span: statement.span,
  };
}

/**
 * Build an evaluation environment.
 *
 * `overrides` are the live values of sliders, which take precedence over the
 * values implied by the parameter definitions. That is what makes dragging a
 * slider change every dependent expression without rewriting the source.
 */
export function workspaceEnvironment(
  workspace: Workspace,
  overrides: ReadonlyMap<string, number> = new Map(),
  extraValues: ReadonlyMap<string, Complex> = new Map(),
): EvaluationEnvironment {
  const values = new Map<string, Complex>();
  for (const parameter of workspace.parameters) {
    values.set(parameter.name, parameter.value);
  }
  for (const [name, value] of overrides) {
    values.set(name, cx(value, 0));
  }
  for (const [name, value] of extraValues) {
    values.set(name, value);
  }
  return makeEnvironment({ values, functions: workspace.functions });
}

/**
 * Re-evaluate a parameter's value from its definition, for when the expression
 * behind a slider changes. Returns the previous value when the definition no
 * longer produces a single real number.
 */
export function evaluateParameterExpression(
  workspace: Workspace,
  expression: Expr,
  overrides: ReadonlyMap<string, number> = new Map(),
): Result<number, MathIssue> {
  const environment = workspaceEnvironment(workspace, overrides, new Map<string, Complex>());
  const result = evaluate(expression, environment);
  if (!result.ok) return result;
  if (result.value.kind !== 'scalar') {
    return fail({
      kind: 'invalid-parameter',
      detail: 'A parameter must be a single value',
      message: 'A parameter must be a single number, but this definition produces a list.',
      span: expression.span,
    });
  }
  if (result.value.value.im !== 0) {
    return fail({
      kind: 'invalid-parameter',
      detail: 'A slider parameter must be real',
      message: 'A parameter that drives a slider must be real, but this value is complex.',
      span: expression.span,
    });
  }
  return ok(result.value.value.re);
}

/** True when a value is exactly zero, exposed for callers building sliders. */
export function isZeroValue(value: Complex): boolean {
  return isZero(value);
}

/** Space label of a signature's domain, for display. */
export function domainLabel(signature: Signature): string {
  return spaceToString(signature.domain);
}
