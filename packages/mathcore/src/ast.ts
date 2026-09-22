/**
 * The canonical abstract syntax tree.
 *
 * There is exactly one internal mathematical representation for the whole
 * project (GOAL.md 6.1). The numerical evaluator, the type inferencer, the
 * symbolic adapter and the GLSL lowering all consume *this* tree; none of them
 * keeps a private parallel representation. Adding a new downstream target means
 * adding a consumer of these types, never a second parser.
 *
 * Design notes:
 *
 * - Numeric literals keep their exact rational value. See `rational.ts`.
 * - Constants (`i`, `pi`, `e`, `tau`) are a distinct node kind from variables.
 *   The space of a variable depends on a documented naming convention, whereas
 *   a constant has a fixed meaning; conflating them would make inference
 *   ambiguous.
 * - Operators use names (`add`, `mul`) rather than symbols, so that a reader of
 *   a `switch` statement cannot confuse the operator with a character that also
 *   appears in the source text.
 * - There is no grouping node. Parentheses affect the shape of the tree and are
 *   otherwise not part of the mathematics; the original text is recoverable via
 *   spans and `format.ts`.
 */
import type { SourceSpan } from './errors';
import type { Rational } from './rational';

export type BinaryOperator = 'add' | 'sub' | 'mul' | 'div' | 'pow';
export type UnaryOperator = 'neg' | 'pos';

export interface NumberLiteralNode {
  readonly kind: 'number';
  /** Exact value as written, before any floating-point conversion. */
  readonly value: Rational;
  /** Original source text of the literal, kept for round-tripping and display. */
  readonly raw: string;
  readonly span: SourceSpan;
}

export interface VariableNode {
  readonly kind: 'variable';
  readonly name: string;
  readonly span: SourceSpan;
}

export interface ConstantNode {
  readonly kind: 'constant';
  readonly name: string;
  readonly span: SourceSpan;
}

export interface UnaryNode {
  readonly kind: 'unary';
  readonly op: UnaryOperator;
  readonly operand: Expr;
  readonly span: SourceSpan;
}

export interface BinaryNode {
  readonly kind: 'binary';
  readonly op: BinaryOperator;
  readonly left: Expr;
  readonly right: Expr;
  readonly span: SourceSpan;
}

export interface CallNode {
  readonly kind: 'call';
  /** Canonical builtin name, or the user-defined function's name. */
  readonly callee: string;
  readonly args: readonly Expr[];
  readonly span: SourceSpan;
}

/**
 * A parenthesised list, e.g. `(-y, x)`.
 *
 * Needed so that vector-valued results such as vector fields are representable
 * in the same tree as everything else. A one-element parenthesised list is
 * never produced: `(z + 1)` is just a `BinaryNode` with a wider span.
 */
export interface TupleNode {
  readonly kind: 'tuple';
  readonly items: readonly Expr[];
  readonly span: SourceSpan;
}

export type Expr =
  | NumberLiteralNode
  | VariableNode
  | ConstantNode
  | UnaryNode
  | BinaryNode
  | CallNode
  | TupleNode;

export type ExprKind = Expr['kind'];

/**
 * A top-level line of the workspace.
 *
 * These are the three things a user can write, which is what makes the
 * expression panel a list of statements rather than a list of strings.
 */
export interface FunctionDefinition {
  readonly kind: 'function-definition';
  readonly name: string;
  readonly parameters: readonly string[];
  readonly body: Expr;
  readonly span: SourceSpan;
}

/**
 * `a = 2`.
 *
 * A parameter is an assignment whose right-hand side does not depend on any
 * variable, which is what makes it suitable for a slider. Assignment to a name
 * that *does* depend on variables is reported as an issue rather than silently
 * treated as a function.
 */
export interface ParameterAssignment {
  readonly kind: 'parameter';
  readonly name: string;
  readonly body: Expr;
  readonly span: SourceSpan;
}

/** A bare expression with nothing to bind it to, e.g. `z^2`. */
export interface ExpressionStatement {
  readonly kind: 'expression';
  readonly body: Expr;
  readonly span: SourceSpan;
}

export type Statement = FunctionDefinition | ParameterAssignment | ExpressionStatement;

/** Immediate children of a node, in source order. */
export function childNodes(expr: Expr): readonly Expr[] {
  switch (expr.kind) {
    case 'number':
    case 'variable':
    case 'constant':
      return [];
    case 'unary':
      return [expr.operand];
    case 'binary':
      return [expr.left, expr.right];
    case 'call':
      return expr.args;
    case 'tuple':
      return expr.items;
  }
}

/** Depth-first pre-order traversal. */
export function walk(expr: Expr, visit: (node: Expr) => void): void {
  visit(expr);
  for (const child of childNodes(expr)) walk(child, visit);
}

/** Names of every variable mentioned in the expression, in first-appearance order. */
export function collectVariableNames(expr: Expr): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  walk(expr, (node) => {
    if (node.kind === 'variable' && !seen.has(node.name)) {
      seen.add(node.name);
      ordered.push(node.name);
    }
  });
  return ordered;
}

/**
 * The integer value of a literal that is provably an integer, else `null`.
 *
 * Recognises a literal with denominator 1 and a negated literal. Used by type
 * inference to decide whether `z^2` stays in the base's space while `z^0.5`
 * must widen to the complex numbers.
 */
export function asIntegerLiteral(expr: Expr): number | null {
  if (expr.kind === 'number' && expr.value.d === 1n) {
    const value = Number(expr.value.n);
    return Number.isSafeInteger(value) ? value : null;
  }
  if (expr.kind === 'unary' && expr.op === 'neg') {
    const inner = asIntegerLiteral(expr.operand);
    return inner === null ? null : -inner;
  }
  return null;
}

/** True when the literal is the exact number 1. */
export function isOneLiteral(expr: Expr): boolean {
  return expr.kind === 'number' && expr.value.n === 1n && expr.value.d === 1n;
}

/** True when the literal is the exact number 0. */
export function isZeroLiteral(expr: Expr): boolean {
  return expr.kind === 'number' && expr.value.n === 0n;
}
