/**
 * Parser tests.
 *
 * Precedence and implicit multiplication are checked both structurally (by
 * printing the AST back to canonical text) and, for the statement forms, by
 * inspecting the parsed statement directly.
 */
import { describe, expect, it } from 'vitest';
import { exprToText } from '../src/format';
import { detectDefinitionHeader, parseExpression, parseStatement } from '../src/parser';
import type { Statement } from '../src/ast';

interface Names {
  readonly functions?: readonly string[];
  readonly values?: readonly string[];
}

function optionsFor(names: Names = {}): {
  knownFunctions: Set<string>;
  knownValues: Set<string>;
} {
  return {
    knownFunctions: new Set(names.functions ?? []),
    knownValues: new Set(names.values ?? []),
  };
}

/** Parse a bare expression and print the canonical form of the tree. */
function canonical(source: string, names: Names = {}): string {
  const result = parseExpression(source, optionsFor(names));
  if (!result.ok) throw new Error(`expected a parse, got: ${result.issue.message}`);
  return exprToText(result.value);
}

function parseOrThrow(source: string, names: Names = {}): Statement {
  const result = parseStatement(source, optionsFor(names));
  if (!result.ok) throw new Error(`expected a parse, got: ${result.issue.message}`);
  return result.value;
}

function failureMessage(source: string): string {
  const result = parseStatement(
    source,
    optionsFor({ functions: ['f', 'g', 'gamma'], values: ['a'] }),
  );
  if (result.ok) throw new Error(`expected a failure for: ${source}`);
  return result.issue.message;
}

describe('precedence', () => {
  it('multiplies before adding', () => {
    expect(canonical('1+2*3')).toBe('1 + 2 * 3');
    expect(canonical('(1+2)*3')).toBe('(1 + 2) * 3');
  });

  it('raises to a power before multiplying', () => {
    expect(canonical('2*z^2')).toBe('2 * z ^ 2');
    expect(canonical('(2*z)^2')).toBe('(2 * z) ^ 2');
  });

  it('treats the power operator as right associative', () => {
    expect(canonical('2^3^2')).toBe('2 ^ 3 ^ 2');
    // Written the other way, the parentheses are meaningful and are kept.
    expect(canonical('(2^3)^2')).toBe('(2 ^ 3) ^ 2');
  });

  it('binds a leading sign more loosely than a power', () => {
    expect(canonical('-z^2')).toBe('-z ^ 2');
    expect(canonical('(-z)^2')).toBe('(-z) ^ 2');
  });

  it('accepts a signed exponent, and prints it without redundant parentheses', () => {
    expect(canonical('2^-3')).toBe('2 ^ -3');
    expect(canonical('2^(-3)')).toBe('2 ^ -3');
  });

  it('still parenthesises a sum in the exponent', () => {
    expect(canonical('2^(a+b)')).toBe('2 ^ (a + b)');
  });

  it('subtracts left to right', () => {
    expect(canonical('a - b - c')).toBe('a - b - c');
    expect(canonical('a - (b - c)')).toBe('a - (b - c)');
  });

  it('keeps parentheses that change a division', () => {
    expect(canonical('a/(b*c)')).toBe('a / (b * c)');
    expect(canonical('a/b*c')).toBe('a / b * c');
  });
});

describe('implicit multiplication', () => {
  it('multiplies a number by a name', () => {
    expect(canonical('2z')).toBe('2 * z');
  });

  it('multiplies a name by a parenthesis', () => {
    expect(canonical('I*(z+1)')).toBe('I * (z + 1)');
    expect(canonical('z(z+1)')).toBe('z * (z + 1)');
  });

  it('multiplies two parenthesised groups', () => {
    expect(canonical('(z+1)(z-1)')).toBe('(z + 1) * (z - 1)');
  });

  it('takes the precedence of multiplication', () => {
    expect(canonical('2z^2+1')).toBe('2 * z ^ 2 + 1');
  });

  it('multiplies a number by a constant', () => {
    expect(canonical('2pi')).toBe('2 * pi');
  });

  it('treats a known function name as a call, not a product', () => {
    expect(canonical('f(z)', { functions: ['f'] })).toBe('f(z)');
    expect(canonical('sin(z)')).toBe('sin(z)');
  });
});

describe('juxtaposed letters', () => {
  it('reads an unknown run of letters as a product of its letters', () => {
    // The reason this rule exists: these are the forms the goal document uses.
    expect(canonical('it')).toBe('i * t');
    expect(canonical('ay')).toBe('a * y');
    expect(canonical('xy')).toBe('x * y');
  });

  it('reads Euler notation the way the goal document writes it', () => {
    expect(canonical('2e^(it)')).toBe('2 * e ^ (i * t)');
  });

  it('keeps a known constant as one symbol', () => {
    expect(canonical('2pi')).toBe('2 * pi');
  });

  it('keeps a defined name as one symbol', () => {
    expect(canonical('ay', { values: ['ay'] })).toBe('ay');
    expect(canonical('ab^2', { values: ['ab'] })).toBe('ab ^ 2');
  });

  it('keeps a single unknown letter as itself', () => {
    expect(canonical('q')).toBe('q');
  });
});

describe('calls and lists', () => {
  it('parses a call with one argument', () => {
    expect(canonical('sin(z)/(z^2+1)')).toBe('sin(z) / (z ^ 2 + 1)');
  });

  it('parses a list', () => {
    expect(canonical('(-y, x)')).toBe('(-y, x)');
  });

  it('does not treat a parenthesised single value as a list', () => {
    expect(canonical('(z + 1)')).toBe('z + 1');
  });

  it('rejects a missing closing parenthesis', () => {
    expect(failureMessage('sin(z')).toContain('closing parenthesis');
  });
});

describe('statements', () => {
  it('parses a function definition', () => {
    const statement = parseOrThrow('f(z)=sin(z)/(z^2+1)');
    expect(statement.kind).toBe('function-definition');
    if (statement.kind !== 'function-definition') return;
    expect(statement.name).toBe('f');
    expect(statement.parameters).toEqual(['z']);
    expect(exprToText(statement.body)).toBe('sin(z) / (z ^ 2 + 1)');
  });

  it('parses a definition of several variables', () => {
    const statement = parseOrThrow('g(x,y)=x^2+a*y^2');
    if (statement.kind !== 'function-definition') throw new Error('expected a definition');
    expect(statement.parameters).toEqual(['x', 'y']);
  });

  it('parses a parameter assignment', () => {
    const statement = parseOrThrow('a=2');
    expect(statement.kind).toBe('parameter');
    if (statement.kind !== 'parameter') return;
    expect(statement.name).toBe('a');
    expect(exprToText(statement.body)).toBe('2');
  });

  it('parses a bare expression', () => {
    const statement = parseOrThrow('z^2');
    expect(statement.kind).toBe('expression');
  });

  it('parses a complex path expression', () => {
    const statement = parseOrThrow('gamma(t)=2e^(it)');
    if (statement.kind !== 'function-definition') throw new Error('expected a definition');
    expect(exprToText(statement.body)).toBe('2 * e ^ (i * t)');
  });

  it('rejects a definition whose left side is not a name or a header', () => {
    expect(failureMessage('z+1 = 2')).toContain('left of "="');
  });

  it('rejects redefining a builtin function', () => {
    expect(failureMessage('sin(x)=x')).toContain('builtin');
  });

  it('rejects an empty expression', () => {
    expect(failureMessage('   ')).toContain('empty');
  });

  it('rejects a trailing operator', () => {
    expect(failureMessage('z^2 +')).toContain('Expected an expression');
  });

  it('rejects text after a complete expression', () => {
    expect(failureMessage('z^2 1)')).toContain('Unexpected');
  });
});

describe('definition header detection', () => {
  it('recognises the exact header shape', () => {
    expect(detectDefinitionHeader('f(z)=z^2')).toEqual({ name: 'f', parameters: ['z'] });
    expect(detectDefinitionHeader('g(x, y) = x')).toEqual({ name: 'g', parameters: ['x', 'y'] });
  });

  it('does not mistake a product for a header', () => {
    // This is the case the token-shape test exists for: z(z+1) must stay a
    // product so that the parser does not need to guess.
    expect(detectDefinitionHeader('z(z+1)')).toBeNull();
    expect(detectDefinitionHeader('sin(z)')).toBeNull();
    expect(detectDefinitionHeader('a = 2')).toBeNull();
    expect(detectDefinitionHeader('f(2) = 4')).toBeNull();
  });
});

describe('spans', () => {
  it('covers the source text of a binary expression', () => {
    const result = parseExpression('z^2 + 1');
    if (!result.ok) throw new Error('expected a parse');
    expect(result.value.span).toEqual({ start: 0, end: 7 });
  });

  it('reports the position of a syntax error', () => {
    const result = parseStatement('z + * 2');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.span.start).toBe(4);
  });
});
