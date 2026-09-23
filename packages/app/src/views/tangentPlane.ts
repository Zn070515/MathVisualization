import {
  cx,
  linearizationErrorAt,
  linearizedValue,
  ok,
  sampleSurface,
  type Linearization,
  type RealFieldEvaluator,
  type SurfaceMesh,
  type SurfaceSampling,
} from '@mathviz/mathcore';

export interface TangentPlaneDiagnostics {
  readonly maxAbsoluteError: number;
  readonly sampleCount: number;
  readonly unresolvedSamples: number;
}

/** Sample the tangent plane over the same domain as the linked surface. */
export function sampleTangentPlane(
  linearization: Linearization,
  sampling: SurfaceSampling,
): SurfaceMesh {
  return sampleSurface(
    (x, y) => ok(cx(linearizedValue(linearization, x, y), 0)),
    sampling,
  );
}

/** Measure the actual field-versus-plane error over a display patch. */
export function measureTangentPlaneError(
  evaluate: RealFieldEvaluator,
  linearization: Linearization,
  sampling: SurfaceSampling,
): TangentPlaneDiagnostics {
  const columns = Math.max(2, Math.floor(sampling.columns));
  const rows = Math.max(2, Math.floor(sampling.rows));
  const dx = (sampling.xMax - sampling.xMin) / (columns - 1);
  const dy = (sampling.yMax - sampling.yMin) / (rows - 1);
  let maxAbsoluteError = 0;
  let unresolvedSamples = 0;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = sampling.xMin + column * dx;
      const y = sampling.yMin + row * dy;
      const result = linearizationErrorAt(evaluate, linearization, x, y);
      if (!result.ok) {
        unresolvedSamples += 1;
        continue;
      }
      maxAbsoluteError = Math.max(maxAbsoluteError, result.value.absoluteError);
    }
  }

  return {
    maxAbsoluteError,
    sampleCount: columns * rows,
    unresolvedSamples,
  };
}
