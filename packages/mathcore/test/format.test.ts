import { describe, expect, it } from 'vitest';
import { collectVariableNames } from '../src/ast';
import { exprToText } from '../src/format';
import { parseExpression } from '../src/parser';

function parse(source: string) {
  const result = parseExpression(source, { knownFunctions: new Set(['f']) });
  if (!result.ok) throw new Error(`expected a parse, got: ${result.issue.message}`);
  return result.value;
}

describe('Fourier series formatting', () => {
  it('prints the period instead of dropping it', () => {
    expect(exprToText(parse('FourierSeries(f(u), 2*pi + 1)'))).toBe(
      'FourierSeries(f(u), 2 * pi + 1)',
    );
  });

  it('keeps the source binding separate from the period', () => {
    expect(collectVariableNames(parse('FourierSeries(f(u), p)'))).toEqual(['p']);
  });
});
