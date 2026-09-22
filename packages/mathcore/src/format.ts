/**
 * Rendering mathematical objects as text.
 *
 * Two jobs:
 *
 * 1. `exprToText` prints an AST back as readable mathematics. It is
 *    precedence-aware, so it only inserts parentheses that change the meaning:
 *    `a - (b + c)` keeps them, `(a * b) + c` does not.
 * 2. `formatComplex` prints a numerical value, distinguishing exact-looking
 *    short decimals from values that are only approximated.
 *
 * This is deliberately plain text, not LaTeX and not a typed-maths layout. The
 * expression panel's editor is a separate, later concern; what it needs from the
 * core is a faithful textual form of the tree, which is what this provides.
 */
import type { Expr, Statement } from './ast';
import { type Complex, isUndefined } from './complex';

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
      return `${statement.name}(${statement.parameters.join(', ')}) = ${exprToText(statement.body)}`;
    case 'parameter':
      return `${statement.name} = ${exprToText(statement.body)}`;
    case 'expression':
      return exprToText(statement.body);
  }
}

export interface NumberFormatOptions {
  /** Significant digits to show. */
  readonly digits?: number;
}

/**
 * Components smaller than this fraction of the largest one are shown as zero.
 *
 * A display convention, and only that: nothing here changes a computed value.
 * The reason it is needed is that exact mathematics rarely survives double
 * precision intact. `(1 + i)^2` is exactly `2i`, but evaluating it numerically
 * leaves a real part of about 1e-16, and printing `1.11022e-15 + 2i` would
 * present rounding as if it were structure.
 *
 * The threshold is relative rather than absolute, so a value whose components are
 * all genuinely tiny is still printed in full.
 */
export const DISPLAY_ZERO_THRESHOLD = 1e-12;

/**
 * Print a real number.
 *
 * Values are rounded to `digits` significant digits for display, but the
 * rounding is explicitly a display concern: nothing here feeds back into
 * computation. Values far from unity switch to exponential form.
 */
export function formatReal(value: number, options: NumberFormatOptions = {}): string {
  const digits = options.digits ?? 6;

  if (Number.isNaN(value)) return 'undefined';
  if (value === Infinity) return '∞';
  if (value === -Infinity) return '-∞';
  if (value === 0) return '0';

  const magnitude = Math.abs(value);
  if (magnitude >= 1e-4 && magnitude < 1e7) {
    const rounded = Number(value.toPrecision(digits));
    return String(rounded);
  }
  return value.toExponential(Math.max(0, digits - 1));
}

/**
 * Print a complex number in the form mathematics is written in.
 *
 * Real values print as a real number. Purely imaginary values print as `2i` or
 * `-1.5i`, not `0 + 2i`. Undefined values print as `undefined`, so that a
 * singularity in the readout is visibly a singularity rather than a number.
 *
 * Components at the level of rounding noise are dropped, for the reason given at
 * {@link DISPLAY_ZERO_THRESHOLD}.
 */
export function formatComplex(value: Complex, options: NumberFormatOptions = {}): string {
  if (isUndefined(value)) return 'undefined';

  const scale = Math.max(Math.abs(value.re), Math.abs(value.im));
  const threshold = scale * DISPLAY_ZERO_THRESHOLD;
  const re = Math.abs(value.re) < threshold ? 0 : value.re;
  const im = Math.abs(value.im) < threshold ? 0 : value.im;

  if (im === 0) return formatReal(re, options);

  const imaginary = formatReal(Math.abs(im), options);
  const imaginaryText = imaginary === '1' ? 'i' : `${imaginary}i`;

  if (re === 0) {
    return im < 0 ? `-${imaginaryText}` : imaginaryText;
  }

  const realText = formatReal(re, options);
  return im < 0 ? `${realText} - ${imaginaryText}` : `${realText} + ${imaginaryText}`;
}
