/**
 * The shader a surface is drawn with.
 *
 * This is the one shader in the project that is *not* a lowering of the
 * expression. A surface's `z` is computed on the CPU when the mesh is sampled —
 * the AST is evaluated hundreds of thousands of times to build the geometry, and
 * doing it again per pixel on the GPU would be work for nothing. What is left for
 * the shader is to place the vertices and colour them, so it is a fixed program
 * and takes no part of the AST.
 *
 * That is why it is not a `GlslProgram`. That type means "the expression,
 * compiled", and it is produced only by lowering; putting a camera in it would
 * blur the distinction the architecture rests on.
 *
 * What it *does* share is the colouring: the ramp and its normalisation come from
 * `scalarFieldColoringSource`, which is generated from `SCALAR_RAMP`. A surface of
 * `f(x, y)` and a heatmap of `f(x, y)` therefore cannot come out different
 * colours, because there is one table and both read it.
 */
import { scalarFieldColoringSource, type GlslUniform } from './glsl';

export interface SurfaceProgram {
  readonly vertexSource: string;
  readonly fragmentSource: string;
  readonly uniforms: readonly GlslUniform[];
}

const VERTEX_SOURCE = `#version 300 es
in vec3 aPosition;
in vec3 aNormal;
in float aValue;

uniform mat4 uViewProjection;

out vec3 vNormal;
out float vValue;

void main() {
  vNormal = aNormal;
  vValue = aValue;
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
}
`;

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;

uniform vec2 uScalarRange;
uniform vec3 uLightDirection;
// 1 draws everything in one flat colour, which is how the axes and the reference
// grid are drawn: they are scaffolding, not data, and shading them by a value
// they do not have would say they were part of the surface.
uniform float uFlat;
uniform vec3 uFlatColor;

in vec3 vNormal;
in float vValue;

out vec4 fragColor;

const float PI = 3.141592653589793;
const float TAU = 6.283185307179586;

${scalarFieldColoringSource()}

void main() {
  if (uFlat > 0.5) {
    fragColor = vec4(uFlatColor, 1.0);
    return;
  }

  // Mode 3 is the linear mapping of the value, and it is the only one that means
  // anything here: a surface's value *is* its height. The other modes are
  // readings of a complex number, which a surface does not have.
  vec3 base = scalarRamp(normalizeScalar(vValue, 3));

  vec3 normal = normalize(vNormal);
  // Seen from below, the shading flips so the underside is lit rather than left
  // as a hole. Back faces are drawn rather than culled for the same reason: a
  // surface can legitimately be looked at from underneath, and hiding it would be
  // the picture lying about what is there.
  if (!gl_FrontFacing) normal = -normal;

  float lambert = max(0.0, dot(normal, normalize(uLightDirection)));
  // A floor under the diffuse term: without it the far side of a fold goes flat
  // black and stops being readable as shape.
  fragColor = vec4(base * (0.45 + 0.55 * lambert), 1.0);
}
`;

/**
 * The program source, and the uniforms it expects.
 *
 * The uniforms are declared rather than left for the renderer to discover, so the
 * two cannot disagree about a name.
 */
export function surfaceProgramSource(): SurfaceProgram {
  return {
    vertexSource: VERTEX_SOURCE,
    fragmentSource: FRAGMENT_SOURCE,
    uniforms: [
      { name: 'uViewProjection', kind: 'mat4', meaning: 'World space to clip space' },
      {
        name: 'uScalarRange',
        kind: 'vec2',
        meaning: 'Minimum and maximum of the sampled value, for the colour ramp',
      },
      {
        name: 'uLightDirection',
        kind: 'vec3',
        meaning: 'Direction the light comes from, in world space',
      },
      { name: 'uFlat', kind: 'float', meaning: '1 to draw scaffolding in a flat colour' },
      { name: 'uFlatColor', kind: 'vec3', meaning: 'The colour the scaffolding is drawn in' },
    ],
  };
}
