/**
 * LaTeX front-end tests.
 *
 * The point of this module is that LaTeX and plain text are two surface syntaxes
 * for one tree, so most of what matters is:
 *
 * - that a LaTeX fragment produces the same AST the plain-text parser would;
 * - that the round trip holds, LaTeX → AST → LaTeX;
 * - that an unfinished expression is reported as unfinished rather than wrong,
 *   which is what lets the editor stay quiet while someone is still typing.
 */
import { describe, expect, it } from 'vitest';
import {
  detectLatexDefinition,
  detectLatexParameter,
  exprToLatex,
  parseLatexExpression,
  parseLatexStatement,
  statementToLatex,
} from '../src/latex';
import { exprToText } from '../src/format';
import { parseExpression, parseStatement } from '../src/parser';
import type { Expr, Statement } from '../src/ast';

function latexExpr(source: string, knownFunctions: readonly string[] = []): Expr {
  const result = parseLatexExpression(source, { knownFunctions: new Set(knownFunctions) });
  if (!result.ok) throw new Error(`expected a parse of ${source}, got: ${result.issue.message}`);
  return result.value;
}

function latexStatement(source: string, knownFunctions: readonly string[] = []): Statement {
  const result = parseLatexStatement(source, { knownFunctions: new Set(knownFunctions) });
  if (!result.ok) throw new Error(`expected a parse of ${source}, got: ${result.issue.message}`);
  return result.value;
}

/** The canonical text of a LaTeX fragment, for comparing with plain text. */
function canonical(source: string, knownFunctions: readonly string[] = []): string {
  return exprToText(latexExpr(source, knownFunctions));
}

function plainCanonical(source: string, knownFunctions: readonly string[] = []): string {
  const result = parseExpression(source, { knownFunctions: new Set(knownFunctions) });
  if (!result.ok) throw new Error(`expected a parse of ${source}, got: ${result.issue.message}`);
  return exprToText(result.value);
}

function issueOf(source: string): { message: string; incomplete: boolean } {
  const result = parseLatexStatement(source);
  if (result.ok) throw new Error(`expected a failure for ${source}`);
  return { message: result.issue.message, incomplete: result.issue.incomplete === true };
}

describe('the two syntaxes agree on the tree', () => {
  it('reads a fraction the same way as a division', () => {
    expect(canonical('\\frac{a}{b}')).toBe(plainCanonical('a/b'));
  });

  it('reads a superscript the same way as a caret', () => {
    expect(canonical('z^{2}')).toBe(plainCanonical('z^2'));
    expect(canonical('z^2')).toBe(plainCanonical('z^2'));
  });

  it('reads a radical the same way as sqrt', () => {
    expect(canonical('\\sqrt{x}')).toBe(plainCanonical('sqrt(x)'));
  });

  it('reads a function command the same way as a call', () => {
    expect(canonical('\\sin(z)')).toBe(plainCanonical('sin(z)'));
    expect(canonical('\\exp(z)')).toBe(plainCanonical('exp(z)'));
    expect(canonical('\\ln(z)')).toBe(plainCanonical('log(z)'));
  });

  it('reads juxtaposition the same way', () => {
    expect(canonical('2x')).toBe(plainCanonical('2x'));
    expect(canonical('2\\pi')).toBe(plainCanonical('2pi'));
    expect(canonical('\\pi i')).toBe(plainCanonical('pi i'));
  });

  it('reads the imaginary unit as the constant, as plain text does', () => {
    expect(canonical('i')).toBe(plainCanonical('i'));
    expect(canonical('2i')).toBe(plainCanonical('2i'));
  });

  it('reads absolute value as abs, in either syntax', () => {
    expect(canonical('|z|')).toBe(plainCanonical('abs(z)'));
    expect(canonical('\\left|z\\right|')).toBe(plainCanonical('abs(z)'));
  });

  it('recovers conventional precedence that LaTeX leaves implicit', () => {
    // In LaTeX this is three atoms in a row; the tree has to make a decision.
    expect(canonical('a+b\\cdot c')).toBe('a + b * c');
    expect(canonical('a+b c')).toBe('a + b * c');
  });
});

describe('the composition that matters most', () => {
  it('reads a quotient of a trig function by a quadratic', () => {
    expect(canonical('\\frac{\\sin(z)}{z^{2}+1}')).toBe(
      canonical('\\frac{\\sin\\left(z\\right)}{z^{2}+1}'),
    );
    expect(canonical('\\frac{\\sin(z)}{z^{2}+1}')).toBe('sin(z) / (z ^ 2 + 1)');
  });

  it('keeps the denominator from swallowing the addition', () => {
    // The failure this guards against: reading the fraction as sin(z)/(z^2) + 1.
    expect(canonical('\\frac{1}{z^{2}+1}')).toBe('1 / (z ^ 2 + 1)');
  });

  it('nests a fraction inside a fraction', () => {
    expect(canonical('\\frac{1}{\\frac{1}{z}+1}')).toBe('1 / (1 / z + 1)');
  });

  it('handles a negative exponent', () => {
    expect(canonical('z^{-1}')).toBe('z ^ -1');
  });

  it('handles an nth root as a power', () => {
    expect(canonical('\\sqrt[3]{x}')).toBe('x ^ (1 / 3)');
  });
});

describe('functions', () => {
  it('reads a function applied without parentheses', () => {
    expect(canonical('\\sin x')).toBe('sin(x)');
  });

  it('reads the exponent as part of an unparenthesised argument', () => {
    // sin x^2 is the sine of x squared, not the square of sin x.
    expect(canonical('\\sin x^{2}')).toBe('sin(x ^ 2)');
  });

  it('reads the real and imaginary parts written as operators', () => {
    expect(canonical('\\operatorname{Re}(z)')).toBe('re(z)');
    expect(canonical('\\operatorname{Im}(z)')).toBe('im(z)');
    expect(canonical('\\operatorname{arg}(z)')).toBe('arg(z)');
    expect(canonical('\\Re(z)')).toBe('re(z)');
  });

  it('reads the conjugate written as an overline', () => {
    expect(canonical('\\overline{z}')).toBe('conj(z)');
    expect(canonical('\\operatorname{conj}(z)')).toBe('conj(z)');
  });

  it('reads a user-defined function as a call when the document defines it', () => {
    expect(canonical('g(z)', ['g'])).toBe('g(z)');
    // and as a product when it does not
    expect(canonical('g(z)')).toBe('g * z');
  });
});

describe('greek letters and subscripts', () => {
  it('reads greek commands as names', () => {
    expect(canonical('\\gamma')).toBe('gamma');
    expect(canonical('\\theta')).toBe('theta');
    expect(canonical('\\omega')).toBe('omega');
    expect(canonical('\\alpha\\beta')).toBe('alpha * beta');
  });

  it('reads pi and tau as constants, as plain text does', () => {
    expect(canonical('\\pi')).toBe(plainCanonical('pi'));
    expect(canonical('\\tau')).toBe(plainCanonical('tau'));
  });

  it('absorbs a subscript into the name', () => {
    expect(canonical('a_{1}')).toBe('a_1');
    expect(canonical('a_1')).toBe('a_1');
    expect(canonical('z_{k}')).toBe('z_k');
    expect(canonical('\\gamma_{1}')).toBe('gamma_1');
  });

  it('keeps a compound subscript as one symbol', () => {
    expect(canonical('z_{k+1}')).toBe('z_{k+1}');
  });

  it('distinguishes a subscripted name from the plain one', () => {
    expect(canonical('a_{1}+a')).toBe('a_1 + a');
  });
});

describe('structures', () => {
  it('reads parentheses and nesting', () => {
    expect(canonical('\\left(a+b\\right)c')).toBe('(a + b) * c');
    expect(canonical('(a+b)c')).toBe('(a + b) * c');
  });

  it('reads a tuple', () => {
    expect(canonical('\\left(-y, x\\right)')).toBe('(-y, x)');
  });

  it('applies a power to a group', () => {
    expect(canonical('\\left(z+1\\right)^{2}')).toBe('(z + 1) ^ 2');
  });

  it('binds a power more tightly than a leading sign', () => {
    expect(canonical('-z^{2}')).toBe(plainCanonical('-z^2'));
  });
});

describe('statements', () => {
  it('reads a definition', () => {
    const statement = latexStatement('f\\left(z\\right)=\\frac{\\sin(z)}{z^{2}+1}');
    expect(statement.kind).toBe('function-definition');
    if (statement.kind !== 'function-definition') return;
    expect(statement.name).toBe('f');
    expect(statement.parameters).toEqual(['z']);
    expect(exprToText(statement.body)).toBe('sin(z) / (z ^ 2 + 1)');
  });

  it('reads a definition of several variables', () => {
    const statement = latexStatement('g\\left(x, y\\right)=x^{2}+a y^{2}');
    if (statement.kind !== 'function-definition') throw new Error('expected a definition');
    expect(statement.parameters).toEqual(['x', 'y']);
    expect(exprToText(statement.body)).toBe('x ^ 2 + a * y ^ 2');
  });

  it('reads a parameter assignment', () => {
    const statement = latexStatement('a=2');
    expect(statement.kind).toBe('parameter');
    if (statement.kind !== 'parameter') return;
    expect(statement.name).toBe('a');
    expect(exprToText(statement.body)).toBe('2');
  });

  it('reads a bare expression', () => {
    const statement = latexStatement('\\frac{1}{z}');
    expect(statement.kind).toBe('expression');
  });

  it('reads a complex path', () => {
    const statement = latexStatement('\\gamma\\left(t\\right)=2e^{i t}');
    if (statement.kind !== 'function-definition') throw new Error('expected a definition');
    expect(statement.name).toBe('gamma');
    expect(exprToText(statement.body)).toBe('2 * e ^ (i * t)');
  });

  it('finds an equals sign inside an absolute value', () => {
    const statement = latexStatement('a=|z|');
    expect(statement.kind).toBe('parameter');
  });

  it('rejects a head that is not a name', () => {
    expect(issueOf('z+1=2').message).toContain('left of "="');
  });
});

describe('unfinished input is not an error', () => {
  it('reports an empty fraction as unfinished', () => {
    expect(issueOf('\\frac{}{}').incomplete).toBe(true);
  });

  it('reports an unwritten denominator as unfinished', () => {
    expect(issueOf('\\frac{1}{}').incomplete).toBe(true);
  });

  it('reports a missing closing brace as unfinished', () => {
    expect(issueOf('\\frac{1}{z+1').incomplete).toBe(true);
  });

  it('reports a bare function as unfinished', () => {
    expect(issueOf('\\sin').incomplete).toBe(true);
  });

  it('reports a trailing operator as unfinished', () => {
    expect(issueOf('z+').incomplete).toBe(true);
  });

  it('reports an unfinished exponent as unfinished', () => {
    expect(issueOf('z^{').incomplete).toBe(true);
  });

  it('reports unreadable input as wrong, not unfinished', () => {
    expect(issueOf('z\\int').incomplete).toBe(false);
  });

  it('reports an empty line as unfinished', () => {
    expect(issueOf('').incomplete).toBe(true);
  });
});

describe('printing back to LaTeX', () => {
  it('writes a quotient as a fraction', () => {
    expect(exprToLatex(latexExpr('a/b'))).toBe('\\frac{a}{b}');
  });

  it('writes a power with a brace', () => {
    expect(exprToLatex(latexExpr('z^2'))).toBe('z^{2}');
  });

  it('writes a radical as a radical', () => {
    expect(exprToLatex(latexExpr('\\sqrt{x}'))).toBe('\\sqrt{x}');
  });

  it('writes the modulus with bars and the conjugate with an overline', () => {
    expect(exprToLatex(latexExpr('|z|'))).toBe('\\left|z\\right|');
    expect(exprToLatex(latexExpr('\\overline{z}'))).toBe('\\overline{z}');
  });

  it('writes the real part as an operator name', () => {
    expect(exprToLatex(latexExpr('\\operatorname{Re}(z)'))).toBe(
      '\\operatorname{Re}\\left(z\\right)',
    );
  });

  it('writes greek names as commands, never as letters', () => {
    // The failure this guards against: writing `gamma`, which would typeset as
    // g·a·m·m·a.
    expect(exprToLatex(latexExpr('\\gamma'))).toBe('\\gamma');
    expect(exprToLatex(latexExpr('\\theta'))).toBe('\\theta');
    expect(exprToLatex(latexExpr('\\pi'))).toBe('\\pi');
  });

  it('writes a subscripted name', () => {
    expect(exprToLatex(latexExpr('a_1'))).toBe('a_1');
    expect(exprToLatex(latexExpr('a_12'))).toBe('a_{12}');
  });

  it('writes a sum without redundant parentheses', () => {
    expect(exprToLatex(latexExpr('a+b\\cdot c'))).toBe('a+b\\cdot c');
    expect(exprToLatex(latexExpr('\\left(a+b\\right)\\cdot c'))).toBe(
      '\\left(a+b\\right)\\cdot c',
    );
  });

  it('writes a definition with its head', () => {
    const statement = latexStatement('f\\left(z\\right)=z^{2}');
    expect(statementToLatex(statement)).toBe('f\\left(z\\right)=z^{2}');
  });
});

describe('the round trip holds', () => {
  const samples = [
    '\\frac{a}{b}',
    'z^{2}',
    'z^{-1}',
    '\\sqrt{x}',
    '\\frac{\\sin(z)}{z^{2}+1}',
    '|z|',
    '\\overline{z}',
    '\\operatorname{Re}(z)',
    '\\exp(-t^{2})',
    '\\gamma',
    'a_1+a',
    '\\left(-y, x\\right)',
    '\\left(z+1\\right)^{2}',
    '2x',
    '\\frac{1}{1+t^{2}}',
    '\\sin(x)\\cdot\\cos(y)',
    // ASCII multiplication is accepted, so a pasted expression round trips too.
    '\\sin(x)*\\cos(y)',
  ];

  it('survives LaTeX to tree to LaTeX to tree', () => {
    for (const source of samples) {
      const first = exprToText(latexExpr(source));
      const latex = exprToLatex(latexExpr(source));
      const second = exprToText(latexExpr(latex));
      expect(second, `round trip of ${source} via ${latex}`).toBe(first);
    }
  });

  it('survives a statement round trip', () => {
    for (const source of ['f\\left(z\\right)=z^2', 'a=2', 'f\\left(x, y\\right)=x^2-y^2']) {
      const statement = latexStatement(source);
      const latex = statementToLatex(statement);
      const again = latexStatement(latex);
      expect(statementToText(again)).toBe(statementToText(statement));
    }
  });
});

describe('name detection before parsing', () => {
  it('recognises a definition header', () => {
    expect(detectLatexDefinition('f\\left(z\\right)=z^{2}')).toEqual({
      name: 'f',
      parameters: ['z'],
    });
  });

  it('recognises a parameter assignment', () => {
    expect(detectLatexParameter('a=2')).toBe('a');
  });

  it('does not mistake a product for a header', () => {
    expect(detectLatexDefinition('z\\left(z+1\\right)')).toBeNull();
    expect(detectLatexDefinition('\\sin\\left(z\\right)')).toBeNull();
    expect(detectLatexParameter('z^{2}')).toBeNull();
  });

  it('reads a greek name in a header', () => {
    expect(detectLatexDefinition('\\gamma\\left(t\\right)=t')).toEqual({
      name: 'gamma',
      parameters: ['t'],
    });
  });
});

function statementToText(statement: Statement): string {
  switch (statement.kind) {
    case 'function-definition':
      return `${statement.name}(${statement.parameters.join(',')}) = ${exprToText(statement.body)}`;
    case 'parameter':
      return `${statement.name} = ${exprToText(statement.body)}`;
    case 'expression':
      return exprToText(statement.body);
  }
}

describe('the plain parser is untouched', () => {
  it('still parses plain text the way it did', () => {
    const result = parseStatement('f(z)=sin(z)/(z^2+1)');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.kind !== 'function-definition') throw new Error('expected a definition');
    expect(exprToText(result.value.body)).toBe('sin(z) / (z ^ 2 + 1)');
  });
});
