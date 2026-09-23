import type { Complex } from '@mathviz/mathcore';

/** Split a mapped grid line wherever the function has no finite image. */
export function splitMappedPolyline(samples: readonly (Complex | null)[]): readonly Complex[][] {
  const segments: Complex[][] = [];
  let current: Complex[] = [];

  const flush = (): void => {
    if (current.length >= 2) segments.push(current);
    current = [];
  };

  for (const sample of samples) {
    if (sample === null || !Number.isFinite(sample.re) || !Number.isFinite(sample.im)) {
      flush();
      continue;
    }
    current.push(sample);
  }
  flush();
  return segments;
}
