/**
 * Writing a contour integral down.
 *
 * GOAL.md 7.15 states the interaction as notation — `f(z) = ...`, `gamma(t) = ...`,
 * `∮_gamma f(z) dz` — rather than as a dialog, so the notation is the feature. These
 * tests are about the writing rather than the mathematics: how the differential is
 * read, how the contour is named, and above all what happens to the variables.
 *
 * The load-bearing one is the binding. `∮_gamma f(z) dz` mentions `z` and is a
 * *constant*; if `z` came back free the line would be typed as a function of `z`, and a
 * value would appear in the interface as something to plot. Nothing about the integral
 * itself would look wrong, which is what makes it worth a test of its own.
 */
import { describe, expect, it } from 'vitest';
import { childNodes, collectVariableNames, walk, type Expr } from '../src/ast';
import { cabs, csub, cx } from '../src/complex';
import { asComplex, evaluate, evaluateScalar } from '../src/evaluator';
import { exprToText } from '../src/format';
import { lowerToDomainColoringProgram } from '../src/glsl';
import { inferSpace, makeInferenceContext } from '../src/infer';
import { exprToLatex, parseLatexExpression, parseLatexStatement } from '../src/latex';
import { parseExpression } from '../src/parser';
import { lowerToSympy } from '../src/sympy';
import { buildWorkspace, workspaceEnvironment, type WorkspaceInput } from '../src/workspace';

const KNOWN = { knownFunctions: new Set(['f', 'g', 'gamma']), knownValues: new Set(['t', 'z']) };

function parse(source: string): Expr {
  const result = parseExpression(source, KNOWN);
  if (!result.ok) throw new Error(`expected "${source}" to parse: ${result.issue.message}`);
  return result.value;
}

function parseFailure(source: string): string {
  const result = parseExpression(source, KNOWN);
  if (result.ok) throw new Error(`expected "${source}" to fail, and it parsed`);
  return result.issue.message;
}

function parseLatex(source: string): Expr {
  const result = parseLatexExpression(source, KNOWN);
  if (!result.ok) throw new Error(`expected "${source}" to parse: ${result.issue.message}`);
  return result.value;
}

/** Every name mentioned as a variable anywhere in the tree, bound or not. */
function everyVariableName(expr: Expr): string[] {
  const names: string[] = [];
  walk(expr, (node) => {
    if (node.kind === 'variable') names.push(node.name);
  });
  return names;
}

/**
 * The tree without its source positions.
 *
 * Two trees built from differently-spaced spellings of the same mathematics are the
 * same tree, and comparing them with their spans would be comparing where the text sat
 * rather than what it said.
 */
function bare(expr: Expr): unknown {
  return JSON.parse(
    JSON.stringify(expr, (key, value) =>
      key === 'span' || key === 'pathSpan' ? undefined : value,
    ),
  );
}

function inputs(...sources: string[]): WorkspaceInput[] {
  return sources.map((source, index) => ({ id: `line-${index}`, source }));
}

describe('the integration variable is bound, not free', () => {
  it('makes the integral a constant', () => {
    const integral = parse('∮_gamma f(z) dz');
    expect(collectVariableNames(integral)).toEqual([]);
  });

  it('binds only inside the integrand', () => {
    // The `z` after the integral is a different `z`, and it is free.
    expect(collectVariableNames(parse('∮_gamma z dz + z'))).toEqual(['z']);
  });

  it('keeps a workspace parameter free, because a parameter is not a variable', () => {
    // `a` is bound by the document, so the line is a value that happens to follow the
    // slider — not a function of `a` to be plotted.
    const workspace = buildWorkspace(
      inputs('a=2', 'gamma(t)=exp(i*t)', 'f(z)=1/z', '∮_gamma a*f(z) dz'),
    );
    const line = workspace.entries[3];
    expect(line?.type?.classification.kind).toBe('scalar');
    expect(line?.type?.signature.codomain.kind).toBe('C');
  });

  it('still reports the integration variable when it is written inside a call', () => {
    // The tree is free of `z`; the *name* is still there, and the printers and the
    // lowerings have to be able to see it.
    expect(everyVariableName(parse('∮_gamma f(z) dz'))).toEqual(['z']);
    expect(childNodes(parse('∮_gamma f(z) dz')).length).toBe(1);
  });
});

describe('reading the differential', () => {
  it('takes the variable from `dz` in both plain spellings', () => {
    for (const source of ['∮_gamma f(z) dz', '∮_gamma f(z) d z', '∮gamma f(z) dz']) {
      const integral = parse(source);
      if (integral.kind !== 'contour-integral') throw new Error('expected an integral');
      expect(integral.variable).toBe('z');
    }
  });

  it('reads the three LaTeX spellings as the same tree', () => {
    const spellings = [
      '\\oint_{\\gamma}f(z)\\,dz',
      '\\oint_{\\gamma}f(z)\\,d z',
      '\\oint_{\\gamma}f(z)dz',
    ];
    const trees = spellings.map(parseLatex);
    for (const tree of trees) {
      if (tree.kind !== 'contour-integral') throw new Error('expected an integral');
      expect(tree.variable).toBe('z');
      expect(tree.path).toBe('gamma');
    }
    expect(bare(trees[1] as Expr)).toEqual(bare(trees[0] as Expr));
    expect(bare(trees[2] as Expr)).toEqual(bare(trees[0] as Expr));
  });

  it('refuses to guess when there is none', () => {
    expect(parseFailure('∮_gamma f(z)')).toContain('differential');
    const latex = parseLatexExpression('\\oint_{\\gamma}f(z)', KNOWN);
    expect(latex.ok).toBe(false);
    if (!latex.ok) expect(latex.issue.message).toContain('differential');
  });

  it('names the multiplication when that is what was meant', () => {
    // `f(z)*dz` is a product its author meant, and saying so is better than letting the
    // bounded integrand parse fail somewhere confusing.
    expect(parseFailure('∮_gamma f(z)*dz')).toContain('product');
    const latex = parseLatexExpression('\\oint_{\\gamma}f(z)\\cdot dz', KNOWN);
    expect(latex.ok).toBe(false);
    if (!latex.ok) expect(latex.issue.message).toContain('product');
  });

  it('leaves `d z` alone everywhere else', () => {
    // The regression guard for the decision not to teach the lexer about `d`. If a
    // differential were a *token*, `d z` would stop being `d*z` in every line of every
    // workspace, and `d(x)` would stay a product while `dx` would not.
    const product = parseExpression('d z');
    expect(product.ok).toBe(true);
    if (!product.ok) return;
    expect(exprToText(product.value)).toBe('d * z');
  });
});

describe('naming the contour', () => {
  it('accepts the same name from both front ends', () => {
    for (const [source, expected] of [
      ['∮_gamma f(z) dz', 'gamma'],
      ['∮gamma f(z) dz', 'gamma'],
      ['\\oint_{\\gamma}f(z)\\,dz', 'gamma'],
      ['\\oint_{\\gamma_1}f(z)\\,dz', 'gamma_1'],
    ] as const) {
      const tree = source.startsWith('\\') ? parseLatex(source) : parse(source);
      if (tree.kind !== 'contour-integral') throw new Error(`expected an integral from ${source}`);
      expect(tree.path).toBe(expected);
    }
  });

  it('says what an underscore means, rather than multiplying by it', () => {
    // Without this `_gamma` reaches the juxtaposed-letters rule and quietly becomes
    // `_ · g · a · m · m · a`.
    expect(parseFailure('_gamma')).toContain('underscore');
  });
});

describe('what the type system says about it', () => {
  const context = makeInferenceContext({
    functions: [
      ['gamma', { domain: { kind: 'R', dim: 1 }, codomain: { kind: 'C', dim: 1 } }],
      ['f', { domain: { kind: 'C', dim: 1 }, codomain: { kind: 'C', dim: 1 } }],
    ],
  });

  it('is complex, whatever the integrand is', () => {
    const space = inferSpace(parse('∮_gamma f(z) dz'), context);
    expect(space.ok).toBe(true);
    if (!space.ok) return;
    expect(space.value.kind).toBe('C');
  });

  it('requires the path to be a function of one real parameter', () => {
    const complexPath = makeInferenceContext({
      functions: [
        ['gamma', { domain: { kind: 'C', dim: 1 }, codomain: { kind: 'C', dim: 1 } }],
        ['f', { domain: { kind: 'C', dim: 1 }, codomain: { kind: 'C', dim: 1 } }],
      ],
    });
    const wrongDomain = inferSpace(parse('∮_gamma f(z) dz'), complexPath);
    expect(wrongDomain.ok).toBe(false);
    if (wrongDomain.ok) return;
    expect(wrongDomain.issue.kind).toBe('dimension-mismatch');

    const undefinedPath = inferSpace(parse('∮_gamma f(z) dz'), makeInferenceContext());
    expect(undefinedPath.ok).toBe(false);
    if (undefinedPath.ok) return;
    expect(undefinedPath.issue.kind).toBe('unknown-function');
  });
});

describe('what the other back ends do with it', () => {
  const integral = parse('∮_gamma f(z) dz');

  it('refuses to draw it, rather than dropping it', () => {
    // The refusal has to be *reachable*: a lowering that silently produced `0` would
    // pass a test that only checked for failure.
    const shader = lowerToDomainColoringProgram(integral, {
      parameters: [],
      variables: new Map([['z', { kind: 'complex' } as const]]),
    });
    expect(shader.ok).toBe(false);
    if (shader.ok) return;
    expect(shader.issue.kind).toBe('unsupported');
    expect(shader.issue.message).toContain('one number');
  });

  it('refuses to hand it to the symbolic engine, and says why', () => {
    const lowered = lowerToSympy(integral, ['z']);
    expect(lowered.ok).toBe(false);
    if (lowered.ok) return;
    expect(lowered.issue.kind).toBe('unsupported');
    expect(lowered.issue.message).toContain('numerically');
  });
});

describe('printing it back', () => {
  it('round-trips through the plain syntax', () => {
    const integral = parse('∮_gamma f(z) dz');
    const printed = exprToText(integral);
    expect(printed).toBe('∮_gamma f(z) dz');
    expect(bare(parse(printed))).toEqual(bare(integral));
  });

  it('round-trips through LaTeX', () => {
    const integral = parse('∮_gamma f(z) dz');
    const latex = exprToLatex(integral);
    // `\left(...\right)` is how this printer writes every call, so the round trip is
    // through the same shape rather than through a hand-written string.
    expect(latex).toBe('\\oint_{\\gamma}f\\left(z\\right)\\,dz');
    expect(bare(parseLatex(latex))).toEqual(bare(integral));
  });

  it('brackets an integrand that would otherwise regroup', () => {
    // `∮_γ a + b dz` is not `∮_γ (a + b) dz`, and the printer must not produce the
    // first when it means the second.
    const sum = parse('∮_gamma (a + b) dz');
    expect(exprToText(sum)).toContain('(a + b)');
    expect(bare(parse(exprToText(sum)))).toEqual(bare(sum));
  });
});

describe('the whole way through', () => {
  it('gives 2 pi i for the integral GOAL.md asks for', () => {
    // The interaction GOAL.md 7.15 writes down, end to end: three lines, no dialog, and
    // a number that is the residue theorem's simplest case.
    const workspace = buildWorkspace(inputs('gamma(t)=exp(i*t)', 'f(z)=1/z', '∮_gamma f(z) dz'));
    const entry = workspace.entries[2];
    expect(entry?.type?.classification.kind).toBe('scalar');

    const statement = entry?.statement;
    if (statement == null) throw new Error('expected a statement');
    const value = evaluate(statement.body, workspaceEnvironment(workspace));
    expect(value.ok).toBe(true);
    if (!value.ok) return;
    const scalar = asComplex(value.value);
    expect(scalar).not.toBeNull();
    if (scalar === null) return;
    expect(cabs(csub(scalar, cx(0, 2 * Math.PI)))).toBeLessThan(1e-9);
  });

  it('follows a parameter, so the slider means something', () => {
    const workspace = buildWorkspace(
      inputs('a=2', 'gamma(t)=exp(i*t)', 'f(z)=1/z', '∮_gamma a*f(z) dz'),
    );
    const entry = workspace.entries[3];
    const statement = entry?.statement;
    if (statement == null) throw new Error('expected a statement');

    const midway = evaluate(statement.body, workspaceEnvironment(workspace));
    expect(midway.ok).toBe(true);
    if (!midway.ok) return;
    const doubled = asComplex(midway.value);
    expect(doubled).not.toBeNull();
    if (doubled === null) return;

    // Twice the residue, from the same contour.
    expect(cabs(csub(doubled, cx(0, 4 * Math.PI)))).toBeLessThan(1e-9);
  });

  it('refuses a contour that passes through the pole', () => {
    // `∮ 1/(z-1) dz` around the unit circle is not a large number: the contour runs
    // through the pole at z = 1, and the answer is that there is no answer.
    const workspace = buildWorkspace(
      inputs('gamma(t)=exp(i*t)', 'f(z)=1/(z-1)', '∮_gamma f(z) dz'),
    );
    const entry = workspace.entries[2];
    const statement = entry?.statement;
    if (statement == null) throw new Error('expected a statement');
    const value = evaluate(statement.body, workspaceEnvironment(workspace));
    expect(value.ok).toBe(false);
    if (value.ok) return;
    expect(value.issue.kind).toBe('singularity');
  });

  it('is a value you can do arithmetic with', () => {
    // The consequence of making the node an expression rather than a statement, and
    // the reason for it: GOAL.md 7.17 compares this against `2πi Σ Res`, which has to be
    // writable rather than something the interface arranges behind the scenes.
    const workspace = buildWorkspace(
      inputs('gamma(t)=exp(i*t)', 'f(z)=1/z', '∮_gamma f(z) dz + 1'),
    );
    const entry = workspace.entries[2];
    const statement = entry?.statement;
    if (statement == null) throw new Error('expected a statement');
    const value = evaluateScalar(statement.body, workspaceEnvironment(workspace));
    expect(value.ok).toBe(true);
    if (!value.ok) return;
    expect(cabs(csub(value.value, cx(1, 2 * Math.PI)))).toBeLessThan(1e-9);
  });
});

describe('a statement that names a contour integral as a parameter', () => {
  it('parses and types, so the notation works where a value is expected', () => {
    const parsed = parseLatexStatement('a=\\oint_{\\gamma}f(z)\\,dz', KNOWN);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.kind).toBe('parameter');
  });
});
