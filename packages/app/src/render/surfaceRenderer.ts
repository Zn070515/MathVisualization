/**
 * The WebGL2 side of the 3D surface view.
 *
 * A sibling of `FieldRenderer` rather than a generalisation of it, because the two
 * pipelines share only the compile-and-link step. The field renderer draws one
 * full-screen quad and recovers the plane coordinate from `gl_FragCoord`, with the
 * depth buffer off entirely; this one transforms real geometry with a camera,
 * needs a depth buffer so the near part of a surface hides the far part, and
 * carries two more attributes. One class doing both would be a class with two
 * vertex layouts, two draw calls and a context flag that changes everything about
 * how it draws — a worse abstraction than two classes, and a bigger one.
 *
 * Back faces are *not* culled and the fragment shader flips the normal when it is
 * looking at one. A surface can legitimately be viewed from underneath, and
 * hiding the underside would be the picture refusing to show what is there.
 */
import { axisTicks, surfaceProgramSource, type SurfaceMesh } from '@mathviz/mathcore';
import type { Mat4, Vec3 } from './matrix';
import { linkProgram, ShaderCompilationError } from './shaderProgram';

/** Position (3), normal (3) and value (1), interleaved. */
const STRIDE = 7;

/**
 * The clear colour, as the floats `clearColor` wants.
 *
 * The same sheet as the 2D views draw on — `CANVAS_COLORS.paper`, `#fdfcfa` — in
 * the form this call takes. Written out rather than converted, because converting
 * a hex string on every frame to get four constants is work for nothing.
 */
const PAPER_CLEAR: readonly [number, number, number] = [0.992, 0.988, 0.98];

/** Where the light comes from, in world space. Over one shoulder and above. */
const LIGHT_DIRECTION: Vec3 = { x: 0.45, y: 0.72, z: 0.53 };

/** How thick the scaffolding lines are drawn. Line width is in device pixels. */
const SCAFFOLD_LINE_WIDTH = 1;
const TANGENT_PLANE_COLOR: readonly [number, number, number] = [0.72, 0.24, 0.16];
const TANGENT_PLANE_OPACITY = 0.38;

export interface SurfaceDrawRequest {
  readonly viewProjection: Mat4;
  readonly scalarRange: readonly [number, number];
  readonly widthPixels: number;
  readonly heightPixels: number;
}

interface Layer {
  readonly vertexArray: WebGLVertexArrayObject;
  readonly vertexBuffer: WebGLBuffer;
  readonly indexBuffer: WebGLBuffer | null;
  readonly vertexCount: number;
  readonly indexCount: number;
}

/** Read a typed array without the `undefined` that a bounds-checked index gives. */
function at(data: ArrayLike<number>, index: number): number {
  return data[index] ?? 0;
}

export class SurfaceRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly locations = new Map<string, WebGLUniformLocation | null>();
  private surface: Layer | null = null;
  private scaffold: Layer | null = null;
  private tangentPlane: Layer | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      depth: true,
      stencil: false,
      // Kept so the browser check can read the frame back and compare it against
      // a prediction. It costs a little performance and buys a verifiable picture.
      preserveDrawingBuffer: true,
    });
    if (context === null) {
      throw new ShaderCompilationError(
        'WebGL2 is not available in this browser',
        'getContext("webgl2") returned null',
      );
    }
    this.gl = context;

    const source = surfaceProgramSource();
    this.program = linkProgram(context, source.vertexSource, source.fragmentSource);

    context.enable(context.DEPTH_TEST);
    context.depthFunc(context.LEQUAL);
    context.disable(context.CULL_FACE);
  }

  /** Upload a sampled surface, and the scaffolding it is drawn against. */
  setMesh(mesh: SurfaceMesh, normals: Float32Array): void {
    this.disposeLayers();
    this.surface = this.uploadSurface(mesh, normals);
    this.scaffold = this.uploadScaffold(mesh);
  }

  /** Replace only the optional tangent-plane overlay. */
  setTangentPlane(mesh: SurfaceMesh | null, normals: Float32Array | null): void {
    this.disposeLayer(this.tangentPlane);
    this.tangentPlane = mesh === null || normals === null ? null : this.uploadSurface(mesh, normals);
  }

  private uploadSurface(mesh: SurfaceMesh, normals: Float32Array): Layer | null {
    const vertexCount = mesh.columns * mesh.rows;
    if (vertexCount === 0 || mesh.index.length === 0) return null;

    const data = new Float32Array(vertexCount * STRIDE);
    for (let index = 0; index < vertexCount; index += 1) {
      const target = index * STRIDE;
      data[target] = at(mesh.positions, 3 * index);
      data[target + 1] = at(mesh.positions, 3 * index + 1);
      data[target + 2] = at(mesh.positions, 3 * index + 2);
      data[target + 3] = at(normals, 3 * index);
      data[target + 4] = at(normals, 3 * index + 1);
      data[target + 5] = at(normals, 3 * index + 2);
      data[target + 6] = at(mesh.values, index);
    }

    return this.upload(data, mesh.index, vertexCount);
  }

  /**
   * The axes and the reference grid, drawn flat.
   *
   * An `xy` plane at `z = 0` is what makes a surface readable as a graph: without
   * it there is nothing to say where the surface leaves the plane it is drawn
   * over. It is depth-tested with everything else, so a surface seen from above
   * hides the parts of the grid underneath it — which is what a grid under a
   * surface looks like.
   */
  private uploadScaffold(mesh: SurfaceMesh): Layer | null {
    const lines: number[] = [];
    const push = (x: number, y: number, z: number): void => {
      lines.push(x, y, z, 0, 0, 1, 0);
    };

    const xTicks = axisTicks(mesh.xMin, mesh.xMax).major.map((tick) => tick.value);
    const yTicks = axisTicks(mesh.yMin, mesh.yMax).major.map((tick) => tick.value);

    for (const x of xTicks) {
      push(x, mesh.yMin, 0);
      push(x, mesh.yMax, 0);
    }
    for (const y of yTicks) {
      push(mesh.xMin, y, 0);
      push(mesh.xMax, y, 0);
    }

    // The three axes, over the grid and taller than it, so they read as axes.
    const zTop = Math.max(Math.abs(mesh.zMin), Math.abs(mesh.zMax), 1);
    push(mesh.xMin, 0, 0);
    push(mesh.xMax, 0, 0);
    push(0, mesh.yMin, 0);
    push(0, mesh.yMax, 0);
    push(0, 0, mesh.zMin);
    push(0, 0, mesh.zMax === 0 ? zTop : mesh.zMax);

    return this.upload(Float32Array.from(lines), null, lines.length / STRIDE);
  }

  private upload(data: Float32Array, index: Uint32Array | null, vertexCount: number): Layer | null {
    const gl = this.gl;
    const vertexArray = gl.createVertexArray();
    const vertexBuffer = gl.createBuffer();
    const indexBuffer = index === null ? null : gl.createBuffer();
    if (vertexArray === null || vertexBuffer === null || (index !== null && indexBuffer === null)) {
      throw new ShaderCompilationError('could not allocate surface geometry', '');
    }

    gl.bindVertexArray(vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

    const bytes = STRIDE * 4;
    this.bindAttribute(vertexArray, 'aPosition', 3, bytes, 0);
    this.bindAttribute(vertexArray, 'aNormal', 3, bytes, 12);
    this.bindAttribute(vertexArray, 'aValue', 1, bytes, 24);

    if (indexBuffer !== null && index !== null) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index, gl.STATIC_DRAW);
    }

    gl.bindVertexArray(null);

    return {
      vertexArray,
      vertexBuffer,
      indexBuffer,
      vertexCount,
      indexCount: index === null ? 0 : index.length,
    };
  }

  private bindAttribute(
    vertexArray: WebGLVertexArrayObject,
    name: string,
    size: number,
    stride: number,
    offset: number,
  ): void {
    const gl = this.gl;
    const location = gl.getAttribLocation(this.program, name);
    if (location < 0) return;
    gl.bindVertexArray(vertexArray);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
  }

  draw(request: SurfaceDrawRequest): void {
    const gl = this.gl;

    if (this.canvas.width !== request.widthPixels || this.canvas.height !== request.heightPixels) {
      this.canvas.width = request.widthPixels;
      this.canvas.height = request.heightPixels;
    }

    gl.viewport(0, 0, request.widthPixels, request.heightPixels);
    gl.clearColor(PAPER_CLEAR[0], PAPER_CLEAR[1], PAPER_CLEAR[2], 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const surface = this.surface;
    const scaffold = this.scaffold;
    const tangentPlane = this.tangentPlane;
    if (surface === null && scaffold === null && tangentPlane === null) return;

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniform('uViewProjection'), false, request.viewProjection);
    gl.uniform2f(this.uniform('uScalarRange'), request.scalarRange[0], request.scalarRange[1]);
    gl.uniform3f(
      this.uniform('uLightDirection'),
      LIGHT_DIRECTION.x,
      LIGHT_DIRECTION.y,
      LIGHT_DIRECTION.z,
    );

    gl.lineWidth(SCAFFOLD_LINE_WIDTH);

    if (scaffold !== null) {
      gl.uniform1f(this.uniform('uFlat'), 1);
      gl.uniform3f(this.uniform('uFlatColor'), 0.6, 0.58, 0.54);
      gl.uniform1f(this.uniform('uOpacity'), 1);
      gl.bindVertexArray(scaffold.vertexArray);
      gl.drawArrays(gl.LINES, 0, scaffold.vertexCount);
    }

    if (surface !== null && surface.indexCount > 0) {
      gl.uniform1f(this.uniform('uFlat'), 0);
      gl.uniform1f(this.uniform('uOpacity'), 1);
      gl.bindVertexArray(surface.vertexArray);
      gl.drawElements(gl.TRIANGLES, surface.indexCount, gl.UNSIGNED_INT, 0);
    }

    if (tangentPlane !== null && tangentPlane.indexCount > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.uniform1f(this.uniform('uFlat'), 1);
      gl.uniform3f(
        this.uniform('uFlatColor'),
        TANGENT_PLANE_COLOR[0],
        TANGENT_PLANE_COLOR[1],
        TANGENT_PLANE_COLOR[2],
      );
      gl.uniform1f(this.uniform('uOpacity'), TANGENT_PLANE_OPACITY);
      gl.bindVertexArray(tangentPlane.vertexArray);
      gl.drawElements(gl.TRIANGLES, tangentPlane.indexCount, gl.UNSIGNED_INT, 0);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    gl.bindVertexArray(null);
  }

  private uniform(name: string): WebGLUniformLocation | null {
    const cached = this.locations.get(name);
    if (cached !== undefined) return cached;
    const location = this.gl.getUniformLocation(this.program, name);
    this.locations.set(name, location);
    return location;
  }

  private disposeLayers(): void {
    this.disposeLayer(this.surface);
    this.disposeLayer(this.scaffold);
    this.disposeLayer(this.tangentPlane);
    this.surface = null;
    this.scaffold = null;
    this.tangentPlane = null;
  }

  private disposeLayer(layer: Layer | null): void {
    if (layer === null) return;
    const gl = this.gl;
    gl.deleteVertexArray(layer.vertexArray);
    gl.deleteBuffer(layer.vertexBuffer);
    if (layer.indexBuffer !== null) gl.deleteBuffer(layer.indexBuffer);
  }

  dispose(): void {
    this.disposeLayers();
    this.gl.deleteProgram(this.program);
    this.locations.clear();
  }
}
