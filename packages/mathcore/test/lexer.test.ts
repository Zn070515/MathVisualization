import { describe, expect, it } from 'vitest';
import { tokenize, type Token } from '../src/lexer';

function texts(source: string): string[] {
  const result = tokenize(source);
  if (!result.ok) throw new Error(`expected tokens, got: ${result.issue.message}`);
  return result.value.map((token: Token) => token.text);
}

describe('numbers', () => {
  it('reads an integer and a decimal', () => {
    expect(texts('42')).toEqual(['42']);
    expect(texts('3.5')).toEqual(['3.5']);
  });

  it('consumes an exponent only when digits follow', () => {
    // 1e-3 is one number, but 2e is the number 2 followed by Euler's number.
    expect(texts('1e-3')).toEqual(['1e-3']);
    expect(texts('2E5')).toEqual(['2E5']);
    expect(texts('2e')).toEqual(['2', 'e']);
  });

  it('reads a maximal run of letters as one token', () => {
    // `it` is lexed as a single name. Deciding that it means `i * t` is the
    // parser's job, since it depends on which names the workspace defines.
    expect(texts('2e^(it)')).toEqual(['2', 'e', '^', '(', 'it', ')']);
  });

  it('does not swallow a sign that is not part of the exponent', () => {
    expect(texts('2e+i')).toEqual(['2', 'e', '+', 'i']);
  });

  it('rejects a number outside the representable range', () => {
    const result = tokenize('1e999');
    expect(result.ok).toBe(false);
  });
});

describe('names', () => {
  it('reads an identifier', () => {
    expect(texts('gamma')).toEqual(['gamma']);
  });

  it('keeps digits after the first character', () => {
    expect(texts('z1 + t2')).toEqual(['z1', '+', 't2']);
  });

  it('canonicalises aliases so later stages never see them', () => {
    expect(texts('ln(x)')).toEqual(['log', '(', 'x', ')']);
    expect(texts('π')).toEqual(['pi']);
    expect(texts('τ')).toEqual(['tau']);
    expect(texts('θ')).toEqual(['theta']);
  });

  it('accepts non-ASCII letters as names', () => {
    expect(texts('ω')).toEqual(['omega']);
    // A letter with no alias stays as written.
    expect(texts('ψ')).toEqual(['ψ']);
  });
});

describe('punctuation and operators', () => {
  it('reads operators, parentheses, commas and equals', () => {
    expect(texts('f(x, y) = x^2 - y/2')).toEqual([
      'f', '(', 'x', ',', 'y', ')', '=', 'x', '^', '2', '-', 'y', '/', '2',
    ]);
  });

  it('records the span of each token', () => {
    const result = tokenize('z + 1');
    if (!result.ok) throw new Error('expected tokens');
    expect(result.value.map((token) => [token.start, token.end])).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });
});

describe('errors', () => {
  it('reports an unexpected character with its position', () => {
    const result = tokenize('z # 1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.message).toContain('#');
    expect(result.issue.span).toEqual({ start: 2, end: 3 });
  });

  it('returns no tokens for empty input without failing', () => {
    const result = tokenize('   ');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });
});
