/**
 * Type inference tests.
 *
 * Two themes:
 *
 * - The signature tests check that a definition's signature becomes the right
 *   mathematical object. This drives which capabilities the UI offers.
 * - The widening tests check the conservative choices. A real power with a
 *   non-integer exponent widens to the complex numbers because `(-1)^0.5 = i`;
 *   a real logarithm widens because the logarithm of a negative real is
 *   imaginary. These are deliberate, and the tests say why.
 *
 * The parser is given the same options the workspace gives it, so these tests
 * exercise the real configuration rather than a simplified one.
 */
import { describe, expect, it } from 'vitest';
import { C1, R1, spaceToString, type Signature } from '../src/types';
import { spaceNameForVariable } from '../src/conventions';
import {
  inferSignature,
  inferSpace,
  makeInferenceContext,
  provablyNonNegative,
  provablyPositive,
  spaceForConventionLetter,
  type InferenceContext,
} from '../src/infer';
import { detectDefinitionHeader, parseExpression, parseStatement } from '../src/parser';
import type { Expr } from '../src/ast';
import { exprToText } from '../src/format';

const spaceOfParameter = (name: string) => spaceForConventionLetter(spaceNameForVariable(name));

interface Case {
  readonly variables?: Record<string, 'R' | 'C'>;
  readonly functions?: Record<string, Signature>;
  readonly knownFunctions?: readonly string[];
  readonly knownValues?: readonly string[];
}

function contextFor(options: Case): InferenceContext {
  return makeInferenceContext({
    variables: Object.entries(options.variables ?? {}).map(([name, letter]) => [
      name,
      spaceForConventionLetter(letter),
    ]),
    functions: Object.entries(options.functions ?? {}),
  });
}

const C_TO_C: Signature = { domain: C1, codomain: C1 };
const R_TO_R: Signature = { domain: R1, codomain: R1 };

function parseWith(source: string, options: Case): Expr {
  const result = parseExpression(source, {
    knownFunctions: new Set(options.knownFunctions ?? []),
    knownValues: new Set(options.knownValues ?? []),
  });
  if (!result.ok) throw new Error(`expected a parse, got: ${result.issue.message}`);
  return result.value;
}

function spaceOf(source: string, options: Case = {}): string {
  const result = inferSpace(parseWith(source, options), contextFor(options));
  if (!result.ok) throw new Error(`expected a type, got: ${result.issue.message}`);
  return spaceToString(result.value);
}

function issueOf(source: string, options: Case = {}): string {
  const result = inferSpace(parseWith(source, options), contextFor(options));
  if (result.ok) throw new Error(`expected an issue for: ${source}`);
  return result.issue.kind;
}

/**
 * Infer a definition's signature, parsing it the way the workspace does.
 *
 * The workspace collects every function name in the document before parsing any
 * line, so `g(z)` is a call whether or not `g` is defined above `f`. The helper
 * does the same, taking the names from the signatures it was given.
 */
function signatureOf(source: string, options: Case = {}): string {
  const header = detectDefinitionHeader(source);
  const parsed = parseStatement(source, {
    knownFunctions: new Set([
      ...Object.keys(options.functions ?? {}),
      ...(header === null ? [] : [header.name]),
    ]),
    knownValues: new Set([...Object.keys(options.variables ?? {}), ...(header?.parameters ?? [])]),
  });
  if (!parsed.ok) throw new Error(`expected a parse, got: ${parsed.issue.message}`);
  if (parsed.value.kind !== 'function-definition') throw new Error('expected a definition');

  const result = inferSignature(
    parsed.value.parameters,
    parsed.value.body,
    contextFor(options),
    spaceOfParameter,
  );
  if (!result.ok) throw new Error(`expected a signature, got: ${result.issue.message}`);
  return `${spaceToString(result.value.domain)} -> ${spaceToString(result.value.codomain)}`;
}

describe('scalars and simple combinations', () => {
  it('types literals and real arithmetic as R', () => {
    expect(spaceOf('2')).toBe('R');
    expect(spaceOf('2 + 3 * 4')).toBe('R');
  });

  it('types the imaginary unit as C', () => {
    expect(spaceOf('i')).toBe('C');
  });

  it('keeps a real constant real and makes a derived one complex', () => {
    expect(spaceOf('pi')).toBe('R');
    expect(spaceOf('pi*i')).toBe('C');
  });

  it('widens a sum to C when either side is complex', () => {
    expect(spaceOf('z + 1', { variables: { z: 'C' } })).toBe('C');
    expect(spaceOf('x + y', { variables: { x: 'R', y: 'R' } })).toBe('R');
  });

  it('rejects combining values of different real dimensions', () => {
    expect(issueOf('(1, 2) + (1, 2, 3)')).toBe('dimension-mismatch');
  });
});

describe('powers widen only when they must', () => {
  it('keeps a real base real for an integer exponent', () => {
    expect(spaceOf('x^2', { variables: { x: 'R' } })).toBe('R');
    expect(spaceOf('x^-3', { variables: { x: 'R' } })).toBe('R');
  });

  it('widens a real base with a non-integer exponent', () => {
    // (-1)^0.5 is i, so claiming R would be wrong.
    expect(spaceOf('x^0.5', { variables: { x: 'R' } })).toBe('C');
    expect(spaceOf('x^(1/3)', { variables: { x: 'R' } })).toBe('C');
  });

  it('keeps a provably non-negative base real', () => {
    expect(spaceOf('4^0.5')).toBe('R');
    expect(spaceOf('abs(x)^0.5', { variables: { x: 'R' } })).toBe('R');
  });

  it('keeps a complex base complex whatever the exponent', () => {
    expect(spaceOf('z^2', { variables: { z: 'C' } })).toBe('C');
    expect(spaceOf('z^0.5', { variables: { z: 'C' } })).toBe('C');
  });
});

describe('builtin functions follow their space rule', () => {
  it('preserves the argument space for the trigonometric and exponential functions', () => {
    expect(spaceOf('sin(x)', { variables: { x: 'R' } })).toBe('R');
    expect(spaceOf('sin(z)', { variables: { z: 'C' } })).toBe('C');
    expect(spaceOf('exp(z)', { variables: { z: 'C' } })).toBe('C');
  });

  it('always produces a real result for the real-valued builtins', () => {
    expect(spaceOf('abs(z)', { variables: { z: 'C' } })).toBe('R');
    expect(spaceOf('arg(z)', { variables: { z: 'C' } })).toBe('R');
    expect(spaceOf('re(z)', { variables: { z: 'C' } })).toBe('R');
    expect(spaceOf('im(z)', { variables: { z: 'C' } })).toBe('R');
  });

  it('widens a real logarithm, because the logarithm of a negative real is imaginary', () => {
    expect(spaceOf('log(x)', { variables: { x: 'R' } })).toBe('C');
    expect(spaceOf('log(2)')).toBe('R');
    expect(spaceOf('log(exp(x))', { variables: { x: 'R' } })).toBe('R');
  });

  it('widens a real square root unless it is provably non-negative', () => {
    expect(spaceOf('sqrt(x)', { variables: { x: 'R' } })).toBe('C');
    expect(spaceOf('sqrt(4)')).toBe('R');
    expect(spaceOf('sqrt(abs(x))', { variables: { x: 'R' } })).toBe('R');
  });

  it('rejects the wrong number of arguments', () => {
    expect(issueOf('sin(z, 1)', { variables: { z: 'C' } })).toBe('arity-mismatch');
  });
});

describe('provability helpers', () => {
  it('recognises non-negative expressions', () => {
    const at = (source: string): boolean => provablyNonNegative(parseWith(source, {}));
    expect(at('4')).toBe(true);
    expect(at('0')).toBe(true);
    expect(at('-4')).toBe(false);
    expect(at('abs(z)')).toBe(true);
    expect(at('exp(x)')).toBe(true);
    expect(at('sqrt(9)')).toBe(true);
    expect(at('x')).toBe(false);
  });

  it('recognises strictly positive expressions', () => {
    const at = (source: string): boolean => provablyPositive(parseWith(source, {}));
    expect(at('4')).toBe(true);
    expect(at('0')).toBe(false);
    expect(at('exp(x)')).toBe(true);
    expect(at('x')).toBe(false);
  });
});

describe('signatures of definitions', () => {
  it('types a complex function of one complex variable', () => {
    expect(signatureOf('f(z)=z^2')).toBe('C -> C');
    expect(signatureOf('f(z)=sin(z)/(z^2+1)')).toBe('C -> C');
    expect(signatureOf('f(z)=(z-1)/(z+1)')).toBe('C -> C');
  });

  it('types a real function of one real variable', () => {
    expect(signatureOf('f(x)=x^2')).toBe('R -> R');
  });

  it('types a scalar field of two variables', () => {
    expect(signatureOf('f(x,y)=x^2-y^2')).toBe('R² -> R');
  });

  it('types a scalar field of three variables', () => {
    expect(signatureOf('f(x,y,zr)=x+y+zr')).toBe('R³ -> R');
  });

  it('types a complex path, a real parameter with complex output', () => {
    // R -> C. The complex-analysis subsystem reads this as a path; the transforms
    // subsystem may read the same signature as a complex-valued signal. The
    // signature itself is unambiguous.
    expect(signatureOf('gamma(t)=2e^(it)')).toBe('R -> C');
  });

  it('types a planar vector field', () => {
    expect(signatureOf('F(x,y)=(-y, x)')).toBe('R² -> R²');
  });

  it('types a space curve', () => {
    expect(signatureOf('r(t)=(cos(t), sin(t), t)')).toBe('R -> R³');
  });

  it('uses a parameter defined elsewhere', () => {
    expect(signatureOf('f(z)=z^a', { variables: { a: 'R' } })).toBe('C -> C');
    expect(signatureOf('g(x)=x^a', { variables: { a: 'R' } })).toBe('R -> C');
  });

  it('uses another function defined elsewhere', () => {
    expect(signatureOf('f(z)=g(z)+1', { functions: { g: C_TO_C } })).toBe('C -> C');
  });

  it('reports an undefined symbol rather than guessing', () => {
    expect(issueOf('wombat + 1')).toBe('unbound-symbol');
  });

  it('reports a call to a name it has no signature for', () => {
    expect(issueOf('g(z)', { knownFunctions: ['g'], variables: { z: 'C' } })).toBe(
      'unknown-function',
    );
  });

  it('accepts a real argument where a complex one is expected', () => {
    // R embeds in C, so passing 2 to a function of z is legitimate.
    expect(
      spaceOf('f(2)', { knownFunctions: ['f'], functions: { f: C_TO_C } }),
    ).toBe('C');
  });

  it('rejects a complex argument where a real one is expected', () => {
    expect(issueOf('f(i)', { knownFunctions: ['f'], functions: { f: R_TO_R } })).toBe(
      'dimension-mismatch',
    );
  });

  it('rejects a point passed to a function of one real variable', () => {
    expect(issueOf('f((1, 2))', { knownFunctions: ['f'], functions: { f: R_TO_R } })).toBe(
      'dimension-mismatch',
    );
  });

  it('rejects a call with the wrong number of arguments', () => {
    expect(issueOf('f(z, 1)', { knownFunctions: ['f'], functions: { f: C_TO_C }, variables: { z: 'C' } })).toBe(
      'arity-mismatch',
    );
  });
});

describe('spaces', () => {
  it('prints labels the way mathematics writes them', () => {
    expect(spaceToString(R1)).toBe('R');
    expect(spaceToString(C1)).toBe('C');
  });
});

describe('inference does not alter the tree it is given', () => {
  it('leaves the expression as written', () => {
    const expression = parseWith('sin(z)/(z^2+1)', { variables: { z: 'C' } });
    const before = exprToText(expression);
    inferSpace(expression, makeInferenceContext({ variables: [['z', C1]] }));
    expect(exprToText(expression)).toBe(before);
  });
});
