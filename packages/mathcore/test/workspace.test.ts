/**
 * Workspace tests.
 *
 * The workspace is where the expression-first promise is kept: a bare `z^2` has
 * to be understood as a complex function, `ay` has to mean `a * y`, and
 * definition order must not matter. These are the behaviours the UI depends on.
 */
import { describe, expect, it } from 'vitest';
import { cx } from '../src/complex';
import { asComplex, evaluateScalar } from '../src/evaluator';
import {
  buildWorkspace,
  evaluateParameterExpression,
  workspaceEnvironment,
  type WorkspaceEntry,
  type WorkspaceInput,
} from '../src/workspace';
import type { InferredType } from '../src/infer';
import { signatureToString } from '../src/types';
import { expectComplexCloseTo } from './helpers';

function inputs(...sources: string[]): WorkspaceInput[] {
  return sources.map((source, index) => ({ id: `line-${index}`, source }));
}

/** The inferred type of a line, asserting that there is one. */
function typeOf(entry: WorkspaceEntry | undefined): InferredType {
  if (entry?.type == null) {
    throw new Error(`expected an inferred type, got: ${entry?.typeIssue?.message ?? 'nothing'}`);
  }
  return entry.type;
}

describe('classifying lines', () => {
  it('recognises a definition, a parameter and a bare expression', () => {
    const workspace = buildWorkspace(inputs('f(z)=z^2', 'a=2', 'z+1'));
    expect(workspace.entries.map((entry) => entry.role)).toEqual([
      'definition',
      'parameter',
      'expression',
    ]);
  });

  it('types a definition as a complex function', () => {
    const workspace = buildWorkspace(inputs('f(z)=sin(z)/(z^2+1)'));
    const entry = workspace.entries[0];
    expect(typeOf(entry).classification.kind).toBe('complex-function');
    expect(signatureToString(typeOf(entry).signature)).toBe('C → C');
  });

  it('types a bare expression as a function of its free variables', () => {
    // No definition written, yet the system knows what it is.
    const workspace = buildWorkspace(inputs('z^2'));
    const entry = workspace.entries[0];
    expect(typeOf(entry).classification.kind).toBe('complex-function');
    expect(signatureToString(typeOf(entry).signature)).toBe('C → C');
  });

  it('types a bare expression in two real variables as a scalar field', () => {
    const workspace = buildWorkspace(inputs('x^2+y^2'));
    const entry = workspace.entries[0];
    expect(typeOf(entry).classification.kind).toBe('scalar-field');
    expect(signatureToString(typeOf(entry).signature)).toBe('R² → R');
  });

  it('types a bare constant expression as a value', () => {
    const workspace = buildWorkspace(inputs('2+3'));
    expect(typeOf(workspace.entries[0]).classification.kind).toBe('scalar');
  });

  it('types a complex path', () => {
    const workspace = buildWorkspace(inputs('gamma(t)=2e^(it)'));
    expect(typeOf(workspace.entries[0]).classification.kind).toBe('complex-path');
  });

  it('types a vector field', () => {
    const workspace = buildWorkspace(inputs('F(x,y)=(-y, x)'));
    expect(typeOf(workspace.entries[0]).classification.kind).toBe('vector-field');
  });
});

describe('parameters', () => {
  it('exposes a real parameter as a slider', () => {
    const workspace = buildWorkspace(inputs('a=2'));
    expect(workspace.parameters).toHaveLength(1);
    expect(workspace.parameters[0]?.name).toBe('a');
    expect(workspace.parameters[0]?.slider).toBe(true);
    expect(workspace.parameters[0]?.value).toEqual(cx(2, 0));
  });

  it('binds a complex parameter but offers no slider', () => {
    const workspace = buildWorkspace(inputs('a=2i'));
    expect(workspace.parameters[0]?.value).toEqual(cx(0, 2));
    expect(workspace.parameters[0]?.slider).toBe(false);
  });

  it('resolves a parameter defined in terms of another', () => {
    const workspace = buildWorkspace(inputs('a=2', 'b=a*3'));
    const b = workspace.parameters.find((parameter) => parameter.name === 'b');
    expect(b?.value).toEqual(cx(6, 0));
  });

  it('resolves parameters regardless of the order they are written in', () => {
    const workspace = buildWorkspace(inputs('b=a*3', 'a=2'));
    const b = workspace.parameters.find((parameter) => parameter.name === 'b');
    expect(b?.value).toEqual(cx(6, 0));
  });

  it('leaves a circular definition unresolved rather than failing', () => {
    const workspace = buildWorkspace(inputs('a=b', 'b=a'));
    expect(workspace.parameters).toHaveLength(0);
  });

  it('lets a slider override the value implied by the definition', () => {
    const workspace = buildWorkspace(inputs('a=2', 'f(z)=a*z'));
    const environment = workspaceEnvironment(workspace, new Map([['a', 5]]));
    const function_ = workspace.functions.get('f');
    expect(function_).toBeDefined();
    if (function_ === undefined) return;

    const result = evaluateScalar(
      { kind: 'call', callee: 'f', args: [{ kind: 'number', value: { n: 3n, d: 1n }, raw: '3', span: { start: 0, end: 1 } }], span: { start: 0, end: 4 } },
      environment,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectComplexCloseTo(result.value, cx(15, 0));
  });

  it('re-evaluates a parameter expression against current values', () => {
    const workspace = buildWorkspace(inputs('a=2', 'b=a*3'));
    const b = workspace.parameters.find((parameter) => parameter.name === 'b');
    expect(b).toBeDefined();
    if (b === undefined) return;

    const result = evaluateParameterExpression(workspace, b.expression, new Map([['a', 10]]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(30);
  });
});

describe('order independence and dependent definitions', () => {
  it('resolves a definition that uses a function written later', () => {
    const workspace = buildWorkspace(inputs('f(z)=g(z)+1', 'g(z)=z^2'));
    const f = workspace.signatures.get('f');
    expect(f).toBeDefined();
    expect(f && signatureToString(f)).toBe('C → C');
    expect(workspace.functions.has('f')).toBe(true);
    expect(workspace.functions.has('g')).toBe(true);
  });

  it('distinguishes a call from a product using the whole document', () => {
    // `f(z)` is a call because f is defined somewhere in this document...
    const withFunction = buildWorkspace(inputs('f(z)=z^2', 'f(w)+1'));
    expect(withFunction.entries[1]?.parseError).toBeNull();
    expect(withFunction.entries[1]?.typeIssue).toBeNull();

    // ...and `z(z+1)` is a product because z is not a function anywhere.
    const withProduct = buildWorkspace(inputs('z(z+1)'));
    expect(withProduct.entries[0]?.typeIssue).toBeNull();
  });

  it('reads juxtaposed letters as a product', () => {
    const workspace = buildWorkspace(inputs('a=2', 'f(x,y)=x^2+a y^2'));
    expect(workspace.entries[1]?.typeIssue).toBeNull();
    expect(typeOf(workspace.entries[1]).signature.codomain).toEqual({ kind: 'R', dim: 1 });
  });
});

describe('problems are reported per line', () => {
  it('reports a parse error without affecting the other lines', () => {
    const workspace = buildWorkspace(inputs('f(z)=z^2', 'g(z)=z^', 'a=1'));
    expect(workspace.entries[1]?.parseError).not.toBeNull();
    expect(workspace.entries[1]?.role).toBe('invalid');
    expect(workspace.entries[0]?.typeIssue).toBeNull();
    expect(workspace.entries[2]?.typeIssue).toBeNull();
  });

  it('reports a name defined twice', () => {
    const workspace = buildWorkspace(inputs('a=1', 'a=2'));
    expect(workspace.entries[0]?.typeIssue).toBeNull();
    expect(workspace.entries[1]?.typeIssue?.kind).toBe('unsupported');
    expect(workspace.entries[1]?.typeIssue?.message).toContain('already defined');
  });

  it('reports an undefined symbol', () => {
    const workspace = buildWorkspace(inputs('f(z)=wombat*z'));
    expect(workspace.entries[0]?.typeIssue?.kind).toBe('unbound-symbol');
  });

  it('reports a definition that refers only to itself', () => {
    const workspace = buildWorkspace(inputs('f(z)=f(z)+1'));
    expect(workspace.entries[0]?.typeIssue).not.toBeNull();
  });
});

describe('the function map handed to the evaluator', () => {
  it('contains every definition with its parameters and body', () => {
    const workspace = buildWorkspace(inputs('f(z)=z^2', 'g(x,y)=x+y'));
    expect([...workspace.functions.keys()].sort()).toEqual(['f', 'g']);
    expect(workspace.functions.get('g')?.parameters).toEqual(['x', 'y']);
  });

  it('exposes the function names for the parser and for completion', () => {
    const workspace = buildWorkspace(inputs('f(z)=z^2', 'gamma(t)=t'));
    expect([...workspace.functionNames].sort()).toEqual(['f', 'gamma']);
  });
});

describe('an empty workspace', () => {
  it('analyses to nothing rather than failing', () => {
    const workspace = buildWorkspace([]);
    expect(workspace.entries).toEqual([]);
    expect(workspace.parameters).toEqual([]);
    expect(workspace.functions.size).toBe(0);
  });

  it('produces a usable environment', () => {
    const workspace = buildWorkspace([]);
    const environment = workspaceEnvironment(workspace);
    expect(environment.values.size).toBe(0);
    const result = evaluateScalar(
      { kind: 'number', value: { n: 7n, d: 1n }, raw: '7', span: { start: 0, end: 1 } },
      environment,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(asComplex({ kind: 'scalar', value: result.value })).toEqual(cx(7, 0));
  });
});
