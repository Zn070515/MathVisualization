/**
 * Rendering mathematical objects as text.
 *
 * Two jobs, and they are different jobs:
 *
 * 1. `exprToText` prints an *expression* back as readable mathematics. It is
 *    precedence-aware, so it only inserts parentheses that change the meaning:
 *    `a - (b + c)` keeps them, `(a * b) + c` does not. The output is source-like
 *    on purpose — `*` and `^`, not LaTeX — because what the editor needs from
 *    the core is a faithful textual form of the tree.
 * 2. `formatReal` and `formatComplex` print a computed *value*. These are thin
 *    projections of `display.ts`, which is where the decision about how a number
 *    is written actually lives. There is one implementation of that decision, so
 *    the same magnitude cannot be written two ways in two panes.
 */
import type { Expr, Statement } from './ast';
import type { Complex } from './complex';
import {
  displayComplex,
  displayComplexToText,
  displayNumber,
  displayNumberToText,
  type DisplayOptions,
} from './display';

const PRECEDENCE_ADDITIVE = 10;
const PRECEDENCE_MULTIPLICATIVE = 20;
const PRECEDENCE_UNARY = 30;
const PRECEDENCE_POWER = 40;
const PRECEDENCE_ATOM = 100;

const OPERATOR_TEXT: Readonly<Record<string, string>> = {
  add: '+',
  sub: '-',
  mul: '*',
  div: '/',
  pow: '^',
};

function precedenceOf(expr: Expr): number {
  switch (expr.kind) {
    case 'binary':
      switch (expr.op) {
        case 'add':
        case 'sub':
          return PRECEDENCE_ADDITIVE;
        case 'mul':
        case 'div':
          return PRECEDENCE_MULTIPLICATIVE;
        case 'pow':
          return PRECEDENCE_POWER;
      }
      return PRECEDENCE_ATOM;
    case 'unary':
      return PRECEDENCE_UNARY;
    // Written out rather than left to the default below. The `∮` is self-delimiting —
    // nothing binds more tightly into it — but a reader of this switch should be able
    // to see that a decision was made, not guess that one was forgotten.
    case 'contour-integral':
      return PRECEDENCE_ATOM;
    case 'fourier-transform':
    case 'dft-transform':
      return PRECEDENCE_ATOM;
    default:
      return PRECEDENCE_ATOM;
  }
}

function print(expr: Expr, minimumPrecedence: number): string {
  const precedence = precedenceOf(expr);

  switch (expr.kind) {
    case 'number':
      return expr.raw;

    case 'variable':
    case 'constant':
      return expr.name;

    case 'unary': {
      const inner = print(expr.operand, PRECEDENCE_UNARY);
      const text = expr.op === 'neg' ? `-${inner}` : inner;
      return precedence < minimumPrecedence ? `(${text})` : text;
    }

    case 'binary': {
      // A left-associative operator needs its right operand printed one level
      // tighter, which is what preserves `a - (b + c)` and `a / (b * c)`.
      //
      // The power operator is right associative, so it needs neither. Its
      // exponent may also be signed without parentheses, since `2 ^ -3` reads
      // unambiguously; a sum or product in the exponent still gets them.
      const leftMinimum = expr.op === 'pow' ? precedence + 1 : precedence;
      const rightMinimum = expr.op === 'pow' ? PRECEDENCE_UNARY : precedence + 1;
      const left = print(expr.left, leftMinimum);
      const right = print(expr.right, rightMinimum);
      const operator = OPERATOR_TEXT[expr.op] ?? '?';
      const text = `${left} ${operator} ${right}`;
      return precedence < minimumPrecedence ? `(${text})` : text;
    }

    case 'call': {
      const args = expr.args.map((arg) => print(arg, 0)).join(', ');
      return `${expr.callee}(${args})`;
    }

    case 'tuple': {
      const items = expr.items.map((item) => print(item, 0)).join(', ');
      return `(${items})`;
    }

    case 'contour-integral': {
      // The integrand is printed one level tighter than a product, so a sum inside it
      // is bracketed — `∮_γ (a + b) dz` — while `f(z)` stays bare. Without that the
      // printed form would read as `∮_γ a + b dz`, which is a different expression.
      const integrand = print(expr.integrand, PRECEDENCE_MULTIPLICATIVE + 1);
      return `∮_${expr.path} ${integrand} d${expr.variable}`;
    }

    case 'fourier-transform':
      return `Fourier(${print(expr.source, 0)})`;

    case 'dft-transform':
      return `DFT(${print(expr.source, 0)})`;
  }
}

/** Print an expression as readable mathematics, with only meaningful parentheses. */
export function exprToText(expr: Expr): string {
  return print(expr, 0);
}

/** Print a whole statement, including its left-hand side where it has one. */
export function statementToText(statement: Statement): string {
  switch (statement.kind) {
    case 'function-definition':
      return `${statement.name}(${statement.parameters.join(', ')}${
        statement.interval === undefined
          ? ''
          : `; [${exprToText(statement.interval.from)}, ${exprToText(statement.interval.to)}]`
      }) = ${exprToText(statement.body)}`;
    case 'parameter':
      return `${statement.name} = ${exprToText(statement.body)}`;
    case 'expression':
      return exprToText(statement.body);
  }
}

/**
 * The options the formatting entry points take.
 *
 * Kept as a name here because it is what the printer's callers already say; the
 * decisions it carries are described at {@link DisplayOptions}.
 */
export type NumberFormatOptions = DisplayOptions;

/**
 * Print a real number.
 *
 * Rounded for display only: nothing here feeds back into a computation, so an
 * exact result and an approximate one stay distinguishable (GOAL.md section 13).
 */
export function formatReal(value: number, options: NumberFormatOptions = {}): string {
  return displayNumberToText(displayNumber(value, options));
}

/**
 * Print a complex number in the form mathematics is written in.
 *
 * Real values print as a real number. Purely imaginary values print as `2i` or
 * `-1.5i`, not `0 + 2i`. Undefined values print as `undefined`, so that a
 * singularity in the readout is visibly a singularity rather than a number.
 * Components at the level of rounding noise are dropped, which is how `(1+i)^2`
 * prints as `2i` rather than as `1.11022e-16 + 2i`.
 */
export function formatComplex(value: Complex, options: NumberFormatOptions = {}): string {
  return displayComplexToText(displayComplex(value, options));
}
