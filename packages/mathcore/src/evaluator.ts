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
import type { Expr } from './ast';
import { builtinFunction } from './builtins';
import {
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
  csqrt,
  csub,
  ctan,
  ctanh,
  cx,
  isUndefined,
  isZero,
  principalArg,
} from './complex';
import { builtinConstant } from './conventions';
import { contourIntegral } from './contour';
import { fail, ok, type MathIssue, type Result } from './errors';
import { exprToText } from './format';
import { rationalToNumber } from './rational';

/** A function the user defined, in the form the evaluator needs. */
export interface UserFunctionDefinition {
  readonly name: string;
  readonly parameters: readonly string[];
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

  const integrated = contourIntegral({ path: atParameter, integrand: atPoint });
  if (!integrated.ok) return fail(integrated.issue);
  return ok(scalarValue(integrated.value.value));
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
