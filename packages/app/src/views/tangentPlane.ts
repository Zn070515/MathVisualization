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
  /** Null means that no sampled field value was resolved. */
  readonly maxAbsoluteError: number | null;
  readonly sampleCount: number;
  readonly unresolvedSamples: number;
}

export interface TangentPatchDomain {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

/**
 * Build a local patch around a selected point without losing the point at a
 * domain edge. A selection outside the current domain is not silently
 * clamped: the linked 3D view cannot represent that point yet.
 */
export function tangentPatchForSelection(
  selection: { readonly x: number; readonly y: number },
  domain: TangentPatchDomain,
  maxRadius: number,
): TangentPatchDomain | null {
  if (
    !Number.isFinite(selection.x) ||
    !Number.isFinite(selection.y) ||
    !Number.isFinite(maxRadius) ||
    maxRadius <= 0 ||
    !Number.isFinite(domain.xMin) ||
    !Number.isFinite(domain.xMax) ||
    !Number.isFinite(domain.yMin) ||
    !Number.isFinite(domain.yMax) ||
    domain.xMin >= domain.xMax ||
    domain.yMin >= domain.yMax ||
    selection.x < domain.xMin ||
    selection.x > domain.xMax ||
    selection.y < domain.yMin ||
    selection.y > domain.yMax
  ) {
    return null;
  }

  const width = domain.xMax - domain.xMin;
  const height = domain.yMax - domain.yMin;
  const radius = Math.min(maxRadius, width / 4, height / 4);
  if (!(radius > 0)) return null;

  const span = 2 * radius;
  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));
  const xMin = clamp(selection.x - radius, domain.xMin, domain.xMax - span);
  const yMin = clamp(selection.y - radius, domain.yMin, domain.yMax - span);

  return {
    xMin,
    xMax: xMin + span,
    yMin,
    yMax: yMin + span,
  };
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
  let maxAbsoluteError: number | null = null;
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
      maxAbsoluteError =
        maxAbsoluteError === null
          ? result.value.absoluteError
          : Math.max(maxAbsoluteError, result.value.absoluteError);
    }
  }

  return {
    maxAbsoluteError,
    sampleCount: columns * rows,
    unresolvedSamples,
  };
}
