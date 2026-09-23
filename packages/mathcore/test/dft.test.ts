import { describe, expect, it } from 'vitest';
import { collectVariableNames, type DftTransformNode } from '../src/ast';
import { cabs } from '../src/complex';
import { estimateDft } from '../src/dft';
import { evaluateScalar } from '../src/evaluator';
import { lowerToDomainColoringProgram } from '../src/glsl';
import { exprToLatex, parseLatexExpression } from '../src/latex';
import { parseExpression } from '../src/parser';
import { lowerToSympy } from '../src/sympy';
import { buildWorkspace, workspaceEnvironment, type WorkspaceInput } from '../src/workspace';
import { expectComplexCloseTo } from './helpers';

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

function transformEntry(workspace: ReturnType<typeof buildWorkspace>): DftTransformNode {
  const entry = workspace.entries[1];
  const body = entry?.statement?.kind === 'function-definition' ? entry.statement.body : null;
  if (body?.kind !== 'dft-transform') throw new Error('expected a DFT transform definition');
  return body;
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

  it('requires a one-dimensional real frequency variable', () => {
    const complexFrequency = buildWorkspace(inputs('f(t)=t', 'D(z)=DFT(f(t))'));
    expect(complexFrequency.entries[1]?.type).toBeNull();
    expect(complexFrequency.entries[1]?.typeIssue?.message).toMatch(/frequency.*real/i);

    const multiVariableFrequency = buildWorkspace(inputs('f(t)=t', 'D(x,y)=DFT(f(t))'));
    expect(multiVariableFrequency.entries[1]?.type).toBeNull();
    expect(multiVariableFrequency.entries[1]?.typeIssue?.message).toMatch(/frequency.*real/i);
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

describe('numerical DFT estimates', () => {
  it('keeps FFT and direct DFT on the same scaled signed-bin convention', () => {
    const workspace = buildWorkspace(inputs('f(t)=cos(pi*t/2)', 'D(ω)=DFT(f(t))'));
    const options = { timeWindow: { min: 1, max: 5 }, sampleCount: 8 };
    const direct = estimateDft(transformEntry(workspace), workspaceEnvironment(workspace), {
      ...options,
      algorithm: 'direct',
    });
    const fast = estimateDft(transformEntry(workspace), workspaceEnvironment(workspace), {
      ...options,
      algorithm: 'fft',
    });

    expect(fast.algorithm).toBe('fft');
    expect(fast.bins.map((bin) => bin.signedIndex)).toEqual(
      direct.bins.map((bin) => bin.signedIndex),
    );
    expect(fast.values).toHaveLength(direct.values.length);
    fast.values.forEach((value, index) => {
      expectComplexCloseTo(value, direct.values[index] as { re: number; im: number });
    });
  });

  it('uses time-integral scaling and a half-open sample grid', () => {
    const workspace = buildWorkspace(inputs('f(t)=1', 'D(ω)=DFT(f(t))'));
    const estimate = estimateDft(transformEntry(workspace), workspaceEnvironment(workspace), {
      timeWindow: { min: 0, max: 4 },
      sampleCount: 4,
    });

    expect(estimate.samples).toHaveLength(4);
    expect(estimate.sampleTimes).toEqual([0, 1, 2, 3]);
    expect(estimate.values[0]).toEqual({ re: 4, im: 0 });
    expect(estimate.sampleInterval).toBe(1);
    expect(estimate.samplingFrequency).toBe(1);
    expect(estimate.nyquistAngularFrequency).toBe(Math.PI);
    expect(estimate.bins.map((bin) => bin.signedIndex)).toEqual([0, 1, 2, -1]);
  });

  it('places an on-grid cosine at its positive and negative frequency bins', () => {
    const workspace = buildWorkspace(inputs('f(t)=cos(pi*t/2)', 'D(ω)=DFT(f(t))'));
    const estimate = estimateDft(transformEntry(workspace), workspaceEnvironment(workspace), {
      timeWindow: { min: 0, max: 8 },
      sampleCount: 8,
    });

    expect(cabs(estimate.values[2] ?? { re: 0, im: 0 })).toBeCloseTo(4, 10);
    expect(cabs(estimate.values[6] ?? { re: 0, im: 0 })).toBeCloseTo(4, 10);
    expect(estimate.stability).toBe('stable');
    expect(estimate.estimatedError).toBeLessThan(1e-10);
  });

  it('reports a coarse grid that aliases a higher-frequency cosine', () => {
    const workspace = buildWorkspace(inputs('f(t)=cos(3*pi*t/2)', 'D(ω)=DFT(f(t))'));
    const estimate = estimateDft(transformEntry(workspace), workspaceEnvironment(workspace), {
      timeWindow: { min: 0, max: 4 },
      sampleCount: 4,
    });

    expect(estimate.bins[1]?.angularFrequency).toBeCloseTo(Math.PI / 2, 12);
    expect(cabs(estimate.values[1] ?? { re: 0, im: 0 })).toBeCloseTo(2, 10);
    expect(cabs(estimate.values[3] ?? { re: 0, im: 0 })).toBeCloseTo(2, 10);
    expect(estimate.stability).toBe('sampling-sensitive');
  });

  it('keeps the time-origin phase in the complex spectrum', () => {
    const workspace = buildWorkspace(inputs('f(t)=cos(pi*t/2)', 'D(ω)=DFT(f(t))'));
    const estimate = estimateDft(transformEntry(workspace), workspaceEnvironment(workspace), {
      timeWindow: { min: 1, max: 5 },
      sampleCount: 4,
    });

    expect(estimate.values[1]?.re ?? 0).toBeCloseTo(2, 10);
    expect(estimate.values[1]?.im ?? 0).toBeCloseTo(0, 10);
  });

  it('returns unresolved when a sampled source is not finite', () => {
    const workspace = buildWorkspace(inputs('f(t)=1/(t-t)', 'D(ω)=DFT(f(t))'));
    const estimate = estimateDft(transformEntry(workspace), workspaceEnvironment(workspace), {
      timeWindow: { min: 0, max: 4 },
      sampleCount: 4,
    });

    expect(estimate.stability).toBe('unresolved');
    expect(estimate.values).toEqual([]);
    expect(estimate.diagnostics.join(' ')).toMatch(/finite|undefined|evaluate/i);
  });

  it('rejects an unsafe resolution before doing direct quadratic work', () => {
    const workspace = buildWorkspace(inputs('f(t)=1', 'D(ω)=DFT(f(t))'));
    const estimate = estimateDft(transformEntry(workspace), workspaceEnvironment(workspace), {
      timeWindow: { min: 0, max: 4 },
      sampleCount: 1024,
    });

    expect(estimate.stability).toBe('unresolved');
    expect(estimate.diagnostics.join(' ')).toMatch(/resolution|sample|1024/i);
  });
});
