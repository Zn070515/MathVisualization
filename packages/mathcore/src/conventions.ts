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
    glslImplementation: 'complexArg() in the shader prelude uses atan(y, x) and must agree on this range.',
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
    note: 'Recorded now so the future contour-integration feature has a fixed sign convention from the start. Not yet implemented.',
  },
  surfaceNormal: {
    name: 'Surface normal orientation',
    definition: 'Outward normal for closed surfaces',
    note: 'Recorded now so the future flux and divergence-theorem features have a fixed orientation convention. Not yet implemented.',
  },
  booleanReturn: {
    name: 'Undefined values',
    definition: 'Undefined results are reported as a mathematical issue, never as NaN reaching the UI',
    note: 'The numerical evaluator returns a discriminated result carrying a reason (division by zero, logarithm of zero, unbound symbol, ...). The GPU path cannot do this, so the shader marks undefined pixels explicitly and the CPU path is the reference.',
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
  { name: 'pi', space: 'R', value: { re: Math.PI, im: 0 }, description: 'Ratio of circumference to diameter' },
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
} as const;

/** Domain-coloring convention, shared by the CPU reference and the shader. */
export const DOMAIN_COLORING = {
  /** Hue is driven by the argument, mapped from (-π, π] onto [0, 1). */
  hueFromArgument: 'h = (Arg w + π) / 2π',
  /** Brightness is driven by the modulus on a logarithmic scale. */
  brightnessFromModulus:
    'log2|w| drives a per-octave band; |w| = 1 sits at the middle of a band',
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
