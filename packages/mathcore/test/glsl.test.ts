/**
 * GLSL lowering tests.
 *
 * A shader cannot be executed here, but its *source* can be checked, and that
 * catches the failures that matter: an unsupported construct being dropped
 * silently, a parameter baked in as a constant instead of a uniform, a variable
 * left unbound, or the prelude losing a function the expression needs. The
 * browser verification then confirms that the shader agrees with the CPU
 * reference numerically.
 */
import { describe, expect, it } from 'vitest';
import { SCALAR_RAMP } from '../src/coloring';
import { lowerToDomainColoringProgram, type VariableBinding } from '../src/glsl';
import { parseExpression } from '../src/parser';
import type { Expr } from '../src/ast';
import type { MathIssue, Result } from '../src/errors';

function expr(source: string): Expr {
  const result = parseExpression(source);
  if (!result.ok) throw new Error(`expected a parse, got: ${result.issue.message}`);
  return result.value;
}

interface LowerOptions {
  readonly parameters?: readonly string[];
  readonly variables?: Record<string, VariableBinding>;
  /** Names the parser should treat as values, mirroring what the workspace does. */
  readonly values?: readonly string[];
}

function parseWith(source: string, options: LowerOptions): Expr {
  const result = parseExpression(source, { knownValues: new Set(options.values ?? []) });
  if (!result.ok) throw new Error(`expected a parse, got: ${result.issue.message}`);
  return result.value;
}

function lower(
  source: string,
  options: LowerOptions = {},
): Result<{ vertex: string; fragment: string; uniformNames: string[] }, MathIssue> {
  const result = lowerToDomainColoringProgram(parseWith(source, options), {
    parameters: options.parameters ?? [],
    variables: new Map(Object.entries(options.variables ?? { z: { kind: 'complex' } })),
  });
  if (!result.ok) return result;
  return {
    ok: true,
    value: {
      vertex: result.value.vertexSource,
      fragment: result.value.fragmentSource,
      uniformNames: result.value.uniforms.map((uniform) => uniform.name),
    },
  };
}

function fragmentFor(source: string, options: LowerOptions = {}): string {
  const result = lower(source, options);
  if (!result.ok) throw new Error(`expected a program, got: ${result.issue.message}`);
  return result.value.fragment;
}

describe('program shape', () => {
  it('puts the version directive on the very first line', () => {
    // A GLSL version directive must precede everything else, including comments.
    expect(fragmentFor('z^2').startsWith('#version 300 es\n')).toBe(true);
    expect(fragmentFor('z^2').split('\n')[0]).toBe('#version 300 es');
  });

  it('declares the fragment output and high precision', () => {
    const fragment = fragmentFor('z^2');
    expect(fragment).toContain('precision highp float;');
    expect(fragment).toContain('out vec4 outColor;');
  });

  it('emits a vertex shader that covers the viewport', () => {
    const result = lower('z^2');
    if (!result.ok) throw new Error('expected a program');
    expect(result.value.vertex).toContain('gl_Position');
  });

  it('includes the complex primitives the expression needs', () => {
    const fragment = fragmentFor('sin(z)/(z^2+1)');
    for (const symbol of ['cadd', 'csub', 'cmul', 'cdiv', 'csin', 'clog', 'csqrt', 'cpow']) {
      expect(fragment).toContain(symbol);
    }
  });

  it('includes the colouring routine, which mirrors coloring.ts', () => {
    const fragment = fragmentFor('z^2');
    expect(fragment).toContain('vec3 colorForValue(vec2 w)');
    expect(fragment).toContain('hsvToRgb');
    expect(fragment).toContain('carg');
  });

  it('exposes the generated function under a known entry point', () => {
    const result = lowerToDomainColoringProgram(expr('z^2'), {
      parameters: [],
      variables: new Map([['z', { kind: 'complex' } as VariableBinding]]),
    });
    if (!result.ok) throw new Error('expected a program');
    expect(result.value.entryPoint).toBe('expressionAt');
    expect(result.value.fragmentSource).toContain('vec2 expressionAt(vec2 point)');
  });
});

describe('the expression is translated, not interpreted', () => {
  it('emits a call to the complex power for a power expression', () => {
    // The shader's cpow decides at run time whether the exponent is an integer
    // and therefore whether the exact repeated-multiplication path applies. The
    // emitter does not duplicate that decision.
    expect(fragmentFor('z^2')).toContain('cpow(v_z, vec2(2.0, 0.0))');
  });

  it('emits nested complex calls for a compound expression', () => {
    expect(fragmentFor('z^2+1')).toContain('cadd(cpow(v_z, vec2(2.0, 0.0)), vec2(1.0, 0.0))');
  });

  it('emits a division as a complex division', () => {
    expect(fragmentFor('1/z')).toContain('cdiv(vec2(1.0, 0.0), v_z)');
  });

  it('emits the imaginary unit as a pair', () => {
    expect(fragmentFor('i')).toContain('vec2(0.0, 1.0)');
  });

  it('emits an integer literal as a whole number', () => {
    expect(fragmentFor('5')).toContain('vec2(5.0, 0.0)');
  });

  it('emits a fractional literal as an exact division of its rational form', () => {
    // 0.5 is exactly 1/2 and 0.1 is exactly 1/10, so the shader begins from the
    // rational the parser recorded rather than from a rounded decimal.
    expect(fragmentFor('0.5')).toContain('vec2((1.0 / 2.0), 0.0)');
    expect(fragmentFor('0.1')).toContain('vec2((1.0 / 10.0), 0.0)');
  });

  it('wraps a real-valued builtin back into a complex value', () => {
    expect(fragmentFor('abs(z)')).toContain('absToComplex(v_z)');
    expect(fragmentFor('arg(z)')).toContain('argToComplex(v_z)');
  });
});

describe('variables become plane coordinates', () => {
  it('binds a complex variable to the plane point', () => {
    const fragment = fragmentFor('z^2', { variables: { z: { kind: 'complex' } } });
    expect(fragment).toContain('vec2 v_z = point;');
  });

  it('binds a real variable to one axis', () => {
    const fragment = fragmentFor('x^2', { variables: { x: { kind: 'real', axis: 0 } } });
    expect(fragment).toContain('vec2 v_x = vec2(point.x, 0.0);');
  });

  it('binds the second real variable to the other axis', () => {
    const fragment = fragmentFor('y^2', { variables: { y: { kind: 'real', axis: 1 } } });
    expect(fragment).toContain('vec2 v_y = vec2(point.y, 0.0);');
  });

  it('gives two variables distinct names', () => {
    const fragment = fragmentFor('x*y', {
      variables: { x: { kind: 'real', axis: 0 }, y: { kind: 'real', axis: 1 } },
    });
    expect(fragment).toContain('vec2 v_x = vec2(point.x, 0.0);');
    expect(fragment).toContain('vec2 v_y = vec2(point.y, 0.0);');
  });

  it('refuses to lower an expression with an unbound variable', () => {
    const result = lower('z^2', { variables: {} });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.kind).toBe('unbound-symbol');
  });
});

describe('parameters become uniforms', () => {
  it('declares one uniform per parameter', () => {
    const fragment = fragmentFor('z^a', {
      parameters: ['a'],
      variables: { z: { kind: 'complex' } },
    });
    expect(fragment).toContain('uniform float p_a;');
    expect(fragment).toContain('vec2(p_a, 0.0)');
  });

  it('reports the uniforms it expects', () => {
    const result = lower('z^a', { parameters: ['a'], variables: { z: { kind: 'complex' } } });
    if (!result.ok) throw new Error('expected a program');
    expect(result.value.uniformNames).toContain('p_a');
    // The framing uniforms the renderer must always supply.
    expect(result.value.uniformNames).toContain('uResolution');
    expect(result.value.uniformNames).toContain('uCenter');
    expect(result.value.uniformNames).toContain('uHalfSize');
  });

  it('does not bake a parameter in as a constant, so a slider needs no recompile', () => {
    const fragment = fragmentFor('z^a', {
      parameters: ['a'],
      variables: { z: { kind: 'complex' } },
    });
    expect(fragment).not.toContain('cintpow(v_z');
  });
});

describe('scalar field modes', () => {
  it('declares the mode and range uniforms', () => {
    const fragment = fragmentFor('z^2');
    expect(fragment).toContain('uniform float uMode;');
    expect(fragment).toContain('uniform vec2 uScalarRange;');
  });

  it('generates the ramp table from the single source of truth in coloring.ts', () => {
    const fragment = fragmentFor('z^2');
    expect(fragment).toContain(`const vec3 RAMP_COLOR[${SCALAR_RAMP.length}]`);
    // The first stop is the darkest violet of the palette, emitted with its full
    // precision rather than rounded.
    const first = SCALAR_RAMP[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(fragment).toContain(
      `vec3(${String(first.rgb.r)}, ${String(first.rgb.g)}, ${String(first.rgb.b)})`,
    );
  });

  it('selects the colouring by mode at run time', () => {
    const fragment = fragmentFor('z^2');
    expect(fragment).toContain('vec3 colorForField(vec2 w)');
    expect(fragment).toContain('if (mode == 0) return colorForValue(w);');
    // main() shades through the mode-aware entry point.
    expect(fragment).toContain('vec3 color = colorForField(value);');
  });

  it('normalises the modulus with the same formula as the CPU reference', () => {
    // log(1 + x) on both sides, because GLSL has no log1p.
    expect(fragmentFor('z^2')).toContain('log(1.0 + max(0.0, scalar))');
  });
});

describe('unsupported constructs are reported, not dropped', () => {
  it('refuses a list-valued expression, which has no scalar meaning', () => {
    const result = lower('(-y, x)', {
      variables: { y: { kind: 'real', axis: 1 }, x: { kind: 'real', axis: 0 } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.kind).toBe('unsupported');
    expect(result.issue.message).toContain('list');
  });

  it('reports arity problems rather than emitting a broken call', () => {
    const result = lower('sin(z, z)');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.kind).toBe('arity-mismatch');
  });
});

describe('identifier safety', () => {
  it('does not let a variable shadow a name from the prelude', () => {
    const fragment = fragmentFor('point^2', {
      variables: { point: { kind: 'complex' } },
      values: ['point'],
    });
    // The variable is renamed, so `point` still refers to the coordinate.
    expect(fragment).toContain('vec2 v0 = point;');
    expect(fragment).toContain('cpow(v0, vec2(2.0, 0.0))');
  });

  it('renames a variable that is not a legal GLSL identifier', () => {
    const fragment = fragmentFor('ψ^2', { variables: { ψ: { kind: 'complex' } } });
    expect(fragment).toMatch(/vec2 v\d+ = point;/);
  });
});
