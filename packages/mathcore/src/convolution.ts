/**
 * Finite-window numerical convolution and its periodic sampled companion.
 *
 * This module deliberately does not claim a whole-line convolution or a
 * symbolic result. The direct trapezoid estimator is the reference calculation;
 * the sampled helper exists only to make the repository's DFT product convention
 * explicit and testable.
 */
import type { ConvolutionNode } from './ast';
import { type Complex, cadd, cabs, cmul, cscale, cx, isFiniteComplex } from './complex';
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
  /** The number of integration samples in the primary estimate. */
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
  /** The number of integration samples in the primary estimate. */
  readonly primaryIntegrationSampleCount: number;
  /** The number of integration samples used for the returned refined value. */
  readonly refinedIntegrationSampleCount: number;
  readonly estimatedError: number;
  readonly stability: ConvolutionStability;
  readonly diagnostics: readonly string[];
}

export interface ConvolutionConstructionOptions {
  readonly integrationWindow: ConvolutionWindow;
  readonly integrationSampleCount: number;
  readonly tolerance?: number;
}

export interface ConvolutionConstructionEstimate {
  readonly outputTime: number;
  readonly integrationWindow: ConvolutionWindow;
  readonly tau: readonly number[];
  readonly leftValues: readonly (Complex | null)[];
  readonly shiftedRightValues: readonly (Complex | null)[];
  readonly productValues: readonly (Complex | null)[];
  readonly accumulatedValues: readonly (Complex | null)[];
  readonly segments: readonly {
    readonly startIndex: number;
    readonly endIndex: number;
  }[];
  readonly primaryIntegrationSampleCount: number;
  readonly refinedIntegrationSampleCount: number;
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

interface RawConstruction {
  readonly tau: readonly number[];
  readonly leftValues: readonly (Complex | null)[];
  readonly shiftedRightValues: readonly (Complex | null)[];
  readonly productValues: readonly (Complex | null)[];
  readonly accumulatedValues: readonly (Complex | null)[];
  readonly segments: readonly { readonly startIndex: number; readonly endIndex: number }[];
  readonly finalValue: Complex | null;
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
    primaryIntegrationSampleCount: options.integrationSampleCount,
    refinedIntegrationSampleCount: refinedCount,
    estimatedError,
    stability,
    diagnostics: [...diagnostics, statusDiagnostic],
  };
}

/**
 * Estimate the finite-window construction for one output time. The returned
 * refined samples expose f(τ), g(T-τ), their product, and its accumulated
 * trapezoid integral without claiming a whole-real-line convolution.
 */
export function estimateConvolutionConstruction(
  node: ConvolutionNode,
  environment: EvaluationEnvironment,
  outputTime: number,
  options: ConvolutionConstructionOptions,
): ConvolutionConstructionEstimate {
  const diagnostics = [
    'Finite-window convolution construction using composite trapezoid quadrature.',
    'The integration window is not a certification of the whole real line.',
  ];
  const validation = validateConstructionOptions(outputTime, options);
  if (validation !== null) {
    return unresolvedConstruction(outputTime, options, [...diagnostics, validation]);
  }

  const primary = sampleConstruction(
    node,
    environment,
    outputTime,
    options,
    options.integrationSampleCount,
  );
  const refinedCount = options.integrationSampleCount * 2;
  const refined = sampleConstruction(node, environment, outputTime, options, refinedCount);
  const estimatedError = constructionDifference(primary.finalValue, refined.finalValue);
  const scale = Math.max(1, refined.finalValue === null ? 0 : cabs(refined.finalValue));
  const relativeDifference = estimatedError / scale;
  const tolerance = options.tolerance ?? CONVOLUTION_DEFAULT_TOLERANCE;
  const stability: ConvolutionStability =
    primary.finalValue !== null &&
    refined.finalValue !== null &&
    Number.isFinite(estimatedError) &&
    Number.isFinite(relativeDifference)
      ? relativeDifference <= tolerance
        ? 'stable'
        : 'sampling-sensitive'
      : 'unresolved';
  const statusDiagnostic =
    stability === 'stable'
      ? `Construction refinement stayed within relative difference ${relativeDifference}.`
      : stability === 'sampling-sensitive'
        ? `Construction refinement changed the result by relative difference ${relativeDifference}.`
        : 'Construction refinement could not produce a finite full-window comparison.';
  const unresolvedCount = refined.productValues.filter((value) => value === null).length;

  return {
    outputTime,
    integrationWindow: { ...options.integrationWindow },
    tau: [...refined.tau],
    leftValues: [...refined.leftValues],
    shiftedRightValues: [...refined.shiftedRightValues],
    productValues: [...refined.productValues],
    accumulatedValues: [...refined.accumulatedValues],
    segments: [...refined.segments],
    primaryIntegrationSampleCount: options.integrationSampleCount,
    refinedIntegrationSampleCount: refinedCount,
    estimatedError,
    stability,
    diagnostics: [
      ...diagnostics,
      ...(unresolvedCount === 0
        ? []
        : [`${unresolvedCount} construction samples were unresolved.`]),
      ...(primary.issue === null ? [] : [primary.issue]),
      ...(refined.issue === null ? [] : [refined.issue]),
      statusDiagnostic,
    ],
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
      message:
        'Periodic sampled convolution needs equally sized non-empty samples and a positive sample interval.',
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

/**
 * Transform a periodic sample vector on the exact grid represented by a DFT
 * estimate. This is the reference side of the sampled convolution theorem; it
 * is not an estimate of a continuous whole-line transform.
 */
export function dftOfPeriodicSamples(
  samples: readonly Complex[],
  grid: Pick<DftEstimate, 'bins' | 'sampleInterval' | 'timeWindow'>,
): Result<readonly Complex[], MathIssue> {
  if (
    samples.length === 0 ||
    samples.length !== grid.bins.length ||
    !Number.isFinite(grid.sampleInterval) ||
    grid.sampleInterval <= 0 ||
    !validTimeWindow(grid.timeWindow)
  ) {
    return fail({
      kind: 'invalid-parameter',
      message: 'The sampled DFT needs a non-empty vector and a valid matching time grid.',
    });
  }
  if (samples.some((value) => !isFiniteComplex(value))) {
    return fail({
      kind: 'invalid-parameter',
      message: 'The sampled DFT cannot use an undefined or non-finite sample.',
    });
  }

  const values: Complex[] = [];
  for (const bin of grid.bins) {
    let total = cx(0, 0);
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index] as Complex;
      const time = grid.timeWindow.min + index * grid.sampleInterval;
      const phase = cx(
        Math.cos(-bin.angularFrequency * time),
        Math.sin(-bin.angularFrequency * time),
      );
      total = cadd(total, cmul(sample, phase));
    }
    values.push(cscale(total, grid.sampleInterval));
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
      if (!left.ok)
        return emptyRaw(`The left source is unresolved at τ=${tau}: ${left.issue.message}`);
      const right = evaluateSource(node.right, node.sourceVariable, outputTime - tau, environment);
      if (!right.ok)
        return emptyRaw(
          `The right source is unresolved at t-τ=${outputTime - tau}: ${right.issue.message}`,
        );
      const weight = index === 0 || index === integrationTimes.length - 1 ? 0.5 : 1;
      total = cadd(total, cscale(cmul(left.value, right.value), weight));
    }
    values.push(cscale(total, integrationStep));
  }

  return { sampleTimes, leftValues, rightValues, values, issue: null };
}

function sampleConstruction(
  node: ConvolutionNode,
  environment: EvaluationEnvironment,
  outputTime: number,
  options: ConvolutionConstructionOptions,
  sampleCount: number,
): RawConstruction {
  const tau = grid(options.integrationWindow, sampleCount);
  const step = (options.integrationWindow.max - options.integrationWindow.min) / (sampleCount - 1);
  const leftValues: (Complex | null)[] = [];
  const shiftedRightValues: (Complex | null)[] = [];
  const productValues: (Complex | null)[] = [];
  const accumulatedValues: (Complex | null)[] = [];
  let firstIssue: string | null = null;

  for (const value of tau) {
    const left = evaluateSource(node.left, node.sourceVariable, value, environment);
    const right = evaluateSource(node.right, node.sourceVariable, outputTime - value, environment);
    const leftValue = left.ok ? left.value : null;
    const rightValue = right.ok ? right.value : null;
    if (!left.ok && firstIssue === null) {
      firstIssue = `The left source is unresolved at τ=${value}: ${left.issue.message}`;
    }
    if (!right.ok && firstIssue === null) {
      firstIssue = `The right source is unresolved at t-τ=${outputTime - value}: ${right.issue.message}`;
    }
    leftValues.push(leftValue);
    shiftedRightValues.push(rightValue);
    if (leftValue === null || rightValue === null) {
      productValues.push(null);
      continue;
    }
    const product = cmul(leftValue, rightValue);
    if (!isFiniteComplex(product)) {
      if (firstIssue === null) {
        firstIssue = `The convolution product became non-finite at τ=${value}.`;
      }
      productValues.push(null);
      continue;
    }
    productValues.push(product);
  }

  let accumulationAvailable = true;
  for (let index = 0; index < productValues.length; index += 1) {
    const product = productValues[index];
    if (index === 0) {
      accumulatedValues.push(product === null || product === undefined ? null : cx(0, 0));
      if (product === null || product === undefined) accumulationAvailable = false;
      continue;
    }
    const previousProduct = productValues[index - 1];
    const previousAccumulation = accumulatedValues[index - 1];
    if (
      !accumulationAvailable ||
      product === null ||
      product === undefined ||
      previousProduct === null ||
      previousProduct === undefined ||
      previousAccumulation === null ||
      previousAccumulation === undefined
    ) {
      accumulationAvailable = false;
      accumulatedValues.push(null);
      continue;
    }
    const trapezoid = cadd(previousProduct, product);
    const increment = cscale(trapezoid, step / 2);
    const nextAccumulation = cadd(previousAccumulation, increment);
    if (
      !isFiniteComplex(trapezoid) ||
      !isFiniteComplex(increment) ||
      !isFiniteComplex(nextAccumulation)
    ) {
      if (firstIssue === null) {
        firstIssue = `The accumulated convolution became non-finite at τ=${tau[index]}.`;
      }
      accumulationAvailable = false;
      accumulatedValues.push(null);
      continue;
    }
    accumulatedValues.push(nextAccumulation);
  }

  const segments: { startIndex: number; endIndex: number }[] = [];
  let startIndex: number | null = null;
  for (let index = 0; index < productValues.length; index += 1) {
    if (productValues[index] !== null && productValues[index] !== undefined) {
      if (startIndex === null) startIndex = index;
      continue;
    }
    if (startIndex !== null) {
      segments.push({ startIndex, endIndex: index - 1 });
      startIndex = null;
    }
  }
  if (startIndex !== null) segments.push({ startIndex, endIndex: productValues.length - 1 });

  return {
    tau,
    leftValues,
    shiftedRightValues,
    productValues,
    accumulatedValues,
    segments,
    finalValue: accumulatedValues.at(-1) ?? null,
    issue: firstIssue,
  };
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
  if (
    options.tolerance !== undefined &&
    (!Number.isFinite(options.tolerance) || options.tolerance < 0)
  ) {
    return 'The convolution refinement tolerance must be finite and non-negative.';
  }
  return null;
}

function validateConstructionOptions(
  outputTime: number,
  options: ConvolutionConstructionOptions,
): string | null {
  if (!Number.isFinite(outputTime)) return 'The construction output time must be finite.';
  if (!validWindow(options.integrationWindow)) {
    return 'The construction integration window must be finite and strictly increasing.';
  }
  if (
    !validSampleCount(options.integrationSampleCount) ||
    options.integrationSampleCount * 2 > CONVOLUTION_MAX_SAMPLE_COUNT
  ) {
    return `Construction sample counts must be integers from 2 through ${CONVOLUTION_MAX_SAMPLE_COUNT / 2}, with a finite refinement.`;
  }
  if (
    options.tolerance !== undefined &&
    (!Number.isFinite(options.tolerance) || options.tolerance < 0)
  ) {
    return 'The construction refinement tolerance must be finite and non-negative.';
  }
  return null;
}

function validWindow(window: ConvolutionWindow): boolean {
  return Number.isFinite(window.min) && Number.isFinite(window.max) && window.max > window.min;
}

function validSampleCount(value: number): boolean {
  return Number.isInteger(value) && value >= 2 && value <= CONVOLUTION_MAX_SAMPLE_COUNT / 2;
}

function unresolvedConstruction(
  outputTime: number,
  options: ConvolutionConstructionOptions,
  diagnostics: readonly string[],
): ConvolutionConstructionEstimate {
  return {
    outputTime,
    integrationWindow: { ...options.integrationWindow },
    tau: [],
    leftValues: [],
    shiftedRightValues: [],
    productValues: [],
    accumulatedValues: [],
    segments: [],
    primaryIntegrationSampleCount: options.integrationSampleCount,
    refinedIntegrationSampleCount: options.integrationSampleCount * 2,
    estimatedError: Number.POSITIVE_INFINITY,
    stability: 'unresolved',
    diagnostics,
  };
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

function constructionDifference(primary: Complex | null, refined: Complex | null): number {
  if (primary === null || refined === null) return Number.POSITIVE_INFINITY;
  return cabs({ re: primary.re - refined.re, im: primary.im - refined.im });
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
    primaryIntegrationSampleCount: options.integrationSampleCount,
    refinedIntegrationSampleCount: options.integrationSampleCount * 2,
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

function validTimeWindow(window: { readonly min: number; readonly max: number }): boolean {
  return Number.isFinite(window.min) && Number.isFinite(window.max) && window.max > window.min;
}
