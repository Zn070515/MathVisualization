/**
 * Deterministic numerical estimates of the continuous forward Fourier transform.
 *
 * This module deliberately does not promise an exact transform over the whole real
 * line. It samples the source on a finite window and reports the refinement error and
 * the unmeasured-tail limitation alongside the values. The application can therefore
 * draw a useful spectrum without turning a numerical experiment into a theorem.
 */
import type { FourierTransformNode } from './ast';
import {
  type Complex,
  cabs,
  cadd,
  cmul,
  cscale,
  cx,
  isFiniteComplex,
} from './complex';
import { type EvaluationEnvironment, evaluateScalar } from './evaluator';
import { type MathIssue } from './errors';

export interface FourierTimeWindow {
  readonly min: number;
  readonly max: number;
}

export interface FourierEstimate {
  readonly values: readonly Complex[];
  readonly frequencies: readonly number[];
  readonly timeWindow: FourierTimeWindow;
  /** Number of intervals used for the returned refined estimate. */
  readonly timeSamples: number;
  /** Discretisation difference between the base and refined grids. */
  readonly estimatedError: number;
  readonly convergence: 'converged' | 'unresolved';
  readonly diagnostics: readonly string[];
}

export interface FourierEstimateOptions {
  readonly frequencies: readonly number[];
  readonly timeWindow: FourierTimeWindow;
  readonly timeSamples: number;
  /** Absolute refinement threshold. Defaults to a scale-aware tolerance. */
  readonly tolerance?: number;
}

interface SampledTransform {
  readonly values: Complex[];
  readonly issue: MathIssue | null;
}

const DEFAULT_TOLERANCE = 1e-5;

/**
 * Estimate `∫ f(t)e^(-iωt)dt` by composite trapezoid quadrature and one grid
 * refinement. The source expression is evaluated for every sample through the
 * ordinary evaluator; no source-specific closed form is used.
 */
export function estimateFourierTransform(
  transform: FourierTransformNode,
  environment: EvaluationEnvironment,
  options: FourierEstimateOptions,
): FourierEstimate {
  const diagnostics = ['Finite-window numerical estimate; tail convergence is not certified.'];
  const validation = validateOptions(options);
  if (validation !== null) {
    return unresolvedEstimate(options, [...diagnostics, validation]);
  }

  const base = sampleTransform(transform, environment, options, options.timeSamples);
  if (base.issue !== null) {
    return unresolvedEstimate(options, [...diagnostics, base.issue.message]);
  }

  const refinedSamples = options.timeSamples * 2;
  const refined = sampleTransform(transform, environment, options, refinedSamples);
  if (refined.issue !== null) {
    return unresolvedEstimate(options, [...diagnostics, refined.issue.message]);
  }

  const estimatedError = maxDifference(base.values, refined.values);
  const scale = Math.max(1, ...refined.values.map(cabs));
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE * scale;
  const converged = Number.isFinite(estimatedError) && estimatedError <= tolerance;

  return {
    values: refined.values,
    frequencies: [...options.frequencies],
    timeWindow: { ...options.timeWindow },
    timeSamples: refinedSamples,
    estimatedError,
    convergence: converged ? 'converged' : 'unresolved',
    diagnostics: converged
      ? diagnostics
      : [...diagnostics, `Grid refinement changed the estimate by ${estimatedError}.`],
  };
}

function validateOptions(options: FourierEstimateOptions): string | null {
  if (!Number.isInteger(options.timeSamples) || options.timeSamples < 2) {
    return 'The Fourier time grid needs at least two intervals.';
  }
  if (
    !Number.isFinite(options.timeWindow.min) ||
    !Number.isFinite(options.timeWindow.max) ||
    options.timeWindow.max <= options.timeWindow.min
  ) {
    return 'The Fourier time window must have a finite increasing range.';
  }
  if (options.frequencies.some((frequency) => !Number.isFinite(frequency))) {
    return 'The Fourier frequency grid contains a non-finite value.';
  }
  return null;
}

function unresolvedEstimate(
  options: FourierEstimateOptions,
  diagnostics: readonly string[],
): FourierEstimate {
  return {
    values: [],
    frequencies: [...options.frequencies],
    timeWindow: { ...options.timeWindow },
    timeSamples: options.timeSamples,
    estimatedError: Number.POSITIVE_INFINITY,
    convergence: 'unresolved',
    diagnostics,
  };
}

function sampleTransform(
  transform: FourierTransformNode,
  environment: EvaluationEnvironment,
  options: FourierEstimateOptions,
  intervals: number,
): SampledTransform {
  const dt = (options.timeWindow.max - options.timeWindow.min) / intervals;
  const accumulators = options.frequencies.map(() => ({ re: 0, im: 0 }));

  for (let index = 0; index <= intervals; index += 1) {
    const t = options.timeWindow.min + index * dt;
    const values = new Map(environment.values);
    values.set(transform.sourceVariable, cx(t, 0));
    const source = evaluateScalar(transform.source, {
      values,
      functions: environment.functions,
    });
    if (!source.ok) return { values: [], issue: source.issue };
    if (!isFiniteComplex(source.value)) {
      return {
        values: [],
        issue: {
          kind: 'domain-error',
          message: 'The source produced a non-finite value during Fourier sampling.',
          span: transform.source.span,
        },
      };
    }

    const weight = index === 0 || index === intervals ? 0.5 * dt : dt;
    for (let frequencyIndex = 0; frequencyIndex < options.frequencies.length; frequencyIndex += 1) {
      const frequency = options.frequencies[frequencyIndex] as number;
      const phase = cx(Math.cos(frequency * t), -Math.sin(frequency * t));
      const contribution = cscale(cmul(source.value, phase), weight);
      const current = accumulators[frequencyIndex] as Complex;
      accumulators[frequencyIndex] = cadd(current, contribution);
    }
  }

  return { values: accumulators, issue: null };
}

function maxDifference(left: readonly Complex[], right: readonly Complex[]): number {
  if (left.length !== right.length) return Number.POSITIVE_INFINITY;
  let maximum = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] as Complex;
    const b = right[index] as Complex;
    maximum = Math.max(maximum, cabs({ re: a.re - b.re, im: a.im - b.im }));
  }
  return maximum;
}
