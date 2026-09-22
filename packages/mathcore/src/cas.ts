/**
 * The symbolic adapter contract.
 *
 * SymPy is a backend mathematical capability, not the product and not the UI
 * (GOAL.md 12 and 8). This module defines the boundary in one place: the shape of
 * a request, the shape of an answer, and what happens when no engine is running.
 *
 * Two rules the contract enforces:
 *
 * - Symbolic results are marked exact. A result that came from the engine is
 *   exact by construction; this is the flag the UI uses to distinguish it from a
 *   numerical approximation (GOAL.md 13).
 * - Absence of the engine is a normal, reportable state, not an error. The
 *   application is fully usable without it, so `unavailable` is a first-class
 *   outcome and not a failure.
 *
 * Only operations that are actually implemented are listed. Extending the list is
 * how a new symbolic capability is added; there are no placeholder operations.
 */
import type { MathIssue } from './errors';

export type SymbolicOperation = 'simplify' | 'differentiate';

export interface SymbolicRequest {
  readonly operation: SymbolicOperation;
  /** Expression in SymPy syntax, produced by `lowerToSympy`. */
  readonly expression: string;
  /** Symbols the expression may mention, in SymPy syntax. */
  readonly symbols: readonly string[];
  /** Declarations to send alongside the expression. */
  readonly preamble: string;
  /** For `differentiate`: the variable to differentiate with respect to. */
  readonly withRespectTo?: string;
}

/** A symbolic result. Exact by construction, never an approximation. */
export interface SymbolicSuccess {
  readonly exact: true;
  /** The result in SymPy syntax. */
  readonly text: string;
  /** LaTeX form when the engine supplied one, else null. */
  readonly latex: string | null;
  /** Assumptions the engine had to make, surfaced rather than hidden. */
  readonly assumptions: readonly string[];
}

/** No engine is reachable. */
export interface SymbolicUnavailable {
  readonly status: 'unavailable';
  readonly reason: string;
}

/** The engine ran and produced a result. */
export interface SymbolicComputed {
  readonly status: 'computed';
  readonly result: SymbolicSuccess;
}

/** The engine ran and could not answer. */
export interface SymbolicFailed {
  readonly status: 'failed';
  readonly message: string;
  /** The underlying issue, for callers that want to inspect the kind. */
  readonly issue: MathIssue;
}

export type SymbolicOutcome = SymbolicUnavailable | SymbolicComputed | SymbolicFailed;

export interface CasAdapter {
  /** Human-readable name of the backend, shown in the UI. */
  readonly name: string;
  /** Whether the backend is reachable right now. */
  isAvailable(): Promise<boolean>;
  /** Run one symbolic operation. */
  run(request: SymbolicRequest): Promise<SymbolicOutcome>;
}

/**
 * The adapter used when no engine is configured.
 *
 * Reporting unavailability explicitly, rather than throwing, is what keeps the
 * application honest: every symbolic affordance can ask and get a truthful
 * answer, so nothing has to pretend a result exists.
 */
export function createUnavailableAdapter(reason: string): CasAdapter {
  return {
    name: 'unavailable',
    isAvailable: () => Promise.resolve(false),
    run: () => Promise.resolve<SymbolicOutcome>({ status: 'unavailable', reason }),
  };
}
