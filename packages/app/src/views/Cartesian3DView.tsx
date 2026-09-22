/**
 * The 3D surface view: a scalar field of two real variables, drawn as a surface.
 *
 * `f(x, y) = x² − y²` is a saddle. Drawing it as a heatmap is drawing the same
 * numbers read from above, which is useful and is not the same thing; this view is
 * what the object actually is.
 *
 * Three things decide the picture, and they are deliberately separate:
 *
 * - the **domain**, which comes from the shared viewport, so the surface covers
 *   the same region of the plane as the two-dimensional views do;
 * - the **mesh**, sampled from that domain, which is rebuilt only when the
 *   expression, its parameters or the domain change;
 * - the **camera**, which is its own, because an orbit position is not a plane
 *   rectangle and pretending otherwise would be a lie.
 *
 * Orbiting therefore does not re-sample anything. It rewrites a matrix and redraws
 * the geometry that is already uploaded, which is what makes dragging smooth even
 * though the field is evaluated sixteen thousand times to build the mesh.
 *
 * The picture is drawn on two stacked canvases: the surface and its scaffolding in
 * WebGL, and the numbers — tick labels, the axis names, the cursor — on a
 * transparent 2D canvas above it. WebGL has no text, and building one is a tar pit;
 * the labels are also sharper drawn by the 2D context, and only the text floats, so
 * the occlusion between the surface and the grid is still done by the depth buffer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  axisTicks,
  cx,
  displayNumberToText,
  sampleSurface,
  surfaceNormals,
  type SurfaceMesh,
} from '@mathviz/mathcore';
import { AXIS_NAME_FONT, drawDisplayNumber, TICK_FONT } from '../render/canvasText';
import { CANVAS_COLORS, prepareCanvas2d, pixelSize } from '../render/canvasSurface';
import { cameraViewProjection, frameScene } from '../render/camera3d';
import { projectToScreen } from '../render/matrix';
import { webgl2Available } from '../render/shaderProgram';
import { SurfaceRenderer } from '../render/surfaceRenderer';
import { viewNumber } from '../display/numbers';
import { NumberText } from '../display/NumberText';
import { useStore } from '../state/store';
import { selectActiveExpression, type ViewRendererProps } from '../state/workspaceStore';
import { makePointEvaluation } from './evaluation';
import { useResizeVersion } from './useResizeVersion';

/**
 * Vertices along each axis of the domain.
 *
 * A hundred and twenty-nine rather than a hundred and twenty-eight, so that the
 * grid has a vertex exactly at the centre of an odd count of intervals and lands
 * on round coordinates like 0 when the domain is symmetric.
 */
const RESOLUTION = 129;

/** Radians of rotation per pixel dragged. */
const ORBIT_PER_PIXEL = 0.008;

/** How close to a projected vertex the pointer has to be to pick it, in pixels. */
const PICK_RADIUS = 18;

/** How far apart two labels have to be before both are drawn. */
const LABEL_CLEARANCE_X = 30;
const LABEL_CLEARANCE_Y = 13;

export function Cartesian3DView({ store }: ViewRendererProps): React.JSX.Element {
  const surfaceRef = useRef<HTMLCanvasElement>(null);
  const labelRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SurfaceRenderer | null>(null);
  const dragRef = useRef<{ x: number; y: number; panning: boolean } | null>(null);
  /** Projected vertices, in device pixels, rebuilt whenever the camera moves. */
  const projectedRef = useRef<Float32Array | null>(null);

  const resizeVersion = useResizeVersion(surfaceRef);
  const state = useStore(store, (current) => current);
  const { workspace, focusedLineId } = state;
  const functions = workspace.functions;

  const [ready, setReady] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);

  const active = useMemo(
    () => selectActiveExpression(workspace, focusedLineId, store.drawableKinds),
    [workspace, focusedLineId, store.drawableKinds],
  );

  const evaluation = useMemo(
    () => makePointEvaluation(active, state.parameterValues, functions),
    [active, state.parameterValues, functions],
  );

  /** A surface is a scalar over the plane, and nothing else is one. */
  const drawable = useMemo(() => {
    const signature = active?.signature;
    if (signature === undefined) return false;
    return (
      signature.domain.kind === 'R' &&
      signature.domain.dim === 2 &&
      signature.codomain.kind === 'R' &&
      signature.codomain.dim === 1
    );
  }, [active]);

  /**
   * The domain, as a square from the shared viewport.
   *
   * Square rather than canvas-shaped, and taken from the same centre and
   * half-width the plane views use: what the surface covers is then the same
   * region of the plane the other views are showing, which is what "linked" has
   * to mean. The canvas shape is the camera's business instead.
   */
  const domain = useMemo(() => {
    const half = state.viewport.halfWidth;
    return {
      xMin: state.viewport.centre.re - half,
      xMax: state.viewport.centre.re + half,
      yMin: state.viewport.centre.im - half,
      yMax: state.viewport.centre.im + half,
    };
  }, [state.viewport]);

  const mesh = useMemo((): SurfaceMesh | null => {
    if (!drawable || evaluation === null) return null;
    return sampleSurface((x, y) => evaluation.evaluate({ re: x, im: y }), {
      ...domain,
      columns: RESOLUTION,
      rows: RESOLUTION,
    });
  }, [drawable, evaluation, domain]);

  const normals = useMemo(() => (mesh === null ? null : surfaceNormals(mesh)), [mesh]);

  /**
   * The radius of the scene, which is what the camera has to fit.
   *
   * Taken from the bounding box including the height, because for a field like
   * `x² − y²` the height is the largest dimension by far and framing only the
   * domain would leave the camera inside the surface.
   */
  const sceneRadius = useMemo(() => {
    if (mesh === null) return 1;
    const halfX = Math.max(Math.abs(mesh.xMin), Math.abs(mesh.xMax));
    const halfY = Math.max(Math.abs(mesh.yMin), Math.abs(mesh.yMax));
    const halfZ = Math.max(Math.abs(mesh.zMin), Math.abs(mesh.zMax));
    return Math.max(Math.hypot(halfX, halfY, halfZ), 1e-6);
  }, [mesh]);

  // Frame the scene when it changes size, and only then.
  //
  // The camera is read from the store rather than from the render, so that it is
  // the *current* one at the moment the scene changed and so that the camera is
  // not a dependency — which it must not be, or a deliberate dolly would be undone
  // on the next render.
  useEffect(() => {
    if (mesh === null) return;
    store.setCamera3d(frameScene(store.getState().camera3d, sceneRadius));
  }, [mesh, sceneRadius, store]);

  // The renderer exists once. The program is fixed, so nothing about it depends on
  // the expression.
  useEffect(() => {
    const canvas = surfaceRef.current;
    if (canvas === null) return;
    if (!webgl2Available()) {
      setFailure('This browser does not provide WebGL2, so a surface cannot be drawn.');
      return;
    }
    try {
      rendererRef.current = new SurfaceRenderer(canvas);
      setReady((current) => current + 1);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'the renderer could not start');
      return;
    }
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  // Upload the geometry when it changes — and only then, which is the whole
  // reason the mesh is a separate memo from the camera.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (renderer === null || mesh === null || normals === null) return;
    try {
      renderer.setMesh(mesh, normals);
      setFailure(null);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'the surface could not be built');
    }
  }, [ready, mesh, normals]);

  const draw = useCallback(() => {
    const surface = surfaceRef.current;
    const labels = labelRef.current;
    const renderer = rendererRef.current;
    if (surface === null || labels === null || renderer === null) return;

    const { width, height } = pixelSize(surface);
    const camera = state.camera3d;
    const viewProjection = cameraViewProjection(camera, width, height);

    renderer.draw({
      viewProjection,
      scalarRange: [mesh?.zMin ?? -1, mesh?.zMax ?? 1],
      widthPixels: width,
      heightPixels: height,
    });

    // Project every vertex once. The picking and the labels both read this, so
    // they cannot disagree about where a point is on the screen.
    const projected = mesh === null ? null : new Float32Array(2 * mesh.columns * mesh.rows);
    if (mesh !== null && projected !== null) {
      for (let index = 0; index < mesh.columns * mesh.rows; index += 1) {
        const point = projectToScreen(
          {
            x: mesh.positions[3 * index] ?? 0,
            y: mesh.positions[3 * index + 1] ?? 0,
            z: mesh.positions[3 * index + 2] ?? 0,
          },
          viewProjection,
          width,
          height,
        );
        projected[2 * index] = point.visible ? point.x : Number.NaN;
        projected[2 * index + 1] = point.visible ? point.y : Number.NaN;
      }
    }
    projectedRef.current = projected;

    const prepared = prepareCanvas2d(labels, { fill: false });
    if (prepared === null || mesh === null) return;
    const { context } = prepared;

    // The axis numbers, de-duplicated in screen space rather than along an axis,
    // because projected ticks are not in any order.
    const drawn: { x: number; y: number }[] = [];
    const roomFor = (x: number, y: number): boolean => {
      if (x < 4 || x > width - 4 || y < 4 || y > height - 4) return false;
      for (const other of drawn) {
        if (
          Math.abs(other.x - x) < LABEL_CLEARANCE_X &&
          Math.abs(other.y - y) < LABEL_CLEARANCE_Y
        ) {
          return false;
        }
      }
      drawn.push({ x, y });
      return true;
    };

    const xTicks = axisTicks(mesh.xMin, mesh.xMax).major;
    for (const tick of xTicks) {
      const at = projectToScreen(
        { x: tick.value, y: mesh.yMin, z: 0 },
        viewProjection,
        width,
        height,
      );
      if (!at.visible || !roomFor(at.x, at.y)) continue;
      drawDisplayNumber(context, tick.label, at.x, at.y, {
        align: 'center',
        baseline: 'top',
        color: CANVAS_COLORS.tickLabel,
        font: TICK_FONT,
      });
    }
    const yTicks = axisTicks(mesh.yMin, mesh.yMax).major;
    for (const tick of yTicks) {
      const at = projectToScreen(
        { x: mesh.xMin, y: tick.value, z: 0 },
        viewProjection,
        width,
        height,
      );
      if (!at.visible || !roomFor(at.x, at.y)) continue;
      drawDisplayNumber(context, tick.label, at.x, at.y, {
        align: 'right',
        baseline: 'middle',
        color: CANVAS_COLORS.tickLabel,
        font: TICK_FONT,
      });
    }
    const zTicks = axisTicks(mesh.zMin, mesh.zMax).major;
    for (const tick of zTicks) {
      if (tick.value === 0) continue;
      const at = projectToScreen({ x: 0, y: 0, z: tick.value }, viewProjection, width, height);
      if (!at.visible || !roomFor(at.x, at.y)) continue;
      drawDisplayNumber(context, tick.label, at.x, at.y, {
        align: 'left',
        baseline: 'middle',
        color: CANVAS_COLORS.tickLabel,
        font: TICK_FONT,
      });
    }

    // The axis names, at the far end of each axis.
    context.fillStyle = CANVAS_COLORS.axisName;
    context.font = `${AXIS_NAME_FONT.size}px ${AXIS_NAME_FONT.family}`;
    context.textAlign = 'center';
    context.textBaseline = 'top';
    const names: [string, { x: number; y: number; z: number }][] = [
      ['x', { x: mesh.xMax, y: mesh.yMin, z: 0 }],
      ['y', { x: mesh.xMin, y: mesh.yMax, z: 0 }],
      ['z', { x: 0, y: 0, z: Math.max(mesh.zMax, 1) }],
    ];
    for (const [name, corner] of names) {
      const at = projectToScreen(corner, viewProjection, width, height);
      if (!at.visible) continue;
      context.fillText(name, at.x, at.y);
    }

    // The shared cursor, as the sample it landed on. Marking the vertex rather
    // than an interpolated point is honest about what is being pointed at: this is
    // a sample of the surface, not a mathematical point on it.
    const cursor = state.hover ?? state.selection;
    if (cursor !== null) {
      const at = projectToScreen(
        { x: cursor.re, y: cursor.im, z: 0 },
        viewProjection,
        width,
        height,
      );
      if (at.visible) {
        context.beginPath();
        context.arc(at.x, at.y, Math.max(3, prepared.ratio * 3.5), 0, Math.PI * 2);
        context.strokeStyle = CANVAS_COLORS.curveSecondary;
        context.lineWidth = Math.max(1.5, prepared.ratio * 1.6);
        context.stroke();
      }
    }
  }, [mesh, state.camera3d, state.hover, state.selection]);

  useEffect(() => {
    draw();
  }, [draw, ready, resizeVersion]);

  /** The vertex nearest the pointer, in device pixels, or null. */
  const vertexNear = (event: { clientX: number; clientY: number }): number | null => {
    const canvas = surfaceRef.current;
    const projected = projectedRef.current;
    if (canvas === null || projected === null || mesh === null) return null;

    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0) return null;
    const ratio = canvas.width / bounds.width;
    const x = (event.clientX - bounds.left) * ratio;
    const y = (event.clientY - bounds.top) * ratio;

    const radius = PICK_RADIUS * ratio;
    const radiusSquared = radius * radius;
    let best = -1;
    let bestDistance = radiusSquared;
    const count = mesh.columns * mesh.rows;
    for (let index = 0; index < count; index += 1) {
      if (mesh.defined[index] === 0) continue;
      const dx = (projected[2 * index] ?? Number.NaN) - x;
      const dy = (projected[2 * index + 1] ?? Number.NaN) - y;
      const distance = dx * dx + dy * dy;
      if (Number.isFinite(distance) && distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    return best < 0 ? null : best;
  };

  const hoverAt = (event: { clientX: number; clientY: number }): void => {
    const index = vertexNear(event);
    if (index === null || mesh === null) return;
    // The *domain* point, so the cursor stays a coordinate of the plane and the
    // height is read out of the function rather than carried around as state.
    store.setHover(cx(mesh.positions[3 * index] ?? 0, mesh.positions[3 * index + 1] ?? 0));
  };

  return (
    <div className="view">
      <canvas
        ref={surfaceRef}
        className="view__canvas view__canvas--paper"
        tabIndex={0}
        role="img"
        aria-label={
          mesh === null
            ? 'A surface over the plane'
            : `A surface over x and y from ${displayNumberToText(
                viewNumber(mesh.xMin),
              )} to ${displayNumberToText(viewNumber(mesh.xMax))}, with z from ${displayNumberToText(
                viewNumber(mesh.zMin),
              )} to ${displayNumberToText(viewNumber(mesh.zMax))}`
        }
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            x: event.clientX,
            y: event.clientY,
            panning: event.shiftKey || event.button === 2,
          };
        }}
        onPointerMove={(event) => {
          const start = dragRef.current;
          if (start === null) {
            hoverAt(event);
            return;
          }
          const deltaX = event.clientX - start.x;
          const deltaY = event.clientY - start.y;
          const height = surfaceRef.current?.getBoundingClientRect().height ?? 0;
          if (start.panning) {
            store.panCamera(deltaX, deltaY, height);
          } else {
            store.orbitCamera(-deltaX * ORBIT_PER_PIXEL, deltaY * ORBIT_PER_PIXEL);
          }
          dragRef.current = { ...start, x: event.clientX, y: event.clientY };
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onPointerLeave={() => {
          dragRef.current = null;
          store.clearCursor();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
        }}
        onWheel={(event) => {
          store.dollyCamera(Math.exp(event.deltaY * 0.0015));
        }}
        onKeyDown={(event) => {
          const orbitStep = 0.09;
          switch (event.key) {
            case 'ArrowLeft':
              store.orbitCamera(-orbitStep, 0);
              break;
            case 'ArrowRight':
              store.orbitCamera(orbitStep, 0);
              break;
            case 'ArrowUp':
              store.orbitCamera(0, orbitStep);
              break;
            case 'ArrowDown':
              store.orbitCamera(0, -orbitStep);
              break;
            case '+':
            case '=':
              store.dollyCamera(0.85);
              break;
            case '-':
              store.dollyCamera(1.18);
              break;
            case '0':
              store.resetCamera3d();
              break;
            default:
              return;
          }
          event.preventDefault();
        }}
      />

      {/* Labels and the cursor, over the surface and transparent. */}
      <canvas ref={labelRef} className="view__canvas view__canvas--overlay" aria-hidden="true" />

      {failure !== null && (
        <div className="view__overlay">
          <p className="view__problem">{failure}</p>
        </div>
      )}

      {failure === null && !drawable && (
        <div className="view__overlay">
          <p>
            A surface needs a scalar field of two variables, such as{' '}
            <span className="view__mono">f(x,y)=x^2-y^2</span>.
          </p>
        </div>
      )}

      {failure === null && drawable && mesh !== null && (
        <div className="legend legend--corner">
          <span className="legend__title">z = f(x, y)</span>
          <span className="legend__range">
            z ∈ [<NumberText value={viewNumber(mesh.zMin)} />,{' '}
            <NumberText value={viewNumber(mesh.zMax)} />]
          </span>
          <span className="legend__range">drag to orbit · shift-drag to pan · wheel to zoom</span>
        </div>
      )}
    </div>
  );
}
