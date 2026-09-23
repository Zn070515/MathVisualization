/**
 * Mathematical type inference.
 *
 * Computes the space of an expression, and the signature of a definition, from
 * the canonical AST. This is real inference over the tree, not pattern matching
 * on source text: the space of a compound expression is derived from the spaces
 * of its parts and the meaning of the operation.
 *
 * Two conventions are unavoidable and are therefore explicit rather than
 * hidden:
 *
 * 1. The space of a *variable* comes from the documented naming table in
 *    `conventions.ts`, applied by the caller when it builds the context. Nothing
 *    is inferred from a variable's name here.
 * 2. Real powers with non-integer exponents widen to the complex numbers,
 *    because `(-1)^0.5 = i`. The inference only stays real when the exponent is
 *    provably an integer, or the base is provably non-negative.
 *
 * The conservative choices are deliberate. `log(x)` for real `x` is typed
 * `R -> C` because the principal logarithm of a negative real is imaginary;
 * claiming `R -> R` would be wrong for half the domain. Where the mathematics
 * forces a widening, the type system widens. Callers that need a narrower type
 * must prove non-negativity to get it.
 */
import { type Expr, asIntegerLiteral } from './ast';
import { builtinFunction } from './builtins';
import { builtinConstant } from './conventions';
import { fail, ok, type MathIssue, type Result } from './errors';
import {
  C1,
  R1,
  R2,
  R3,
  type Classification,
  type Signature,
  type Space,
  classifySignature,
  spaceEquals,
  spaceToString,
} from './types';

export interface InferenceContext {
  /** Space of every name that is bound as a value, by a parameter or a definition. */
  readonly variables: ReadonlyMap<string, Space>;
  /** Signatures of user-defined functions. */
  readonly functions: ReadonlyMap<string, Signature>;
}

export function makeInferenceContext(parts?: {
  variables?: Iterable<readonly [string, Space]>;
  functions?: Iterable<readonly [string, Signature]>;
}): InferenceContext {
  return {
    variables: new Map(parts?.variables ?? []),
    functions: new Map(parts?.functions ?? []),
  };
}

const EMPTY_CONTEXT: InferenceContext = makeInferenceContext();

/** Space corresponding to a convention letter: `'R'` -> R, `'C'` -> C. */
export function spaceForConventionLetter(letter: 'R' | 'C'): Space {
  return letter === 'C' ? C1 : R1;
}

function unboundSymbol(name: string, expr: Expr): MathIssue {
  return {
    kind: 'unbound-symbol',
    symbol: name,
    message: `"${name}" is not defined. Give it a value, as in ${name} = 2, or bind it as a function parameter.`,
    span: expr.span,
  };
}

/**
 * Infer the space an expression evaluates in.
 *
 * Fails rather than guessing: an undefined name, a call with the wrong number of
 * arguments, or a call to something that is not a function all produce an issue
 * carrying a mathematical explanation.
 */
export function inferSpace(
  expr: Expr,
  context: InferenceContext = EMPTY_CONTEXT,
): Result<Space, MathIssue> {
  switch (expr.kind) {
    case 'number':
      return ok(R1);

    case 'constant': {
      const constant = builtinConstant(expr.name);
      if (constant === undefined) {
        return fail({
          kind: 'unsupported',
          detail: `Unknown constant "${expr.name}".`,
          message: `"${expr.name}" is not a known constant.`,
          span: expr.span,
        });
      }
      return ok(spaceForConventionLetter(constant.space));
    }

    case 'variable': {
      const bound = context.variables.get(expr.name);
      if (bound === undefined) return fail(unboundSymbol(expr.name, expr));
      return ok(bound);
    }

    case 'contour-integral': {
      // The path has to be a function of one real parameter. A function of a complex
      // variable is not a contour — it is a map of the plane — and saying which is
      // wrong is the whole of what this check is for.
      const path = context.functions.get(expr.path);
      if (path === undefined) {
        return fail({
          kind: 'unknown-function',
          name: expr.path,
          message: `"${expr.path}" is not a function, so it cannot be the path of a contour integral. A path is a function of one real parameter, as in ${expr.path}(t) = ....`,
          span: expr.pathSpan,
        });
      }
      if (path.domain.kind !== 'R' || path.domain.dim !== 1) {
        return fail({
          kind: 'dimension-mismatch',
          message: `A contour is parameterised by one real variable, and "${expr.path}" is a function of ${spaceToString(path.domain)}.`,
          span: expr.pathSpan,
        });
      }

      // The integrand is checked with the integration variable bound to the plane: it
      // is a complex variable whatever it is called, because that is what a contour
      // integral integrates over.
      const integrand = inferSpace(expr.integrand, {
        variables: new Map([...context.variables, [expr.variable, C1]]),
        functions: context.functions,
      });
      if (!integrand.ok) return integrand;

      // A complex number, always. The integral of a real-valued integrand along a path
      // is complex in general, and typing it real because the integrand looked real
      // would be wrong for every contour that is not the real axis.
      return ok(C1);
    }

    case 'fourier-transform':
    case 'dft-transform': {
      const transformName = expr.kind === 'fourier-transform' ? 'Fourier' : 'DFT';
      const source = expr.source;
      if (source.kind !== 'call' || source.args.length !== 1) {
        return fail({
          kind: 'unsupported',
          detail: `${transformName} source is not a unary function call.`,
          message: `A ${transformName} transform needs a one-variable real source function.`,
          span: expr.span,
        });
      }

      const sourceVariable = source.args[0];
      if (sourceVariable?.kind !== 'variable' || sourceVariable.name !== expr.sourceVariable) {
        return fail({
          kind: 'unsupported',
          detail: `${transformName} source variable is not explicitly bound.`,
          message: `A ${transformName} transform needs the source variable explicitly, as in ${transformName}(f(t)).`,
          span: expr.span,
        });
      }

      const signature = context.functions.get(source.callee);
      if (signature === undefined) {
        const builtin = builtinFunction(source.callee);
        if (builtin !== undefined && builtin.arity === 1) {
          const sourceSpace = inferSpace(source, {
            variables: new Map([...context.variables, [expr.sourceVariable, R1]]),
            functions: context.functions,
          });
          if (!sourceSpace.ok) return sourceSpace;
          if (sourceSpace.value.kind === 'R' && sourceSpace.value.dim === 1) return ok(C1);
        }
        return fail({
          kind: 'unknown-function',
          name: source.callee,
          message: `"${source.callee}" is not a known real source function for this ${transformName} transform.`,
          span: source.span,
        });
      }
      if (
        signature.domain.kind !== 'R' ||
        signature.domain.dim !== 1 ||
        signature.codomain.kind !== 'R' ||
        signature.codomain.dim !== 1
      ) {
        return fail({
          kind: 'dimension-mismatch',
          message: `${transformName} currently accepts a real signal f: R → R, but "${source.callee}" has signature ${spaceToString(signature.domain)} → ${spaceToString(signature.codomain)}.`,
          span: source.span,
        });
      }

      return ok(C1);
    }

    case 'unary':
      return inferSpace(expr.operand, context);

    case 'binary': {
      if (expr.op === 'pow') return inferPowerSpace(expr.left, expr.right, context);

      const left = inferSpace(expr.left, context);
      if (!left.ok) return left;
      const right = inferSpace(expr.right, context);
      if (!right.ok) return right;
      return joinSpaces(left.value, right.value, expr);
    }

    case 'call':
      return inferCallSpace(expr, context);

    case 'tuple': {
      const itemSpaces: Space[] = [];
      for (const item of expr.items) {
        const space = inferSpace(item, context);
        if (!space.ok) return space;
        itemSpaces.push(space.value);
      }
      const first = itemSpaces[0];
      if (first === undefined) {
        return fail({
          kind: 'unsupported',
          detail: 'An empty tuple has no space.',
          message: 'An empty list has no mathematical type.',
          span: expr.span,
        });
      }
      for (const space of itemSpaces) {
        if (!spaceEquals(space, first)) {
          return fail({
            kind: 'dimension-mismatch',
            message: `The entries of a list must lie in the same space, but this list mixes ${spaceToString(first)} and ${spaceToString(space)}.`,
            span: expr.span,
          });
        }
      }
      if (first.kind === 'C') {
        return fail({
          kind: 'unsupported',
          detail: 'Lists of complex values are not modelled.',
          message: 'A list of complex values is not supported yet.',
          span: expr.span,
        });
      }
      const dimension = expr.items.length;
      if (dimension === 1) return ok(first);
      if (dimension === 2) return ok(R2);
      if (dimension === 3) return ok(R3);
      return fail({
        kind: 'unsupported',
        detail: `Lists of length ${dimension} are not modelled.`,
        message: `A list of ${dimension} entries is not supported; R² and R³ are.`,
        span: expr.span,
      });
    }
  }
}

function inferPowerSpace(
  baseExpr: Expr,
  exponentExpr: Expr,
  context: InferenceContext,
): Result<Space, MathIssue> {
  const base = inferSpace(baseExpr, context);
  if (!base.ok) return base;
  const exponent = inferSpace(exponentExpr, context);
  if (!exponent.ok) return exponent;

  if (base.value.kind === 'C' || exponent.value.kind === 'C') return ok(C1);
  if (base.value.dim !== 1 || exponent.value.dim !== 1) {
    return fail({
      kind: 'dimension-mismatch',
      message: 'Only scalars can be raised to a power; a list cannot be an exponent or a base.',
      span: baseExpr.span,
    });
  }

  // A provably integer exponent keeps the base's space: (-1)^2 = 1 is real.
  if (asIntegerLiteral(exponentExpr) !== null) return ok(R1);
  // A provably non-negative base keeps it too: 4^0.5 = 2 is real.
  if (provablyNonNegative(baseExpr)) return ok(R1);

  // Otherwise the result may be complex: (-1)^0.5 = i.
  return ok(C1);
}

function inferCallSpace(
  expr: Extract<Expr, { kind: 'call' }>,
  context: InferenceContext,
): Result<Space, MathIssue> {
  const builtin = builtinFunction(expr.callee);
  if (builtin !== undefined) {
    if (expr.args.length !== builtin.arity) {
      return fail({
        kind: 'arity-mismatch',
        name: builtin.name,
        expected: builtin.arity,
        received: expr.args.length,
        message: `${builtin.name} takes ${builtin.arity} argument${builtin.arity === 1 ? '' : 's'}, but was given ${expr.args.length}.`,
        span: expr.span,
      });
    }
    const argumentExpr = expr.args[0];
    if (argumentExpr === undefined) {
      return fail({
        kind: 'arity-mismatch',
        name: builtin.name,
        expected: builtin.arity,
        received: 0,
        message: `${builtin.name} needs an argument.`,
        span: expr.span,
      });
    }
    const argument = inferSpace(argumentExpr, context);
    if (!argument.ok) return argument;

    switch (builtin.spaceRule) {
      case 'preserve':
        return argument;
      case 'to-real':
        return ok(R1);
      case 'log':
        return ok(provablyPositive(argumentExpr) ? R1 : C1);
      case 'sqrt':
        return ok(provablyNonNegative(argumentExpr) ? R1 : C1);
    }
  }

  const signature = context.functions.get(expr.callee);
  if (signature === undefined) {
    return fail({
      kind: 'unknown-function',
      name: expr.callee,
      message: `"${expr.callee}" is not a known function. Supported functions include ${builtinFunctionNamesForMessage()}.`,
      span: expr.span,
    });
  }

  const expectedArity = domainArity(signature.domain);
  if (expr.args.length !== expectedArity) {
    return fail({
      kind: 'arity-mismatch',
      name: expr.callee,
      expected: expectedArity,
      received: expr.args.length,
      message: `${expr.callee} is defined on ${spaceToString(signature.domain)} and takes ${expectedArity} argument${expectedArity === 1 ? '' : 's'}, but was given ${expr.args.length}.`,
      span: expr.span,
    });
  }

  for (const argumentExpr of expr.args) {
    const argument = inferSpace(argumentExpr, context);
    if (!argument.ok) return argument;
    if (!isAssignable(argument.value, signature.domain)) {
      return fail({
        kind: 'dimension-mismatch',
        message: `${expr.callee} expects ${spaceToString(signature.domain)}, but an argument in ${spaceToString(argument.value)} was supplied.`,
        span: argumentExpr.span,
      });
    }
  }

  return ok(signature.codomain);
}

function builtinFunctionNamesForMessage(): string {
  return 'sin, cos, tan, sinh, cosh, tanh, exp, log, sqrt, abs, arg, re, im, conj';
}

/** Number of arguments a domain space corresponds to. */
export function domainArity(domain: Space): number {
  if (domain.kind === 'C') return 1;
  return domain.dim;
}

/**
 * Whether a value in `from` may be passed where `to` is expected.
 *
 * The only widening allowed is R into C, which is the embedding of the real line
 * in the complex plane. Dimensions must otherwise agree exactly, so passing an
 * R² value to a function of one real variable is an error rather than a silent
 * reinterpretation.
 */
export function isAssignable(from: Space, to: Space): boolean {
  if (spaceEquals(from, to)) return true;
  return from.kind === 'R' && from.dim === 1 && to.kind === 'C';
}

/** Combine the spaces of two operands of a ring operation. */
function joinSpaces(left: Space, right: Space, expr: Expr): Result<Space, MathIssue> {
  if (left.kind === 'C' || right.kind === 'C') return ok(C1);
  if (left.dim !== right.dim) {
    return fail({
      kind: 'dimension-mismatch',
      message: `Cannot combine a value in ${spaceToString(left)} with a value in ${spaceToString(right)}.`,
      span: expr.span,
    });
  }
  return ok(left);
}

/**
 * True when the expression is provably non-negative for every input.
 *
 * Recognises non-negative literals, `abs(...)`, and `exp(...)`. Everything else
 * is treated as possibly negative, which is what forces `sqrt(x)` to be typed as
 * complex.
 */
export function provablyNonNegative(expr: Expr): boolean {
  if (expr.kind === 'number') return expr.value.n >= 0n;
  if (expr.kind === 'constant') {
    const constant = builtinConstant(expr.name);
    if (constant !== undefined && constant.space === 'R') return constant.value.re >= 0;
  }
  if (expr.kind === 'call') {
    if (expr.callee === 'abs') return true;
    if (expr.callee === 'exp') return true;
    // sqrt of a non-negative is non-negative.
    const inner = expr.args[0];
    if (expr.callee === 'sqrt' && inner !== undefined && provablyNonNegative(inner)) return true;
  }
  if (expr.kind === 'unary' && expr.op === 'neg') return provablyNonPositive(expr.operand);
  return false;
}

/** True when the expression is provably at most zero for every input. */
function provablyNonPositive(expr: Expr): boolean {
  if (expr.kind === 'number') return expr.value.n <= 0n;
  if (expr.kind === 'unary' && expr.op === 'neg') return provablyNonNegative(expr.operand);
  return false;
}

/**
 * True when the expression is provably strictly positive for every input.
 *
 * Used to keep `log(x)` real when the argument cannot be zero or negative.
 */
export function provablyPositive(expr: Expr): boolean {
  if (expr.kind === 'number') return expr.value.n > 0n;
  if (expr.kind === 'constant') {
    const constant = builtinConstant(expr.name);
    if (constant !== undefined && constant.space === 'R') return constant.value.re > 0;
  }
  if (expr.kind === 'call') {
    if (expr.callee === 'exp') return true;
    if (expr.callee === 'abs') return true;
    const inner = expr.args[0];
    if (expr.callee === 'sqrt' && inner !== undefined && provablyPositive(inner)) return true;
  }
  return false;
}

/**
 * Domain space for a definition's parameter list.
 *
 * One parameter takes its space from the naming convention. Several parameters
 * are combined into R² or R³, since that is what a function of several real
 * variables is. Mixing a complex and a real parameter, or using four real
 * parameters, is reported as unsupported rather than quietly coerced.
 */
export function inferDomain(
  parameters: readonly string[],
  spaceOfParameter: (name: string) => Space,
  at: Expr | undefined,
): Result<Space, MathIssue> {
  const location = at?.span;

  if (parameters.length === 0) {
    return fail({
      kind: 'unsupported',
      detail: 'A definition with no parameters has no domain.',
      message: 'A definition needs at least one parameter, as in f(z) = ...',
      ...(location === undefined ? {} : { span: location }),
    });
  }

  const spaces = parameters.map(spaceOfParameter);

  if (spaces.length === 1) return ok(spaces[0] as Space);

  const anyComplex = spaces.some((space) => space.kind === 'C');
  if (anyComplex) {
    return fail({
      kind: 'unsupported',
      detail: 'Mixed or multi-dimensional complex domains are not modelled.',
      message:
        parameters.length === 1
          ? 'That domain is not supported.'
          : 'Functions of several variables are supported over the real numbers; complex domains are one-dimensional.',
      ...(location === undefined ? {} : { span: location }),
    });
  }

  if (spaces.length === 2) return ok(R2);
  if (spaces.length === 3) return ok(R3);

  return fail({
    kind: 'unsupported',
    detail: `${spaces.length}-parameter domains are not modelled.`,
    message: `Functions of ${spaces.length} variables are not supported yet; up to three are.`,
    ...(location === undefined ? {} : { span: location }),
  });
}

/** Infer the full signature of a definition body. */
export function inferSignature(
  parameters: readonly string[],
  body: Expr,
  context: InferenceContext,
  spaceOfParameter: (name: string) => Space,
): Result<Signature, MathIssue> {
  const domain = inferDomain(parameters, spaceOfParameter, body);
  if (!domain.ok) return domain;

  const innerVariables = new Map(context.variables);
  for (const parameter of parameters) innerVariables.set(parameter, spaceOfParameter(parameter));

  const codomain = inferSpace(body, { variables: innerVariables, functions: context.functions });
  if (!codomain.ok) return codomain;

  return ok({ domain: domain.value, codomain: codomain.value });
}

/** Signature plus its classification, which is what the expression panel shows. */
export interface InferredType {
  readonly signature: Signature;
  readonly classification: Classification;
}

export function classifySignatureWith(signature: Signature): InferredType {
  return { signature, classification: classifySignature(signature) };
}

/** Classify a valid definition body without changing generic signature rules. */
export function classifyDefinitionWith(
  signature: Signature,
  body: Expr,
): InferredType {
  if (body.kind === 'fourier-transform' || body.kind === 'dft-transform') {
    return {
      signature,
      classification: {
        kind: 'transform-pair',
        description:
          body.kind === 'dft-transform'
            ? 'A sampled real signal and its discrete Fourier spectrum'
            : 'A real signal and its numerical Fourier transform',
      },
    };
  }
  return classifySignatureWith(signature);
}
