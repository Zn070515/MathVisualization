/**
 * Deterministic direct estimates of the time-integral-scaled forward DFT.
 *
 * A DFT is deliberately a separate numerical object from the finite-window
 * continuous Fourier estimate. The returned bins are the frequencies of the
 * actual sample grid, and the refinement comparison says only whether this
 * sampled representation changes when the grid is doubled.
 */
import type { DftTransformNode } from './ast';
import { type Complex, cabs, cadd, cmul, cscale, cx, isFiniteComplex } from './complex';
import { ok, type MathIssue, type Result } from './errors';
import { type EvaluationEnvironment, evaluateScalar } from './evaluator';
import { radix2Fft } from './fft';

export interface DftTimeWindow {
  readonly min: number;
  readonly max: number;
}

export interface DftBin {
  readonly index: number;
  readonly signedIndex: number;
  readonly angularFrequency: number;
}

export type DftStability = 'stable' | 'sampling-sensitive' | 'unresolved';
export type DftAlgorithm = 'direct' | 'fft';

export interface DftEstimateOptions {
  readonly timeWindow: DftTimeWindow;
  readonly sampleCount: number;
  /** Numerical route used to compute the same DFT values. */
  readonly algorithm?: DftAlgorithm;
  /** Relative refinement threshold. Defaults to {@link DFT_DEFAULT_TOLERANCE}. */
  readonly tolerance?: number;
}

export interface DftEstimate {
  /** Values of the source at the primary, half-open sample grid. */
  readonly samples: readonly Complex[];
  readonly sampleTimes: readonly number[];
  readonly bins: readonly DftBin[];
  /** Time-integral-scaled DFT values at {@link bins}. */
  readonly values: readonly Complex[];
  readonly timeWindow: DftTimeWindow;
  readonly sampleCount: number;
  readonly algorithm: DftAlgorithm;
  readonly sampleInterval: number;
  /** Ordinary sampling frequency, in cycles per unit. */
  readonly samplingFrequency: number;
  /** Angular Nyquist frequency, in radians per unit. */
  readonly nyquistAngularFrequency: number;
  /** Largest primary/refined complex difference at a common frequency. */
  readonly estimatedError: number;
  readonly stability: DftStability;
  readonly diagnostics: readonly string[];
}

export const DFT_DEFAULT_TOLERANCE = 1e-5;
export const DFT_MAX_SAMPLE_COUNT = 512;
export const DFT_MAX_REFINED_SAMPLE_COUNT = 1024;

interface SampledSignal {
  readonly samples: readonly Complex[];
  readonly sampleTimes: readonly number[];
  readonly issue: string | null;
}

interface RawDft {
  readonly samples: readonly Complex[];
  readonly sampleTimes: readonly number[];
  readonly bins: readonly DftBin[];
  readonly values: readonly Complex[];
  readonly sampleInterval: number;
  readonly issue: string | null;
}

/** Estimate a DFT and classify whether its bins are stable under `N → 2N`. */
export function estimateDft(
  transform: DftTransformNode,
  environment: EvaluationEnvironment,
  options: DftEstimateOptions,
): DftEstimate {
  const algorithm = options.algorithm ?? 'direct';
  const diagnostics: string[] = [
    algorithm === 'fft'
      ? 'Radix-2 FFT of a finite set of samples; this computes the same DFT convention and does not certify the continuous transform.'
      : 'Direct DFT of a finite set of samples; this is the quadratic reference algorithm and does not certify the continuous transform.',
  ];
  const validation = validateOptions(options);
  if (validation !== null) return unresolvedEstimate(options, [...diagnostics, validation]);

  const base = estimateRawDft(
    transform,
    environment,
    options.timeWindow,
    options.sampleCount,
    algorithm,
  );
  if (base.issue !== null) return unresolvedEstimate(options, [...diagnostics, base.issue]);

  const refinedCount = options.sampleCount * 2;
  const refined = estimateRawDft(
    transform,
    environment,
    options.timeWindow,
    refinedCount,
    algorithm,
  );
  if (refined.issue !== null) return unresolvedEstimate(options, [...diagnostics, refined.issue]);

  const estimatedError = commonBinDifference(base.bins, base.values, refined.bins, refined.values);
  const scale = Math.max(1, ...refined.values.map(cabs));
  const relativeDifference = estimatedError / scale;
  const tolerance = options.tolerance ?? DFT_DEFAULT_TOLERANCE;
  const stability: DftStability =
    !Number.isFinite(estimatedError) || !Number.isFinite(relativeDifference)
      ? 'unresolved'
      : relativeDifference <= tolerance
        ? 'stable'
        : 'sampling-sensitive';

  if (stability === 'stable') {
    diagnostics.push(`N to 2N refinement stayed within relative difference ${relativeDifference}.`);
  } else if (stability === 'sampling-sensitive') {
    diagnostics.push(
      `N to 2N refinement changed common bins by relative difference ${relativeDifference}; aliasing or unresolved content may be present.`,
    );
  } else {
    diagnostics.push('N to 2N refinement could not produce a finite comparison.');
  }

  return {
    samples: [...base.samples],
    sampleTimes: [...base.sampleTimes],
    bins: [...base.bins],
    values: [...base.values],
    timeWindow: { ...options.timeWindow },
    sampleCount: options.sampleCount,
    algorithm,
    sampleInterval: base.sampleInterval,
    samplingFrequency: 1 / base.sampleInterval,
    nyquistAngularFrequency: Math.PI / base.sampleInterval,
    estimatedError,
    stability,
    diagnostics,
  };
}

function validateOptions(options: DftEstimateOptions): string | null {
  if (
    options.algorithm !== undefined &&
    options.algorithm !== 'direct' &&
    options.algorithm !== 'fft'
  ) {
    return 'The DFT algorithm must be direct or fft.';
  }
  if (
    !Number.isFinite(options.timeWindow.min) ||
    !Number.isFinite(options.timeWindow.max) ||
    options.timeWindow.max <= options.timeWindow.min
  ) {
    return 'The DFT time window must have a finite increasing range.';
  }
  if (
    !Number.isInteger(options.sampleCount) ||
    options.sampleCount < 2 ||
    options.sampleCount > DFT_MAX_SAMPLE_COUNT ||
    !isPowerOfTwo(options.sampleCount)
  ) {
    return `The DFT sample count must be a power of two from 2 through ${DFT_MAX_SAMPLE_COUNT}.`;
  }
  if (options.sampleCount * 2 > DFT_MAX_REFINED_SAMPLE_COUNT) {
    return `The DFT refinement is capped at ${DFT_MAX_REFINED_SAMPLE_COUNT} samples.`;
  }
  if (
    options.tolerance !== undefined &&
    (!Number.isFinite(options.tolerance) || options.tolerance < 0)
  ) {
    return 'The DFT refinement tolerance must be a finite non-negative number.';
  }
  return null;
}

function estimateRawDft(
  transform: DftTransformNode,
  environment: EvaluationEnvironment,
  timeWindow: DftTimeWindow,
  sampleCount: number,
  algorithm: DftAlgorithm,
): RawDft {
  const sampleInterval = (timeWindow.max - timeWindow.min) / sampleCount;
  const sampled = sampleSignal(transform, environment, timeWindow, sampleCount, sampleInterval);
  if (sampled.issue !== null) {
    return {
      samples: [],
      sampleTimes: [],
      bins: createBins(sampleCount, sampleInterval),
      values: [],
      sampleInterval,
      issue: sampled.issue,
    };
  }

  const bins = createBins(sampleCount, sampleInterval);
  const transformed =
    algorithm === 'fft'
      ? fftDftValues(sampled.samples, bins, timeWindow.min, sampleInterval)
      : directDftValues(sampled.samples, sampled.sampleTimes, bins, sampleInterval);
  if (!transformed.ok) {
    return {
      samples: sampled.samples,
      sampleTimes: sampled.sampleTimes,
      bins,
      values: [],
      sampleInterval,
      issue: transformed.issue.message,
    };
  }

  return {
    samples: sampled.samples,
    sampleTimes: sampled.sampleTimes,
    bins,
    values: transformed.value,
    sampleInterval,
    issue: null,
  };
}

function directDftValues(
  samples: readonly Complex[],
  sampleTimes: readonly number[],
  bins: readonly DftBin[],
  sampleInterval: number,
): Result<readonly Complex[], MathIssue> {
  const values = bins.map(() => cx(0, 0));
  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    const sample = samples[sampleIndex] as Complex;
    const time = sampleTimes[sampleIndex] as number;
    for (let binIndex = 0; binIndex < bins.length; binIndex += 1) {
      const bin = bins[binIndex] as DftBin;
      const phase = cx(
        Math.cos(bin.angularFrequency * time),
        -Math.sin(bin.angularFrequency * time),
      );
      const contribution = cscale(cmul(sample, phase), sampleInterval);
      values[binIndex] = cadd(values[binIndex] as Complex, contribution);
    }
  }
  return ok(values);
}

function fftDftValues(
  samples: readonly Complex[],
  bins: readonly DftBin[],
  timeOrigin: number,
  sampleInterval: number,
): Result<readonly Complex[], MathIssue> {
  const transformed = radix2Fft(samples);
  if (!transformed.ok) return transformed;
  return ok(
    bins.map((bin) => {
      const raw = transformed.value[bin.index] as Complex;
      const originPhase = cx(
        Math.cos(bin.angularFrequency * timeOrigin),
        -Math.sin(bin.angularFrequency * timeOrigin),
      );
      return cscale(cmul(raw, originPhase), sampleInterval);
    }),
  );
}

function sampleSignal(
  transform: DftTransformNode,
  environment: EvaluationEnvironment,
  timeWindow: DftTimeWindow,
  sampleCount: number,
  sampleInterval: number,
): SampledSignal {
  const samples: Complex[] = [];
  const sampleTimes: number[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const time = timeWindow.min + index * sampleInterval;
    const values = new Map(environment.values);
    values.set(transform.sourceVariable, cx(time, 0));
    const source = evaluateScalar(transform.source, {
      values,
      functions: environment.functions,
    });
    if (!source.ok) return { samples: [], sampleTimes: [], issue: source.issue.message };
    if (!isFiniteComplex(source.value)) {
      return {
        samples: [],
        sampleTimes: [],
        issue: 'The source produced a non-finite value during DFT sampling.',
      };
    }
    samples.push(source.value);
    sampleTimes.push(time);
  }
  return { samples, sampleTimes, issue: null };
}

function createBins(sampleCount: number, sampleInterval: number): DftBin[] {
  const bins: DftBin[] = [];
  const totalWindow = sampleCount * sampleInterval;
  for (let index = 0; index < sampleCount; index += 1) {
    const signedIndex = index <= sampleCount / 2 ? index : index - sampleCount;
    bins.push({
      index,
      signedIndex,
      angularFrequency: (2 * Math.PI * signedIndex) / totalWindow,
    });
  }
  return bins;
}

function commonBinDifference(
  primaryBins: readonly DftBin[],
  primaryValues: readonly Complex[],
  refinedBins: readonly DftBin[],
  refinedValues: readonly Complex[],
): number {
  if (primaryBins.length === 0 || refinedBins.length === 0) return Number.POSITIVE_INFINITY;
  const refinedBySignedIndex = new Map(refinedBins.map((bin) => [bin.signedIndex, bin.index]));
  let maximum = 0;
  for (const primaryBin of primaryBins) {
    // The physical frequency is determined by the signed index and the total
    // time window, not by the sample count. Refining N to 2N halves Δt while
    // doubling the number of samples, so the same signed index is the same ω.
    const refinedIndex = refinedBySignedIndex.get(primaryBin.signedIndex);
    const primaryValue = primaryValues[primaryBin.index];
    const refinedValue = refinedIndex === undefined ? undefined : refinedValues[refinedIndex];
    if (primaryValue === undefined || refinedValue === undefined) return Number.POSITIVE_INFINITY;
    maximum = Math.max(
      maximum,
      cabs({ re: primaryValue.re - refinedValue.re, im: primaryValue.im - refinedValue.im }),
    );
  }
  return maximum;
}

function unresolvedEstimate(
  options: DftEstimateOptions,
  diagnostics: readonly string[],
): DftEstimate {
  const sampleInterval =
    Number.isFinite(options.timeWindow.min) && Number.isFinite(options.timeWindow.max)
      ? (options.timeWindow.max - options.timeWindow.min) / options.sampleCount
      : Number.NaN;
  return {
    samples: [],
    sampleTimes: [],
    bins: [],
    values: [],
    timeWindow: { ...options.timeWindow },
    sampleCount: options.sampleCount,
    algorithm: options.algorithm ?? 'direct',
    sampleInterval,
    samplingFrequency: 1 / sampleInterval,
    nyquistAngularFrequency: Math.PI / sampleInterval,
    estimatedError: Number.POSITIVE_INFINITY,
    stability: 'unresolved',
    diagnostics,
  };
}

function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(value) && value >= 2 && (value & (value - 1)) === 0;
}
