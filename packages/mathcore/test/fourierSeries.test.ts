import { describe, expect, it } from 'vitest';
import type { FourierSeriesNode } from '../src/ast';
import { evaluateFourierSeriesAt, estimateFourierSeries } from '../src/fourierSeries';
import { buildWorkspace, workspaceEnvironment, type WorkspaceInput } from '../src/workspace';

function inputs(...sources: string[]): WorkspaceInput[] {
  return sources.map((source, index) => ({ id: `line-${index}`, source }));
}

function seriesEntry(
  source: string,
  parameterSources: readonly string[] = [],
): { node: FourierSeriesNode; environment: ReturnType<typeof workspaceEnvironment> } {
  const workspace = buildWorkspace(
    inputs(...parameterSources, source, 'S(t)=FourierSeries(f(u),2*pi)'),
  );
  const entry = workspace.entries.at(-1);
  const body = entry?.statement?.kind === 'function-definition' ? entry.statement.body : null;
  if (body?.kind !== 'fourier-series') throw new Error('expected a Fourier series definition');
  return { node: body, environment: workspaceEnvironment(workspace) };
}

describe('Fourier series coefficient estimates', () => {
  it('computes only the constant coefficient for a constant source', () => {
    const { node, environment } = seriesEntry('f(u)=2');
    const estimate = estimateFourierSeries(node, environment, {
      order: 3,
      integrationSampleCount: 4,
    });

    expect(estimate.period).toBeCloseTo(2 * Math.PI, 12);
    expect(estimate.baseIntegrationIntervals).toBe(12);
    expect(estimate.refinedIntegrationIntervals).toBe(24);
    expect(estimate.constantCoefficient).toBeCloseTo(4, 10);
    expect(estimate.cosineCoefficients.every((value) => Math.abs(value) < 1e-10)).toBe(true);
    expect(estimate.sineCoefficients.every((value) => Math.abs(value) < 1e-10)).toBe(true);
    expect(estimate.convergence).toBe('converged');
    expect(evaluateFourierSeriesAt(estimate, 0.7)).toBeCloseTo(2, 10);
  });

  it('recovers the first cosine coefficient of cos(u)', () => {
    const { node, environment } = seriesEntry('f(u)=cos(u)');
    const estimate = estimateFourierSeries(node, environment, {
      order: 3,
      integrationSampleCount: 64,
    });

    expect(estimate.constantCoefficient).toBeCloseTo(0, 10);
    expect(estimate.cosineCoefficients[0]).toBeCloseTo(1, 8);
    expect(estimate.cosineCoefficients.slice(1).every((value) => Math.abs(value) < 1e-8)).toBe(
      true,
    );
    expect(estimate.sineCoefficients.every((value) => Math.abs(value) < 1e-8)).toBe(true);
  });

  it('recovers the odd sine coefficients of sign(sin(u))', () => {
    const { node, environment } = seriesEntry('f(u)=sign(sin(u))');
    const estimate = estimateFourierSeries(node, environment, {
      order: 5,
      integrationSampleCount: 256,
    });

    expect(estimate.sineCoefficients[0]).toBeCloseTo(4 / Math.PI, 3);
    expect(estimate.sineCoefficients[2]).toBeCloseTo(4 / (3 * Math.PI), 3);
    expect(Math.abs(estimate.sineCoefficients[1] ?? 0)).toBeLessThan(1e-8);
    expect(estimate.cosineCoefficients.every((value) => Math.abs(value) < 1e-8)).toBe(true);
  });

  it('uses at least four quadrature intervals per requested harmonic', () => {
    const { node, environment } = seriesEntry('f(u)=cos(u)');
    const estimate = estimateFourierSeries(node, environment, {
      order: 5,
      integrationSampleCount: 4,
    });

    expect(estimate.requestedIntegrationSampleCount).toBe(4);
    expect(estimate.baseIntegrationIntervals).toBe(20);
    expect(estimate.refinedIntegrationIntervals).toBe(40);
    expect(estimate.coefficientDisagreement).toBeLessThan(1e-8);
  });
});

describe('Fourier series validation and unresolved estimates', () => {
  it('rejects invalid numerical options without a usable partial sum', () => {
    const { node, environment } = seriesEntry('f(u)=cos(u)');
    const estimate = estimateFourierSeries(node, environment, {
      order: 0,
      integrationSampleCount: 0,
    });

    expect(estimate.period).toBeNull();
    expect(estimate.constantCoefficient).toBeNull();
    expect(estimate.cosineCoefficients).toEqual([]);
    expect(estimate.sineCoefficients).toEqual([]);
    expect(estimate.convergence).toBe('unresolved');
    expect(estimate.diagnostics.join(' ')).toMatch(/order|interval/i);
    expect(evaluateFourierSeriesAt(estimate, 0)).toBeNull();
  });

  it('rejects a non-positive period', () => {
    const workspace = buildWorkspace(inputs('f(u)=cos(u)', 'S(t)=FourierSeries(f(u),0)'));
    const body = workspace.entries[1]?.statement;
    if (body?.kind !== 'function-definition' || body.body.kind !== 'fourier-series') {
      throw new Error('expected a Fourier series definition');
    }
    const estimate = estimateFourierSeries(body.body, workspaceEnvironment(workspace), {
      order: 3,
      integrationSampleCount: 32,
    });
    expect(estimate.period).toBeNull();
    expect(estimate.convergence).toBe('unresolved');
    expect(estimate.diagnostics.join(' ')).toMatch(/positive|period/i);
  });

  it('reports a source domain error on the base grid', () => {
    const { node, environment } = seriesEntry('f(u)=1/u');
    const estimate = estimateFourierSeries(node, environment, {
      order: 5,
      integrationSampleCount: 4,
    });
    expect(estimate.period).toBeCloseTo(2 * Math.PI, 12);
    expect(estimate.unresolvedSamples).toBeGreaterThan(0);
    expect(estimate.convergence).toBe('unresolved');
    expect(estimate.constantCoefficient).toBeNull();
  });

  it('reports a source domain error found only after refinement', () => {
    const { node, environment } = seriesEntry('f(u)=1/(u-a)', ['a=-pi+pi/20']);
    const estimate = estimateFourierSeries(node, environment, {
      order: 5,
      integrationSampleCount: 4,
    });
    expect(estimate.baseIntegrationIntervals).toBe(20);
    expect(estimate.refinedIntegrationIntervals).toBe(40);
    expect(estimate.period).toBeCloseTo(2 * Math.PI, 12);
    expect(estimate.unresolvedSamples).toBeGreaterThan(0);
    expect(estimate.diagnostics.join(' ')).toMatch(/refin|undefined|domain|finite/i);
  });
});
