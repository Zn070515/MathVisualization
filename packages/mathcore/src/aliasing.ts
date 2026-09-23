/**
 * Relations created by uniform sampling.
 *
 * Frequencies separated by an integer multiple of the sampling angular
 * frequency produce the same indexed sinusoid up to an origin-dependent phase.
 * The representative uses the repository's DFT convention: the Nyquist edge is
 * represented by +Ωs/2, matching the positive signed Nyquist bin.
 */
import { type Complex } from './complex';
import { fail, ok, type MathIssue, type Result } from './errors';

export interface AliasingRelation {
  readonly representative: number;
  readonly samplingAngularFrequency: number;
  readonly nyquistAngularFrequency: number;
  readonly sampleOrigin: number;
  /** Phase multiplier for a +Ωs frequency shift on the indexed sample sequence. */
  readonly phasePerSamplingFrequency: Complex;
  /** The representative and its nearest ± one sampling-frequency aliases. */
  readonly aliases: readonly number[];
}

/** Describe the frequency aliases and sample-grid phase at a sampling interval. */
export function describeAliasing(
  angularFrequency: number,
  sampleInterval: number,
  sampleOrigin: number,
): Result<AliasingRelation, MathIssue> {
  if (!Number.isFinite(angularFrequency)) {
    return fail({
      kind: 'invalid-parameter',
      message: 'The frequency must be finite before it can be folded by sampling.',
    });
  }
  if (!Number.isFinite(sampleInterval) || sampleInterval <= 0) {
    return fail({
      kind: 'invalid-parameter',
      message: 'The sampling interval must be finite and positive.',
    });
  }
  if (!Number.isFinite(sampleOrigin)) {
    return fail({
      kind: 'invalid-parameter',
      message: 'The sample-grid origin must be finite.',
    });
  }

  const samplingAngularFrequency = (2 * Math.PI) / sampleInterval;
  if (!Number.isFinite(samplingAngularFrequency)) {
    return fail({
      kind: 'invalid-parameter',
      message: 'The sampling angular frequency must be finite.',
    });
  }
  const nyquistAngularFrequency = samplingAngularFrequency / 2;
  const cycleIndex = Math.floor(
    (angularFrequency + nyquistAngularFrequency) / samplingAngularFrequency,
  );
  if (!Number.isFinite(cycleIndex)) {
    return fail({
      kind: 'invalid-parameter',
      message: 'The frequency is too large to fold at this sampling rate.',
    });
  }
  let wrapped = angularFrequency - cycleIndex * samplingAngularFrequency;
  if (wrapped > nyquistAngularFrequency) wrapped -= samplingAngularFrequency;
  const representative =
    angularFrequency === nyquistAngularFrequency ||
    angularFrequency === -nyquistAngularFrequency ||
    wrapped === -nyquistAngularFrequency
      ? nyquistAngularFrequency
      : wrapped;
  const phaseAngle = -samplingAngularFrequency * sampleOrigin;
  if (!Number.isFinite(phaseAngle)) {
    return fail({
      kind: 'invalid-parameter',
      message: 'The sample-grid phase is too large to evaluate.',
    });
  }

  return ok({
    representative,
    samplingAngularFrequency,
    nyquistAngularFrequency,
    sampleOrigin,
    phasePerSamplingFrequency: {
      re: Math.cos(phaseAngle),
      im: Math.sin(phaseAngle),
    },
    aliases: [
      representative - samplingAngularFrequency,
      representative,
      representative + samplingAngularFrequency,
    ],
  });
}
