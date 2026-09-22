/**
 * The WebGL2 side of the field view.
 *
 * Owns a context, a compiled program and the uniform plumbing, and nothing else.
 * It receives a shader that the mathematical core produced from the canonical AST
 * (see `glsl.ts`) and a set of values to bind; it does not know what the
 * expression means. That separation is the point: the renderer is an engine, not
 * a second implementation of the mathematics.
 *
 * One consequence worth stating: a change to a parameter value is only a uniform
 * update, so dragging a slider never recompiles a shader. A change to the
 * *expression* is a new program.
 */
import type { GlslProgram } from '@mathviz/mathcore';
import { linkProgram, ShaderCompilationError } from './shaderProgram';

export interface RenderRequest {
  readonly centerX: number;
  readonly centerY: number;
  readonly halfWidth: number;
  readonly halfHeight: number;
  readonly widthPixels: number;
  readonly heightPixels: number;
  readonly mode: number;
  readonly scalarRange: readonly [number, number];
  readonly grid: boolean;
  readonly axes: boolean;
  readonly gridSpacing: number;
  readonly phaseContours: boolean;
  readonly modulusBands: boolean;
  /** Live values of the expression's parameters, by name. */
  readonly parameterValues: ReadonlyMap<string, number>;
}

const VERTEX_COUNT = 4;

export class FieldRenderer {
  private readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private vertexArray: WebGLVertexArrayObject | null = null;
  private positionBuffer: WebGLBuffer | null = null;
  private locations = new Map<string, WebGLUniformLocation | null>();

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
    });
    if (context === null) {
      throw new ShaderCompilationError(
        'WebGL2 is not available in this browser',
        'getContext("webgl2") returned null',
      );
    }
    this.gl = context;
  }

  /** Compile a program from the lowering of an expression. */
  setProgram(program: GlslProgram): void {
    const gl = this.gl;
    const linked = linkProgram(gl, program.vertexSource, program.fragmentSource);

    // Release the previous program only after the new one has linked, so a failed
    // compile leaves the previous picture on screen rather than a blank canvas.
    if (this.program !== null) gl.deleteProgram(this.program);
    this.program = linked;
    this.locations.clear();

    if (this.vertexArray === null) this.createGeometry();
  }

  private createGeometry(): void {
    const gl = this.gl;
    const vertexArray = gl.createVertexArray();
    const buffer = gl.createBuffer();
    if (vertexArray === null || buffer === null) {
      throw new ShaderCompilationError('could not allocate geometry', '');
    }

    gl.bindVertexArray(vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    // A quad covering the viewport, drawn as a triangle strip. The same geometry
    // is used for every expression; only the program changes.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    this.vertexArray = vertexArray;
    this.positionBuffer = buffer;
  }

  private uniform(name: string): WebGLUniformLocation | null {
    const cached = this.locations.get(name);
    if (cached !== undefined) return cached;
    const location = this.program === null ? null : this.gl.getUniformLocation(this.program, name);
    this.locations.set(name, location);
    return location;
  }

  /** Resize the drawing buffer when the canvas has changed size. */
  resize(widthPixels: number, heightPixels: number): void {
    const canvas = this.canvas;
    if (canvas.width !== widthPixels || canvas.height !== heightPixels) {
      canvas.width = widthPixels;
      canvas.height = heightPixels;
    }
  }

  draw(request: RenderRequest): void {
    const gl = this.gl;
    const program = this.program;
    const vertexArray = this.vertexArray;
    if (program === null || vertexArray === null) return;

    this.resize(request.widthPixels, request.heightPixels);

    gl.viewport(0, 0, request.widthPixels, request.heightPixels);
    gl.useProgram(program);
    gl.bindVertexArray(vertexArray);

    const positionLocation = gl.getAttribLocation(program, 'aPosition');
    if (positionLocation >= 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    }

    gl.uniform2f(this.uniform('uResolution'), request.widthPixels, request.heightPixels);
    gl.uniform2f(this.uniform('uCenter'), request.centerX, request.centerY);
    gl.uniform2f(this.uniform('uHalfSize'), request.halfWidth, request.halfHeight);
    gl.uniform1f(this.uniform('uMode'), request.mode);
    gl.uniform2f(this.uniform('uScalarRange'), request.scalarRange[0], request.scalarRange[1]);
    gl.uniform1f(this.uniform('uGrid'), request.grid ? 1 : 0);
    gl.uniform1f(this.uniform('uAxes'), request.axes ? 1 : 0);
    gl.uniform1f(this.uniform('uGridSpacing'), request.gridSpacing);
    gl.uniform1f(this.uniform('uPhaseContours'), request.phaseContours ? 1 : 0);
    gl.uniform1f(this.uniform('uModulusBands'), request.modulusBands ? 1 : 0);

    for (const [name, value] of request.parameterValues) {
      const location = this.uniform(`p_${name}`);
      if (location !== null) gl.uniform1f(location, value);
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, VERTEX_COUNT);
  }

  dispose(): void {
    const gl = this.gl;
    if (this.program !== null) gl.deleteProgram(this.program);
    if (this.vertexArray !== null) gl.deleteVertexArray(this.vertexArray);
    if (this.positionBuffer !== null) gl.deleteBuffer(this.positionBuffer);
    this.program = null;
    this.vertexArray = null;
    this.positionBuffer = null;
    this.locations.clear();
  }
}
