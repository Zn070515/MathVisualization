/**
 * Lowering the canonical AST to GLSL.
 *
 * This is the concrete proof that the AST is a real intermediate representation
 * and not a frontend-only convenience (GOAL.md 6.1). The *same* tree that the
 * numerical evaluator walks and that the symbolic adapter will translate is
 * compiled here into a fragment shader that computes the function on the GPU.
 * Nothing is parsed twice and no second mathematical truth exists: if the AST is
 * wrong, the CPU and the GPU are wrong in the same way, which is exactly the
 * property the architecture is supposed to have.
 *
 * What has to be kept in step
 * ---------------------------
 * GLSL has no complex type, so complex numbers are pairs of floats and every
 * elementary function is reimplemented in the prelude below. Those
 * implementations reproduce `complex.ts`, including its branch conventions, and
 * `colorForValue` reproduces `coloring.ts`. The remaining differences are the
 * ones 32-bit floating point forces, so agreement with the CPU reference is
 * close rather than exact; the browser verification samples the shader and
 * compares against `domainColor` with a stated tolerance.
 *
 * Unsupported constructs are reported, never silently dropped. A list-valued
 * expression (a vector field) has no scalar-domain-colouring meaning, so the
 * lowering refuses it and the caller shows why.
 */
import type { Expr } from './ast';
import { SCALAR_RAMP } from './coloring';
import { type DomainColoringOptions, DEFAULT_DOMAIN_COLORING } from './conventions';
import { fail, ok, type MathIssue, type Result } from './errors';

/** How a variable of the expression maps onto the plane the shader rasterises. */
export type VariableBinding =
  { readonly kind: 'complex' } | { readonly kind: 'real'; readonly axis: 0 | 1 };

export interface GlslLoweringOptions {
  /** Parameters lowered to `float` uniforms, so changing one does not recompile. */
  readonly parameters: readonly string[];
  /** Binding for every free variable in the expression. */
  readonly variables: ReadonlyMap<string, VariableBinding>;
  readonly coloring?: DomainColoringOptions;
}

export interface GlslUniform {
  readonly name: string;
  /**
   * What the uniform is, so a renderer knows which call to bind it with.
   *
   * The wider kinds are here for the surface shader, which is transformed by
   * matrices rather than rasterised in screen space. Adding them is inert: the
   * fragment-shader renderer binds its uniforms by name and never reads this
   * field, so nothing that already worked changed.
   */
  readonly kind: 'float' | 'vec2' | 'vec3' | 'vec4' | 'mat3' | 'mat4';
  /** What the uniform means, so the renderer can be written against this list. */
  readonly meaning: string;
}

export interface GlslProgram {
  readonly vertexSource: string;
  readonly fragmentSource: string;
  readonly uniforms: readonly GlslUniform[];
  /** Name of the generated function that evaluates the expression. */
  readonly entryPoint: string;
}

/** Uniforms the prelude always declares, independent of the expression. */
const FRAMING_UNIFORMS: readonly GlslUniform[] = [
  { name: 'uResolution', kind: 'vec2', meaning: 'Canvas size in device pixels' },
  { name: 'uCenter', kind: 'vec2', meaning: 'Complex coordinate at the centre of the view' },
  {
    name: 'uHalfSize',
    kind: 'vec2',
    meaning: 'Half-width and half-height of the view, in plane units',
  },
  {
    name: 'uPhaseContours',
    kind: 'float',
    meaning: '1 to darken the phase contours, 0 to omit them',
  },
  {
    name: 'uModulusBands',
    kind: 'float',
    meaning: '1 to shade the logarithmic modulus bands, 0 for flat brightness',
  },
  { name: 'uGrid', kind: 'float', meaning: '1 to draw the coordinate grid' },
  { name: 'uAxes', kind: 'float', meaning: '1 to draw the real and imaginary axes' },
  { name: 'uGridSpacing', kind: 'float', meaning: 'Grid spacing in plane units' },
  {
    name: 'uMode',
    kind: 'float',
    meaning: 'Which quantity to shade: 0 complex, 1 magnitude, 2 phase, 3 real, 4 imaginary',
  },
  {
    name: 'uScalarRange',
    kind: 'vec2',
    meaning: 'Minimum and maximum of the sampled scalar, for the linear modes',
  },
];

/** GLSL ES keywords and reserved identifiers that a variable name must avoid. */
const RESERVED_IDENTIFIERS = new Set([
  'attribute',
  'const',
  'uniform',
  'varying',
  'buffer',
  'shared',
  'coherent',
  'volatile',
  'restrict',
  'readonly',
  'writeonly',
  'layout',
  'centroid',
  'flat',
  'smooth',
  'noperspective',
  'patch',
  'sample',
  'break',
  'continue',
  'do',
  'for',
  'while',
  'switch',
  'case',
  'default',
  'if',
  'else',
  'subroutine',
  'in',
  'out',
  'inout',
  'float',
  'double',
  'int',
  'void',
  'bool',
  'true',
  'false',
  'invariant',
  'precise',
  'discard',
  'return',
  'mat2',
  'mat3',
  'mat4',
  'vec2',
  'vec3',
  'vec4',
  'ivec2',
  'ivec3',
  'ivec4',
  'bvec2',
  'bvec3',
  'bvec4',
  'uint',
  'uvec2',
  'uvec3',
  'uvec4',
  'lowp',
  'mediump',
  'highp',
  'precision',
  'sampler2D',
  'samplerCube',
  'struct',
  'main',
  // Names in scope inside the generated function, which a variable must not shadow.
  'point',
  'value',
  'color',
  'magnitude',
  'argument',
  'hue',
  'brightness',
]);

/** A GLSL float literal, always with a decimal point or an exponent. */
function glslFloatLiteral(value: number): string {
  if (!Number.isFinite(value)) {
    throw new RangeError(`glslFloatLiteral(): ${value} is not a finite number`);
  }
  const text = String(value);
  const exponentIndex = text.search(/[eE]/);
  if (exponentIndex >= 0) {
    const mantissa = text.slice(0, exponentIndex);
    const exponent = text.slice(exponentIndex + 1);
    const withPoint = mantissa.includes('.') ? mantissa : `${mantissa}.0`;
    return `${withPoint}e${exponent}`;
  }
  return text.includes('.') ? text : `${text}.0`;
}

/** Largest numerator or denominator emitted as an exact division. */
const EXACT_DIVISION_LIMIT = 1e15;

/**
 * Emit a numeric literal.
 *
 * A non-integer rational is emitted as an exact division on the GPU
 * (`1.0 / 3.0`) rather than as a pre-rounded decimal, so the shader starts from
 * the same rational the parser recorded.
 */
function glslLiteral(numerator: bigint, denominator: bigint): string {
  const n = Number(numerator);
  const d = Number(denominator);
  if (
    denominator !== 1n &&
    Number.isFinite(n) &&
    Number.isFinite(d) &&
    Math.abs(n) < EXACT_DIVISION_LIMIT &&
    Math.abs(d) < EXACT_DIVISION_LIMIT
  ) {
    return `(${glslFloatLiteral(n)} / ${glslFloatLiteral(d)})`;
  }
  return glslFloatLiteral(n / d);
}

const GLSL_BINARY_FUNCTION: Readonly<Record<string, string>> = {
  add: 'cadd',
  sub: 'csub',
  mul: 'cmul',
  div: 'cdiv',
  pow: 'cpow',
};

/**
 * Shader function for each builtin. Functions whose result is real are wrapped
 * so that the expression stays uniformly complex-valued.
 */
const GLSL_CALL_FUNCTION: Readonly<Record<string, string>> = {
  sin: 'csin',
  cos: 'ccos',
  tan: 'ctan',
  sinh: 'csinh',
  cosh: 'ccosh',
  tanh: 'ctanh',
  exp: 'cexp',
  log: 'clog',
  sqrt: 'csqrt',
  conj: 'cconj',
  abs: 'absToComplex',
  arg: 'argToComplex',
  re: 'realToComplex',
  im: 'imagToComplex',
};

/**
 * Lowering of one program. Identifier assignment lives on the instance so that
 * two lowerings cannot influence each other.
 */
class Lowering {
  private readonly options: GlslLoweringOptions;
  private readonly parameterNames: ReadonlySet<string>;
  /** GLSL name chosen for each variable, decided once and reused. */
  private readonly identifiers = new Map<string, string>();

  constructor(options: GlslLoweringOptions) {
    this.options = options;
    this.parameterNames = new Set(options.parameters);
  }

  /**
   * GLSL name for a variable.
   *
   * Prefixed so that no variable can shadow a local of the generated function or
   * a symbol from the prelude, and falling back to a positional name when the
   * original is not a legal GLSL identifier (`θ` and other Greek letters are not
   * ASCII, so they cannot be used directly).
   */
  identifierFor(name: string): string {
    const existing = this.identifiers.get(name);
    if (existing !== undefined) return existing;

    const legal =
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !RESERVED_IDENTIFIERS.has(name) && name.length <= 20;
    const identifier = legal ? `v_${name}` : `v${this.identifiers.size}`;
    this.identifiers.set(name, identifier);
    return identifier;
  }

  /** Declarations that bind each variable to the plane coordinate. */
  variableDeclarations(): string[] {
    const declarations: string[] = [];
    for (const [name, binding] of this.options.variables) {
      const identifier = this.identifierFor(name);
      if (binding.kind === 'complex') {
        declarations.push(`  vec2 ${identifier} = point;`);
      } else {
        const axis = binding.axis === 0 ? 'point.x' : 'point.y';
        declarations.push(`  vec2 ${identifier} = vec2(${axis}, 0.0);`);
      }
    }
    return declarations;
  }

  lower(expr: Expr): Result<string, MathIssue> {
    switch (expr.kind) {
      case 'number':
        return ok(`vec2(${glslLiteral(expr.value.n, expr.value.d)}, 0.0)`);

      case 'constant':
        return this.lowerConstant(expr.name, expr);

      case 'variable':
        return this.lowerVariable(expr.name, expr);

      case 'unary': {
        const operand = this.lower(expr.operand);
        if (!operand.ok) return operand;
        return ok(expr.op === 'neg' ? `cneg(${operand.value})` : operand.value);
      }

      case 'binary': {
        const left = this.lower(expr.left);
        if (!left.ok) return left;
        const right = this.lower(expr.right);
        if (!right.ok) return right;
        return ok(`${GLSL_BINARY_FUNCTION[expr.op]}(${left.value}, ${right.value})`);
      }

      case 'call':
        return this.lowerCall(expr);

      case 'tuple':
        return fail({
          kind: 'unsupported',
          detail: 'List-valued expression lowered to a scalar-field shader',
          message:
            'This view shows a single complex value at each point, so it cannot display a list-valued expression yet.',
          span: expr.span,
        });

      case 'contour-integral':
        // Not "not yet" — never. A fragment shader evaluates a function at every pixel,
        // and a contour integral is not a function of the pixel: it is one number,
        // computed once. Lowering it would mean integrating per fragment, which is both
        // absurd and wrong.
        return fail({
          kind: 'unsupported',
          detail: 'Contour integral lowered to a shader',
          message:
            'A contour integral is one number rather than a value at each point of the plane, so this view cannot draw it. Its value belongs beside the line that asked for it.',
          span: expr.span,
        });

      case 'fourier-transform':
      case 'dft-transform': {
        const transformName = expr.kind === 'fourier-transform' ? 'Fourier' : 'DFT';
        return fail({
          kind: 'unsupported',
          detail: `${transformName} transform lowered to a shader`,
          message:
            `A ${transformName} transform is a finite-window frequency-domain estimate, so it cannot be drawn by the pointwise shader backend.`,
          span: expr.span,
        });
      }
    }
  }

  private lowerConstant(name: string, expr: Expr): Result<string, MathIssue> {
    switch (name) {
      case 'pi':
        return ok('vec2(PI, 0.0)');
      case 'e':
        return ok('vec2(E_CONSTANT, 0.0)');
      case 'tau':
        return ok('vec2(TAU, 0.0)');
      case 'i':
        return ok('vec2(0.0, 1.0)');
      default:
        return fail({
          kind: 'unsupported',
          detail: `Constant ${name} has no shader representation`,
          message: `The constant "${name}" cannot be drawn.`,
          span: expr.span,
        });
    }
  }

  private lowerVariable(name: string, expr: Expr): Result<string, MathIssue> {
    // Parameters take precedence: a parameter and a coordinate cannot share a
    // name in one expression, and the parameter is the more specific binding.
    if (this.parameterNames.has(name)) return ok(`vec2(p_${name}, 0.0)`);

    if (!this.options.variables.has(name)) {
      return fail({
        kind: 'unbound-symbol',
        symbol: name,
        message: `"${name}" has no value in this view.`,
        span: expr.span,
      });
    }
    return ok(this.identifierFor(name));
  }

  private lowerCall(expr: Extract<Expr, { kind: 'call' }>): Result<string, MathIssue> {
    if (expr.args.length !== 1) {
      return fail({
        kind: 'arity-mismatch',
        name: expr.callee,
        expected: 1,
        received: expr.args.length,
        message: `${expr.callee} takes one argument.`,
        span: expr.span,
      });
    }
    const argumentExpression = expr.args[0] as Expr;
    const argument = this.lower(argumentExpression);
    if (!argument.ok) return argument;

    const shaderFunction = GLSL_CALL_FUNCTION[expr.callee];
    if (shaderFunction === undefined) {
      return fail({
        kind: 'unsupported',
        detail: `No shader implementation for ${expr.callee}`,
        message: `${expr.callee} cannot be drawn on the GPU yet.`,
        span: expr.span,
      });
    }
    return ok(`${shaderFunction}(${argument.value})`);
  }
}

/**
 * The shader prelude.
 *
 * Mirrors `complex.ts` operation for operation. Where the CPU has a fast path for
 * real arguments, the GPU formula already reduces to the same value: `sinh(0.0)`
 * is exactly zero, so a real input produces an exactly zero imaginary part here
 * too.
 */
const PRELUDE = `
const float PI = 3.141592653589793;
const float TAU = 6.283185307179586;
const float E_CONSTANT = 2.718281828459045;

// ---------------------------------------------------------------------------
// Complex primitives. Mirror of complex.ts; see that file for the conventions.
// ---------------------------------------------------------------------------

vec2 cadd(vec2 a, vec2 b) { return a + b; }
vec2 csub(vec2 a, vec2 b) { return a - b; }
vec2 cneg(vec2 a) { return -a; }

vec2 cmul(vec2 a, vec2 b) {
  return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

vec2 cdiv(vec2 a, vec2 b) {
  float denominator = b.x * b.x + b.y * b.y;
  return vec2(
    (a.x * b.x + a.y * b.y) / denominator,
    (a.y * b.x - a.x * b.y) / denominator
  );
}

vec2 cconj(vec2 a) { return vec2(a.x, -a.y); }

float cabsValue(vec2 a) { return length(a); }

// Principal argument in (-PI, PI]. The negative real axis belongs to the upper
// edge of the branch cut, matching principalArg in complex.ts.
float carg(vec2 a) {
  float theta = atan(a.y, a.x);
  return theta == -PI ? PI : theta;
}

vec2 cexp(vec2 a) {
  float magnitude = exp(a.x);
  return vec2(magnitude * cos(a.y), magnitude * sin(a.y));
}

vec2 clog(vec2 a) { return vec2(log(cabsValue(a)), carg(a)); }

vec2 csqrt(vec2 a) {
  if (a.y == 0.0) {
    if (a.x >= 0.0) return vec2(sqrt(a.x), 0.0);
    return vec2(0.0, sqrt(-a.x));
  }
  float magnitude = cabsValue(a);
  float re = sqrt(max(0.0, (magnitude + a.x) * 0.5));
  float imPart = sqrt(max(0.0, (magnitude - a.x) * 0.5));
  return vec2(re, a.y < 0.0 ? -imPart : imPart);
}

// Exponentiation by squaring, 11 steps covering |n| <= 2047. Matches the exact
// integer path in complex.ts, including the reciprocal for negative exponents.
vec2 cintpow(vec2 z, float n) {
  float remaining = abs(n);
  vec2 result = vec2(1.0, 0.0);
  vec2 factor = z;
  for (int i = 0; i < 11; i++) {
    if (mod(remaining, 2.0) >= 1.0) result = cmul(result, factor);
    factor = cmul(factor, factor);
    remaining = floor(remaining * 0.5);
  }
  return n < 0.0 ? cdiv(vec2(1.0, 0.0), result) : result;
}

// A runtime NaN. Built from a uniform rather than a literal so that no compiler
// can constant-fold a division by zero.
vec2 undefinedValue() {
  float zero = uCenter.x - uCenter.x;
  float nan = zero / zero;
  return vec2(nan, nan);
}

vec2 cpow(vec2 z, vec2 w) {
  if (w.y == 0.0 && w.x == floor(w.x) && abs(w.x) <= 1024.0) return cintpow(z, w.x);
  if (dot(z, z) == 0.0) return w.x > 0.0 ? vec2(0.0, 0.0) : undefinedValue();
  return cexp(cmul(w, clog(z)));
}

vec2 csin(vec2 a) { return vec2(sin(a.x) * cosh(a.y), cos(a.x) * sinh(a.y)); }
vec2 ccos(vec2 a) { return vec2(cos(a.x) * cosh(a.y), -sin(a.x) * sinh(a.y)); }
vec2 ctan(vec2 a) { return cdiv(csin(a), ccos(a)); }
vec2 csinh(vec2 a) { return vec2(sinh(a.x) * cos(a.y), cosh(a.x) * sin(a.y)); }
vec2 ccosh(vec2 a) { return vec2(cosh(a.x) * cos(a.y), sinh(a.x) * sin(a.y)); }
vec2 ctanh(vec2 a) { return cdiv(csinh(a), ccosh(a)); }

// Real-valued builtins, wrapped back into a complex value.
vec2 absToComplex(vec2 a) { return vec2(cabsValue(a), 0.0); }
vec2 argToComplex(vec2 a) { return vec2(carg(a), 0.0); }
vec2 realToComplex(vec2 a) { return vec2(a.x, 0.0); }
vec2 imagToComplex(vec2 a) { return vec2(a.y, 0.0); }

// ---------------------------------------------------------------------------
// Value colouring. Mirror of coloring.ts domainColor.
// ---------------------------------------------------------------------------

float fractOf(float x) { return x - floor(x); }

vec3 hsvToRgb(float hue, float saturation, float value) {
  float sector = floor(hue * 6.0);
  float fraction = hue * 6.0 - sector;
  float p = value * (1.0 - saturation);
  float q = value * (1.0 - fraction * saturation);
  float t = value * (1.0 - (1.0 - fraction) * saturation);
  int index = int(mod(sector, 6.0));
  if (index == 0) return vec3(value, t, p);
  if (index == 1) return vec3(q, value, p);
  if (index == 2) return vec3(p, value, t);
  if (index == 3) return vec3(p, q, value);
  if (index == 4) return vec3(t, p, value);
  return vec3(value, p, q);
}

vec3 colorForValue(vec2 w) {
  if (isnan(w.x) || isnan(w.y)) return vec3(0.5);
  if (isinf(w.x) || isinf(w.y)) return vec3(1.0);

  float magnitude = length(w);
  if (magnitude == 0.0) return vec3(0.0);
  if (isinf(magnitude)) return vec3(1.0);

  float argument = carg(w);
  float hue = (argument + PI) / TAU;

  float brightness = 0.75;
  if (uModulusBands > 0.5) {
    float octavePosition = fractOf(log2(magnitude));
    float triangle = 1.0 - abs(2.0 * octavePosition - 1.0);
    brightness = 0.35 + 0.65 * triangle;
  }
  if (uPhaseContours > 0.5 && abs(sin(2.0 * argument)) < 0.08) {
    brightness *= 0.6;
  }

  return hsvToRgb(hue, 0.8, brightness);
}

// Scalar field colouring, shared with the 3D surface shader. See
// scalarFieldColoringSource below.
${scalarFieldColoringSource()}

vec3 colorForField(vec2 w) {
  if (isnan(w.x) || isnan(w.y)) return vec3(0.5);
  if (isinf(w.x) || isinf(w.y)) return vec3(1.0);

  int mode = int(uMode + 0.5);
  if (mode == 0) return colorForValue(w);

  float scalar = mode == 1 ? cabsValue(w)
               : mode == 2 ? carg(w)
               : mode == 3 ? w.x
               : w.y;
  return scalarRamp(normalizeScalar(scalar, mode));
}
`;

/**
 * The scalar ramp, and the normalisation that feeds it, as GLSL.
 *
 * Extracted rather than inlined into the fragment shader because a second shader
 * needs it: the 3D surface colours its vertices by the same rule, so that a
 * surface of `f(x, y)` and a heatmap of `f(x, y)` are the same colours on the
 * same values. Both read the ramp below, which is itself generated from
 * `SCALAR_RAMP`, so there is one table and not three.
 *
 * A caller must declare `uniform vec2 uScalarRange`, which `normalizeScalar`
 * reads, and a name for π and 2π. The surface shader passes the same range, which
 * is how a surface of `f` and a heatmap of `f` come out the same colours.
 */
export function scalarFieldColoringSource(): string {
  return `${rampTableSource()}

vec3 scalarRamp(float t) {
  float position = clamp(t, 0.0, 1.0);
  int index = 0;
  for (int i = 0; i < ${SCALAR_RAMP.length - 1}; i++) {
    if (position >= RAMP_POSITION[i]) index = i;
  }
  float span = RAMP_POSITION[index + 1] - RAMP_POSITION[index];
  float local = span > 0.0 ? clamp((position - RAMP_POSITION[index]) / span, 0.0, 1.0) : 0.0;
  return mix(RAMP_COLOR[index], RAMP_COLOR[index + 1], local);
}

// Mirrors normalizeScalar in coloring.ts. The modulus uses log(1 + x) rather
// than log1p because GLSL has no log1p; the CPU reference uses the same form.
float normalizeScalar(float scalar, int mode) {
  if (mode == 2) return clamp((scalar + PI) / TAU, 0.0, 1.0);
  if (mode == 1) {
    float scale = log(1.0 + max(0.0, uScalarRange.y));
    if (scale <= 0.0) return 0.5;
    return clamp(log(1.0 + max(0.0, scalar)) / scale, 0.0, 1.0);
  }
  float span = uScalarRange.y - uScalarRange.x;
  if (span <= 0.0) return 0.5;
  return clamp((scalar - uScalarRange.x) / span, 0.0, 1.0);
}`;
}

/**
 * The ramp stops, rendered as GLSL constants.
 *
 * Generated from `SCALAR_RAMP` rather than written out again, so the two
 * implementations cannot drift apart.
 */
function rampTableSource(): string {
  const colors = SCALAR_RAMP.map(
    (stop) =>
      `  vec3(${glslFloatLiteral(stop.rgb.r)}, ${glslFloatLiteral(stop.rgb.g)}, ${glslFloatLiteral(stop.rgb.b)})`,
  ).join(',\n');
  const positions = SCALAR_RAMP.map((stop) => glslFloatLiteral(stop.t)).join(', ');

  return `const vec3 RAMP_COLOR[${SCALAR_RAMP.length}] = vec3[${SCALAR_RAMP.length}](
${colors}
);
const float RAMP_POSITION[${SCALAR_RAMP.length}] = float[${SCALAR_RAMP.length}](${positions});`;
}

/** Vertex shader for a full-viewport quad drawn as a triangle strip. */
const VERTEX_SOURCE = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

/**
 * Lower an expression into a complete domain-colouring shader.
 *
 * The expression is compiled into `expressionAt`, called once per fragment with
 * the complex coordinate of that fragment. Parameters become uniforms rather than
 * baked constants, which is what makes dragging a slider a uniform update instead
 * of a recompile.
 */
export function lowerToDomainColoringProgram(
  expr: Expr,
  options: GlslLoweringOptions,
): Result<GlslProgram, MathIssue> {
  const lowering = new Lowering(options);
  const body = lowering.lower(expr);
  if (!body.ok) return body;

  const declarations = lowering.variableDeclarations();
  const parameterUniforms = options.parameters.map((name) => `uniform float p_${name};`).join('\n');

  const fragmentSource = `#version 300 es
precision highp float;
precision highp int;

out vec4 outColor;

uniform vec2 uResolution;
uniform vec2 uCenter;
uniform vec2 uHalfSize;
uniform float uPhaseContours;
uniform float uModulusBands;
uniform float uGrid;
uniform float uAxes;
uniform float uGridSpacing;
uniform float uMode;
uniform vec2 uScalarRange;
${parameterUniforms}
${PRELUDE}
// ---------------------------------------------------------------------------
// The expression, lowered from the canonical AST.
// ---------------------------------------------------------------------------
vec2 expressionAt(vec2 point) {
${declarations.join('\n')}
  return ${body.value};
}

// Distance to the nearest grid line, in plane units.
float distanceToGridLine(float coordinate, float spacing) {
  return abs(fractOf(coordinate / spacing + 0.5) - 0.5) * spacing;
}

void main() {
  vec2 point = uCenter + (gl_FragCoord.xy / uResolution - 0.5) * 2.0 * uHalfSize;
  vec2 value = expressionAt(point);
  vec3 color = colorForField(value);

  float pixelSize = (2.0 * uHalfSize.x) / uResolution.x;

  if (uGrid > 0.5) {
    float distance = min(
      distanceToGridLine(point.x, uGridSpacing),
      distanceToGridLine(point.y, uGridSpacing)
    );
    float line = 1.0 - smoothstep(0.0, pixelSize * 1.2, distance);
    color = mix(color, vec3(0.18), line * 0.35);
  }

  if (uAxes > 0.5) {
    float axisDistance = min(abs(point.x), abs(point.y));
    float axis = 1.0 - smoothstep(0.0, pixelSize * 1.6, axisDistance);
    color = mix(color, vec3(0.1), axis * 0.75);
  }

  outColor = vec4(color, 1.0);
}
`;

  const uniforms: GlslUniform[] = [
    ...FRAMING_UNIFORMS,
    ...options.parameters.map((name): GlslUniform => ({
      name: `p_${name}`,
      kind: 'float',
      meaning: `Value of the parameter ${name}`,
    })),
  ];

  return ok({
    vertexSource: VERTEX_SOURCE,
    fragmentSource,
    uniforms,
    entryPoint: 'expressionAt',
  });
}

/** True when the colouring options are the defaults, used by the renderer's fast path. */
export function isDefaultColoring(options: DomainColoringOptions): boolean {
  return (
    options.phaseContours === DEFAULT_DOMAIN_COLORING.phaseContours &&
    options.modulusBands === DEFAULT_DOMAIN_COLORING.modulusBands
  );
}
