/**
 * Finite-window numerical convolution and its periodic sampled companion.
 *
 * This module deliberately does not claim a whole-line convolution or a
 * symbolic result. The direct trapezoid estimator is the reference calculation;
 * the sampled helper exists only to make the repository's DFT product convention
 * explicit and testable.
 */
import type { ConvolutionNode } from './ast';
import {
  type Complex,
  cadd,
  cabs,
  cmul,
  cscale,
  cx,
  isFiniteComplex,
} from './complex';
import { NUMERICS } from './conventions';
import type { DftEstimate } from './dft';
import { fail, ok, type MathIssue, type Result } from './errors';
import { evaluateScalar, type EvaluationEnvironment } from './evaluator';

export interface ConvolutionWindow {
  readonly min: number;
  readonly max: number;
}

export type ConvolutionStability = 'stable' | 'sampling-sensitive' | 'unresolved';

export interface ConvolutionEstimateOptions {
  readonly integrationWindow: ConvolutionWindow;
  readonly outputWindow: ConvolutionWindow;
  readonly outputSampleCount: number;
  readonly integrationSampleCount: number;
  readonly tolerance?: number;
}

export interface ConvolutionEstimate {
  readonly sampleTimes: readonly number[];
  readonly leftValues: readonly Complex[];
  readonly rightValues: readonly Complex[];
  readonly values: readonly Complex[];
  readonly integrationWindow: ConvolutionWindow;
  readonly outputWindow: ConvolutionWindow;
  readonly outputSampleCount: number;
  readonly integrationSampleCount: number;
  readonly estimatedError: number;
  readonly stability: ConvolutionStability;
  readonly diagnostics: readonly string[];
}

export const CONVOLUTION_DEFAULT_TOLERANCE = NUMERICS.methodTolerance;
export const CONVOLUTION_MAX_SAMPLE_COUNT = 2048;

interface RawEstimate {
  readonly sampleTimes: readonly number[];
  readonly leftValues: readonly Complex[];
  readonly rightValues: readonly Complex[];
  readonly values: readonly Complex[];
  readonly issue: string | null;
}

/** Estimate a finite-window convolution and classify integration refinement. */
export function estimateConvolution(
  node: ConvolutionNode,
  environment: EvaluationEnvironment,
  options: ConvolutionEstimateOptions,
): ConvolutionEstimate {
  const diagnostics = [
    'Finite-window numerical convolution using composite trapezoid quadrature.',
    'The integration window is not a certification of the whole real line.',
  ];
  const validation = validateOptions(options);
  if (validation !== null) return unresolvedEstimate(options, [...diagnostics, validation]);

  const primary = estimateRaw(node, environment, options, options.integrationSampleCount);
  if (primary.issue !== null) return unresolvedEstimate(options, [...diagnostics, primary.issue]);

  const refinedCount = options.integrationSampleCount * 2;
  const refined = estimateRaw(node, environment, options, refinedCount);
  if (refined.issue !== null) return unresolvedEstimate(options, [...diagnostics, refined.issue]);

  const estimatedError = maximumDifference(primary.values, refined.values);
  const scale = Math.max(1, ...refined.values.map(cabs));
  const relativeDifference = estimatedError / scale;
  const tolerance = options.tolerance ?? CONVOLUTION_DEFAULT_TOLERANCE;
  const stability: ConvolutionStability =
    Number.isFinite(estimatedError) && Number.isFinite(relativeDifference)
      ? relativeDifference <= tolerance
        ? 'stable'
        : 'sampling-sensitive'
      : 'unresolved';

  const statusDiagnostic =
    stability === 'stable'
      ? `Integration refinement stayed within relative difference ${relativeDifference}.`
      : stability === 'sampling-sensitive'
        ? `Integration refinement changed the result by relative difference ${relativeDifference}.`
        : 'Integration refinement could not produce a finite comparison.';

  return {
    sampleTimes: [...refined.sampleTimes],
    leftValues: [...refined.leftValues],
    rightValues: [...refined.rightValues],
    values: [...refined.values],
    integrationWindow: { ...options.integrationWindow },
    outputWindow: { ...options.outputWindow },
    outputSampleCount: options.outputSampleCount,
    integrationSampleCount: options.integrationSampleCount,
    estimatedError,
    stability,
    diagnostics: [...diagnostics, statusDiagnostic],
  };
}

/** Compute the periodic sampled convolution using the repository's Δt scaling. */
export function periodicSampledConvolution(
  left: readonly Complex[],
  right: readonly Complex[],
  sampleInterval: number,
): Result<readonly Complex[], MathIssue> {
  if (
    left.length === 0 ||
    left.length !== right.length ||
    !Number.isFinite(sampleInterval) ||
    sampleInterval <= 0
  ) {
    return fail({
      kind: 'invalid-parameter',
      message: 'Periodic sampled convolution needs equally sized non-empty samples and a positive sample interval.',
    });
  }
  if ([...left, ...right].some((value) => !isFiniteComplex(value))) {
    return fail({
      kind: 'invalid-parameter',
      message: 'Periodic sampled convolution cannot use an undefined or non-finite sample.',
    });
  }

  const values: Complex[] = [];
  for (let output = 0; output < left.length; output += 1) {
    let total = cx(0, 0);
    for (let input = 0; input < left.length; input += 1) {
      const wrapped = (output - input + left.length) % left.length;
      total = cadd(total, cmul(left[input] as Complex, right[wrapped] as Complex));
    }
    values.push(cscale(total, sampleInterval));
  }
  return ok(values);
}

/** Build the DFT product with the phase required by a nonzero sample origin. */
export function phaseCorrectedDftProduct(
  left: DftEstimate,
  right: DftEstimate,
): Result<readonly Complex[], MathIssue> {
  if (
    left.bins.length === 0 ||
    left.bins.length !== right.bins.length ||
    left.values.length !== left.bins.length ||
    right.values.length !== right.bins.length ||
    !sameNumber(left.sampleInterval, right.sampleInterval) ||
    !sameNumber(left.timeWindow.min, right.timeWindow.min) ||
    !sameNumber(left.timeWindow.max, right.timeWindow.max)
  ) {
    return fail({
      kind: 'invalid-parameter',
      message: 'The DFT product check needs estimates on the same sampled time grid.',
    });
  }

  const values: Complex[] = [];
  for (let index = 0; index < left.bins.length; index += 1) {
    const bin = left.bins[index];
    const leftValue = left.values[index];
    const rightValue = right.values[index];
    if (bin === undefined || leftValue === undefined || rightValue === undefined) {
      return fail({
        kind: 'invalid-parameter',
        message: 'The DFT product check encountered a missing frequency bin.',
      });
    }
    const originPhase = cx(
      Math.cos(bin.angularFrequency * left.timeWindow.min),
      Math.sin(bin.angularFrequency * left.timeWindow.min),
    );
    const value = cmul(originPhase, cmul(leftValue, rightValue));
    if (!isFiniteComplex(value)) {
      return fail({
        kind: 'invalid-parameter',
        message: 'The DFT product check produced a non-finite frequency value.',
      });
    }
    values.push(value);
  }
  return ok(values);
}

function estimateRaw(
  node: ConvolutionNode,
  environment: EvaluationEnvironment,
  options: ConvolutionEstimateOptions,
  integrationSampleCount: number,
): RawEstimate {
  const sampleTimes = grid(options.outputWindow, options.outputSampleCount);
  const integrationTimes = grid(options.integrationWindow, integrationSampleCount);
  const integrationStep =
    (options.integrationWindow.max - options.integrationWindow.min) / (integrationSampleCount - 1);
  const leftValues: Complex[] = [];
  const rightValues: Complex[] = [];
  const values: Complex[] = [];

  for (const outputTime of sampleTimes) {
    const leftAtOutput = evaluateSource(node.left, node.sourceVariable, outputTime, environment);
    if (!leftAtOutput.ok) return emptyRaw(leftAtOutput.issue.message);
    const rightAtOutput = evaluateSource(node.right, node.sourceVariable, outputTime, environment);
    if (!rightAtOutput.ok) return emptyRaw(rightAtOutput.issue.message);
    leftValues.push(leftAtOutput.value);
    rightValues.push(rightAtOutput.value);

    let total = cx(0, 0);
    for (let index = 0; index < integrationTimes.length; index += 1) {
      const tau = integrationTimes[index] as number;
      const left = evaluateSource(node.left, node.sourceVariable, tau, environment);
      if (!left.ok) return emptyRaw(`The left source is unresolved at τ=${tau}: ${left.issue.message}`);
      const right = evaluateSource(
        node.right,
        node.sourceVariable,
        outputTime - tau,
        environment,
      );
      if (!right.ok) return emptyRaw(`The right source is unresolved at t-τ=${outputTime - tau}: ${right.issue.message}`);
      const weight = index === 0 || index === integrationTimes.length - 1 ? 0.5 : 1;
      total = cadd(total, cscale(cmul(left.value, right.value), weight));
    }
    values.push(cscale(total, integrationStep));
  }

  return { sampleTimes, leftValues, rightValues, values, issue: null };
}

function evaluateSource(
  source: ConvolutionNode['left'],
  variable: string,
  value: number,
  environment: EvaluationEnvironment,
): Result<Complex, MathIssue> {
  const values = new Map(environment.values);
  values.set(variable, cx(value, 0));
  const evaluated = evaluateScalar(source, { values, functions: environment.functions });
  if (!evaluated.ok) return evaluated;
  if (!isFiniteComplex(evaluated.value)) {
    return fail({
      kind: 'singularity',
      message: 'The source has no finite value at this sample.',
      span: source.span,
    });
  }
  return evaluated;
}

function validateOptions(options: ConvolutionEstimateOptions): string | null {
  if (!validWindow(options.integrationWindow) || !validWindow(options.outputWindow)) {
    return 'Convolution windows must be finite and strictly increasing.';
  }
  if (
    !validSampleCount(options.outputSampleCount) ||
    !validSampleCount(options.integrationSampleCount) ||
    options.integrationSampleCount * 2 > CONVOLUTION_MAX_SAMPLE_COUNT
  ) {
    return `Convolution sample counts must be integers from 2 through ${CONVOLUTION_MAX_SAMPLE_COUNT / 2}, with a finite refinement.`;
  }
  if (options.tolerance !== undefined && (!Number.isFinite(options.tolerance) || options.tolerance < 0)) {
    return 'The convolution refinement tolerance must be finite and non-negative.';
  }
  return null;
}

function validWindow(window: ConvolutionWindow): boolean {
  return Number.isFinite(window.min) && Number.isFinite(window.max) && window.max > window.min;
}

function validSampleCount(value: number): boolean {
  return Number.isInteger(value) && value >= 2 && value <= CONVOLUTION_MAX_SAMPLE_COUNT / 2;
}

function grid(window: ConvolutionWindow, count: number): number[] {
  const step = (window.max - window.min) / (count - 1);
  return Array.from({ length: count }, (_, index) => window.min + index * step);
}

function maximumDifference(primary: readonly Complex[], refined: readonly Complex[]): number {
  if (primary.length !== refined.length || primary.length === 0) return Number.POSITIVE_INFINITY;
  let maximum = 0;
  for (let index = 0; index < primary.length; index += 1) {
    const first = primary[index] as Complex;
    const second = refined[index] as Complex;
    maximum = Math.max(maximum, cabs({ re: first.re - second.re, im: first.im - second.im }));
  }
  return maximum;
}

function unresolvedEstimate(
  options: ConvolutionEstimateOptions,
  diagnostics: readonly string[],
): ConvolutionEstimate {
  return {
    sampleTimes: [],
    leftValues: [],
    rightValues: [],
    values: [],
    integrationWindow: { ...options.integrationWindow },
    outputWindow: { ...options.outputWindow },
    outputSampleCount: options.outputSampleCount,
    integrationSampleCount: options.integrationSampleCount,
    estimatedError: Number.POSITIVE_INFINITY,
    stability: 'unresolved',
    diagnostics,
  };
}

function emptyRaw(issue: string): RawEstimate {
  return { sampleTimes: [], leftValues: [], rightValues: [], values: [], issue };
}

function sameNumber(left: number, right: number): boolean {
  return Object.is(left, right) || Math.abs(left - right) <= NUMERICS.absoluteTolerance;
}
