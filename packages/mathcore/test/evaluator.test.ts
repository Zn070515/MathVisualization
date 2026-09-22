/**
 * Numerical evaluator tests.
 *
 * Half of these check values. The other half check that a point where there is no
 * value produces a *mathematical reason* rather than NaN reaching the caller,
 * which is what GOAL.md section 14 asks for.
 */
import { describe, expect, it } from 'vitest';
import { cx, type Complex } from '../src/complex';
import {
  asComplex,
  asComponents,
  evaluate,
  evaluateScalar,
  makeEnvironment,
  type UserFunctionDefinition,
} from '../src/evaluator';
import { parseExpression, parseStatement } from '../src/parser';
import type { Expr } from '../src/ast';
import { expectCloseTo, expectComplexCloseTo } from './helpers';

function expr(source: string, knownFunctions: readonly string[] = []): Expr {
  const result = parseExpression(source, { knownFunctions: new Set(knownFunctions) });
  if (!result.ok) throw new Error(`expected a parse, got: ${result.issue.message}`);
  return result.value;
}

/** Evaluate source with the given bound values and user functions. */
function valueOf(
  source: string,
  values: Record<string, Complex> = {},
  functions: readonly UserFunctionDefinition[] = [],
): Complex {
  const result = evaluateScalar(
    expr(source, functions.map((fn) => fn.name)),
    makeEnvironment({ values: Object.entries(values), functions: functions.map((fn) => [fn.name, fn] as const) }),
  );
  if (!result.ok) throw new Error(`expected a value, got: ${result.issue.message}`);
  return result.value;
}

/** The issue kind produced by evaluating source. */
function issueOf(
  source: string,
  values: Record<string, Complex> = {},
  functions: readonly UserFunctionDefinition[] = [],
): string {
  const result = evaluateScalar(
    expr(source, functions.map((fn) => fn.name)),
    makeEnvironment({ values: Object.entries(values), functions: functions.map((fn) => [fn.name, fn] as const) }),
  );
  if (result.ok) throw new Error(`expected an issue for: ${source}`);
  return result.issue.kind;
}

/** Parse `name(params) = body` into the shape the evaluator applies. */
function define(source: string, knownFunctions: readonly string[] = []): UserFunctionDefinition {
  const parsed = parseStatement(source, { knownFunctions: new Set(knownFunctions) });
  if (!parsed.ok) throw new Error(`expected a parse, got: ${parsed.issue.message}`);
  if (parsed.value.kind !== 'function-definition') throw new Error('expected a definition');
  return {
    name: parsed.value.name,
    parameters: parsed.value.parameters,
    body: parsed.value.body,
  };
}

describe('values', () => {
  it('evaluates arithmetic with the usual precedence', () => {
    expectCloseTo(valueOf('1 + 2*3').re, 7);
    expectCloseTo(valueOf('(1 + 2)*3').re, 9);
  });

  it('keeps a literal exact until it is used', () => {
    // 1/3 as a double, but computed from the exact rational rather than from a
    // pre-rounded decimal.
    expectCloseTo(valueOf('1/3').re, 1 / 3);
    expect(valueOf('1/3').im).toBe(0);
  });

  it('treats a real result as exactly real', () => {
    // Not merely close to real: the imaginary part must be exactly zero, so the
    // readout shows a real number for a real function.
    for (const source of ['2 + 3', 'sin(1)', 'exp(2)', 'log(2)', 'sqrt(4)', '1/7']) {
      expect(valueOf(source).im).toBe(0);
    }
  });

  it('evaluates the imaginary unit', () => {
    expectComplexCloseTo(valueOf('i^2'), cx(-1, 0));
    expectComplexCloseTo(valueOf('2i'), cx(0, 2));
  });

  it('evaluates the builtin constants', () => {
    expectCloseTo(valueOf('pi').re, Math.PI);
    expectCloseTo(valueOf('e').re, Math.E);
    expectCloseTo(valueOf('tau').re, 2 * Math.PI);
  });

  it('evaluates the complex elementary functions', () => {
    expectComplexCloseTo(valueOf('exp(i*pi)'), cx(-1, 0));
    expectComplexCloseTo(valueOf('sqrt(-4)'), cx(0, 2));
    expectCloseTo(valueOf('abs(3+4i)').re, 5);
    expectComplexCloseTo(valueOf('conj(3+4i)'), cx(3, -4));
    expectCloseTo(valueOf('re(3+4i)').re, 3);
    expectCloseTo(valueOf('im(3+4i)').re, 4);
  });

  it('evaluates a pointwise value in a list', () => {
    const result = evaluate(expr('(2, 3)'));
    if (!result.ok) throw new Error('expected a value');
    const components = asComponents(result.value);
    expect(components).not.toBeNull();
    expect(components?.map((component) => component.re)).toEqual([2, 3]);
  });
});

describe('undefined points carry a reason', () => {
  it('reports division by zero and names the divisor', () => {
    const result = evaluateScalar(expr('1/(z^2-1)'), makeEnvironment({ values: [['z', cx(1, 0)]] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.kind).toBe('division-by-zero');
    expect(result.issue.message).toContain('z ^ 2 - 1');
  });

  it('reports the logarithm of zero', () => {
    expect(issueOf('log(0)')).toBe('logarithm-of-zero');
  });

  it('reports the argument of zero', () => {
    expect(issueOf('arg(0)')).toBe('domain-error');
  });

  it('reports zero raised to a negative power as a pole', () => {
    expect(issueOf('0^(-1)')).toBe('singularity');
  });

  it('reports a complex power that has no value', () => {
    expect(issueOf('0^i')).toBe('domain-error');
  });

  it('reports an unbound symbol', () => {
    expect(issueOf('q + 1')).toBe('unbound-symbol');
  });

  it('reports a call to a function it has no definition for', () => {
    // The parser produces a call only for a name it was told is a function, so
    // reaching the evaluator with one and no definition is a real situation.
    const result = evaluateScalar(expr('g(1)', ['g']));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.kind).toBe('unknown-function');
  });

  it('reports the wrong number of arguments', () => {
    const definition = define('g(t)=t^2');
    const result = evaluateScalar(
      expr('g(1, 2)', ['g']),
      makeEnvironment({ functions: [['g', definition]] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.kind).toBe('arity-mismatch');
  });
});

describe('user-defined functions', () => {
  it('applies a function to an argument', () => {
    const square = define('f(z)=z^2');
    expectComplexCloseTo(valueOf('f(1+i)', {}, [square]), cx(0, 2));
  });

  it('passes a real argument into a complex parameter', () => {
    const square = define('f(z)=z^2');
    expectCloseTo(valueOf('f(3)', {}, [square]).re, 9);
  });

  it('makes workspace parameters visible inside a function body', () => {
    const scaled = define('f(z)=a*z');
    expectComplexCloseTo(valueOf('f(3)', { a: cx(2, 0) }, [scaled]), cx(6, 0));
  });

  it('lets a function call another function', () => {
    const inner = define('g(z)=z+1');
    const outer = define('f(z)=g(z)*2', ['g']);
    expectComplexCloseTo(valueOf('f(3)', {}, [inner, outer]), cx(8, 0));
  });

  it('reads a complex path', () => {
    const path = define('gamma(t)=2e^(it)');
    const atZero = valueOf('gamma(0)', {}, [path]);
    expectComplexCloseTo(atZero, cx(2, 0));
    const atHalfPi = valueOf('gamma(pi/2)', {}, [path]);
    expectComplexCloseTo(atHalfPi, cx(0, 2));
  });

  it('reports a definition that recurses without end', () => {
    // The name has to be declared a function, or the body would read `f(z)` as
    // the product f * z.
    const looping = define('f(z)=f(z)', ['f']);
    const result = evaluateScalar(
      expr('f(1)', ['f']),
      makeEnvironment({ functions: [['f', looping]] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.kind).toBe('unsupported');
  });
});

describe('lists', () => {
  it('evaluates a vector field at a point', () => {
    const field = define('F(x,y)=(-y, x)');
    const result = evaluate(
      expr('F(1, 2)', ['F']),
      makeEnvironment({ functions: [['F', field]] }),
    );
    if (!result.ok) throw new Error(`expected a value, got: ${result.issue.message}`);
    const components = asComponents(result.value);
    expect(components?.map((component) => component.re)).toEqual([-2, 1]);
  });

  it('scales a list by a scalar', () => {
    const result = evaluate(expr('(1, 2)*3'));
    if (!result.ok) throw new Error('expected a value');
    const components = asComponents(result.value);
    expect(components?.map((component) => component.re)).toEqual([3, 6]);
  });

  it('adds two lists componentwise', () => {
    const result = evaluate(expr('(1, 2) + (3, 4)'));
    if (!result.ok) throw new Error('expected a value');
    const components = asComponents(result.value);
    expect(components?.map((component) => component.re)).toEqual([4, 6]);
  });

  it('refuses to multiply two lists, because the operation is ambiguous', () => {
    const result = evaluate(expr('(1, 2) * (3, 4)'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.kind).toBe('unsupported');
  });

  it('refuses to divide by a list', () => {
    const result = evaluate(expr('1 / (2, 3)'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.kind).toBe('unsupported');
  });

  it('refuses to add a scalar and a list', () => {
    const result = evaluate(expr('1 + (2, 3)'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.kind).toBe('dimension-mismatch');
  });
});

describe('value inspection', () => {
  it('extracts a scalar and reports a list as not being one', () => {
    const scalar = evaluate(expr('3'));
    if (!scalar.ok) throw new Error('expected a value');
    expect(asComplex(scalar.value)).toEqual(cx(3, 0));
    expect(asComponents(scalar.value)).toBeNull();

    const list = evaluate(expr('(1, 2)'));
    if (!list.ok) throw new Error('expected a value');
    expect(asComplex(list.value)).toBeNull();
  });
});
