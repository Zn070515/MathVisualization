import { describe, expect, it } from 'vitest';
import { collectVariableNames } from '../src/ast';
import { evaluateScalar } from '../src/evaluator';
import { lowerToDomainColoringProgram } from '../src/glsl';
import { exprToLatex, parseLatexExpression } from '../src/latex';
import { parseExpression } from '../src/parser';
import { lowerToSympy } from '../src/sympy';
import { buildWorkspace, type WorkspaceInput } from '../src/workspace';

function inputs(...sources: string[]): WorkspaceInput[] {
  return sources.map((source, index) => ({ id: `line-${index}`, source }));
}

function dftExpression(source = 'DFT(f(t))') {
  const parsed = parseExpression(source, {
    knownFunctions: new Set(['DFT', 'f']),
    knownValues: new Set(['t', 'ω']),
  });
  if (!parsed.ok) throw new Error(parsed.issue.message);
  return parsed.value;
}

describe('DFT transform syntax and binding', () => {
  it('parses the operation as a dedicated AST node', () => {
    const transform = dftExpression();

    expect(transform.kind).toBe('dft-transform');
    if (transform.kind !== 'dft-transform') return;
    expect(transform.sourceVariable).toBe('t');
    expect(transform.source.kind).toBe('call');
    expect(collectVariableNames(transform)).toEqual([]);
  });

  it('reads the LaTeX operation into the same AST shape', () => {
    const parsed = parseLatexExpression('\\operatorname{DFT}(f(t))', {
      knownFunctions: new Set(['f']),
    });
    if (!parsed.ok) throw new Error(parsed.issue.message);

    expect(parsed.value.kind).toBe('dft-transform');
    expect(exprToLatex(parsed.value)).toContain('DFT');
  });

  it('rejects a source that is not a unary real signal call', () => {
    const malformed = parseExpression('DFT(t^2)', {
      knownFunctions: new Set(['DFT']),
      knownValues: new Set(['t']),
    });
    expect(malformed.ok).toBe(false);

    const multiple = parseExpression('DFT(f(t, t))', {
      knownFunctions: new Set(['DFT', 'f']),
      knownValues: new Set(['t']),
    });
    expect(multiple.ok).toBe(false);
  });
});

describe('DFT transform workspace inference', () => {
  it('classifies a valid real source as a transform pair', () => {
    const workspace = buildWorkspace(inputs('f(t)=exp(-t^2)', 'D(ω)=DFT(f(t))'));

    expect(workspace.entries[0]?.type?.classification.kind).toBe('real-function');
    expect(workspace.entries[1]?.type?.classification.kind).toBe('transform-pair');
    expect(workspace.entries[1]?.type?.signature).toEqual({
      domain: { kind: 'R', dim: 1 },
      codomain: { kind: 'C', dim: 1 },
    });
  });

  it('rejects a complex-valued source function', () => {
    const workspace = buildWorkspace(inputs('f(t)=exp(i*t)', 'D(ω)=DFT(f(t))'));
    expect(workspace.entries[1]?.type).toBeNull();
    expect(workspace.entries[1]?.typeIssue?.message).toMatch(/real|complex/i);
  });
});

describe('unsupported DFT backends', () => {
  it('does not evaluate a transform as a scalar point value', () => {
    const result = evaluateScalar(dftExpression());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.message).toMatch(/frequency-domain|estimate/i);
  });

  it('rejects the transform in the shader and symbolic backends', () => {
    const expression = dftExpression();
    const shader = lowerToDomainColoringProgram(expression, {
      parameters: [],
      variables: new Map([['t', { kind: 'real', axis: 0 } as const]]),
    });
    expect(shader.ok).toBe(false);
    if (!shader.ok) expect(shader.issue.message).toMatch(/frequency|pointwise|shader/i);

    const symbolic = lowerToSympy(expression, []);
    expect(symbolic.ok).toBe(false);
    if (!symbolic.ok) expect(symbolic.issue.message).toMatch(/numerical|symbolic/i);
  });
});
