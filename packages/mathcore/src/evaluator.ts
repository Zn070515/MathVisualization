/**
 * The numerical evaluator.
 *
 * Walks the canonical AST and produces either a value or a mathematical reason
 * why there is no value. Every operation here is double precision, complex from
 * the start, because that is what numerical evaluation means (GOAL.md 6.3).
 * Exactness lives in the symbolic layer; this layer is honest about being an
 * approximation, and about the points where there is nothing to approximate.
 *
 * Why a `Result` rather than NaN
 * ------------------------------
 * `1/(z^2 - 1)` at `z = 1` is not "NaN"; it is undefined, and the reason is that
 * the denominator vanishes. Returning a reason lets the readout say so, and lets
 * the contour and integral features later distinguish a pole from a removable
 * hole. NaN is still used *inside* `complex.ts`, but it never escapes this
 * module: the conditions that produce it are checked first.
 *
 * Realness is preserved exactly. For real input, `csin`, `cexp`, `clog` and
 * friends return an imaginary part of exactly zero, so a real function does not
 * drift into looking complex. Where the *type* says complex but the *value* is
 * real (for example `log(2)`), the value carries the truth and the readout shows
 * a real number.
 */
import type { Expr, PathInterval } from './ast';
import { builtinFunction } from './builtins';
import {
  CX_I,
  CX_ZERO,
  type Complex,
  cabs,
  cadd,
  cconj,
  ccos,
  ccosh,
  cdiv,
  cexp,
  cim,
  clog,
  cmul,
  cneg,
  cpow,
  cre,
  csin,
  csinh,
  cscale,
  csqrt,
  csub,
  ctan,
  ctanh,
  cx,
  isFiniteComplex,
  isUndefined,
  isZero,
  principalArg,
} from './complex';
import { CONTOUR_INTEGRAL, builtinConstant } from './conventions';
import {
  contourIntegral,
  residueAt,
  windingAround,
  type ResidueEstimate,
  type ContourIntegralResult,
} from './contour';
import { fail, ok, type MathIssue, type Result } from './errors';
import { exprToText } from './format';
import { rationalToNumber } from './rational';
import { analyzeZerosAndPoles, type SingularitySearchResult } from './zerosAndPoles';

/** A function the user defined, in the form the evaluator needs. */
export interface UserFunctionDefinition {
  readonly name: string;
  readonly parameters: readonly string[];
  readonly interval?: Pick<PathInterval, 'from' | 'to'>;
  readonly body: Expr;
}

/**
 * Everything an expression can refer to.
 *
 * `values` holds parameters and function arguments. User functions are kept
 * separately because they are applied, not substituted.
 */
export interface EvaluationEnvironment {
  readonly values: ReadonlyMap<string, Complex>;
  readonly functions: ReadonlyMap<string, UserFunctionDefinition>;
}

export function makeEnvironment(parts?: {
  values?: Iterable<readonly [string, Complex]>;
  functions?: Iterable<readonly [string, UserFunctionDefinition]>;
}): EvaluationEnvironment {
  return {
    values: new Map(parts?.values ?? []),
    functions: new Map(parts?.functions ?? []),
  };
}

export const EMPTY_ENVIRONMENT: EvaluationEnvironment = makeEnvironment();

/** A scalar, or a list of values standing for a point in R² or R³. */
export type Value =
  | { readonly kind: 'scalar'; readonly value: Complex }
  | { readonly kind: 'tuple'; readonly items: readonly Value[] };

export function scalarValue(value: Complex): Value {
  return { kind: 'scalar', value };
}

/** Extract the complex value of a scalar result, or `null` if it is a list. */
export function asComplex(value: Value): Complex | null {
  return value.kind === 'scalar' ? value.value : null;
}

/** Extract the components of a list result, or `null` if it is a scalar. */
export function asComponents(value: Value): readonly Complex[] | null {
  if (value.kind !== 'tuple') return null;
  const components: Complex[] = [];
  for (const item of value.items) {
    if (item.kind !== 'scalar') return null;
    components.push(item.value);
  }
  return components;
}

/** Guards against a definition that refers to itself without a base case. */
const MAXIMUM_DEPTH = 256;

/**
 * How deeply contour integrals may nest inside one another.
 *
 * Separate from `MAXIMUM_DEPTH` because the two guards stop different things, and the
 * depth guard does not stop this one. `g(z) = ∮_γ g(w) dw` is not a stack overflow:
 * each level costs about two thousand evaluations, so the *time* runs away long before
 * the call stack does, and a guard counting call frames would never fire.
 */
const MAXIMUM_CONTOUR_DEPTH = 4;

/**
 * Evaluate an expression.
 *
 * The optional `depth` is threaded through recursive calls so that a circular
 * definition is reported rather than overflowing the stack. `contourDepth` is the
 * same idea for a different resource — see {@link MAXIMUM_CONTOUR_DEPTH}.
 */
export function evaluate(
  expr: Expr,
  environment: EvaluationEnvironment = EMPTY_ENVIRONMENT,
  depth = 0,
  contourDepth = 0,
): Result<Value, MathIssue> {
  if (depth > MAXIMUM_DEPTH) {
    return fail({
      kind: 'unsupported',
      detail: `Evaluation nested more than ${MAXIMUM_DEPTH} levels deep.`,
      message: `Evaluation went more than ${MAXIMUM_DEPTH} levels deep, which usually means a definition refers to itself.`,
      span: expr.span,
    });
  }

  switch (expr.kind) {
    case 'number':
      return ok(scalarValue(cx(rationalToNumber(expr.value), 0)));

    case 'contour-integral':
      return evaluateContour(expr, environment, depth, contourDepth);

    case 'constant': {
      const constant = builtinConstant(expr.name);
      if (constant === undefined) {
        return fail({
          kind: 'unsupported',
          detail: `Unknown constant ${expr.name}`,
          message: `"${expr.name}" is not a known constant.`,
          span: expr.span,
        });
      }
      return ok(scalarValue(constant.value));
    }

    case 'variable': {
      const bound = environment.values.get(expr.name);
      if (bound === undefined) {
        return fail({
          kind: 'unbound-symbol',
          symbol: expr.name,
          message: `"${expr.name}" has no value at this point.`,
          span: expr.span,
        });
      }
      return ok(scalarValue(bound));
    }

    case 'unary': {
      const operand = evaluate(expr.operand, environment, depth + 1);
      if (!operand.ok) return operand;
      if (expr.op === 'pos') return operand;
      return ok(mapValue(operand.value, cneg));
    }

    case 'binary':
      return evaluateBinary(expr, environment, depth);

    case 'call':
      return evaluateCall(expr, environment, depth);

    case 'tuple': {
      const items: Value[] = [];
      for (const item of expr.items) {
        const result = evaluate(item, environment, depth + 1);
        if (!result.ok) return result;
        items.push(result.value);
      }
      return ok({ kind: 'tuple', items });
    }
  }
}

function mapValue(value: Value, transform: (input: Complex) => Complex): Value {
  if (value.kind === 'scalar') return scalarValue(transform(value.value));
  return { kind: 'tuple', items: value.items.map((item) => mapValue(item, transform)) };
}

function evaluateBinary(
  expr: Extract<Expr, { kind: 'binary' }>,
  environment: EvaluationEnvironment,
  depth: number,
): Result<Value, MathIssue> {
  const left = evaluate(expr.left, environment, depth + 1);
  if (!left.ok) return left;
  const right = evaluate(expr.right, environment, depth + 1);
  if (!right.ok) return right;

  const leftText = exprToText(expr.left);
  const rightText = exprToText(expr.right);

  switch (expr.op) {
    case 'add':
    case 'sub': {
      const combined = combineComponentwise(
        left.value,
        right.value,
        expr.op === 'add' ? cadd : csub,
        expr,
      );
      return combined;
    }

    case 'mul':
      return multiplyValues(left.value, right.value, expr, leftText, rightText);

    case 'div':
      return divideValues(left.value, right.value, expr, rightText);

    case 'pow': {
      const base = asComplex(left.value);
      const exponent = asComplex(right.value);
      if (base === null || exponent === null) {
        return fail({
          kind: 'unsupported',
          detail: 'Power of a list value',
          message: 'A list cannot be raised to a power.',
          span: expr.span,
        });
      }

      // 0^(negative) is a pole. Report it as a singularity rather than as NaN,
      // and report it before calling in so the message can name the operation.
      if (isZero(base) && exponent.im === 0 && exponent.re < 0) {
        return fail({
          kind: 'singularity',
          detail: 'Zero raised to a negative power',
          message: `0^(${rightText}) is a pole: zero to a negative power is not defined.`,
          span: expr.span,
        });
      }

      const result = cpow(base, exponent);
      if (isUndefined(result)) {
        return fail({
          kind: 'domain-error',
          detail: 'Complex power undefined',
          message: `(${leftText})^(${rightText}) is not defined at this point.`,
          span: expr.span,
        });
      }
      return ok(scalarValue(result));
    }
  }
}

function combineComponentwise(
  left: Value,
  right: Value,
  combine: (a: Complex, b: Complex) => Complex,
  expr: Expr,
): Result<Value, MathIssue> {
  if (left.kind === 'scalar' && right.kind === 'scalar') {
    return ok(scalarValue(combine(left.value, right.value)));
  }
  if (left.kind === 'tuple' && right.kind === 'tuple') {
    if (left.items.length !== right.items.length) {
      return fail({
        kind: 'dimension-mismatch',
        message: `Cannot combine a list of ${left.items.length} entries with a list of ${right.items.length}.`,
        span: expr.span,
      });
    }
    const items: Value[] = [];
    for (let index = 0; index < left.items.length; index += 1) {
      const a = left.items[index] as Value;
      const b = right.items[index] as Value;
      const item = combineComponentwise(a, b, combine, expr);
      if (!item.ok) return item;
      items.push(item.value);
    }
    return ok({ kind: 'tuple', items });
  }
  return fail({
    kind: 'dimension-mismatch',
    message: 'A single value and a list cannot be added or subtracted.',
    span: expr.span,
  });
}

function multiplyValues(
  left: Value,
  right: Value,
  expr: Expr,
  _leftText: string,
  _rightText: string,
): Result<Value, MathIssue> {
  if (left.kind === 'scalar' && right.kind === 'scalar') {
    return ok(scalarValue(cmul(left.value, right.value)));
  }
  if (left.kind === 'scalar' && right.kind === 'tuple') {
    return ok({
      kind: 'tuple',
      items: right.items.map((item) => mapValue(item, (z) => cmul(left.value, z))),
    });
  }
  if (left.kind === 'tuple' && right.kind === 'scalar') {
    return ok({
      kind: 'tuple',
      items: left.items.map((item) => mapValue(item, (z) => cmul(z, right.value))),
    });
  }
  // Two lists multiplied together is ambiguous: it could be a dot product, a
  // cross product, or an outer product. Choosing one silently would be wrong.
  return fail({
    kind: 'unsupported',
    detail: 'Product of two list values',
    message:
      'Multiplying two lists is ambiguous, because a dot product and a cross product are both written this way. Use an explicit operation.',
    span: expr.span,
  });
}

function divideValues(
  left: Value,
  right: Value,
  expr: Expr,
  divisorText: string,
): Result<Value, MathIssue> {
  if (right.kind === 'scalar' && isZero(right.value)) {
    return fail({
      kind: 'division-by-zero',
      divisor: divisorText,
      message: `${divisorText} is zero here, so the expression is not defined at this point.`,
      span: expr.span,
    });
  }

  if (left.kind === 'scalar' && right.kind === 'scalar') {
    return ok(scalarValue(cdiv(left.value, right.value)));
  }
  if (left.kind === 'tuple' && right.kind === 'scalar') {
    const divisor = right.value;
    return ok({
      kind: 'tuple',
      items: left.items.map((item) => mapValue(item, (z) => cdiv(z, divisor))),
    });
  }
  return fail({
    kind: 'unsupported',
    detail: 'Division by a list value',
    message: 'A list cannot be used as a divisor.',
    span: expr.span,
  });
}

/**
 * A contour integral, computed by `contour.ts`.
 *
 * The two callbacks are the whole of the connection: `contourIntegral` knows about
 * quadrature and nothing about this tree, and this function knows about the tree and
 * nothing about quadrature. That is the same arrangement `zerosAndPoles.ts` has, and it
 * is why the integral composes — a contour integral is a scalar like any other, so
 * `∮_γ f(z) dz + 1` is an ordinary expression.
 *
 * The cost is real and worth stating: a path and an integrand evaluated on a grid of
 * a few thousand points, twice over for the error estimate.
 */
function evaluateContour(
  expr: Extract<Expr, { kind: 'contour-integral' }>,
  environment: EvaluationEnvironment,
  depth: number,
  contourDepth: number,
): Result<Value, MathIssue> {
  const integrated = integrateContour(expr, environment, depth, contourDepth);
  if (!integrated.ok) return integrated;
  return ok(scalarValue(integrated.value.value));
}

/** A pole of the integrand that the contour winds around, and what it contributes. */
export interface EnclosedPole {
  readonly z: Complex;
  /** How many times the contour winds around it — an integer, from the argument principle. */
  readonly winding: number;
  /** Its residue estimate, or null when no circle isolates it well enough to say. */
  readonly residue: ResidueEstimate | null;
}

/** A contour integral and everything that qualifies it. */
export interface ContourDetails {
  readonly integral: ContourIntegralResult;
  /** The poles of the integrand inside the contour, in the order they were found. */
  readonly enclosed: readonly EnclosedPole[];
  /** `2πi Σ n(γ, zₖ) Res(f, zₖ)` — the residue theorem's other side. */
  readonly residueSum: Complex;
  /** The singularity search status that qualifies the enclosed-pole list. */
  readonly singularities: SingularitySearchResult;
  /** Sum of the independent residue uncertainty contributions. */
  readonly residueEstimatedError: number;
}

/**
 * Everything a contour integral reports, not only its number.
 *
 * `evaluate` returns the value, which is what arithmetic needs: `∮ f dz + 1` has no
 * business knowing whether the contour closed. A line whose *whole content* is a contour
 * integral is different — whether the path came back to where it started, how much the
 * grid moved the answer, and what the residue theorem says it should have been, are all
 * part of what the number claims, and they belong beside it rather than in a footnote.
 *
 * **The two sides are computed by different methods, which is the point of showing them
 * at all.** The integral is a quadrature along the reader's own contour; the sum is
 * circle quadrature at each pole, over poles the winding number — an integer, from the
 * argument principle applied to the contour's samples — decided were inside. Comparing
 * two quadratures of the same function would be checking an answer against itself.
 *
 * Returns null when the expression is not a contour integral, because then there is no
 * single integral to describe and the caller has nothing to add to the value.
 */
export function evaluateContourDetails(
  expr: Expr,
  environment: EvaluationEnvironment = EMPTY_ENVIRONMENT,
): Result<ContourDetails, MathIssue> | null {
  if (expr.kind !== 'contour-integral') return null;

  const callbacks = contourCallbacks(expr, environment, 0, 0);
  if (!callbacks.ok) return callbacks;

  const integral = contourIntegral({
    path: callbacks.value.atParameter,
    integrand: callbacks.value.atPoint,
    from: callbacks.value.from,
    to: callbacks.value.to,
  });
  if (!integral.ok) return integral;

  const poleAnalysis = enclosedPoles(integral.value, callbacks.value.atPoint);
  const enclosed = poleAnalysis.poles;
  let residueSum: Complex = CX_ZERO;
  let residueEstimatedError = 0;
  for (const pole of enclosed) {
    if (pole.residue === null) continue;
    residueSum = cadd(residueSum, cscale(pole.residue.value, pole.winding));
    residueEstimatedError += Math.abs(pole.winding) * pole.residue.estimatedError;
  }

  return ok({
    integral: integral.value,
    enclosed,
    // 2πi times the sum.
    residueSum: cscale(cmul(residueSum, CX_I), 2 * Math.PI),
    singularities: poleAnalysis.search,
    residueEstimatedError: residueEstimatedError * 2 * Math.PI,
  });
}

/**
 * The poles inside a contour, with their residues.
 *
 * The region searched is the contour's own bounding box, generously padded: a pole
 * outside the contour cannot be enclosed, and one just outside it is worth finding so
 * that a reader can see it was considered and left out rather than missed.
 */
function enclosedPoles(
  integral: ContourIntegralResult,
  atPoint: (z: Complex) => Result<Complex, MathIssue>,
): { readonly poles: readonly EnclosedPole[]; readonly search: SingularitySearchResult } {
  if (integral.path.length === 0) {
    return { poles: [], search: { points: [], complete: false, unresolved: [], truncated: false } };
  }

  let xMin = Number.POSITIVE_INFINITY;
  let xMax = Number.NEGATIVE_INFINITY;
  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  for (const point of integral.path) {
    if (!isFiniteComplex(point)) continue;
    xMin = Math.min(xMin, point.re);
    xMax = Math.max(xMax, point.re);
    yMin = Math.min(yMin, point.im);
    yMax = Math.max(yMax, point.im);
  }
  if (!Number.isFinite(xMin) || xMax <= xMin || yMax <= yMin) {
    return { poles: [], search: { points: [], complete: false, unresolved: [], truncated: false } };
  }

  const pad = 0.25 * Math.max(xMax - xMin, yMax - yMin);
  const search = analyzeZerosAndPoles(atPoint, {
    xMin: xMin - pad,
    xMax: xMax + pad,
    yMin: yMin - pad,
    yMax: yMax + pad,
  });

  const poles: EnclosedPole[] = [];
  for (const point of search.points) {
    if (point.kind !== 'pole') continue;
    const winding = windingAround(integral.path, point.z);
    if (winding === null || winding === 0) continue;
    // A circle wide enough to hold this pole but not its neighbours: the residue is
    // measured at half the distance to the nearest other pole, and `residueAt`'s ladder
    // guards against the estimate being wrong.
    let nearest = Math.max(xMax - xMin, yMax - yMin);
    for (const other of search.points) {
      if (other === point) continue;
      nearest = Math.min(nearest, cabs(csub(other.z, point.z)));
    }
    poles.push({
      z: point.z,
      winding,
      residue: residueAt(atPoint, point.z, nearest / 2),
    });
  }
  return { poles, search };
}

/** Resolve the path and the integrand, and integrate. */
/** The two callbacks a contour integral needs, once its path has been resolved. */
interface ContourCallbacks {
  readonly atParameter: (t: number) => Result<Complex, MathIssue>;
  readonly atPoint: (z: Complex) => Result<Complex, MathIssue>;
  readonly from: number;
  readonly to: number;
}

/** Resolve the path and the integrand, or say why they cannot be resolved. */
function contourCallbacks(
  expr: Extract<Expr, { kind: 'contour-integral' }>,
  environment: EvaluationEnvironment,
  depth: number,
  contourDepth: number,
): Result<ContourCallbacks, MathIssue> {
  if (contourDepth >= MAXIMUM_CONTOUR_DEPTH) {
    return fail({
      kind: 'unsupported',
      detail: `Contour integrals nested ${contourDepth + 1} deep`,
      message: `A contour integral inside the integrand of another one is not supported: it would cost a whole integration for every sample of the outer one.`,
      span: expr.span,
    });
  }

  const path = environment.functions.get(expr.path);
  if (path === undefined) {
    return fail({
      kind: 'unknown-function',
      name: expr.path,
      message: `"${expr.path}" is not a function, so it cannot be the path of a contour integral.`,
      span: expr.pathSpan,
    });
  }

  const parameter = path.parameters[0];
  if (path.parameters.length !== 1 || parameter === undefined) {
    return fail({
      kind: 'arity-mismatch',
      name: expr.path,
      expected: 1,
      received: path.parameters.length,
      message: `A contour is a function of one real parameter, and "${expr.path}" takes ${path.parameters.length}.`,
      span: expr.pathSpan,
    });
  }

  const innerFunctions = environment.functions;
  const interval =
    path.interval === undefined
      ? ok({ from: CONTOUR_INTEGRAL.from, to: CONTOUR_INTEGRAL.to })
      : resolvePathInterval(path.interval, environment, depth, contourDepth);
  if (!interval.ok) return interval;

  const atParameter = (t: number): Result<Complex, MathIssue> => {
    const value = evaluate(
      path.body,
      {
        values: new Map([...environment.values, [parameter, cx(t, 0)]]),
        functions: innerFunctions,
      },
      depth + 1,
      contourDepth + 1,
    );
    if (!value.ok) return value;
    const scalar = asComplex(value.value);
    return scalar === null
      ? fail({
          kind: 'unsupported',
          detail: 'A path returned a list',
          message: `"${expr.path}" has to take a single complex value, not a list.`,
          span: expr.pathSpan,
        })
      : ok(scalar);
  };

  const atPoint = (z: Complex): Result<Complex, MathIssue> => {
    const value = evaluate(
      expr.integrand,
      { values: new Map([...environment.values, [expr.variable, z]]), functions: innerFunctions },
      depth + 1,
      contourDepth + 1,
    );
    if (!value.ok) return value;
    const scalar = asComplex(value.value);
    return scalar === null
      ? fail({
          kind: 'unsupported',
          detail: 'The integrand returned a list',
          message:
            'The integrand of a contour integral has to take a single complex value, not a list.',
          span: expr.integrand.span,
        })
      : ok(scalar);
  };

  return ok({ atParameter, atPoint, from: interval.value.from, to: interval.value.to });
}

function resolvePathInterval(
  interval: Pick<PathInterval, 'from' | 'to'>,
  environment: EvaluationEnvironment,
  depth: number,
  contourDepth: number,
): Result<{ readonly from: number; readonly to: number }, MathIssue> {
  const from = evaluate(interval.from, environment, depth + 1, contourDepth + 1);
  if (!from.ok) return from;
  const to = evaluate(interval.to, environment, depth + 1, contourDepth + 1);
  if (!to.ok) return to;

  const fromValue = asComplex(from.value);
  const toValue = asComplex(to.value);
  if (
    fromValue === null ||
    toValue === null ||
    fromValue.im !== 0 ||
    toValue.im !== 0 ||
    !Number.isFinite(fromValue.re) ||
    !Number.isFinite(toValue.re)
  ) {
    return fail({
      kind: 'unsupported',
      detail: 'non-real contour parameter interval',
      message: 'A contour parameter interval must have finite real endpoints.',
    });
  }
  return ok({ from: fromValue.re, to: toValue.re });
}

/** Integrate along the contour, resolving the path and the integrand first. */
function integrateContour(
  expr: Extract<Expr, { kind: 'contour-integral' }>,
  environment: EvaluationEnvironment,
  depth: number,
  contourDepth: number,
): Result<ContourIntegralResult, MathIssue> {
  const callbacks = contourCallbacks(expr, environment, depth, contourDepth);
  if (!callbacks.ok) return callbacks;
  return contourIntegral({
    path: callbacks.value.atParameter,
    integrand: callbacks.value.atPoint,
    from: callbacks.value.from,
    to: callbacks.value.to,
  });
}

function evaluateCall(
  expr: Extract<Expr, { kind: 'call' }>,
  environment: EvaluationEnvironment,
  depth: number,
): Result<Value, MathIssue> {
  if (builtinFunction(expr.callee) !== undefined) {
    return evaluateBuiltin(expr, environment, depth);
  }

  const userFunction = environment.functions.get(expr.callee);
  if (userFunction === undefined) {
    return fail({
      kind: 'unknown-function',
      name: expr.callee,
      message: `"${expr.callee}" is not a known function.`,
      span: expr.span,
    });
  }

  const argumentValues: Complex[] = [];
  for (const argumentExpr of expr.args) {
    const result = evaluate(argumentExpr, environment, depth + 1);
    if (!result.ok) return result;
    const value = asComplex(result.value);
    if (value === null) {
      return fail({
        kind: 'unsupported',
        detail: 'List argument to a user function',
        message: `A list cannot be passed as an argument to ${userFunction.name}.`,
        span: argumentExpr.span,
      });
    }
    argumentValues.push(value);
  }

  if (userFunction.parameters.length !== argumentValues.length) {
    return fail({
      kind: 'arity-mismatch',
      name: userFunction.name,
      expected: userFunction.parameters.length,
      received: argumentValues.length,
      message: `${userFunction.name} takes ${userFunction.parameters.length} argument${userFunction.parameters.length === 1 ? '' : 's'}, but was given ${argumentValues.length}.`,
      span: expr.span,
    });
  }

  const innerValues = new Map(environment.values);
  userFunction.parameters.forEach((parameter, index) => {
    innerValues.set(parameter, argumentValues[index] as Complex);
  });

  return evaluate(
    userFunction.body,
    { values: innerValues, functions: environment.functions },
    depth + 1,
  );
}

function evaluateBuiltin(
  expr: Extract<Expr, { kind: 'call' }>,
  environment: EvaluationEnvironment,
  depth: number,
): Result<Value, MathIssue> {
  const builtin = builtinFunction(expr.callee);
  // Callers reach this only after the builtin lookup succeeded.
  if (builtin === undefined) {
    return fail({
      kind: 'unknown-function',
      name: expr.callee,
      message: `"${expr.callee}" is not a known function.`,
      span: expr.span,
    });
  }

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

  const argumentExpr = expr.args[0] as Expr;
  const argument = evaluate(argumentExpr, environment, depth + 1);
  if (!argument.ok) return argument;

  const value = asComplex(argument.value);
  if (value === null) {
    return fail({
      kind: 'unsupported',
      detail: 'List argument to a builtin function',
      message: `${builtin.name} takes a single value, not a list.`,
      span: argumentExpr.span,
    });
  }

  const argumentText = exprToText(argumentExpr);

  switch (builtin.name) {
    case 'sin':
      return ok(scalarValue(csin(value)));
    case 'cos':
      return ok(scalarValue(ccos(value)));
    case 'tan':
      return ok(scalarValue(ctan(value)));
    case 'sinh':
      return ok(scalarValue(csinh(value)));
    case 'cosh':
      return ok(scalarValue(ccosh(value)));
    case 'tanh':
      return ok(scalarValue(ctanh(value)));
    case 'exp':
      return ok(scalarValue(cexp(value)));
    case 'log': {
      if (isZero(value)) {
        return fail({
          kind: 'logarithm-of-zero',
          argument: argumentText,
          message: `log(0) is not defined: zero is not in the domain of the logarithm.`,
          span: expr.span,
        });
      }
      return ok(scalarValue(clog(value)));
    }
    case 'sqrt':
      return ok(scalarValue(csqrt(value)));
    case 'abs':
      return ok(scalarValue(cx(cabs(value), 0)));
    case 'arg':
      // The argument of zero is undefined rather than any particular angle.
      if (isZero(value)) {
        return fail({
          kind: 'domain-error',
          detail: 'Argument of zero',
          message: 'arg(0) is not defined: the argument of zero has no value.',
          span: expr.span,
        });
      }
      return ok(scalarValue(cx(principalArg(value), 0)));
    case 're':
      return ok(scalarValue(cre(value)));
    case 'im':
      return ok(scalarValue(cim(value)));
    case 'conj':
      return ok(scalarValue(cconj(value)));
    default:
      return fail({
        kind: 'unsupported',
        detail: `No numerical implementation for ${builtin.name}`,
        message: `${builtin.name} is not available numerically yet.`,
        span: expr.span,
      });
  }
}

/** Convenience for callers that expect a scalar and want the issue otherwise. */
export function evaluateScalar(
  expr: Expr,
  environment: EvaluationEnvironment = EMPTY_ENVIRONMENT,
): Result<Complex, MathIssue> {
  const result = evaluate(expr, environment);
  if (!result.ok) return result;
  const value = asComplex(result.value);
  if (value === null) {
    return fail({
      kind: 'unsupported',
      detail: 'Expected a scalar, found a list',
      message: 'A single value was expected here, but the expression produces a list.',
      span: expr.span,
    });
  }
  return ok(value);
}
