/**
 * SymPy lowering tests.
 *
 * The central concern is exactness at the engine boundary. A literal that was
 * kept exact through the parser must still be exact when it reaches the engine,
 * which rules out emitting integer-over-integer division as Python would read it.
 */
import { describe, expect, it } from 'vitest';
import { parseExpression, parseStatement } from '../src/parser';
import { lowerStatementToSympy, lowerToSympy, sympyPreamble, sympySymbolName } from '../src/sympy';
import type { Expr } from '../src/ast';

function expr(source: string): Expr {
  const result = parseExpression(source);
  if (!result.ok) throw new Error(`expected a parse, got: ${result.issue.message}`);
  return result.value;
}

function sympyOf(source: string, variables: readonly string[] = []): string {
  const result = lowerToSympy(expr(source), variables);
  if (!result.ok) throw new Error(`expected a translation, got: ${result.issue.message}`);
  return result.value;
}

describe('numbers stay exact', () => {
  it('emits an integer as an integer', () => {
    expect(sympyOf('3')).toBe('3');
    expect(sympyOf('-3')).toBe('(-3)');
  });

  it('emits a fractional literal as a rational', () => {
    expect(sympyOf('0.5')).toBe('Rational(1, 2)');
    expect(sympyOf('0.1')).toBe('Rational(1, 10)');
    expect(sympyOf('1.25')).toBe('Rational(5, 4)');
  });

  it('folds a literal divided by a literal, avoiding float division', () => {
    // The hazard this avoids: in Python, 1 / 3 is 0.333..., so emitting the
    // expression verbatim would destroy the exact rational at the engine boundary.
    expect(sympyOf('1/3')).toBe('Rational(1, 3)');
    expect(sympyOf('1/3/4')).toBe('Rational(1, 12)');
    expect(sympyOf('0.5/0.25')).toBe('2');
  });

  it('leaves a division by a symbol to the engine, which handles it exactly', () => {
    expect(sympyOf('1/z', ['z'])).toBe('(1 / z)');
    expect(sympyOf('1/(z+1)', ['z'])).toBe('(1 / (z + 1))');
  });

  it('refuses to divide by the literal zero', () => {
    const result = lowerToSympy(expr('1/0'), []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.kind).toBe('division-by-zero');
  });
});

describe('constants', () => {
  it('maps each builtin constant onto its SymPy name', () => {
    expect(sympyOf('pi')).toBe('pi');
    expect(sympyOf('e')).toBe('E');
    expect(sympyOf('i')).toBe('I');
    expect(sympyOf('tau')).toBe('2*pi');
  });
});

describe('structure', () => {
  it('parenthesises so that precedence cannot be misread', () => {
    expect(sympyOf('z^2+1', ['z'])).toBe('((z ** 2) + 1)');
    expect(sympyOf('z+2*3', ['z'])).toBe('(z + 6)');
    expect(sympyOf('(z+1)*(z-1)', ['z'])).toBe('((z + 1) * (z - 1))');
  });

  it('folds arithmetic that involves only literals, exactly', () => {
    // Folding is exact, so it is safe, and it keeps the exactness of literal
    // arithmetic visible in one place rather than spread over the expression.
    expect(sympyOf('1+2*3')).toBe('7');
    expect(sympyOf('2^10')).toBe('1024');
  });

  it('uses the power operator SymPy expects', () => {
    expect(sympyOf('z^3', ['z'])).toBe('(z ** 3)');
  });

  it('translates the elementary functions onto SymPy names', () => {
    expect(sympyOf('sin(z)', ['z'])).toBe('sin(z)');
    expect(sympyOf('log(z)', ['z'])).toBe('log(z)');
    expect(sympyOf('sqrt(z)', ['z'])).toBe('sqrt(z)');
    expect(sympyOf('abs(z)', ['z'])).toBe('Abs(z)');
    expect(sympyOf('conj(z)', ['z'])).toBe('conjugate(z)');
    expect(sympyOf('arg(z)', ['z'])).toBe('arg(z)');
  });

  it('translates a whole compound expression', () => {
    expect(sympyOf('sin(z)/(z^2+1)', ['z'])).toBe('(sin(z) / ((z ** 2) + 1))');
  });

  it('translates a list into a matrix', () => {
    expect(sympyOf('(x, y)', ['x', 'y'])).toBe('Matrix([x, y])');
  });
});

describe('symbol safety', () => {
  it('reports a variable it was not told about rather than inventing a symbol', () => {
    const result = lowerToSympy(expr('w*z'), ['z']);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.kind).toBe('unbound-symbol');
  });

  it('renames a symbol that would collide with a SymPy name', () => {
    // `E` is Euler's number in SymPy, so a variable of that name must not shadow it.
    expect(sympySymbolName('E', 0)).toBe('x0');
    expect(sympySymbolName('pi', 1)).toBe('x1');
    expect(sympySymbolName('Rational', 2)).toBe('x2');
  });

  it('renames a symbol that would collide with a Python keyword', () => {
    expect(sympySymbolName('lambda', 0)).toBe('x0');
    expect(sympySymbolName('class', 1)).toBe('x1');
  });

  it('keeps an ordinary name as it is', () => {
    expect(sympySymbolName('z', 0)).toBe('z');
    expect(sympySymbolName('alpha', 0)).toBe('alpha');
  });
});

describe('preamble', () => {
  it('imports SymPy and declares every symbol', () => {
    const preamble = sympyPreamble(['z', 'a']);
    expect(preamble).toContain('from sympy import *');
    expect(preamble).toContain("z = Symbol('z')");
    expect(preamble).toContain("a = Symbol('a')");
  });

  it('declares symbols using their safe names', () => {
    expect(sympyPreamble(['E'])).toContain("x0 = Symbol('x0')");
  });
});

describe('statements', () => {
  it('translates a definition, including its left-hand side', () => {
    const parsed = parseStatement('f(z)=z^2');
    if (!parsed.ok) throw new Error('expected a parse');
    const result = lowerStatementToSympy(parsed.value);
    if (!result.ok) throw new Error(`expected a translation, got: ${result.issue.message}`);
    expect(result.value).toBe('f = (z ** 2)');
  });

  it('translates a parameter', () => {
    const parsed = parseStatement('a=0.5');
    if (!parsed.ok) throw new Error('expected a parse');
    const result = lowerStatementToSympy(parsed.value);
    if (!result.ok) throw new Error(`expected a translation, got: ${result.issue.message}`);
    expect(result.value).toBe('a = Rational(1, 2)');
  });

  it('translates a bare expression using its free variables', () => {
    const parsed = parseStatement('z^2+1');
    if (!parsed.ok) throw new Error('expected a parse');
    const result = lowerStatementToSympy(parsed.value);
    if (!result.ok) throw new Error(`expected a translation, got: ${result.issue.message}`);
    expect(result.value).toBe('((z ** 2) + 1)');
  });
});
