/**
 * The mathematical type system.
 *
 * The project must not guess mathematical types from strings (GOAL.md 4.2). The
 * ground truth is a *signature*: a domain space and a codomain space. Everything
 * else — whether an object is a scalar field, a complex function, a
 * parametric curve — is derived from that signature plus documented
 * conventions, and is therefore explainable rather than guessed.
 *
 * Spaces are deliberately coarse. Only the distinctions that change what
 * mathematics is available are modelled: real versus complex, and how many real
 * dimensions. This is enough to classify every object the three subsystems need,
 * without building a general-purpose type lattice.
 */

export type RealSpaceDimension = 1 | 2 | 3;

export type Space =
  | { readonly kind: 'R'; readonly dim: RealSpaceDimension }
  | { readonly kind: 'C'; readonly dim: 1 };

export const R1: Space = { kind: 'R', dim: 1 };
export const R2: Space = { kind: 'R', dim: 2 };
export const R3: Space = { kind: 'R', dim: 3 };
export const C1: Space = { kind: 'C', dim: 1 };

export function spaceEquals(a: Space, b: Space): boolean {
  return a.kind === b.kind && a.dim === b.dim;
}

/** Human-readable space label: `R`, `R²`, `R³`, `C`. */
export function spaceToString(space: Space): string {
  if (space.kind === 'C') return 'C';
  if (space.dim === 2) return 'R²';
  if (space.dim === 3) return 'R³';
  return 'R';
}

/** Signature of a mathematical function. */
export interface Signature {
  readonly domain: Space;
  readonly codomain: Space;
}

export function signatureToString(signature: Signature): string {
  return `${spaceToString(signature.domain)} → ${spaceToString(signature.codomain)}`;
}

/**
 * The kind of mathematical object a signature denotes.
 *
 * These names follow the vocabulary of GOAL.md. Where a single signature is
 * genuinely ambiguous — `R -> C` is a complex path in the complex-analysis
 * subsystem and a complex-valued signal in the transforms subsystem — the
 * signature is the ground truth and the kind is a documented reading of it.
 * Subsystems refine the kind through their capability registries; they never
 * disagree about the signature.
 */
export type MathObjectKind =
  | 'scalar'
  | 'real-function'
  | 'complex-function'
  | 'scalar-field'
  | 'vector-field'
  | 'complex-path'
  | 'parametric-curve'
  | 'parametric-surface'
  | 'transform-pair'
  | 'convolution-pair'
  | 'unknown';

export interface Classification {
  readonly kind: MathObjectKind;
  /** Dimension of the space the object lives in, when that is meaningful. */
  readonly dimension?: RealSpaceDimension;
  /** Short human-readable description of the object. */
  readonly description: string;
}

/** Classify a function signature into a mathematical object kind. */
export function classifySignature(signature: Signature): Classification {
  const { domain, codomain } = signature;

  if (domain.kind === 'C') {
    if (codomain.kind === 'C') {
      return {
        kind: 'complex-function',
        description: 'Complex function of one complex variable',
      };
    }
    return { kind: 'unknown', description: 'Complex-domain function with real output' };
  }

  // Real domain from here on.
  if (domain.dim === 1 && codomain.kind === 'C') {
    return {
      kind: 'complex-path',
      description: 'Complex-valued function of a real parameter',
    };
  }

  if (codomain.kind === 'C') {
    return { kind: 'unknown', description: 'Real-domain function with complex output' };
  }

  if (codomain.dim === 1) {
    if (domain.dim === 1) {
      return { kind: 'real-function', dimension: 1, description: 'Real function of one variable' };
    }
    return {
      kind: 'scalar-field',
      dimension: domain.dim,
      description: `Scalar field on ${spaceToString(domain)}`,
    };
  }

  // Codomain has dimension > 1.
  if (domain.dim === 1) {
    return {
      kind: 'parametric-curve',
      dimension: codomain.dim,
      description: `Parametric curve in ${spaceToString(codomain)}`,
    };
  }

  if (domain.dim === 2 && codomain.dim === 3) {
    return { kind: 'parametric-surface', description: 'Parametric surface in R³' };
  }

  if (domain.dim === codomain.dim) {
    return {
      kind: 'vector-field',
      dimension: domain.dim,
      description: `Vector field on ${spaceToString(domain)}`,
    };
  }

  return { kind: 'unknown', description: 'Unclassified function signature' };
}

/** True for objects that are values rather than functions. */
export function isScalarKind(kind: MathObjectKind): boolean {
  return kind === 'scalar';
}
