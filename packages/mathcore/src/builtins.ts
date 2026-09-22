/**
 * The builtin function registry.
 *
 * This is the single list of functions the language knows. It is consumed by:
 *
 * - the parser, to decide whether `f(x)` is a call or a product of `f` and `x`;
 * - type inference, through the space rule of each function;
 * - the numerical evaluator, which maps each name to a complex implementation;
 * - the GLSL lowering, which maps each name to a shader-prelude call.
 *
 * Keeping one list means a function cannot exist in the evaluator but be
 * invisible to the parser, or be offered by the UI but missing from the GPU
 * path. `gpu: false` marks a function that is numerically available but has no
 * shader implementation yet; the lowering reports that as `unsupported` rather
 * than silently dropping it.
 */
import type { Space } from './types';

/**
 * How a function's output space relates to its argument space.
 *
 * - `preserve`: the argument's space is the result's space (sin, exp, ...).
 *   Real in, real out; complex in, complex out.
 * - `to-real`: the result is always real (abs, arg, re, im).
 * - `log`: real arguments widen to complex, because Log of a negative real is
 *   imaginary. Complex arguments stay complex.
 * - `sqrt`: real arguments widen to complex unless provably non-negative;
 *   complex arguments stay complex.
 */
export type SpaceRule = 'preserve' | 'to-real' | 'log' | 'sqrt';

export interface BuiltinFunction {
  readonly name: string;
  readonly arity: number;
  readonly spaceRule: SpaceRule;
  /** One-line description shown in the expression panel's help. */
  readonly summary: string;
  /** Whether the GLSL lowering can emit this function. */
  readonly gpu: boolean;
}

export const BUILTIN_FUNCTIONS: readonly BuiltinFunction[] = [
  { name: 'sin', arity: 1, spaceRule: 'preserve', summary: 'Sine', gpu: true },
  { name: 'cos', arity: 1, spaceRule: 'preserve', summary: 'Cosine', gpu: true },
  { name: 'tan', arity: 1, spaceRule: 'preserve', summary: 'Tangent', gpu: true },
  { name: 'sinh', arity: 1, spaceRule: 'preserve', summary: 'Hyperbolic sine', gpu: true },
  { name: 'cosh', arity: 1, spaceRule: 'preserve', summary: 'Hyperbolic cosine', gpu: true },
  { name: 'tanh', arity: 1, spaceRule: 'preserve', summary: 'Hyperbolic tangent', gpu: true },
  { name: 'exp', arity: 1, spaceRule: 'preserve', summary: 'Exponential, e^z', gpu: true },
  {
    name: 'log',
    arity: 1,
    spaceRule: 'log',
    summary: 'Principal logarithm, ln|z| + i·Arg z',
    gpu: true,
  },
  { name: 'sqrt', arity: 1, spaceRule: 'sqrt', summary: 'Principal square root', gpu: true },
  { name: 'abs', arity: 1, spaceRule: 'to-real', summary: 'Modulus |z|', gpu: true },
  { name: 'arg', arity: 1, spaceRule: 'to-real', summary: 'Principal argument, in (-π, π]', gpu: true },
  { name: 're', arity: 1, spaceRule: 'to-real', summary: 'Real part', gpu: true },
  { name: 'im', arity: 1, spaceRule: 'to-real', summary: 'Imaginary part', gpu: true },
  { name: 'conj', arity: 1, spaceRule: 'preserve', summary: 'Complex conjugate', gpu: true },
];

export const BUILTIN_FUNCTION_NAMES: ReadonlySet<string> = new Set(
  BUILTIN_FUNCTIONS.map((fn) => fn.name),
);

export function builtinFunction(name: string): BuiltinFunction | undefined {
  return BUILTIN_FUNCTIONS.find((fn) => fn.name === name);
}

/**
 * Alternative spellings accepted in source and canonicalised by the lexer.
 *
 * `ln` is the spelling most students write; it means the principal logarithm,
 * which is `log` here. `π`, `τ` and `θ` let Greek symbols be typed directly.
 * Canonicalising at the lexical stage means no later stage needs to know about
 * aliases.
 */
export const NAME_ALIASES: Readonly<Record<string, string>> = {
  ln: 'log',
  'π': 'pi',
  'τ': 'tau',
  'θ': 'theta',
  'σ': 'sigma',
  'ω': 'omega',
  'ϕ': 'phi',
  'φ': 'phi',
};

export function canonicalName(name: string): string {
  return NAME_ALIASES[name] ?? name;
}

/** Space rule lookup used by type inference. */
export function spaceRuleFor(name: string): SpaceRule | undefined {
  return builtinFunction(name)?.spaceRule;
}

/** Arity of every builtin, exposed so inference can check calls uniformly. */
export const BUILTIN_ARITY: ReadonlyMap<string, number> = new Map(
  BUILTIN_FUNCTIONS.map((fn) => [fn.name, fn.arity]),
);

/** Names that type inference treats as always producing a real result. */
export const BUILTINS_RETURNING_REAL: ReadonlySet<string> = new Set(
  BUILTIN_FUNCTIONS.filter((fn) => fn.spaceRule === 'to-real').map((fn) => fn.name),
);

/** Convenience for the UI: the space a builtin's result occupies. */
export function resultSpaceFor(rule: SpaceRule, argument: Space): Space {
  switch (rule) {
    case 'preserve':
      return argument;
    case 'to-real':
      return { kind: 'R', dim: 1 };
    case 'log':
      return argument.kind === 'C' ? argument : { kind: 'C', dim: 1 };
    case 'sqrt':
      return argument.kind === 'C' ? argument : { kind: 'C', dim: 1 };
  }
}
