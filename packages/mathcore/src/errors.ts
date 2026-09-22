/**
 * Error vocabulary.
 *
 * GOAL.md section 14 requires mathematical errors to be presented as
 * mathematical information rather than generic software failures. That starts
 * here: every failure carries a machine-readable kind *and* a sentence phrased
 * in mathematical terms, so the UI can display it directly without inventing
 * wording of its own.
 *
 * This module has no dependencies, so it can be imported from anywhere in the
 * core without creating a cycle.
 */

/** Half-open character range in the original source text. */
export interface SourceSpan {
  readonly start: number;
  readonly end: number;
}

export function span(start: number, end: number): SourceSpan {
  return { start, end };
}

/** Union of two spans, used when combining sub-expressions. */
export function spanJoin(a: SourceSpan, b: SourceSpan): SourceSpan {
  return { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) };
}

/** A failure to read the source text as mathematics. */
export interface ParseError {
  readonly kind: 'parse-error';
  readonly message: string;
  readonly span: SourceSpan;
  /**
   * True when the source is not wrong but *unfinished* — an empty fraction, a
   * closing brace that has not been typed yet, a function awaiting its argument.
   *
   * The distinction matters while someone is typing. An unfinished expression is a
   * normal state and should be shown as nothing at all; a wrong one deserves a
   * sentence. Without this flag the interface would flag an error on every
   * keystroke that opens a structure.
   */
  readonly incomplete?: boolean;
}

/** Reason a symbol could not be resolved during evaluation or inference. */
export type MathIssueKind =
  | 'unbound-symbol'
  | 'unknown-function'
  | 'arity-mismatch'
  | 'not-a-function'
  | 'division-by-zero'
  | 'logarithm-of-zero'
  | 'singularity'
  | 'domain-error'
  | 'dimension-mismatch'
  | 'unsupported'
  | 'invalid-parameter';

interface IssueBase {
  /** A sentence phrased in mathematical terms, ready to show to the user. */
  readonly message: string;
  /** Where in the source text the problem is, when it is attributable to a span. */
  readonly span?: SourceSpan;
  /**
   * Optional machine-readable context. The `kind` discriminator is what callers
   * should branch on; this carries the extra detail that is only sometimes
   * interesting, such as the text of a vanishing divisor.
   */
  readonly detail?: string;
}

export type MathIssue =
  | (IssueBase & { readonly kind: 'unbound-symbol'; readonly symbol: string })
  | (IssueBase & { readonly kind: 'unknown-function'; readonly name: string })
  | (IssueBase & {
      readonly kind: 'arity-mismatch';
      readonly name: string;
      readonly expected: number;
      readonly received: number;
    })
  | (IssueBase & { readonly kind: 'not-a-function'; readonly name: string })
  | (IssueBase & { readonly kind: 'division-by-zero'; readonly divisor: string })
  | (IssueBase & { readonly kind: 'logarithm-of-zero'; readonly argument: string })
  | (IssueBase & { readonly kind: 'singularity' })
  | (IssueBase & { readonly kind: 'domain-error' })
  | (IssueBase & { readonly kind: 'dimension-mismatch' })
  | (IssueBase & { readonly kind: 'unsupported' })
  | (IssueBase & { readonly kind: 'invalid-parameter' });

/** Result of an operation that can fail with a mathematical reason. */
export type Result<T, E = MathIssue> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issue: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function fail<E>(issue: E): Result<never, E> {
  return { ok: false, issue };
}

/**
 * A failure whose kind is fixed but whose message is being built up as it
 * propagates outward, so the user sees the outermost reason rather than the
 * innermost one.
 */
export function issueWithSpan<T extends MathIssue>(issue: T, at: SourceSpan): T {
  return issue.span === undefined ? ({ ...issue, span: at } as T) : issue;
}
