/**
 * The mapped-grid view: the CPU path.
 *
 * Draws the image of the plane's coordinate grid under the function. This is the
 * oldest picture in complex analysis and still the clearest way to see what a map
 * does: where the grid squares stay square, the map is conformal; where they
 * collapse or fold, something else is happening.
 *
 * It runs on the CPU, through the numerical evaluator, and that is deliberate
 * rather than a shortcut. The GPU path evaluates a function at a pixel; this view
 * needs a *polyline*, which means following a curve through the map, and a
 * fragment shader cannot do that. Having both paths also means the mapped grid
 * doubles as an independent check on the shader: the two agree on any point where
 * both are sampled.
 *
 * The output plane is auto-fitted to the image, and the fit is reported, because a
 * map that sends the plane to a small region and one that sends it to a huge region
 * look identical if the frame silently rescales.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Complex } from '@mathviz/mathcore';
import { prepareCanvas2d } from '../render/canvasSurface';
import { NumberText } from '../display/NumberText';
import { viewNumber } from '../display/numbers';
import { useStore } from '../state/store';
import {
  selectActiveExpression,
  type ViewSpec,
  type WorkspaceStore,
} from '../state/workspaceStore';
import { makePointEvaluation } from './evaluation';
import { useResizeVersion } from './useResizeVersion';

/** Points sampled along each grid line before mapping. */
const SAMPLES_PER_LINE = 160;
/** Grid lines drawn on each side of the origin. */
const LINES_EACH_SIDE = 6;
/** How far beyond the fitted image the frame extends, as a fraction. */
const FIT_MARGIN = 0.12;

interface Bounds {
  minRe: number;
  maxRe: number;
  minIm: number;
  maxIm: number;
}

export function MappedGridView({
  store,
  view,
}: {
  store: WorkspaceStore;
  view: ViewSpec;
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resizeVersion = useResizeVersion(canvasRef);
  const state = useStore(store, (current) => current);
  const { workspace, focusedLineId } = state;
  const functions = workspace.functions;
  const active = useMemo(
    () => selectActiveExpression(workspace, focusedLineId, store.drawableKinds),
    [workspace, focusedLineId, store.drawableKinds],
  );

  // Only a function of one complex variable has a meaningful plane image; a
  // scalar field of two real ones does not, and neither does a real signal.
  const drawable = active?.signature.domain.kind === 'C';
  const evaluation = useMemo(
    () => (drawable ? makePointEvaluation(active, state.parameterValues, functions) : null),
    [active, drawable, state.parameterValues, functions],
  );

  const [fit, setFit] = useState<Bounds | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const surface = prepareCanvas2d(canvas);
    if (surface === null) return;
    const { context, width, height, ratio } = surface;

    if (!drawable || evaluation === null) return;

    // Build the image of the grid.
    const lines: { points: Complex[]; weight: number }[] = [];
    for (let index = -LINES_EACH_SIDE; index <= LINES_EACH_SIDE; index += 1) {
      const horizontal: Complex[] = [];
      const vertical: Complex[] = [];
      for (let step = 0; step <= SAMPLES_PER_LINE; step += 1) {
        const t = -LINES_EACH_SIDE + (step / SAMPLES_PER_LINE) * 2 * LINES_EACH_SIDE;
        const alongReal = evaluation.valueAt({ re: t, im: index });
        const alongImaginary = evaluation.valueAt({ re: index, im: t });
        if (alongReal !== null) horizontal.push(alongReal);
        if (alongImaginary !== null) vertical.push(alongImaginary);
      }
      // Axis lines are emphasised; index 0 is the real and imaginary axis.
      const weight = index === 0 ? 1 : 0.42;
      if (horizontal.length > 1) lines.push({ points: horizontal, weight });
      if (vertical.length > 1) lines.push({ points: vertical, weight });
    }

    const fitted = fitBounds(lines.flatMap((line) => line.points));
    if (fitted === null) return;
    const padded = padBounds(fitted, FIT_MARGIN);

    setFit((previous) =>
      previous !== null &&
      previous.minRe === padded.minRe &&
      previous.maxRe === padded.maxRe &&
      previous.minIm === padded.minIm &&
      previous.maxIm === padded.maxIm
        ? previous
        : padded,
    );

    const toScreen = (point: Complex): [number, number] => [
      ((point.re - padded.minRe) / (padded.maxRe - padded.minRe)) * width,
      height - ((point.im - padded.minIm) / (padded.maxIm - padded.minIm)) * height,
    ];

    // The image of the grid.
    context.lineWidth = Math.max(1, ratio * 0.75);
    for (const line of lines) {
      context.strokeStyle = line.weight === 1 ? 'rgba(25, 23, 20, 0.55)' : 'rgba(25, 23, 20, 0.2)';
      context.beginPath();
      let started = false;
      for (const point of line.points) {
        const [x, y] = toScreen(point);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          started = false;
          continue;
        }
        if (started) context.lineTo(x, y);
        else {
          context.moveTo(x, y);
          started = true;
        }
      }
      context.stroke();
    }

    // The shared cursor, mapped, so the two planes are visibly linked.
    const cursor = state.hover ?? state.selection;
    if (cursor !== null) {
      const image = evaluation.valueAt(cursor);
      if (image !== null) {
        const [x, y] = toScreen(image);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          context.beginPath();
          context.arc(x, y, Math.max(2, ratio * 2.5), 0, Math.PI * 2);
          context.fillStyle = '#ab2f1c';
          context.fill();
        }
      }
    }
  }, [drawable, evaluation, state.hover, state.selection]);

  // The viewport is deliberately not a dependency: this view frames itself on the
  // image of the grid, so panning or zooming the plane changes nothing here.
  useEffect(() => {
    draw();
  }, [draw, resizeVersion, view.id]);

  return (
    <div className="view">
      <canvas
        ref={canvasRef}
        className="view__canvas view__canvas--paper"
        role="img"
        aria-label="Image of the coordinate grid under the function"
      />

      {!drawable && (
        <div className="view__overlay">
          <p>
            A mapped grid needs a function of one complex variable, such as{' '}
            <span className="view__mono">f(z)=z^2</span>.
          </p>
        </div>
      )}

      {drawable && (
        <div className="legend legend--corner">
          <span className="legend__title">w-plane · image of the grid</span>
          {fit !== null && (
            <span className="legend__range">
              Re <NumberText value={viewNumber(fit.minRe)} />…
              <NumberText value={viewNumber(fit.maxRe)} />
              {'  '}Im <NumberText value={viewNumber(fit.minIm)} />…
              <NumberText value={viewNumber(fit.maxIm)} />
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Frame the image of the grid.
 *
 * The frame covers the whole image, and the range is reported on the picture. A
 * trimmed fit was tried and rejected: for a function like `exp`, whose image of a
 * modest grid genuinely spans five orders of magnitude, no percentile choice makes
 * the picture legible — the scale range *is* the structure — and trimming would
 * silently omit part of the image while the legend implied it was complete. A
 * complete frame that is dense is more honest than a partial frame that is pretty.
 *
 * The limitation is real and is disclosed rather than hidden: this view auto-fits
 * and cannot yet be zoomed, so a scale-spanning map is drawn compressed. See the
 * capability list.
 */
function fitBounds(points: readonly Complex[]): Bounds | null {
  let minRe = Infinity;
  let maxRe = -Infinity;
  let minIm = Infinity;
  let maxIm = -Infinity;

  for (const point of points) {
    if (!Number.isFinite(point.re) || !Number.isFinite(point.im)) continue;
    if (point.re < minRe) minRe = point.re;
    if (point.re > maxRe) maxRe = point.re;
    if (point.im < minIm) minIm = point.im;
    if (point.im > maxIm) maxIm = point.im;
  }

  if (!Number.isFinite(minRe) || !Number.isFinite(maxRe)) return null;
  // Keep the aspect square so the map is not distorted by the frame.
  const span = Math.max(maxRe - minRe, maxIm - minIm, 1e-9);
  const centreRe = (minRe + maxRe) / 2;
  const centreIm = (minIm + maxIm) / 2;
  return {
    minRe: centreRe - span / 2,
    maxRe: centreRe + span / 2,
    minIm: centreIm - span / 2,
    maxIm: centreIm + span / 2,
  };
}

function padBounds(bounds: Bounds, fraction: number): Bounds {
  const padRe = (bounds.maxRe - bounds.minRe) * fraction;
  const padIm = (bounds.maxIm - bounds.minIm) * fraction;
  return {
    minRe: bounds.minRe - padRe,
    maxRe: bounds.maxRe + padRe,
    minIm: bounds.minIm - padIm,
    maxIm: bounds.maxIm + padIm,
  };
}
