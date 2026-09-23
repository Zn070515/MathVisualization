/**
 * Relations created by uniform sampling.
 *
 * Frequencies separated by an integer multiple of the sampling angular
 * frequency produce the same samples. The representative uses the repository's
 * DFT convention: the Nyquist edge is represented by +Ωs/2, matching the
 * positive signed Nyquist bin.
 */
import { fail, ok, type MathIssue, type Result } from './errors';

export interface AliasingRelation {
  readonly representative: number;
  readonly samplingAngularFrequency: number;
  readonly nyquistAngularFrequency: number;
  /** The representative and its nearest ± one sampling-frequency aliases. */
  readonly aliases: readonly number[];
}

/** Describe the frequencies that are indistinguishable at a sampling interval. */
export function describeAliasing(
  angularFrequency: number,
  sampleInterval: number,
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

  const samplingAngularFrequency = (2 * Math.PI) / sampleInterval;
  const nyquistAngularFrequency = samplingAngularFrequency / 2;
  const wrapped =
    positiveModulo(angularFrequency + nyquistAngularFrequency, samplingAngularFrequency) -
    nyquistAngularFrequency;
  const representative =
    Math.abs(wrapped + nyquistAngularFrequency) <=
    Number.EPSILON * Math.max(1, samplingAngularFrequency) * 8
      ? nyquistAngularFrequency
      : wrapped;

  return ok({
    representative,
    samplingAngularFrequency,
    nyquistAngularFrequency,
    aliases: [
      representative - samplingAngularFrequency,
      representative,
      representative + samplingAngularFrequency,
    ],
  });
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}
