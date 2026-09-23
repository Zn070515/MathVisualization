import { describe, expect, it } from 'vitest';
import { cx, fail, linearizationAt, ok, type RealFieldEvaluator } from '@mathviz/mathcore';
import {
  measureTangentPlaneError,
  sampleTangentPlane,
} from '../src/views/tangentPlane';

const sampling = {
  xMin: 0,
  xMax: 2,
  yMin: 0,
  yMax: 2,
  columns: 3,
  rows: 3,
};

describe('tangent-plane view data', () => {
  it('samples the linearization as a real surface mesh', () => {
    const result = linearizationAt((x, y) => ok(cx(x * x + y * y, 0)), 1, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const mesh = sampleTangentPlane(result.value, sampling);
    expect(mesh.index.length).toBe(24);
    expect(mesh.values[0]).toBeCloseTo(-2, 6);
    expect(mesh.values[8]).toBeCloseTo(6, 6);
  });

  it('reports sampled approximation error and unresolved samples separately', () => {
    const evaluate = (x: number, y: number) => ok(cx(x * x + y * y, 0));
    const result = linearizationAt(evaluate, 1, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const diagnostics = measureTangentPlaneError(evaluate, result.value, sampling);
    expect(diagnostics.sampleCount).toBe(9);
    expect(diagnostics.unresolvedSamples).toBe(0);
    expect(diagnostics.maxAbsoluteError).toBeCloseTo(2, 6);
  });

  it('does not turn undefined samples into a zero error claim', () => {
    const evaluate: RealFieldEvaluator = (x, y) =>
      x > 0.5
        ? fail({ kind: 'singularity', message: 'undefined sample' })
        : ok(cx(x + y, 0));
    const result = linearizationAt(evaluate, 0, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const diagnostics = measureTangentPlaneError(evaluate, result.value, sampling);
    expect(diagnostics.unresolvedSamples).toBeGreaterThan(0);
  });
});
