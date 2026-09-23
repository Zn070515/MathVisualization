import { describe, expect, it } from 'vitest';
import { collectVariableNames, type ConvolutionNode } from '../src/ast';
import { cx, cabs } from '../src/complex';
import {
  dftOfPeriodicSamples,
  estimateConvolution,
  periodicSampledConvolution,
  phaseCorrectedDftProduct,
  type ConvolutionEstimate,
  type ConvolutionEstimateOptions,
} from '../src/convolution';
import { estimateDft, type DftEstimate, type DftTimeWindow } from '../src/dft';
import { evaluateScalar } from '../src/evaluator';
import { lowerToDomainColoringProgram } from '../src/glsl';
import { exprToLatex, parseLatexExpression } from '../src/latex';
import { parseExpression } from '../src/parser';
import { lowerToSympy } from '../src/sympy';
import { buildWorkspace, workspaceEnvironment, type WorkspaceInput } from '../src/workspace';

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

function convolutionEntry(workspace: ReturnType<typeof buildWorkspace>): ConvolutionNode {
  const entry = workspace.entries[2];
  const body = entry?.statement?.kind === 'function-definition' ? entry.statement.body : null;
  if (body?.kind !== 'convolution') throw new Error('expected convolution definition');
  return body;
}

function estimateFor(
  sources: readonly string[],
  options: ConvolutionEstimateOptions,
): ConvolutionEstimate {
  const workspace = buildWorkspace(inputs(...sources));
  return estimateConvolution(convolutionEntry(workspace), workspaceEnvironment(workspace), options);
}

function dftEstimateFor(bodySource: string, timeWindow: DftTimeWindow): DftEstimate {
  const workspace = buildWorkspace(inputs(`f(t)=${bodySource}`, 'D(ω)=DFT(f(t))'));
  const entry = workspace.entries[1];
  const body = entry?.statement?.kind === 'function-definition' ? entry.statement.body : null;
  if (body?.kind !== 'dft-transform') throw new Error('expected DFT definition');
  return estimateDft(body, workspaceEnvironment(workspace), {
    timeWindow,
    sampleCount: 16,
  });
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
    const workspace = buildWorkspace(inputs('f(z)=z', 'g(z)=z', 'h(t)=Convolution(f(z), g(z))'));
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

describe('finite-window numerical convolution', () => {
  it('estimates constant finite-window convolution', () => {
    const estimate = estimateFor(['f(t)=1', 'g(t)=1', 'h(t)=Convolution(f(t), g(t))'], {
      integrationWindow: { min: 0, max: 2 },
      outputWindow: { min: -1, max: 1 },
      outputSampleCount: 8,
      integrationSampleCount: 8,
    });

    expect(estimate.stability).toBe('stable');
    expect(estimate.values.every((value) => value.re === 2 && value.im === 0)).toBe(true);
  });

  it('returns the refined value and finite refinement error', () => {
    const estimate = estimateFor(
      ['f(t)=exp(-t^2)', 'g(t)=exp(-2*t^2)', 'h(t)=Convolution(f(t), g(t))'],
      {
        integrationWindow: { min: -4, max: 4 },
        outputWindow: { min: -2, max: 2 },
        outputSampleCount: 8,
        integrationSampleCount: 16,
      },
    );

    expect(estimate.estimatedError).toBeGreaterThanOrEqual(0);
    expect(estimate.primaryIntegrationSampleCount).toBe(16);
    expect(estimate.refinedIntegrationSampleCount).toBe(32);
    expect(estimate.diagnostics.join(' ')).toMatch(/finite-window/i);
  });

  it('returns unresolved when a source is not finite', () => {
    const estimate = estimateFor(['f(t)=1/(t-t)', 'g(t)=1', 'h(t)=Convolution(f(t), g(t))'], {
      integrationWindow: { min: -1, max: 1 },
      outputWindow: { min: -1, max: 1 },
      outputSampleCount: 8,
      integrationSampleCount: 8,
    });

    expect(estimate.stability).toBe('unresolved');
    expect(estimate.values).toEqual([]);
    expect(estimate.estimatedError).toBe(Infinity);
    expect(estimate.diagnostics.join(' ')).toMatch(/undefined|finite|unresolved/i);
  });
});

describe('periodic sampled convolution', () => {
  it('uses Δt scaling and circular indexing', () => {
    const result = periodicSampledConvolution([cx(1), cx(2)], [cx(3), cx(5)], 0.5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      { re: 6.5, im: 0 },
      { re: 5.5, im: 0 },
    ]);
  });

  it('adds the nonzero sample-origin phase to the DFT product', () => {
    const timeWindow = { min: 0.25, max: 8.25 };
    const left = dftEstimateFor('1 + cos(pi*t/2)', timeWindow);
    const right = dftEstimateFor('1 + sin(pi*t/2)', timeWindow);
    const product = phaseCorrectedDftProduct(left, right);
    expect(product.ok).toBe(true);
    if (!product.ok) return;

    const bin = left.bins[1];
    const leftValue = left.values[1];
    const rightValue = right.values[1];
    if (bin === undefined || leftValue === undefined || rightValue === undefined) {
      throw new Error('expected a populated frequency bin');
    }
    const expectedPhase = cx(
      Math.cos(bin.angularFrequency * timeWindow.min),
      Math.sin(bin.angularFrequency * timeWindow.min),
    );
    const expected = {
      re:
        expectedPhase.re * (leftValue.re * rightValue.re - leftValue.im * rightValue.im) -
        expectedPhase.im * (leftValue.re * rightValue.im + leftValue.im * rightValue.re),
      im:
        expectedPhase.re * (leftValue.re * rightValue.im + leftValue.im * rightValue.re) +
        expectedPhase.im * (leftValue.re * rightValue.re - leftValue.im * rightValue.im),
    };
    const actual = product.value[1];
    if (actual === undefined) throw new Error('expected a product value');
    expect(cabs({ re: actual.re - expected.re, im: actual.im - expected.im })).toBeLessThan(1e-12);
  });

  it('matches the phase-corrected product on the same circular sample grid', () => {
    const timeWindow = { min: 0.25, max: 8.25 };
    const left = dftEstimateFor('cos(t)', timeWindow);
    const right = dftEstimateFor('sin(t)', timeWindow);
    const circular = periodicSampledConvolution(left.samples, right.samples, left.sampleInterval);
    const product = phaseCorrectedDftProduct(left, right);
    expect(circular.ok).toBe(true);
    expect(product.ok).toBe(true);
    if (!circular.ok || !product.ok) return;

    const transformed = dftOfPeriodicSamples(circular.value, left);
    expect(transformed.ok).toBe(true);
    if (!transformed.ok) return;
    const maximum = transformed.value.reduce((largest, value, index) => {
      const reference = product.value[index];
      if (reference === undefined) return Number.POSITIVE_INFINITY;
      return Math.max(largest, cabs({ re: value.re - reference.re, im: value.im - reference.im }));
    }, 0);
    expect(maximum).toBeLessThan(1e-9);
  });
});
