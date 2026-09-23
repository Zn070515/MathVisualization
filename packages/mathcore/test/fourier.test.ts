import { describe, expect, it } from 'vitest';
import { collectVariableNames, type FourierTransformNode } from '../src/ast';
import { cabs } from '../src/complex';
import { evaluateScalar } from '../src/evaluator';
import { estimateFourierTransform } from '../src/fourier';
import { lowerToDomainColoringProgram } from '../src/glsl';
import { exprToLatex, parseLatexExpression } from '../src/latex';
import { parseExpression } from '../src/parser';
import { lowerToSympy } from '../src/sympy';
import { buildWorkspace, workspaceEnvironment, type WorkspaceInput } from '../src/workspace';

function inputs(...sources: string[]): WorkspaceInput[] {
  return sources.map((source, index) => ({ id: `line-${index}`, source }));
}

function fourierExpression(source = 'Fourier(f(t))'): FourierTransformNode {
  const parsed = parseExpression(source, {
    knownFunctions: new Set(['f', 'Fourier']),
    knownValues: new Set(['t', 'ω']),
  });
  if (!parsed.ok) throw new Error(parsed.issue.message);
  if (parsed.value.kind !== 'fourier-transform') {
    throw new Error(`expected a Fourier transform, got ${parsed.value.kind}`);
  }
  return parsed.value;
}

function transformEntry(workspace: ReturnType<typeof buildWorkspace>): FourierTransformNode {
  const entry = workspace.entries[1];
  const body = entry?.statement?.kind === 'function-definition' ? entry.statement.body : null;
  if (body?.kind !== 'fourier-transform') throw new Error('expected a Fourier transform entry');
  return body;
}

describe('Fourier transform syntax and binding', () => {
  it('parses the operation as a dedicated AST node', () => {
    const transform = fourierExpression();

    expect(transform.kind).toBe('fourier-transform');
    expect(transform.sourceVariable).toBe('t');
    expect(transform.source.kind).toBe('call');
    expect(collectVariableNames(transform)).toEqual([]);
  });

  it('reads the LaTeX operation into the same AST shape', () => {
    const parsed = parseLatexExpression('\\operatorname{Fourier}(f(t))', {
      knownFunctions: new Set(['f']),
    });
    if (!parsed.ok) throw new Error(parsed.issue.message);

    expect(parsed.value.kind).toBe('fourier-transform');
    if (parsed.value.kind !== 'fourier-transform') return;
    expect(parsed.value.sourceVariable).toBe('t');
    expect(exprToLatex(parsed.value)).toContain('Fourier');
  });

  it('accepts MathLive styled operator names', () => {
    const parsed = parseLatexExpression('\\operatorname{\\mathrm{Fourier}}(f(t))', {
      knownFunctions: new Set(['f']),
    });
    if (!parsed.ok) throw new Error(parsed.issue.message);
    expect(parsed.value.kind).toBe('fourier-transform');
  });

  it('rejects a source that is not a unary real signal call', () => {
    const malformed = parseExpression('Fourier(t^2)', {
      knownFunctions: new Set(['Fourier']),
      knownValues: new Set(['t']),
    });
    expect(malformed.ok).toBe(false);

    const multiple = parseExpression('Fourier(f(t, t))', {
      knownFunctions: new Set(['f', 'Fourier']),
      knownValues: new Set(['t']),
    });
    expect(multiple.ok).toBe(false);
  });
});

describe('Fourier transform workspace inference', () => {
  it('classifies a valid real source and transform pair separately', () => {
    const workspace = buildWorkspace(inputs('f(t)=exp(-t^2)', 'F(ω)=Fourier(f(t))'));

    expect(workspace.entries[0]?.type?.classification.kind).toBe('real-function');
    expect(workspace.entries[1]?.type?.classification.kind).toBe('transform-pair');
    expect(workspace.entries[1]?.type?.signature).toEqual({
      domain: { kind: 'R', dim: 1 },
      codomain: { kind: 'C', dim: 1 },
    });
  });

  it('does not classify an ordinary complex signal as a transform pair', () => {
    const workspace = buildWorkspace(inputs('g(t)=exp(i*t)'));
    expect(workspace.entries[0]?.type?.classification.kind).toBe('complex-path');
  });

  it('rejects a complex-valued source function', () => {
    const workspace = buildWorkspace(inputs('f(t)=exp(i*t)', 'F(ω)=Fourier(f(t))'));
    expect(workspace.entries[1]?.type).toBeNull();
    expect(workspace.entries[1]?.typeIssue?.message).toMatch(/real|complex/i);
  });
});

describe('numerical Fourier estimates', () => {
  it('computes a finite-window estimate from the user source', () => {
    const workspace = buildWorkspace(inputs('f(t)=exp(-t^2)', 'F(ω)=Fourier(f(t))'));
    const transform = transformEntry(workspace);
    const environment = workspaceEnvironment(workspace);
    const estimate = estimateFourierTransform(transform, environment, {
      frequencies: [-2, -1, 0, 1, 2],
      timeWindow: { min: -7, max: 7 },
      timeSamples: 256,
    });

    expect(estimate.values).toHaveLength(5);
    expect(estimate.frequencies).toEqual([-2, -1, 0, 1, 2]);
    expect(estimate.timeWindow).toEqual({ min: -7, max: 7 });
    expect(estimate.diagnostics.join(' ')).toMatch(/finite-window/i);
    expect(estimate.values.every((value) => Number.isFinite(value.re) && Number.isFinite(value.im))).toBe(
      true,
    );
    expect(estimate.values[2]?.re ?? 0).toBeGreaterThan(estimate.values[0]?.re ?? 0);
    expect(Math.abs((estimate.values[1]?.im ?? 0) + (estimate.values[3]?.im ?? 0))).toBeLessThan(1e-8);
  });

  it('responds to a parameter without a closed-form shortcut', () => {
    const workspace = buildWorkspace(inputs('a=1', 'f(t)=exp(-a*t^2)', 'F(ω)=Fourier(f(t))'));
    const transform = workspace.entries[2]?.statement;
    if (transform?.kind !== 'function-definition' || transform.body.kind !== 'fourier-transform') {
      throw new Error('expected a Fourier transform definition');
    }

    const first = estimateFourierTransform(transform.body, workspaceEnvironment(workspace), {
      frequencies: [0],
      timeWindow: { min: -7, max: 7 },
      timeSamples: 256,
    });
    const second = estimateFourierTransform(
      transform.body,
      workspaceEnvironment(workspace, new Map([['a', 4]])),
      {
        frequencies: [0],
        timeWindow: { min: -7, max: 7 },
        timeSamples: 256,
      },
    );

    expect(cabs(first.values[0] ?? { re: 0, im: 0 })).not.toBeCloseTo(
      cabs(second.values[0] ?? { re: 0, im: 0 }),
      3,
    );
  });

  it('reports unresolved output when the source is not finite', () => {
    const workspace = buildWorkspace(inputs('f(t)=1/(t-t)', 'F(ω)=Fourier(f(t))'));
    const transform = transformEntry(workspace);
    const estimate = estimateFourierTransform(transform, workspaceEnvironment(workspace), {
      frequencies: [0],
      timeWindow: { min: -1, max: 1 },
      timeSamples: 64,
    });

    expect(estimate.convergence).toBe('unresolved');
    expect(estimate.diagnostics.join(' ')).toMatch(/undefined|finite|evaluate/i);
  });
});

describe('unsupported Fourier backends', () => {
  it('does not evaluate a transform as a scalar point value', () => {
    const result = evaluateScalar(fourierExpression());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.message).toMatch(/frequency-domain|estimate/i);
  });

  it('rejects the transform in the shader and symbolic backends', () => {
    const expression = fourierExpression();
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
