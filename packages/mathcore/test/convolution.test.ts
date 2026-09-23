import { describe, expect, it } from 'vitest';
import { collectVariableNames, type ConvolutionNode } from '../src/ast';
import { evaluateScalar } from '../src/evaluator';
import { lowerToDomainColoringProgram } from '../src/glsl';
import { exprToLatex, parseLatexExpression } from '../src/latex';
import { parseExpression } from '../src/parser';
import { lowerToSympy } from '../src/sympy';
import { buildWorkspace, type WorkspaceInput } from '../src/workspace';

function inputs(...sources: string[]): WorkspaceInput[] {
  return sources.map((source, index) => ({ id: `line-${index}`, source }));
}

function convolutionExpression(source = 'Convolution(f(t), g(t))'): ConvolutionNode {
  const parsed = parseExpression(source, {
    knownFunctions: new Set(['Convolution', 'f', 'g']),
    knownValues: new Set(['t']),
  });
  if (!parsed.ok || parsed.value.kind !== 'convolution') throw new Error('expected convolution');
  return parsed.value;
}

const shaderOptions = {
  parameters: [],
  variables: new Map([['t', { kind: 'real', axis: 0 } as const]]),
};

describe('convolution transform syntax and binding', () => {
  it('parses convolution as a bound AST node', () => {
    const parsed = parseExpression('Convolution(f(t), g(t))', {
      knownFunctions: new Set(['Convolution', 'f', 'g']),
      knownValues: new Set(['t']),
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.kind).toBe('convolution');
    expect(collectVariableNames(parsed.value)).toEqual([]);
  });

  it('reads the LaTeX operation into the same AST shape', () => {
    const parsed = parseLatexExpression('\\operatorname{Convolution}(f(t),g(t))', {
      knownFunctions: new Set(['f', 'g']),
    });
    if (!parsed.ok) throw new Error(parsed.issue.message);

    expect(parsed.value.kind).toBe('convolution');
    expect(exprToLatex(parsed.value)).toContain('Convolution');
  });

  it('rejects non-unary or mixed-variable sources', () => {
    expect(
      parseExpression('Convolution(f(t, t), g(t))', {
        knownFunctions: new Set(['Convolution', 'f', 'g']),
        knownValues: new Set(['t']),
      }).ok,
    ).toBe(false);
    expect(
      parseExpression('Convolution(f(t), g(u))', {
        knownFunctions: new Set(['Convolution', 'f', 'g']),
        knownValues: new Set(['t', 'u']),
      }).ok,
    ).toBe(false);
  });

  it('round-trips the canonical text form', () => {
    expect(convolutionExpression()).toBeTruthy();
  });
});

describe('convolution workspace inference', () => {
  it('classifies a real convolution definition', () => {
    const workspace = buildWorkspace(
      inputs('f(t)=exp(-t^2)', 'g(t)=exp(-2*t^2)', 'h(t)=Convolution(f(t), g(t))'),
    );
    expect(workspace.entries[2]?.type?.classification.kind).toBe('convolution-pair');
    expect(workspace.entries[2]?.type?.signature).toEqual({
      domain: { kind: 'R', dim: 1 },
      codomain: { kind: 'R', dim: 1 },
    });
  });

  it('rejects a convolution with a complex source variable', () => {
    const workspace = buildWorkspace(
      inputs('f(z)=z', 'g(z)=z', 'h(t)=Convolution(f(z), g(z))'),
    );
    expect(workspace.entries[2]?.type).toBeNull();
    expect(workspace.entries[2]?.typeIssue?.message).toMatch(/real|source|variable/i);
  });
});

describe('unsupported convolution backends', () => {
  it('does not evaluate a convolution as a scalar point value', () => {
    const result = evaluateScalar(convolutionExpression());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.message).toMatch(/numerical|estimate|convolution/i);
  });

  it('rejects convolution in shader and symbolic backends', () => {
    const expression = convolutionExpression();
    const shader = lowerToDomainColoringProgram(expression, shaderOptions);
    expect(shader.ok).toBe(false);
    if (!shader.ok) expect(shader.issue.message).toMatch(/convolution|pointwise|shader/i);

    const symbolic = lowerToSympy(expression, []);
    expect(symbolic.ok).toBe(false);
    if (!symbolic.ok) expect(symbolic.issue.message).toMatch(/convolution|numerical|symbolic/i);
  });
});
