/**
 * The field view: the GPU path.
 *
 * Draws whatever the active expression defines, by compiling the canonical AST to
 * a fragment shader once per expression and thereafter only updating uniforms. The
 * mode uniform selects domain colouring or a scalar projection, so one program
 * serves every mode and switching mode never recompiles.
 *
 * The scalar range is measured on the CPU by sampling the visible region through
 * the *same* evaluator the readout uses. That keeps the two consistent: the colour
 * a pixel gets and the number printed for it come from one piece of mathematics.
 *
 * Pointer interaction, all in plane coordinates:
 * - dragging pans, the wheel zooms about the pointer,
 * - moving the pointer sets the shared cursor,
 * - clicking without dragging sets the shared selection.
 *
 * Because the shared state is a plane coordinate, a point selected here is the same
 * point in every other view (GOAL.md 5.3).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type Complex,
  type FieldMode,
  type GlslProgram,
  type ScalarRange,
  FIELD_MODE_INDEX,
  cx,
  fieldColor,
  lowerToDomainColoringProgram,
  niceStep,
  rgbToCss,
} from '@mathviz/mathcore';
import { pixelSize } from '../render/canvasSurface';
import { FieldRenderer } from '../render/fieldRenderer';
import { ShaderCompilationError, webgl2Available } from '../render/shaderProgram';
import { NumberText } from '../display/NumberText';
import { viewNumber } from '../display/numbers';
import { useStore } from '../state/store';
import {
  loweringOptionsFor,
  selectActiveExpression,
  type ViewSpec,
  type Viewport,
  type WorkspaceStore,
} from '../state/workspaceStore';
import { handleCameraKey } from './cameraKeys';
import { makePointEvaluation } from './evaluation';
import { useResizeVersion } from './useResizeVersion';
import { fromScreen, planeWindow } from './window2d';

/** Samples per axis when measuring the range of a scalar field on the CPU. */
const MEASUREMENT_RESOLUTION = 48;

const DEFAULT_RANGE: ScalarRange = { min: -1, max: 1 };

export interface FieldViewProps {
  readonly store: WorkspaceStore;
  readonly view: ViewSpec;
}

export function FieldView({ store, view }: FieldViewProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resizeVersion = useResizeVersion(canvasRef);
  const rendererRef = useRef<FieldRenderer | null>(null);
  const dragging = useRef<{ x: number; y: number } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  /** Half-height in plane units, kept so overlays can be placed without re-measuring. */
  const [halfHeight, setHalfHeight] = useState(2.4);

  const state = useStore(store, (current) => current);
  const { workspace, focusedLineId } = state;
  const functions = workspace.functions;

  // The active expression, and therefore the shader built from it, depends on the
  // workspace and the focus — and on nothing else. Depending on the whole state
  // would re-lower the shader every time the pointer moved.
  const active = useMemo(
    () => selectActiveExpression(workspace, focusedLineId, store.drawableKinds),
    [workspace, focusedLineId, store.drawableKinds],
  );

  // A field view needs a function of the plane: a complex function, or a scalar
  // field of two real variables. A function of a single real variable belongs to
  // the plot view, and saying so is better than drawing something meaningless.
  const drawable = useMemo((): boolean => {
    const signature = active?.signature;
    if (signature === undefined) return false;
    if (signature.domain.kind === 'C') return true;
    return signature.domain.dim === 2;
  }, [active]);

  const program = useMemo((): GlslProgram | null => {
    const lowering = loweringOptionsFor(active);
    const body = active?.entry.statement?.body;
    if (body === undefined || lowering === null) return null;
    const result = lowerToDomainColoringProgram(body, lowering);
    return result.ok ? result.value : null;
  }, [active]);

  const evaluation = useMemo(
    () => makePointEvaluation(active, state.parameterValues, functions),
    [active, state.parameterValues, functions],
  );

  const range = useMemo((): ScalarRange => {
    if (view.mode === 'phase') return { min: -Math.PI, max: Math.PI };
    if (!drawable || evaluation === null) return DEFAULT_RANGE;
    return measureRange(evaluation.valueAt, state.viewport, view.mode, halfHeight);
  }, [drawable, evaluation, state.viewport, view.mode, halfHeight]);

  // Compile once per expression.
  useEffect(() => {
    if (!webgl2Available()) {
      setFailure('This browser does not provide WebGL2, so field views cannot be drawn.');
      return;
    }
    const canvas = canvasRef.current;
    if (canvas === null) return;

    if (rendererRef.current === null) {
      try {
        rendererRef.current = new FieldRenderer(canvas);
      } catch (error) {
        setFailure(error instanceof Error ? error.message : 'the renderer could not start');
        return;
      }
    }

    if (program === null) {
      setFailure(null);
      return;
    }

    try {
      rendererRef.current.setProgram(program);
      setFailure(null);
    } catch (error) {
      setFailure(
        error instanceof ShaderCompilationError
          ? `The GPU could not compile this expression: ${error.message}.`
          : error instanceof Error
            ? error.message
            : 'the shader could not be built',
      );
    }
  }, [program]);

  useEffect(() => {
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  // Draw whenever anything the picture depends on changes — including the size of
  // the canvas, which the renderer needs in order to size its backing store.
  useEffect(() => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (canvas === null || renderer === null || program === null || failure !== null) return;
    if (!drawable) return;

    const { width: widthPixels, height: heightPixels } = pixelSize(canvas);
    const nextHalfHeight = state.viewport.halfWidth * (heightPixels / widthPixels);
    if (Math.abs(nextHalfHeight - halfHeight) > 1e-9) setHalfHeight(nextHalfHeight);

    try {
      renderer.draw({
        centerX: state.viewport.centre.re,
        centerY: state.viewport.centre.im,
        halfWidth: state.viewport.halfWidth,
        halfHeight: nextHalfHeight,
        widthPixels,
        heightPixels,
        mode: FIELD_MODE_INDEX[view.mode],
        scalarRange: [range.min, range.max],
        grid: true,
        axes: true,
        // The grid the shader draws and the ticks an axis would carry come from
        // one ladder, so they cannot disagree about where a unit is.
        gridSpacing: niceStep(state.viewport.halfWidth * 2),
        phaseContours: true,
        modulusBands: true,
        parameterValues: state.parameterValues,
      });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'the frame could not be drawn');
    }
  }, [
    program,
    failure,
    drawable,
    range,
    state.viewport,
    state.parameterValues,
    view.mode,
    halfHeight,
    resizeVersion,
  ]);

  const toPlane = useCallback(
    (event: { clientX: number; clientY: number }): Complex | null => {
      const canvas = canvasRef.current;
      if (canvas === null) return null;
      const bounds = canvas.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0) return null;
      const window = planeWindow(state.viewport, bounds.width, bounds.height);
      const point = fromScreen(
        window,
        { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        bounds.width,
        bounds.height,
      );
      return cx(point.x, point.y);
    },
    [state.viewport],
  );

  const cursorPoint = state.hover ?? state.selection;

  return (
    <div className="view">
      <canvas
        ref={canvasRef}
        className="view__canvas"
        tabIndex={0}
        role="img"
        aria-label={`Field view, ${view.mode} mode`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragging.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerMove={(event) => {
          const point = toPlane(event);
          store.setHover(point);

          const start = dragging.current;
          if (start === null || point === null) return;
          const canvas = canvasRef.current;
          if (canvas === null) return;
          const unitsPerPixel =
            (2 * state.viewport.halfWidth) / Math.max(1, canvas.getBoundingClientRect().width);
          store.panViewport(
            -(event.clientX - start.x) * unitsPerPixel,
            (event.clientY - start.y) * unitsPerPixel,
          );
          dragging.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={(event) => {
          const start = dragging.current;
          dragging.current = null;
          if (start === null) return;
          const travelled = Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y);
          if (travelled > 3) return; // A pan, not a click.
          store.setSelection(toPlane(event));
        }}
        onPointerLeave={() => {
          dragging.current = null;
          store.clearCursor();
        }}
        onWheel={(event) => {
          store.zoomViewport(Math.exp(event.deltaY * 0.0015), toPlane(event) ?? undefined);
        }}
        onKeyDown={(event) => {
          handleCameraKey(event, store);
        }}
      />

      {failure !== null && (
        <div className="view__overlay">
          <p className="view__problem">{failure}</p>
        </div>
      )}

      {failure === null && active === null && (
        <div className="view__overlay">
          <p>Nothing to draw yet. Write an expression this subsystem can draw.</p>
        </div>
      )}

      {failure === null && active !== null && !drawable && (
        <div className="view__overlay">
          <p>
            <span className="view__mono">{active.entry.source}</span> is a function of one real
            variable. A field view shows a function of the plane; this one belongs in the plot view.
          </p>
        </div>
      )}

      {drawable && failure === null && cursorPoint !== null && (
        <Crosshair point={cursorPoint} viewport={state.viewport} halfHeight={halfHeight} />
      )}

      <Legend mode={view.mode} range={range} />
    </div>
  );
}

/**
 * Measure the range of a scalar over the visible region.
 *
 * Sampling on the CPU rather than on the GPU keeps the colour scale tied to the
 * same evaluator as the readout, and means the range is a number the interface can
 * state rather than an artefact of the shader.
 */
function measureRange(
  valueAt: (point: Complex) => Complex | null,
  viewport: Viewport,
  mode: FieldMode,
  halfHeight: number,
): ScalarRange {
  let min = Infinity;
  let max = -Infinity;

  for (let row = 0; row < MEASUREMENT_RESOLUTION; row += 1) {
    for (let column = 0; column < MEASUREMENT_RESOLUTION; column += 1) {
      const point = cx(
        viewport.centre.re +
          ((column + 0.5) / MEASUREMENT_RESOLUTION - 0.5) * 2 * viewport.halfWidth,
        viewport.centre.im + ((row + 0.5) / MEASUREMENT_RESOLUTION - 0.5) * 2 * halfHeight,
      );
      const value = valueAt(point);
      if (value === null) continue;

      const scalar = project(value, mode);
      if (scalar === null || !Number.isFinite(scalar)) continue;
      if (scalar < min) min = scalar;
      if (scalar > max) max = scalar;
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return DEFAULT_RANGE;
  // A constant field has no range; give the ramp something to span.
  if (min === max) return { min: min - 1, max: max + 1 };
  return { min, max };
}

/** The real quantity a mode shades, or null for domain colouring. */
function project(value: Complex, mode: FieldMode): number | null {
  switch (mode) {
    case 'complex':
      return null;
    case 'magnitude':
      return Math.hypot(value.re, value.im);
    case 'phase':
      return Math.atan2(value.im, value.re);
    case 'real':
      return value.re;
    case 'imaginary':
      return value.im;
  }
}

function Crosshair({
  point,
  viewport,
  halfHeight,
}: {
  point: Complex;
  viewport: Viewport;
  halfHeight: number;
}): React.JSX.Element | null {
  const left = 50 + ((point.re - viewport.centre.re) / (2 * viewport.halfWidth)) * 100;
  const top = 50 - ((point.im - viewport.centre.im) / (2 * halfHeight)) * 100;
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  return (
    <div className="crosshair" style={{ left: `${left}%`, top: `${top}%` }} aria-hidden="true" />
  );
}

/** What the colours mean, stated on the picture rather than in a manual. */
function Legend({ mode, range }: { mode: FieldMode; range: ScalarRange }): React.JSX.Element {
  if (mode === 'complex') {
    return (
      <div className="legend">
        <span className="legend__title">arg → hue · |w| → brightness</span>
        <span className="legend__row">
          <span className="legend__swatch legend__swatch--zero" />
          <span className="legend__label">zero</span>
          <span className="legend__swatch legend__swatch--pole" />
          <span className="legend__label">pole</span>
          <span className="legend__swatch legend__swatch--undefined" />
          <span className="legend__label">undefined</span>
        </span>
      </div>
    );
  }

  return (
    <div className="legend">
      <span className="legend__title">{mode === 'magnitude' ? 'log(1 + |w|)' : `${mode} w`}</span>
      <span className="legend__ramp" aria-hidden="true">
        {Array.from({ length: 48 }, (_, index) => {
          const t = index / 47;
          const probe =
            mode === 'magnitude'
              ? cx(Math.exp(t * Math.log(1 + Math.max(0, range.max))) - 1, 0)
              : cx(range.min + t * (range.max - range.min), 0);
          return (
            <span key={index} style={{ background: rgbToCss(fieldColor(probe, mode, range)) }} />
          );
        })}
      </span>
      <span className="legend__range">
        {mode === 'phase' ? (
          '−π … π'
        ) : (
          <>
            <NumberText value={viewNumber(range.min)} /> …{' '}
            <NumberText value={viewNumber(range.max)} />
          </>
        )}
      </span>
    </div>
  );
}
