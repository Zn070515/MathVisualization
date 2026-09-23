/**
 * Lowering the canonical AST to SymPy syntax.
 *
 * The symbolic representation of an expression is the third target the canonical
 * AST is translated into, alongside the numerical evaluator and the GLSL shader.
 * The tree is the same one in all three cases (GOAL.md 6.1).
 *
 * Two properties matter here:
 *
 * - Numeric literals stay exact. `1/3` becomes `Rational(1, 3)`, never `0.3333`.
 *   Exactness is the whole point of the symbolic layer (GOAL.md 6.3), and
 *   rounding a literal before the CAS sees it would silently destroy it.
 * - The elementary functions map onto SymPy's principal branches, which agree
 *   with the conventions in `conventions.ts`: SymPy's `log` is the principal
 *   logarithm, and its `arg` returns the principal argument.
 *
 * This module only produces text; it performs no I/O and does not call the
 * engine. Whether a symbolic backend exists, where it lives and how it is
 * reached are the adapter's business (see `cas.ts`).
 */
import type { Expr, Statement } from './ast';
import { fail, ok, type MathIssue, type Result } from './errors';
import {
  type Rational,
  rationalAdd,
  rationalDiv,
  rationalIsInteger,
  rationalIsZero,
  rationalMul,
  rationalNegate,
  rationalPowInt,
  rationalSub,
} from './rational';

/** Python keywords and names that a lowered symbol must not collide with. */
const PYTHON_RESERVED = new Set([
  'False',
  'None',
  'True',
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield',
]);

/** SymPy names that the lowering relies on; a symbol may not shadow them. */
const SYMPY_RESERVED = new Set([
  'pi',
  'E',
  'I',
  'Rational',
  'sin',
  'cos',
  'tan',
  'sinh',
  'cosh',
  'tanh',
  'exp',
  'log',
  'sqrt',
  'Abs',
  'arg',
  're',
  'im',
  'conjugate',
  'Matrix',
  'sympify',
  'Symbol',
  'oo',
  'nan',
  'zoo',
]);

const SYMPY_FUNCTION_NAMES: Readonly<Record<string, string>> = {
  sin: 'sin',
  cos: 'cos',
  tan: 'tan',
  sinh: 'sinh',
  cosh: 'cosh',
  tanh: 'tanh',
  exp: 'exp',
  log: 'log',
  sqrt: 'sqrt',
  abs: 'Abs',
  arg: 'arg',
  re: 're',
  im: 'im',
  conj: 'conjugate',
};

const NON_HOLOMORPHIC_FUNCTIONS = new Set(['conj', 're', 'im', 'abs', 'arg']);

const PYTHON_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * A safe SymPy symbol name for a variable.
 *
 * Greek letters are legal Python identifiers, but the engine boundary is easier
 * to reason about when every symbol is ASCII, so anything that is not is
 * transliterated to a positional name.
 */
export function sympySymbolName(name: string, fallbackIndex: number): string {
  if (PYTHON_IDENTIFIER.test(name) && !PYTHON_RESERVED.has(name) && !SYMPY_RESERVED.has(name)) {
    return name;
  }
  return `x${fallbackIndex}`;
}

/** `Rational(n, d)`, or a bare integer when the denominator is one. */
function sympyNumber(numerator: bigint, denominator: bigint): string {
  if (denominator === 1n) return numerator.toString();
  return `Rational(${numerator.toString()}, ${denominator.toString()})`;
}

/**
 * Evaluate a subtree made entirely of literals, exactly.
 *
 * Required, not merely nice. Emitting `(1 / 3)` would be Python's *float*
 * division, because both operands are plain integers, so the engine would
 * receive 0.333... and the exactness that the rational literals exist to
 * preserve would be lost at the engine boundary. Folding literal arithmetic into
 * one exact `Rational` avoids that for every case, not just the obvious one.
 *
 * Returns `null` when the subtree mentions a symbol, or when folding would
 * divide by zero; both fall through to ordinary lowering, which reports the
 * division by zero with a mathematical reason.
 */
function exactRationalOf(expr: Expr): Rational | null {
  switch (expr.kind) {
    case 'number':
      return expr.value;
    case 'unary': {
      const operand = exactRationalOf(expr.operand);
      if (operand === null) return null;
      return expr.op === 'neg' ? rationalNegate(operand) : operand;
    }
    case 'binary': {
      const left = exactRationalOf(expr.left);
      if (left === null) return null;
      const right = exactRationalOf(expr.right);
      if (right === null) return null;

      switch (expr.op) {
        case 'add':
          return rationalAdd(left, right);
        case 'sub':
          return rationalSub(left, right);
        case 'mul':
          return rationalMul(left, right);
        case 'div':
          return rationalIsZero(right) ? null : rationalDiv(left, right);
        case 'pow':
          return rationalIsInteger(right) && Number.isInteger(Number(right.n))
            ? rationalPowInt(left, Number(right.n))
            : null;
      }
      return null;
    }
    default:
      return null;
  }
}

function lower(expr: Expr, symbols: Map<string, string>): Result<string, MathIssue> {
  switch (expr.kind) {
    case 'number':
      return ok(sympyNumber(expr.value.n, expr.value.d));

    case 'constant':
      switch (expr.name) {
        case 'pi':
          return ok('pi');
        case 'e':
          return ok('E');
        case 'tau':
          return ok('2*pi');
        case 'i':
          return ok('I');
        default:
          return fail({
            kind: 'unsupported',
            detail: `Constant ${expr.name} has no symbolic representation`,
            message: `The constant "${expr.name}" cannot be handed to the symbolic engine.`,
            span: expr.span,
          });
      }

    case 'variable': {
      const name = symbols.get(expr.name);
      if (name === undefined) {
        return fail({
          kind: 'unbound-symbol',
          symbol: expr.name,
          message: `"${expr.name}" is not a symbol of this expression.`,
          span: expr.span,
        });
      }
      return ok(name);
    }

    case 'unary': {
      const operand = lower(expr.operand, symbols);
      if (!operand.ok) return operand;
      return ok(expr.op === 'neg' ? `(-${operand.value})` : operand.value);
    }

    case 'binary': {
      if (
        expr.op === 'div' &&
        expr.left.kind === 'number' &&
        expr.right.kind === 'number' &&
        expr.right.value.n === 0n
      ) {
        return fail({
          kind: 'division-by-zero',
          divisor: expr.right.raw,
          message: 'Division by the literal zero has no symbolic value.',
          span: expr.right.span,
        });
      }

      const folded = exactRationalOf(expr);
      if (folded !== null) return ok(sympyNumber(folded.n, folded.d));

      const left = lower(expr.left, symbols);
      if (!left.ok) return left;
      const right = lower(expr.right, symbols);
      if (!right.ok) return right;
      const operator = expr.op === 'pow' ? '**' : BINARY_TEXT[expr.op];
      return ok(`(${left.value} ${operator} ${right.value})`);
    }

    case 'call': {
      const sympyName = SYMPY_FUNCTION_NAMES[expr.callee];
      if (sympyName === undefined) {
        return fail({
          kind: 'unsupported',
          detail: `No symbolic representation for ${expr.callee}`,
          message: `${expr.callee} cannot be handed to the symbolic engine.`,
          span: expr.span,
        });
      }
      const parts: string[] = [];
      for (const argument of expr.args) {
        const lowered = lower(argument, symbols);
        if (!lowered.ok) return lowered;
        parts.push(lowered.value);
      }
      return ok(`${sympyName}(${parts.join(', ')})`);
    }

    case 'tuple': {
      const parts: string[] = [];
      for (const item of expr.items) {
        const lowered = lower(item, symbols);
        if (!lowered.ok) return lowered;
        parts.push(lowered.value);
      }
      return ok(`Matrix([${parts.join(', ')}])`);
    }

    case 'contour-integral':
      // Refused, and deliberately not half-done. The honest SymPy form is
      // `Integral(f(gamma(t))*Derivative(gamma(t), t), (t, 0, 2*pi))`, but the path is a
      // *function of the document* and `sympyPreamble` declares symbols, not functions.
      // Emitting it before that is solved would put an undeclared name on the far side
      // of the engine boundary — which is what this module's contract forbids: an
      // undeclared name is reported, never passed through. The integral is computed
      // numerically instead, and that is a complete answer rather than a placeholder.
      return fail({
        kind: 'unsupported',
        detail: 'Contour integral handed to the symbolic engine',
        message:
          'A contour integral is evaluated numerically, so the symbolic engine is not given it. The number beside the line is a quadrature, and it states how accurate it is.',
        span: expr.span,
      });

    case 'fourier-transform':
      return fail({
        kind: 'unsupported',
        detail: 'Fourier transform handed to the symbolic engine',
        message:
          'Fourier transforms are evaluated numerically over a finite window, so the symbolic engine is not given this node.',
        span: expr.span,
      });
  }
}

const BINARY_TEXT: Readonly<Record<string, string>> = {
  add: '+',
  sub: '-',
  mul: '*',
  div: '/',
};

/**
 * Translate an expression to SymPy syntax.
 *
 * `variableNames` must list every free variable; a variable not in the list is
 * reported rather than passed through, so a typo cannot become a new symbol on
 * the far side of the engine boundary.
 */
export function lowerToSympy(
  expr: Expr,
  variableNames: readonly string[],
): Result<string, MathIssue> {
  const symbols = new Map<string, string>();
  variableNames.forEach((name, index) => {
    symbols.set(name, sympySymbolName(name, index));
  });
  return lower(expr, symbols);
}

/**
 * Return a mathematical issue when an expression cannot be presented as a
 * certified complex derivative with respect to `variable`.
 *
 * SymPy can emit formal objects such as `Derivative(conjugate(z), z)`, but that
 * is not a value of df/dz. The UI must not label such an answer exact. A
 * non-holomorphic operation applied only to a constant parameter is harmless,
 * so the guard is dependency-aware rather than a blanket function-name check.
 */
export function complexDerivativeIssue(expr: Expr, variable: string): MathIssue | null {
  let issue: MathIssue | null = null;

  const dependsOn = (node: Expr, name: string): boolean => {
    if (node.kind === 'variable') return node.name === name;
    switch (node.kind) {
      case 'unary':
        return dependsOn(node.operand, name);
      case 'binary':
        return dependsOn(node.left, name) || dependsOn(node.right, name);
      case 'call':
        return node.args.some((argument) => dependsOn(argument, name));
      case 'tuple':
        return node.items.some((item) => dependsOn(item, name));
      case 'contour-integral':
        return dependsOn(node.integrand, name);
      case 'fourier-transform':
        return dependsOn(node.source, name);
      default:
        return false;
    }
  };

  const visit = (node: Expr): void => {
    if (issue !== null) return;
    if (node.kind === 'call') {
      if (NON_HOLOMORPHIC_FUNCTIONS.has(node.callee)) {
        const depends = node.args.some((argument) => dependsOn(argument, variable));
        if (depends) {
          issue = {
            kind: 'unsupported',
            detail: `non-holomorphic operation ${node.callee}`,
            message:
              `A complex derivative is not certified through ${node.callee}(...). ` +
              'The expression is not known to be holomorphic in the differentiation variable.',
            span: node.span,
          };
          return;
        }
      }
      for (const argument of node.args) visit(argument);
      return;
    }
    switch (node.kind) {
      case 'unary':
        visit(node.operand);
        break;
      case 'binary':
        visit(node.left);
        visit(node.right);
        break;
      case 'tuple':
        for (const item of node.items) visit(item);
        break;
      case 'contour-integral':
        visit(node.integrand);
        break;
      case 'fourier-transform':
        visit(node.source);
        break;
      default:
        break;
    }
  };

  visit(expr);
  return issue;
}

/** Translate a whole statement, including the left-hand side of a definition. */
export function lowerStatementToSympy(statement: Statement): Result<string, MathIssue> {
  switch (statement.kind) {
    case 'function-definition': {
      const lowered = lowerToSympy(statement.body, statement.parameters);
      if (!lowered.ok) return lowered;
      return ok(`${statement.name} = ${lowered.value}`);
    }
    case 'parameter': {
      const lowered = lowerToSympy(statement.body, []);
      if (!lowered.ok) return lowered;
      return ok(`${statement.name} = ${lowered.value}`);
    }
    case 'expression': {
      const freeNames = collectFreeNames(statement.body);
      return lowerToSympy(statement.body, freeNames);
    }
  }
}

function collectFreeNames(expr: Expr): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const visit = (node: Expr): void => {
    if (node.kind === 'variable' && !seen.has(node.name)) {
      seen.add(node.name);
      names.push(node.name);
    }
    switch (node.kind) {
      case 'unary':
        visit(node.operand);
        break;
      case 'binary':
        visit(node.left);
        visit(node.right);
        break;
      case 'call':
        for (const argument of node.args) visit(argument);
        break;
      case 'tuple':
        for (const item of node.items) visit(item);
        break;
      case 'contour-integral':
        // The integration variable is bound by the node, so it is not a free name — but
        // everything *else* in the integrand still is, and this visitor's `default` is a
        // silent `break`. Without this case a parameter mentioned inside an integrand
        // would never reach `symbols`, and the lowering would quietly omit it.
        visit(node.integrand);
        break;
      default:
        break;
    }
  };
  visit(expr);
  return names;
}

/**
 * Preamble that declares the symbols and the exact-rational constructor.
 *
 * Sent with every request so the expression is interpreted with exactly the
 * symbols the caller intended, rather than with whatever the engine would infer.
 */
export function sympyPreamble(variableNames: readonly string[]): string {
  const declarations = variableNames.map(
    (name, index) => `${sympySymbolName(name, index)} = Symbol('${sympySymbolName(name, index)}')`,
  );
  return ['from sympy import *', ...declarations].join('\n');
}
