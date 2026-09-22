/**
 * The parts of talking to WebGL that both renderers need.
 *
 * Two pipelines now exist and they share almost nothing — one rasterises a
 * full-screen quad and computes at every pixel, the other transforms a mesh with a
 * camera and shades it. What they do share is the tedious, identical, easy-to-get-
 * subtly-wrong part: compiling two shaders, linking them, and reporting why when
 * it fails. That is here.
 *
 * The failure is a *typed* error rather than a boolean because the message is the
 * whole point: a shader that will not compile has a line number and a reason, and
 * the views show it. Swallowing it and drawing nothing is the behaviour this
 * exists to avoid.
 */

export class ShaderCompilationError extends Error {
  constructor(
    message: string,
    /** The driver's own report, which is what a person can act on. */
    readonly log: string,
  ) {
    super(message);
    this.name = 'ShaderCompilationError';
  }
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) throw new ShaderCompilationError('could not create a shader', '');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    const stage = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
    throw new ShaderCompilationError(`the ${stage} shader failed to compile`, log);
  }
  return shader;
}

/**
 * Compile and link a program from two sources.
 *
 * The shaders are deleted once they are linked, because the program keeps what it
 * needs and a compiled shader is a driver-side resource that would otherwise leak
 * on every expression change.
 */
export function linkProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const vertexShader = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);

  const linked = gl.createProgram();
  if (linked === null) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new ShaderCompilationError('could not create a program', '');
  }

  gl.attachShader(linked, vertexShader);
  gl.attachShader(linked, fragmentShader);
  gl.linkProgram(linked);

  if (!gl.getProgramParameter(linked, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(linked) ?? '';
    gl.deleteProgram(linked);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new ShaderCompilationError('the shader program failed to link', log);
  }

  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  return linked;
}

/** Whether this browser can render the WebGL views at all. */
export function webgl2Available(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const probe = document.createElement('canvas');
    return probe.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}
