/**
 * Centralized mathematical conventions.
 *
 * GOAL.md section 25 requires that where a convention is ambiguous, the project
 * picks one, defines it in a single place, documents it and tests it. No module
 * may choose its own. This file is that single place.
 *
 * Every entry here is consumed by the CPU evaluator (`evaluator.ts`), the GPU
 * lowering (`glsl.ts`), the type system and the test suite. Where a convention
 * has a corresponding GLSL implementation, the shader prelude must reproduce it
 * exactly; the `glslImplementation` field records where to look.
 */
import { CX_I, CX_ONE, CX_ZERO, type Complex } from './complex';

/** Inclusive/exclusive bounds of the principal argument, as text for documentation. */
export const PRINCIPAL_ARGUMENT_RANGE = '(-π, π]';

export interface ConventionEntry {
  /** What the convention is called. */
  readonly name: string;
  /** The definition, in mathematical notation. */
  readonly definition: string;
  /** Why this choice was made, and what would break if it changed. */
  readonly note: string;
  /** Where the GPU implementation of the same convention lives, if any. */
  readonly glslImplementation?: string;
}

/**
 * The convention registry. Rendered in the UI's conventions panel and asserted
 * against by the test suite, so that documentation cannot drift from behaviour.
 */
export const CONVENTIONS = {
  principalArgument: {
    name: 'Principal argument',
    definition: `Arg z ∈ ${PRINCIPAL_ARGUMENT_RANGE}, continuous except on the negative real axis`,
    note: 'The negative real axis belongs to the upper edge of the branch cut, so Arg(-1) = π rather than -π. JavaScript atan2 returns -π for a negative zero imaginary part; principalArg remaps that single case so the range is exactly (-π, π].',
    glslImplementation:
      'complexArg() in the shader prelude uses atan(y, x) and must agree on this range.',
  },
  complexLogarithm: {
    name: 'Complex logarithm',
    definition: 'Log z = ln|z| + i·Arg z',
    note: 'Principal branch, branch cut along the negative real axis. Log(-4) = ln 4 + πi. Log(0) is undefined, not -Infinity plus a phase; the evaluator reports it as a singularity.',
    glslImplementation: 'complexLog() in the shader prelude.',
  },
  complexSquareRoot: {
    name: 'Complex square root',
    definition: 'sqrt(z) = exp(Log z / 2), the principal root',
    note: 'sqrt(-4) = 2i, never -2i. Computed with a stable half-angle formula rather than through exp/log so accuracy does not degrade near the negative real axis.',
    glslImplementation: 'complexSqrt() in the shader prelude.',
  },
  complexPower: {
    name: 'Complex power',
    definition: 'z^w = exp(w·Log z) for non-integer w; exact repeated multiplication for integer w',
    note: 'Integer exponents take the exact path so that z^2 equals z*z bit for bit. Because 0 is an integer exponent, 0^0 = 1 by convention. 0^w with Re w > 0 is 0; other non-integer powers of zero are undefined.',
    glslImplementation: 'complexPow() in the shader prelude.',
  },
  fourierTransform: {
    name: 'Fourier transform',
    definition: 'F(ω) = ∫ f(t) e^(-iωt) dt over (-∞, +∞), with ω the angular frequency',
    note: 'Angular frequency, not ordinary frequency; the non-unitary normalisation with 1/(2π) placed on the inverse transform. Recorded here so that the transforms subsystem and any future FFT feature cannot drift apart.',
  },
  discreteFourierTransform: {
    name: 'Discrete Fourier transform',
    definition:
      'D[k] = Δt Σ f(t_n)e^(-iω_k t_n), with t_n = t_min + nΔt and ω_k = 2πk_signed/(NΔt)',
    note: 'Samples use the half-open time window and the actual time coordinate, so a nonzero t_min contributes phase. The frequency axis uses angular frequency; the positive Nyquist bin is the single boundary representative. Direct DFT and radix-2 FFT are two algorithms for these same values; neither is a certified continuous Fourier transform.',
  },
  inverseFourierTransform: {
    name: 'Inverse Fourier transform',
    definition: 'f(t) = (1/2π) ∫ F(ω) e^(iωt) dω over (-∞, +∞)',
    note: 'Paired with the forward convention above. The 1/(2π) factor sits here, not split across both directions.',
  },
  laplaceTransform: {
    name: 'Laplace transform',
    definition: 'F(s) = ∫ f(t) e^(-st) dt over (0-, +∞)',
    note: 'One-sided (unilateral) transform with the lower limit taken as 0⁻. Region of convergence is reported as a half-plane Re(s) > σ₀. Reported separately from the algebraic expression, because the same F(s) can belong to different f(t) under different regions.',
  },
  contourOrientation: {
    name: 'Contour orientation',
    definition: 'Positive orientation is counter-clockwise',
    note: 'The parameter runs over [0, 2π] so that γ(t) = r·e^(it) is traversed exactly once in the positive direction, which is what fixes the sign of ∮ f dz as +2πi times the enclosed residues. A path written the other way round — γ(t) = r·e^(-it) — reverses the sign, and that is the whole of what orientation means here. See `contourIntegral` for the parameter range and the accuracy floor.',
  },
  contourIntegral: {
    name: 'Contour integral',
    definition: '∮_γ f(z) dz = ∫ f(γ(t))·γ′(t) dt over t ∈ [0, 2π]',
    note: 'The rule is the composite trapezoid: spectrally accurate for a closed contour, second order for an open one, so every result reports whether the path actually closed and by how much it missed. γ′ is a Richardson-extrapolated central difference, which puts a floor of about 1e-10 (relative) on the accuracy of any result, and the reported error estimate is never allowed below it. The integral is a quadrature, so a pole the grid steps over is invisible to it — which is why whether a pole is *enclosed* is settled by the winding number and not by this.',
  },
  surfaceNormal: {
    name: 'Surface normal orientation',
    definition: 'Outward normal for closed surfaces',
    note: 'Recorded now so the future flux and divergence-theorem features have a fixed orientation convention. Not yet implemented.',
  },
  booleanReturn: {
    name: 'Undefined values',
    definition:
      'Undefined results are reported as a mathematical issue, never as NaN reaching the UI',
    note: 'The numerical evaluator returns a discriminated result carrying a reason (division by zero, logarithm of zero, unbound symbol, ...). The GPU path cannot do this, so the shader marks undefined pixels explicitly and the CPU path is the reference.',
  },
  numberDisplay: {
    name: 'Writing a number',
    definition:
      'Plain decimals in [1e-4, 1e6); scientific notation as m×10^e outside that window; at most 6 significant digits',
    note: 'One policy for every surface that shows a number: the readout, axis labels, view ranges, legends and sliders. A magnitude is stated rather than spelled out when spelling it out stops helping — 200000000 is written 2×10^8, and 0.0000234 is written 2.34×10^-5. Rounding here is display only and never feeds back into a computation. The thresholds live in NUMBER_DISPLAY.',
  },
  tickPlacement: {
    name: 'Axis tick placement',
    definition: 'Major ticks at 1, 2 or 5 times a power of ten, about ten across an axis',
    note: 'Steps a reader can do arithmetic with. A step of 2×10ⁿ subdivides into four minor intervals rather than five, so the minor ticks land on 0.5×10ⁿ and not on 0.4×10ⁿ. Tick values are computed as index × step rather than by repeated addition, so the tick labelled 0.3 is exactly where 0.3 belongs and not one rounding step away. The numbers live in TICK_STEP.',
  },
} as const satisfies Record<string, ConventionEntry>;

export type ConventionName = keyof typeof CONVENTIONS;

export const CONVENTION_NAMES = Object.keys(CONVENTIONS) as readonly ConventionName[];

/**
 * Space conventionally associated with a variable name.
 *
 * `f(z) = z^2` and `f(x) = x^2` are the same expression text; what makes the
 * first a complex function is the declared variable. This table is the
 * documented convention that resolves it, applied when a definition's parameter
 * list is turned into a domain, and as a fallback for free variables in a bare
 * expression. It is a naming convention, not type guessing: the *codomain* is
 * always computed by real inference over the AST.
 */
export const VARIABLE_SPACE_BY_NAME: Readonly<Record<string, 'R' | 'C'>> = {
  // Complex variables.
  z: 'C',
  w: 'C',
  s: 'C',
  // Real variables.
  x: 'R',
  y: 'R',
  t: 'R',
  u: 'R',
  v: 'R',
  r: 'R',
  a: 'R',
  b: 'R',
  c: 'R',
  d: 'R',
  n: 'R',
  k: 'R',
  m: 'R',
  p: 'R',
  q: 'R',
};

/** Space used for a variable name that the table does not mention. */
export const DEFAULT_VARIABLE_SPACE: 'R' | 'C' = 'R';

export function spaceNameForVariable(name: string): 'R' | 'C' {
  return VARIABLE_SPACE_BY_NAME[name] ?? DEFAULT_VARIABLE_SPACE;
}

/**
 * Builtin constants and their values.
 *
 * `i` is a complex constant, every other builtin is real.
 */
export interface BuiltinConstant {
  readonly name: string;
  readonly space: 'R' | 'C';
  readonly value: Complex;
  readonly description: string;
}

export const BUILTIN_CONSTANTS: readonly BuiltinConstant[] = [
  {
    name: 'pi',
    space: 'R',
    value: { re: Math.PI, im: 0 },
    description: 'Ratio of circumference to diameter',
  },
  { name: 'e', space: 'R', value: { re: Math.E, im: 0 }, description: "Euler's number" },
  { name: 'tau', space: 'R', value: { re: 2 * Math.PI, im: 0 }, description: 'Full turn, 2π' },
  { name: 'i', space: 'C', value: CX_I, description: 'Imaginary unit' },
];

export const BUILTIN_CONSTANT_NAMES: ReadonlySet<string> = new Set(
  BUILTIN_CONSTANTS.map((constant) => constant.name),
);

export function builtinConstant(name: string): BuiltinConstant | undefined {
  return BUILTIN_CONSTANTS.find((constant) => constant.name === name);
}

/** Re-exported so callers do not need a second import for the common constants. */
export const CONSTANT_ZERO = CX_ZERO;
export const CONSTANT_ONE = CX_ONE;

/**
 * Numerical tolerances.
 *
 * Used by the test suite to compare against reference values and by numerical
 * routines to decide convergence. Centralized so that "approximately equal"
 * means the same thing everywhere, and so that the distinction between exact
 * and approximate results stays visible (GOAL.md section 13).
 */
export const NUMERICS = {
  /** Absolute tolerance for values of order 1. */
  absoluteTolerance: 1e-12,
  /** Relative tolerance for large magnitudes. */
  relativeTolerance: 1e-9,
  /** Tolerance for numerically-estimated derivatives and integrals. */
  methodTolerance: 1e-6,
  /** Default number of samples along a curve. */
  defaultCurveSamples: 512,
  /** Default resolution of a sampled scalar field. */
  defaultFieldResolution: 256,
  /** Step used by finite-difference derivative estimates. */
  finiteDifferenceStep: 1e-6,
  /** Points on the grid a contour integral is computed on. */
  contourSamples: 1024,
  /**
   * The derivative's step as a fraction of the parameter interval.
   *
   * Larger than `finiteDifferenceStep` on purpose. An extrapolated central difference
   * has a truncation term of order h⁴ and a roundoff term of order ε/h, and those meet
   * around h ≈ 10⁻⁴ of the interval; a step of 10⁻⁶ would be entirely roundoff.
   */
  contourDerivativeStepFraction: 1e-4,
  /**
   * The relative accuracy floor the derivative imposes, so that no result claims to be
   * more exact than the derivative that produced it.
   */
  contourDerivativeFloor: 1e-10,
  /** How near the ends have to meet, relative to the path's size, for it to be closed. */
  contourClosureTolerance: 1e-9,
} as const;

/**
 * The parameter interval a contour is integrated over.
 *
 * The default interval keeps old path definitions deterministic. A path definition may
 * override it with a first-class declaration such as `gamma(t; [0, 1]) = ...`; the
 * evaluator passes that interval to the quadrature instead of requiring a reparameterised
 * formula.
 */
export const CONTOUR_INTEGRAL = {
  from: 0,
  to: 2 * Math.PI,
} as const;

/** Domain-coloring convention, shared by the CPU reference and the shader. */
export const DOMAIN_COLORING = {
  /** Hue is driven by the argument, mapped from (-π, π] onto [0, 1). */
  hueFromArgument: 'h = (Arg w + π) / 2π',
  /** Brightness is driven by the modulus on a logarithmic scale. */
  brightnessFromModulus: 'log2|w| drives a per-octave band; |w| = 1 sits at the middle of a band',
  /** Number of brightness bands per octave of |w|. */
  bandsPerOctave: 1,
  /** How |w| = 0 (a zero of the function) is drawn. */
  atZero: 'Rendered as black, so zeros read as dark points.',
  /** How |w| = ∞ (a pole) is drawn. */
  atInfinity: 'Rendered as white, so poles read as bright points.',
  /** How a point where the expression is undefined is drawn. */
  atUndefined: 'Rendered as a neutral grey cross-hatch-free flat grey, distinct from black.',
} as const;

/** Hues and lightness anchors referenced by the shader, kept here for the legend. */
export interface DomainColoringOptions {
  /** Draw contour lines where the phase is a multiple of π/2. */
  readonly phaseContours: boolean;
  /** Draw the logarithmic modulus bands. */
  readonly modulusBands: boolean;
}

export const DEFAULT_DOMAIN_COLORING: DomainColoringOptions = {
  phaseContours: true,
  modulusBands: true,
};

/**
 * How a computed number is written for a reader.
 *
 * The single policy for every surface that shows a number. It lives here rather
 * than in the display module for the reason this file exists: three views had
 * each grown their own copy of this policy, and the copies disagreed both on
 * where to switch to exponential form (1000 versus 100) and on how many digits
 * to keep (two versus one). A user could see the same magnitude written two
 * ways in two panes.
 *
 * Inside the decimal window a value is written with its digits, because that is
 * how it is read: `2000`, `0.5`, `-12.34`. Outside it a value is written as
 * `m×10^e`, because `200000000` and `0.0000234` stop being readable long before
 * they stop being writable.
 */
export const NUMBER_DISPLAY = {
  /** Significant digits kept when no explicit decimal count is asked for. */
  significantDigits: 6,
  /** Below this magnitude, a value is written in scientific notation. */
  decimalFrom: 1e-4,
  /** At or above this magnitude, a value is written in scientific notation. */
  decimalUntil: 1e6,
  /**
   * Components smaller than this fraction of the largest one are shown as zero.
   *
   * A display convention, and only that: nothing here changes a computed value.
   * The reason it is needed is that exact mathematics rarely survives double
   * precision intact. `(1 + i)^2` is exactly `2i`, but evaluating it numerically
   * leaves a real part of about 1e-16, and printing `1.11022e-15 + 2i` would
   * present rounding as if it were structure.
   *
   * The threshold is relative rather than absolute, so a value whose components
   * are all genuinely tiny is still printed in full.
   */
  zeroThreshold: 1e-12,
} as const;

/**
 * Where the ticks on an axis go.
 *
 * Recorded as numbers because two implementations read it: the CPU axis drawing
 * and the grid spacing the fragment shader receives as a uniform. They must
 * agree, or the grid lines and the numbered ticks would disagree about where a
 * unit is.
 */
export const TICK_STEP = {
  /** Roughly how many major ticks a full axis should carry. */
  targetMajorTicks: 10,
  /** A target step below this multiple of a power of ten snaps down to 1. */
  snapToTwoBelow: 1.5,
  /** ... and below this one snaps down to 2 rather than 5. */
  snapToFiveBelow: 3.5,
  /** Minor subdivisions of a 1×10ⁿ or 5×10ⁿ step. */
  minorDivisionsForOneOrFive: 5,
  /** Minor subdivisions of a 2×10ⁿ step, whose fifths would land on 0.4×10ⁿ. */
  minorDivisionsForTwo: 4,
  /** A guard on how many ticks a single axis may carry, so a bad step cannot hang a render. */
  maxTicks: 512,
} as const;
