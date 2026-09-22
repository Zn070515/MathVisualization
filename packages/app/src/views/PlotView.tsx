/**
 * The plot view: a function of one real variable, drawn against t.
 *
 * This is the time-domain picture the transforms subsystem starts from. A real
 * signal is one curve; a complex-valued signal is drawn as two, the real part and
 * the imaginary part, which is the honest way to show complex values on a single
 * pair of axes.
 *
 * The vertical range is measured from the sampled values and stated, so a signal
 * that dwarfs the frame is visible as a number rather than as a surprise.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Complex, type Expr, cx, evaluateScalar, makeEnvironment } from '@mathviz/mathcore';
import { useStore } from '../state/store';
import { selectActiveExpression, type WorkspaceStore } from '../state/workspaceStore';

/** Points sampled across the visible interval. */
const SAMPLES = 900;

export function PlotView({ store }: { store: WorkspaceStore }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const state = useStore(store, (current) => current);
  const { workspace, focusedLineId } = state;
  const functions = workspace.functions;
  const active = useMemo(
    () => selectActiveExpression(workspace, focusedLineId, store.drawableKinds),
    [workspace, focusedLineId, store.drawableKinds],
  );

  const sample = useMemo(() => {
    const body: Expr | undefined = active?.entry.statement?.body;
    const bindings = active?.bindings;
    if (body === undefined || bindings === undefined) return () => null;

    const environment = makeEnvironment({
      values: [...state.parameterValues].map(([name, value]) => [name, cx(value, 0)] as const),
      functions: [...functions],
    });
    const variable = [...bindings.keys()][0];
    if (variable === undefined) return () => null;

    return (t: number): Complex | null => {
      const values = new Map(environment.values);
      values.set(variable, cx(t, 0));
      const result = evaluateScalar(body, { values, functions: environment.functions });
      return result.ok ? result.value : null;
    };
  }, [active, state.parameterValues, functions]);

  const drawable = useMemo(() => {
    const signature = active?.signature;
    if (signature === undefined) return false;
    return signature.domain.kind === 'R' && signature.domain.dim === 1;
  }, [active]);

  const isComplexValued = active?.signature.codomain.kind === 'C';

  const viewport = useMemo(() => {
    const halfWidth = state.viewport.halfWidth;
    return { tMin: state.viewport.centre.re - halfWidth, tMax: state.viewport.centre.re + halfWidth };
  }, [state.viewport]);

  const [measured, setMeasured] = useState<{ min: number; max: number } | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const context = canvas.getContext('2d');
    if (context === null) return;

    const bounds = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(bounds.width * ratio));
    const height = Math.max(1, Math.round(bounds.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = '#fdfcfa';
    context.fillRect(0, 0, width, height);

    if (!drawable) return;

    // Sample the signal.
    const samples: (Complex | null)[] = [];
    for (let index = 0; index <= SAMPLES; index += 1) {
      const t = viewport.tMin + (index / SAMPLES) * (viewport.tMax - viewport.tMin);
      samples.push(sample(t));
    }

    let min = 0;
    let max = 0;
    for (const value of samples) {
      if (value === null) continue;
      for (const component of [value.re, value.im]) {
        if (!Number.isFinite(component)) continue;
        if (component < min) min = component;
        if (component > max) max = component;
      }
    }
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const pad = (max - min) * 0.08;
    const plotMin = min - pad;
    const plotMax = max + pad;

    setMeasured((previous) =>
      previous !== null && previous.min === plotMin && previous.max === plotMax
        ? previous
        : { min: plotMin, max: plotMax },
    );

    const toX = (t: number): number =>
      ((t - viewport.tMin) / (viewport.tMax - viewport.tMin)) * width;
    const toY = (value: number): number =>
      height - ((value - plotMin) / (plotMax - plotMin)) * height;

    // Axis at zero, when zero is in view.
    if (plotMin <= 0 && plotMax >= 0) {
      context.strokeStyle = 'rgba(25, 23, 20, 0.28)';
      context.lineWidth = Math.max(1, ratio * 0.75);
      context.beginPath();
      context.moveTo(0, toY(0));
      context.lineTo(width, toY(0));
      context.stroke();
    }

    const strokeCurve = (pick: (value: Complex) => number, colour: string): void => {
      context.strokeStyle = colour;
      context.lineWidth = Math.max(1.2, ratio * 1.4);
      context.beginPath();
      let started = false;
      samples.forEach((value, index) => {
        if (value === null) {
          started = false;
          return;
        }
        const component = pick(value);
        if (!Number.isFinite(component)) {
          started = false;
          return;
        }
        const x = toX(viewport.tMin + (index / SAMPLES) * (viewport.tMax - viewport.tMin));
        const y = toY(component);
        if (started) context.lineTo(x, y);
        else {
          context.moveTo(x, y);
          started = true;
        }
      });
      context.stroke();
    };

    strokeCurve((value) => value.re, '#191714');
    if (isComplexValued) strokeCurve((value) => value.im, '#ab2f1c');

    // The shared cursor, drawn as a vertical rule at the selected t.
    const cursor = state.hover ?? state.selection;
    if (cursor !== null) {
      const x = toX(cursor.re);
      if (Number.isFinite(x) && x >= 0 && x <= width) {
        context.strokeStyle = 'rgba(171, 47, 28, 0.5)';
        context.lineWidth = Math.max(1, ratio);
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
      }
    }
  }, [drawable, isComplexValued, sample, state.hover, state.selection, viewport]);

  useEffect(() => {
    draw();
  }, [draw, state.parameterValues]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      draw();
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
    };
  }, [draw]);

  const toT = (event: { clientX: number }): number | null => {
    const canvas = canvasRef.current;
    if (canvas === null) return null;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0) return null;
    const u = (event.clientX - bounds.left) / bounds.width;
    return viewport.tMin + u * (viewport.tMax - viewport.tMin);
  };

  return (
    <div className="view">
      <canvas
        ref={canvasRef}
        className="view__canvas view__canvas--paper"
        tabIndex={0}
        role="img"
        aria-label="Time-domain plot"
        onPointerMove={(event) => {
          const t = toT(event);
          // The shared cursor is a plane coordinate; for a function of t the
          // imaginary part stays zero, so the same point still means the same
          // thing to every view.
          if (t !== null) store.setHover(cx(t, 0));
        }}
        onPointerDown={(event) => {
          const t = toT(event);
          if (t !== null) store.setSelection(cx(t, 0));
        }}
        onPointerLeave={() => {
          store.clearCursor();
        }}
        onKeyDown={(event) => {
          const step = (viewport.tMax - viewport.tMin) * 0.15;
          if (event.key === 'ArrowLeft') store.panViewport(-step, 0);
          else if (event.key === 'ArrowRight') store.panViewport(step, 0);
          else if (event.key === '+' || event.key === '=') store.zoomViewport(0.85);
          else if (event.key === '-') store.zoomViewport(1.18);
          else if (event.key === '0') store.resetViewport();
          else return;
          event.preventDefault();
        }}
      />

      {!drawable && (
        <div className="view__overlay">
          <p>
            A plot needs a function of one real variable, such as{' '}
            <span className="view__mono">f(t)=exp(-t^2)</span>.
          </p>
        </div>
      )}

      {drawable && (
        <div className="legend legend--corner">
          <span className="legend__title">
            {isComplexValued ? 'Re f(t) · Im f(t)' : 'f(t)'} over t ∈ [
            {formatBound(viewport.tMin)}, {formatBound(viewport.tMax)}]
          </span>
          {measured !== null && (
            <span className="legend__range">
              {formatBound(measured.min)} … {formatBound(measured.max)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function formatBound(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  if (Math.abs(value) >= 1000 || Math.abs(value) < 0.01) return value.toExponential(2);
  return value.toFixed(2);
}
