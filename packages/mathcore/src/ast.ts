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

/**
 * A contour integral, `∮_γ f(z) dz`.
 *
 * It is an expression rather than a statement because it *is* a value: the result
 * is a complex number, and `∮_γ f(z) dz + 1` is as meaningful as `2 + 1`. That
 * also makes GOAL.md 7.17 — comparing the integral against `2πi Σ Res` — something
 * that can be written down rather than something the interface has to do for you.
 *
 * `path` is a **name**, not a subtree, following `CallNode.callee`: this tree
 * references functions by name everywhere, and a path is a function of one real
 * parameter. The consequence is deliberate and worth stating, because it is a real
 * limit: the path has to be defined in the document, so a contour written inline is
 * not expressible.
 *
 * `variable` is the integration variable, and it is **bound by this node**. That is
 * the first binding form inside an expression — `FunctionDefinition.parameters` binds,
 * but it is a statement — and it is why `collectVariableNames` cannot simply walk the
 * children: `∮_γ f(z) dz` mentions `z` and is still a constant.
 */
export interface ContourIntegralNode {
  readonly kind: 'contour-integral';
  /** Name of the path function, resolved like any other function name. */
  readonly path: string;
  /** Where the path was written, so an unknown path can be pointed at. */
  readonly pathSpan: SourceSpan;
  /** The integration variable, bound here rather than free. */
  readonly variable: string;
  /** The integrand, a function of `variable`. */
  readonly integrand: Expr;
  readonly span: SourceSpan;
}

/**
 * A forward continuous Fourier transform, `Fourier(f(t))`.
 *
 * The source variable is bound by this node. The frequency variable belongs to
 * the containing one-argument function definition, e.g. `F(ω)=Fourier(f(t))`.
 * Keeping the binding here means the transform is an expression in the same
 * sense as a contour integral, rather than a UI instruction attached to a row.
 */
export interface FourierTransformNode {
  readonly kind: 'fourier-transform';
  /** The source call, normally `f(t)`. */
  readonly source: Expr;
  /** The real variable integrated over the time domain. */
  readonly sourceVariable: string;
  readonly span: SourceSpan;
}

/**
 * A forward discrete Fourier transform, `DFT(f(t))`.
 *
 * The source variable is bound by this node. Sampling settings are deliberately
 * not part of the syntax: they are shared numerical state so the time-domain
 * markers and the discrete spectrum cannot disagree about which samples exist.
 */
export interface DftTransformNode {
  readonly kind: 'dft-transform';
  /** The source call, normally `f(t)`. */
  readonly source: Expr;
  /** The real variable sampled by the transform. */
  readonly sourceVariable: string;
  readonly span: SourceSpan;
}

export type Expr =
  | NumberLiteralNode
  | VariableNode
  | ConstantNode
  | UnaryNode
  | BinaryNode
  | CallNode
  | TupleNode
  | ContourIntegralNode
  | FourierTransformNode
  | DftTransformNode;

export type ExprKind = Expr['kind'];

/** A real interval attached to a one-parameter path definition. */
export interface PathInterval {
  readonly parameter: string;
  readonly from: Expr;
  readonly to: Expr;
  readonly span: SourceSpan;
}

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
  /** Optional declaration such as `gamma(t; [0, 1]) = ...`. */
  readonly interval?: PathInterval;
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
    case 'contour-integral':
      return [expr.integrand];
    case 'fourier-transform':
    case 'dft-transform':
      return [expr.source];
  }
}

/** Depth-first pre-order traversal. */
export function walk(expr: Expr, visit: (node: Expr) => void): void {
  visit(expr);
  for (const child of childNodes(expr)) walk(child, visit);
}

/**
 * Names of every *free* variable mentioned in the expression, in first-appearance
 * order.
 *
 * Not a `walk`, although it is a traversal of the same children. A contour integral
 * binds its integration variable, and a walk visits children uniformly and cannot say
 * "stop counting this one". Getting that wrong is not a small error: `∮_γ f(z) dz` is
 * a number, and if `z` came back free the line would be typed as a *function of z*and
 * the whole feature would be a function where a value belongs.
 *
 * `childNodes` and `walk` stay shape-only on purpose — the printers, the lowerings and
 * the app's "which parameters does this line use" all want to see inside an integrand.
 */
export function collectVariableNames(expr: Expr): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  const visit = (node: Expr, bound: ReadonlySet<string>): void => {
    if (node.kind === 'variable') {
      if (!bound.has(node.name) && !seen.has(node.name)) {
        seen.add(node.name);
        ordered.push(node.name);
      }
      return;
    }
    if (node.kind === 'contour-integral') {
      visit(node.integrand, new Set([...bound, node.variable]));
      return;
    }
    if (node.kind === 'fourier-transform') {
      visit(node.source, new Set([...bound, node.sourceVariable]));
      return;
    }
    if (node.kind === 'dft-transform') {
      visit(node.source, new Set([...bound, node.sourceVariable]));
      return;
    }
    for (const child of childNodes(node)) visit(child, bound);
  };

  visit(expr, new Set());
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
