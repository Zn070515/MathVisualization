/**
 * Finite-window numerical Fourier-series partial sums.
 *
 * This module intentionally reports a numerical coefficient estimate rather than
 * pretending to prove convergence or identify Gibbs phenomenon. The source is
 * sampled on one centred period with composite trapezoid quadrature, then the
 * grid is refined once so the application can expose a concrete discretisation
 * diagnostic.
 */
import type { FourierSeriesNode } from './ast';
import { type EvaluationEnvironment, evaluateScalar } from './evaluator';
import { cx, isFiniteComplex } from './complex';

export interface FourierSeriesEstimateOptions {
  readonly order: number;
  readonly integrationSampleCount: number;
  /** Relative refinement tolerance; defaults to `1e-5`. */
  readonly tolerance?: number;
}

export interface FourierSeriesEstimate {
  readonly period: number | null;
  readonly order: number;
  readonly requestedIntegrationSampleCount: number;
  readonly baseIntegrationIntervals: number;
  readonly refinedIntegrationIntervals: number;
  readonly constantCoefficient: number | null;
  readonly cosineCoefficients: readonly number[];
  readonly sineCoefficients: readonly number[];
  readonly coefficientDisagreement: number;
  readonly convergence: 'converged' | 'unresolved';
  readonly diagnostics: readonly string[];
  readonly unresolvedSamples: number;
}

interface Coefficients {
  readonly constant: number;
  readonly cosine: readonly number[];
  readonly sine: readonly number[];
}

interface SampleResult {
  readonly coefficients: Coefficients | null;
  readonly unresolvedSamples: number;
  readonly diagnostic: string | null;
}

const DEFAULT_TOLERANCE = 1e-5;
const MAX_ORDER = 64;

export function estimateFourierSeries(
  transform: FourierSeriesNode,
  environment: EvaluationEnvironment,
  options: FourierSeriesEstimateOptions,
): FourierSeriesEstimate {
  const diagnostics = [
    'One-period numerical Fourier-series estimate; coefficient convergence is sampled, not certified.',
  ];

  const optionIssue = validateOptions(options);
  if (optionIssue !== null) {
    return unresolvedEstimate(options, 0, 0, null, 0, [...diagnostics, optionIssue]);
  }

  const periodResult = evaluateScalar(transform.period, environment);
  if (!periodResult.ok) {
    return unresolvedEstimate(options, 0, 0, null, 0, [
      ...diagnostics,
      `The Fourier-series period could not be evaluated: ${periodResult.issue.message}`,
    ]);
  }
  const periodValue = periodResult.value;
  if (!isFiniteComplex(periodValue) || periodValue.im !== 0 || periodValue.re <= 0) {
    return unresolvedEstimate(options, 0, 0, null, 0, [
      ...diagnostics,
      'The Fourier-series period must be a finite positive real number.',
    ]);
  }

  const period = periodValue.re;
  const baseIntervals = Math.max(options.integrationSampleCount, 4 * options.order);
  const refinedIntervals = baseIntervals * 2;
  const base = sampleCoefficients(
    transform,
    environment,
    period,
    baseIntervals,
    options.order,
    'base',
  );
  if (base.coefficients === null) {
    return unresolvedEstimate(
      options,
      baseIntervals,
      refinedIntervals,
      period,
      base.unresolvedSamples,
      [...diagnostics, base.diagnostic ?? 'The base Fourier-series grid did not resolve.'],
    );
  }

  const refined = sampleCoefficients(
    transform,
    environment,
    period,
    refinedIntervals,
    options.order,
    'refined',
  );
  if (refined.coefficients === null) {
    return unresolvedEstimate(
      options,
      baseIntervals,
      refinedIntervals,
      period,
      refined.unresolvedSamples,
      [...diagnostics, refined.diagnostic ?? 'The refined Fourier-series grid did not resolve.'],
    );
  }

  const coefficientDisagreement = maximumCoefficientDifference(
    base.coefficients,
    refined.coefficients,
  );
  const largestCoefficient = Math.max(
    1,
    Math.abs(refined.coefficients.constant),
    ...refined.coefficients.cosine.map(Math.abs),
    ...refined.coefficients.sine.map(Math.abs),
  );
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const threshold = tolerance * largestCoefficient;
  const converged =
    Number.isFinite(coefficientDisagreement) && coefficientDisagreement <= threshold;

  return {
    period,
    order: options.order,
    requestedIntegrationSampleCount: options.integrationSampleCount,
    baseIntegrationIntervals: baseIntervals,
    refinedIntegrationIntervals: refinedIntervals,
    constantCoefficient: refined.coefficients.constant,
    cosineCoefficients: refined.coefficients.cosine,
    sineCoefficients: refined.coefficients.sine,
    coefficientDisagreement,
    convergence: converged ? 'converged' : 'unresolved',
    diagnostics: converged
      ? diagnostics
      : [...diagnostics, `Grid refinement changed coefficients by ${coefficientDisagreement}.`],
    unresolvedSamples: 0,
  };
}

/** Evaluate the displayed finite partial sum, when the coefficient estimate completed. */
export function evaluateFourierSeriesAt(
  estimate: FourierSeriesEstimate,
  time: number,
): number | null {
  if (
    estimate.period === null ||
    estimate.constantCoefficient === null ||
    !Number.isFinite(time) ||
    estimate.cosineCoefficients.length !== estimate.order ||
    estimate.sineCoefficients.length !== estimate.order
  ) {
    return null;
  }

  const angularFrequency = (2 * Math.PI) / estimate.period;
  let value = estimate.constantCoefficient / 2;
  for (let harmonic = 1; harmonic <= estimate.order; harmonic += 1) {
    const cosine = estimate.cosineCoefficients[harmonic - 1] as number;
    const sine = estimate.sineCoefficients[harmonic - 1] as number;
    const phase = harmonic * angularFrequency * time;
    value += cosine * Math.cos(phase) + sine * Math.sin(phase);
  }
  return Number.isFinite(value) ? value : null;
}

function validateOptions(options: FourierSeriesEstimateOptions): string | null {
  if (!Number.isInteger(options.order) || options.order < 1 || options.order > MAX_ORDER) {
    return `The Fourier-series order must be an integer from 1 to ${MAX_ORDER}.`;
  }
  if (!Number.isInteger(options.integrationSampleCount) || options.integrationSampleCount < 2) {
    return 'The Fourier-series quadrature needs at least two intervals.';
  }
  if (
    options.tolerance !== undefined &&
    (!Number.isFinite(options.tolerance) || options.tolerance < 0)
  ) {
    return 'The Fourier-series refinement tolerance must be a finite non-negative number.';
  }
  return null;
}

function unresolvedEstimate(
  options: FourierSeriesEstimateOptions,
  baseIntervals: number,
  refinedIntervals: number,
  period: number | null,
  unresolvedSamples: number,
  diagnostics: readonly string[],
): FourierSeriesEstimate {
  return {
    period,
    order: options.order,
    requestedIntegrationSampleCount: options.integrationSampleCount,
    baseIntegrationIntervals: baseIntervals,
    refinedIntegrationIntervals: refinedIntervals,
    constantCoefficient: null,
    cosineCoefficients: [],
    sineCoefficients: [],
    coefficientDisagreement: Number.POSITIVE_INFINITY,
    convergence: 'unresolved',
    diagnostics,
    unresolvedSamples,
  };
}

function sampleCoefficients(
  transform: FourierSeriesNode,
  environment: EvaluationEnvironment,
  period: number,
  intervals: number,
  order: number,
  gridLabel: 'base' | 'refined',
): SampleResult {
  const cosine = Array.from({ length: order }, () => 0);
  const sine = Array.from({ length: order }, () => 0);
  let constant = 0;
  const step = period / intervals;
  const angularFrequency = (2 * Math.PI) / period;

  for (let index = 0; index <= intervals; index += 1) {
    const sourceCoordinate = -period / 2 + index * step;
    const values = new Map(environment.values);
    values.set(transform.sourceVariable, cx(sourceCoordinate, 0));
    const source = evaluateScalar(transform.source, {
      values,
      functions: environment.functions,
    });
    if (!source.ok) {
      return {
        coefficients: null,
        unresolvedSamples: 1,
        diagnostic: `Fourier-series sampling stopped on the ${gridLabel} ${intervals}-interval grid: ${source.issue.message}`,
      };
    }
    if (!isFiniteComplex(source.value) || source.value.im !== 0) {
      return {
        coefficients: null,
        unresolvedSamples: 1,
        diagnostic: `Fourier-series sampling stopped on the ${gridLabel} ${intervals}-interval grid because the source was not finite real-valued.`,
      };
    }

    const weight = index === 0 || index === intervals ? 0.5 * step : step;
    const value = source.value.re;
    constant += value * weight;
    for (let harmonic = 1; harmonic <= order; harmonic += 1) {
      const phase = harmonic * angularFrequency * sourceCoordinate;
      const cosineIndex = harmonic - 1;
      cosine[cosineIndex] = (cosine[cosineIndex] as number) + value * Math.cos(phase) * weight;
      sine[cosineIndex] = (sine[cosineIndex] as number) + value * Math.sin(phase) * weight;
    }
  }

  const scale = 2 / period;
  return {
    coefficients: {
      constant: scale * constant,
      cosine: cosine.map((value) => scale * value),
      sine: sine.map((value) => scale * value),
    },
    unresolvedSamples: 0,
    diagnostic: null,
  };
}

function maximumCoefficientDifference(left: Coefficients, right: Coefficients): number {
  let maximum = Math.abs(left.constant - right.constant);
  for (let index = 0; index < left.cosine.length; index += 1) {
    maximum = Math.max(
      maximum,
      Math.abs((left.cosine[index] as number) - (right.cosine[index] as number)),
    );
    maximum = Math.max(
      maximum,
      Math.abs((left.sine[index] as number) - (right.sine[index] as number)),
    );
  }
  return maximum;
}
