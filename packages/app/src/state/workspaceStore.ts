/**
 * The interaction state of one subsystem.
 *
 * This is where "linked views" is implemented, and it is implemented as data
 * rather than as wiring: there is one `hover` and one `selection` in the state,
 * and every view reads them. A view cannot have a private cursor, because there
 * is nowhere to put one. That is the whole mechanism, and it is what makes the
 * behaviour testable without rendering anything (GOAL.md 5.3, 24).
 *
 * Everything mathematical is delegated to the core: this module holds text, a
 * viewport, a cursor and a set of view descriptors, and asks `buildWorkspace` for
 * the mathematics. It contains no arithmetic of its own.
 */
import {
  type Complex,
  type ContourIntegralNode,
  type FieldMode,
  type GlslLoweringOptions,
  type MathIssue,
  type MathObjectKind,
  type ParseError,
  type ScalarRange,
  type Signature,
  type VariableBinding,
  type Workspace,
  type WorkspaceEntry,
  type WorkspaceInput,
  buildWorkspace,
  collectVariableNames,
  cx,
  walk,
} from '@mathviz/mathcore';
import { MutableStore } from './store';
import { defaultModeFor, defaultViewKinds, nominalViewKind } from './viewKinds';
import { DEFAULT_CAMERA_3D, dolly, orbit, panTarget, type Camera3d } from '../render/camera3d';
import type { SubsystemId } from '../subsystems';

/**
 * One editable line, with a stable identity so focus and errors survive edits.
 *
 * `latex` is the line's source, and it is LaTeX because that is what the structured
 * editor reads and writes. LaTeX is a *surface syntax*, not a second truth: it is
 * parsed into the canonical AST by the core, and everything mathematical —
 * typing, evaluation, rendering — works from that tree. See `docs/ARCHITECTURE.md`.
 */
export interface ExpressionLine {
  readonly id: string;
  readonly latex: string;
}

/** Pass a line to the core in the syntax it is written in. */
function workspaceInput(line: ExpressionLine): WorkspaceInput {
  return { id: line.id, source: line.latex, syntax: 'latex' };
}

/** The visible region of the plane, in plane units. */
export interface Viewport {
  readonly centre: Complex;
  /** Half-width. The half-height follows from the canvas aspect ratio. */
  readonly halfWidth: number;
}

export const DEFAULT_VIEWPORT: Viewport = {
  centre: cx(0, 0),
  halfWidth: 2.4,
};

/** A frequency-domain frame whose scale survives parameter changes. */
export interface FrequencyViewport {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

export const DEFAULT_FREQUENCY_VIEWPORT: FrequencyViewport = {
  xMin: -8,
  xMax: 8,
  yMin: -0.25,
  yMax: 2,
};

export interface Direction2d {
  readonly x: number;
  readonly y: number;
}

export const DEFAULT_DIRECTION: Direction2d = {
  x: Math.SQRT1_2,
  y: Math.SQRT1_2,
};

/**
 * What a canvas pane is showing.
 *
 * Named for the mathematical object and the space it lives in rather than for the
 * renderer that happens to draw it. `complex-plane` is the plane itself;
 * `domain-coloring` is one representation of a map *on* that plane. Conflating
 * those two — one kind called `field` doing every job — is the confusion this
 * taxonomy exists to undo, because it made the plane and a picture of a function
 * on the plane the same choice.
 */
export type ViewKind =
  | 'cartesian-2d'
  | 'cartesian-3d'
  | 'complex-plane'
  | 'contour'
  | 'domain-coloring'
  | 'frequency-domain'
  | 'mapped-grid'
  | 'gradient';

/**
 * A view without an identity: what kind it is and what it shows.
 *
 * Callers describe views this way, and the store assigns the identity. That way
 * an identifier is always unique, however the view came into being — restored
 * from storage, opened with the subsystem, or added from the toolbar.
 */
export interface ViewBlueprint {
  readonly kind: ViewKind;
  readonly mode: FieldMode;
}

export interface ViewSpec extends ViewBlueprint {
  readonly id: string;
}

/**
 * What every view component is given.
 *
 * One shape for all of them, so that the dispatch in the canvas can be exhaustive
 * over `ViewKind`. A kind with no renderer is then a compile error; it used to be
 * a blank frame, because the switch that chose one had no exhaustiveness check.
 */
export interface ViewRendererProps {
  readonly store: WorkspaceStore;
  readonly view: ViewSpec;
}

export interface WorkspaceState {
  readonly subsystem: SubsystemId;
  readonly lines: readonly ExpressionLine[];
  /** The analysed workspace. Recomputed whenever the lines change. */
  readonly workspace: Workspace;
  /** Live slider values, overriding the values the definitions imply. */
  readonly parameterValues: ReadonlyMap<string, number>;
  readonly hover: Complex | null;
  readonly selection: Complex | null;
  /** Frequency-domain cursor, kept numeric so ω is never mistaken for a plane point. */
  readonly frequencyHover: number | null;
  readonly frequencySelection: number | null;
  readonly frequencyViewport: FrequencyViewport;
  /** The shared unit direction used by directional-derivative views. */
  readonly direction: Direction2d;
  /** The explicitly selected level set c shared by contour-capable views. */
  readonly contourLevel: number;
  readonly viewport: Viewport;
  /**
   * Where a three-dimensional view is looking from.
   *
   * A second camera rather than a meaning given to the first: a plane window and
   * an orbit position are different objects, and pretending an orbit is a plane
   * rectangle is the kind of lie this project refuses elsewhere. The 2D kinds
   * share `viewport`; only the surface uses this.
   */
  readonly camera3d: Camera3d;
  readonly views: readonly ViewSpec[];
  /**
   * Whether the views are still the ones inferred from the expression.
   *
   * True until the user touches the layout — adding, removing or reconfiguring a
   * view — and false for ever after. While it is true, changing the expression can
   * change which views are open, which is what makes `f(x, y)` turning into `f(x)`
   * turn a surface back into a curve. Once a user has arranged their own panes,
   * nothing re-derives over them.
   */
  readonly viewsFollowInference: boolean;
  readonly focusedLineId: string | null;
}

/** The entry a canvas should draw, given what the subsystem can draw. */
export interface ActiveExpression {
  readonly entry: WorkspaceEntry;
  readonly signature: Signature;
  readonly bindings: ReadonlyMap<string, VariableBinding>;
  readonly parameterNames: readonly string[];
}

let lineCounter = 0;
let viewCounter = 0;

/** A fresh identifier for a line. Deterministic within a session. */
export function nextLineId(): string {
  lineCounter += 1;
  return `line-${lineCounter}`;
}

/** A fresh identifier for a view. */
export function nextViewId(): string {
  viewCounter += 1;
  return `view-${viewCounter}`;
}

/** Reset the identifier counters. Used by tests so identifiers are predictable. */
export function resetLineIds(): void {
  lineCounter = 0;
  viewCounter = 0;
}

/**
 * The contour integral a canvas should draw the picture of, if there is one.
 *
 * A contour integral is a *value*, so it is never the active expression and no canvas
 * draws it as a function. It is still the thing whose contour and accumulated integral
 * GOAL.md section 7.15 asks to be visible, and a canvas can only draw it if it can find
 * it — which is what this does, as a pure function for the same reason the selector
 * below is one.
 *
 * The focused line wins, so a reader can look at one contour among several; failing
 * that, the first one, so that editing the path or the integrand does not make the
 * picture vanish while the three lines are being set up.
 */
export function selectContourLine(
  workspace: Workspace,
  focusedLineId: string | null,
): ContourIntegralNode | null {
  const bodies = workspace.entries
    .map((entry) => entry.statement)
    .map((statement) => (statement?.kind === 'expression' ? statement.body : null))
    .filter((body): body is ContourIntegralNode => body?.kind === 'contour-integral');
  if (bodies.length === 0) return null;

  const focused = workspace.entries.find((entry) => entry.id === focusedLineId);
  const focusedBody = focused?.statement?.kind === 'expression' ? focused.statement.body : null;
  if (focusedBody?.kind === 'contour-integral') return focusedBody;

  return bodies[0] as ContourIntegralNode;
}

/**
 * Choose the expression a canvas should draw.
 *
 * A pure function of exactly the three things that decide it, rather than a
 * method reading mutable state. That matters beyond tidiness: a view can memoise
 * it against precisely these inputs, so the shader is not re-lowered when, say,
 * the pointer moves. Expressed as a method on the store, the same call would have
 * to depend on the whole state to be correct, and would recompute far too much.
 */
export function selectActiveExpression(
  workspace: Workspace,
  focusedLineId: string | null,
  drawableKinds: ReadonlySet<MathObjectKind>,
): ActiveExpression | null {
  const drawable = workspace.entries.filter(
    (entry) => entry.type !== null && drawableKinds.has(entry.type.classification.kind),
  );
  if (drawable.length === 0) return null;

  const focused = drawable.find((entry) => entry.id === focusedLineId);
  if (focused?.type?.classification.kind === 'transform-pair') {
    return activeExpressionForEntry(focused, workspace);
  }

  // A focused source line belongs to its own transform pair. This keeps the
  // time-domain editor focus and the frequency pane on the same mathematical
  // object when a workspace contains several pairs.
  if (focused?.statement?.kind === 'function-definition') {
    const focusedFunctionName = focused.statement.name;
    const matchingPair = drawable.find((entry) => {
      const body = entry.statement?.kind === 'function-definition' ? entry.statement.body : null;
      return (
        entry.type?.classification.kind === 'transform-pair' &&
        body?.kind === 'fourier-transform' &&
        body.source.kind === 'call' &&
        body.source.callee === focusedFunctionName
      );
    });
    if (matchingPair !== undefined) return activeExpressionForEntry(matchingPair, workspace);
  }

  // If no focused line identifies a pair, use the first pair as the stable
  // fallback. A focused non-transform expression still wins when it has no
  // associated pair, so focus remains meaningful in mixed workspaces.
  const pair = drawable.find((entry) => entry.type?.classification.kind === 'transform-pair');
  const entry = pair ?? focused ?? (drawable[0] as WorkspaceEntry);
  if (entry.type === null) return null;

  return activeExpressionForEntry(entry, workspace);
}

function activeExpressionForEntry(
  entry: WorkspaceEntry,
  workspace: Workspace,
): ActiveExpression | null {
  if (entry.type === null) return null;
  return {
    entry,
    signature: entry.type.signature,
    bindings: variableBindingsFor(entry),
    parameterNames: parametersUsedBy(entry, workspace),
  };
}

/**
 * The source expression drawn by the time-domain pane of a transform pair.
 *
 * A transform definition is the active object for view inference, but its body is
 * an operation over a whole signal and cannot be sampled as a pointwise curve. The
 * time pane therefore follows the source function named by the Fourier node.
 */
export function selectSourceExpression(
  workspace: Workspace,
  focusedLineId: string | null,
  drawableKinds: ReadonlySet<MathObjectKind>,
): ActiveExpression | null {
  const active = selectActiveExpression(workspace, focusedLineId, drawableKinds);
  const statement = active?.entry.statement;
  const body = statement?.kind === 'function-definition' ? statement.body : null;
  if (body?.kind !== 'fourier-transform') return active;

  const source = body.source;
  if (source.kind !== 'call') return active;
  const sourceEntry = workspace.entries.find(
    (entry) =>
      entry.statement?.kind === 'function-definition' &&
      entry.statement.name === source.callee &&
      entry.type?.classification.kind === 'real-function',
  );
  return sourceEntry === undefined ? active : activeExpressionForEntry(sourceEntry, workspace);
}

/** Lowering options for an expression, or null when nothing is being drawn. */
export function loweringOptionsFor(active: ActiveExpression | null): GlslLoweringOptions | null {
  if (active === null) return null;
  return { parameters: active.parameterNames, variables: active.bindings };
}

export class WorkspaceStore extends MutableStore<WorkspaceState> {
  /** The object kinds this subsystem can draw. Fixed for the store's lifetime. */
  readonly drawableKinds: ReadonlySet<MathObjectKind>;

  constructor(options: {
    subsystem: SubsystemId;
    initialLines?: readonly string[];
    drawableKinds: readonly MathObjectKind[];
  }) {
    const lines: ExpressionLine[] = (options.initialLines ?? []).map((latex) => ({
      id: nextLineId(),
      latex,
    }));

    // Built once. The workspace has to exist before an opening view can be
    // inferred from it — the signature it carries is a better answer to "what is
    // this?" than the name of the subsystem is.
    const workspace = buildWorkspace(lines.map(workspaceInput));
    const drawableKinds = new Set(options.drawableKinds);
    const focusedLineId = lines[0]?.id ?? null;

    super({
      subsystem: options.subsystem,
      lines,
      workspace,
      parameterValues: collectSliderValues(workspace),
      hover: null,
      selection: null,
      frequencyHover: null,
      frequencySelection: null,
      frequencyViewport: DEFAULT_FREQUENCY_VIEWPORT,
      direction: DEFAULT_DIRECTION,
      contourLevel: 0,
      viewport: DEFAULT_VIEWPORT,
      camera3d: DEFAULT_CAMERA_3D,
      views: withFreshIds(
        planOpeningViews(workspace, focusedLineId, drawableKinds, options.subsystem),
      ),
      viewsFollowInference: true,
      focusedLineId,
    });

    this.drawableKinds = drawableKinds;
  }

  // -------------------------------------------------------------- restoration

  /**
   * Apply restored values without recomputing anything mathematical.
   *
   * Used once, when a subsystem route mounts and there is stored state to bring
   * back. Restored slider values are reconciled against the workspace rather than
   * trusted blindly, so a stored value for a parameter that no longer exists is
   * simply dropped.
   */
  restore(parts: {
    parameterValues?: ReadonlyMap<string, number>;
    viewport?: Viewport;
    frequencyViewport?: FrequencyViewport;
    contourLevel?: number;
    camera3d?: Camera3d;
    views?: readonly ViewBlueprint[];
  }): void {
    this.update((state) => ({
      ...state,
      parameterValues:
        parts.parameterValues === undefined
          ? state.parameterValues
          : reconcileParameters(state.workspace, parts.parameterValues),
      viewport: parts.viewport ?? state.viewport,
      frequencyViewport: parts.frequencyViewport ?? state.frequencyViewport,
      contourLevel:
        parts.contourLevel !== undefined && Number.isFinite(parts.contourLevel)
          ? parts.contourLevel
          : state.contourLevel,
      camera3d: parts.camera3d ?? state.camera3d,
      views: parts.views === undefined ? state.views : withFreshIds(parts.views),
      // Restoring somebody's arrangement settles the question: from here on the
      // views are theirs, and nothing re-derives over them. When there was
      // nothing to restore the inferred views stand, and keep following the
      // expression.
      viewsFollowInference: parts.views === undefined && state.viewsFollowInference,
    }));
  }

  // ------------------------------------------------------------------ lines

  setLineLatex(id: string, latex: string): void {
    this.rebuild((lines) => lines.map((line) => (line.id === id ? { ...line, latex } : line)));
  }

  addLine(latex = '', options: { focus?: boolean } = {}): string {
    const line: ExpressionLine = { id: nextLineId(), latex };
    this.rebuild(
      (lines) => [...lines, line],
      options.focus === false ? {} : { focusedLineId: line.id },
    );
    return line.id;
  }

  /** Add an empty line directly below an existing one, and focus it. */
  insertLineAfter(id: string): string {
    const line: ExpressionLine = { id: nextLineId(), latex: '' };
    this.rebuild(
      (lines) => {
        const index = lines.findIndex((candidate) => candidate.id === id);
        if (index === -1) return [...lines, line];
        return [...lines.slice(0, index + 1), line, ...lines.slice(index + 1)];
      },
      { focusedLineId: line.id },
    );
    return line.id;
  }

  removeLine(id: string): void {
    this.rebuild((lines) => lines.filter((line) => line.id !== id));
  }

  /** Remove a line, or empty it when it already has content. */
  clearOrRemoveLine(id: string): void {
    const line = this.getState().lines.find((candidate) => candidate.id === id);
    if (line === undefined) return;
    if (line.latex.trim() === '') {
      this.removeLine(id);
      return;
    }
    this.setLineLatex(id, '');
  }

  focusLine(id: string | null): void {
    this.update((state) => ({ ...state, focusedLineId: id }));
  }

  // ------------------------------------------------------------- parameters

  setParameter(name: string, value: number): void {
    this.update((state) => {
      const next = new Map(state.parameterValues);
      next.set(name, value);
      return { ...state, parameterValues: next };
    });
  }

  /** Return a parameter to the value its definition gives it. */
  resetParameter(name: string): void {
    const defined = this.getState().workspace.parameters.find(
      (parameter) => parameter.name === name,
    );
    if (defined === undefined || defined.value.im !== 0) return;
    this.setParameter(name, defined.value.re);
  }

  // -------------------------------------------------------------- the cursor

  /**
   * Set the shared cursor. Both arguments are the same state, so a view cannot
   * update one without the other, and every view observes both.
   */
  setHover(point: Complex | null): void {
    this.update((state) => ({ ...state, hover: point, frequencyHover: null }));
  }

  setSelection(point: Complex | null): void {
    this.update((state) => ({ ...state, selection: point, frequencySelection: null }));
  }

  setFrequencyHover(frequency: number | null): void {
    this.update((state) => ({ ...state, frequencyHover: frequency, hover: null }));
  }

  setFrequencySelection(frequency: number | null): void {
    this.update((state) => ({ ...state, frequencySelection: frequency, selection: null }));
  }

  /** Clear the cursor, for when the pointer leaves every view. */
  clearCursor(): void {
    this.update((state) =>
      state.hover === null && state.frequencyHover === null
        ? state
        : { ...state, hover: null, frequencyHover: null },
    );
  }

  clearFrequencyCursor(): void {
    this.update((state) =>
      state.frequencyHover === null ? state : { ...state, frequencyHover: null },
    );
  }

  // ------------------------------------------------------------- the viewport

  setViewport(viewport: Viewport): void {
    this.update((state) => ({ ...state, viewport }));
  }

  /** Set the frequency frame explicitly; estimates never change its scale. */
  setFrequencyViewport(frequencyViewport: FrequencyViewport): void {
    this.update((state) => ({ ...state, frequencyViewport }));
  }

  /** Set the linked directional-derivative vector, preserving unit length. */
  setDirection(direction: Direction2d): void {
    const length = Math.hypot(direction.x, direction.y);
    if (!Number.isFinite(length) || length === 0) return;
    this.update((state) => ({
      ...state,
      direction: { x: direction.x / length, y: direction.y / length },
    }));
  }

  setContourLevel(level: number): void {
    if (!Number.isFinite(level)) return;
    this.update((state) => ({ ...state, contourLevel: level }));
  }

  panViewport(deltaRe: number, deltaIm: number): void {
    this.update((state) => ({
      ...state,
      viewport: {
        ...state.viewport,
        centre: cx(state.viewport.centre.re + deltaRe, state.viewport.centre.im + deltaIm),
      },
    }));
  }

  /** Zoom about a fixed plane point, so the point under the cursor stays put. */
  zoomViewport(factor: number, about?: Complex): void {
    this.update((state) => {
      const anchor = about ?? state.viewport.centre;
      const halfWidth = clamp(state.viewport.halfWidth * factor, 1e-4, 1e6);
      const ratio = halfWidth / state.viewport.halfWidth;
      return {
        ...state,
        viewport: {
          halfWidth,
          centre: cx(
            anchor.re + (state.viewport.centre.re - anchor.re) * ratio,
            anchor.im + (state.viewport.centre.im - anchor.im) * ratio,
          ),
        },
      };
    });
  }

  resetViewport(): void {
    this.update((state) => ({
      ...state,
      viewport: DEFAULT_VIEWPORT,
      frequencyViewport: DEFAULT_FREQUENCY_VIEWPORT,
      camera3d: DEFAULT_CAMERA_3D,
    }));
  }

  // ---------------------------------------------------------------- camera3d

  /**
   * The three-dimensional camera, moved the same way anything else is.
   *
   * Every operation goes through the store rather than being kept in the view, so
   * that a second surface view — if there were one — would be looking at the same
   * scene, and so that the moves can be tested without a canvas at all.
   */
  setCamera3d(camera: Camera3d): void {
    this.update((state) => ({ ...state, camera3d: camera }));
  }

  orbitCamera(deltaAzimuth: number, deltaElevation: number): void {
    this.update((state) => ({
      ...state,
      camera3d: orbit(state.camera3d, deltaAzimuth, deltaElevation),
    }));
  }

  dollyCamera(factor: number): void {
    this.update((state) => ({ ...state, camera3d: dolly(state.camera3d, factor) }));
  }

  /** Slide the scene by a drag, in screen pixels at this canvas height. */
  panCamera(deltaX: number, deltaY: number, height: number): void {
    this.update((state) => ({
      ...state,
      camera3d: panTarget(state.camera3d, deltaX, deltaY, height),
    }));
  }

  resetCamera3d(): void {
    this.update((state) => ({ ...state, camera3d: DEFAULT_CAMERA_3D }));
  }

  // ------------------------------------------------------------------ views

  setViewMode(viewId: string, mode: FieldMode): void {
    this.update((state) => ({
      ...state,
      views: state.views.map((view) => (view.id === viewId ? { ...view, mode } : view)),
      viewsFollowInference: false,
    }));
  }

  addView(kind: ViewKind, mode: FieldMode): string {
    const id = nextViewId();
    this.update((state) => ({
      ...state,
      views: [...state.views, { id, kind, mode }],
      viewsFollowInference: false,
    }));
    return id;
  }

  removeView(id: string): void {
    this.update((state) => {
      // Always leave one view: an empty canvas has no useful state.
      if (state.views.length <= 1) return state;
      return {
        ...state,
        views: state.views.filter((view) => view.id !== id),
        viewsFollowInference: false,
      };
    });
  }

  // ---------------------------------------------------------------- analysis

  /** The entry a canvas should draw, or null when nothing is drawable yet. */
  activeExpression(): ActiveExpression | null {
    const { workspace, focusedLineId } = this.getState();
    return selectActiveExpression(workspace, focusedLineId, this.drawableKinds);
  }

  /** The pointwise source used by the time-domain readout and curve renderer. */
  sourceExpression(): ActiveExpression | null {
    const { workspace, focusedLineId } = this.getState();
    return selectSourceExpression(workspace, focusedLineId, this.drawableKinds);
  }

  /** Lowering options for the GLSL emitter, for the active expression. */
  loweringOptions(): GlslLoweringOptions | null {
    return loweringOptionsFor(this.activeExpression());
  }

  /** Build an evaluation environment with the live slider values applied. */
  evaluationValues(): Map<string, Complex> {
    const { parameterValues } = this.getState();
    const values = new Map<string, Complex>();
    for (const [name, value] of parameterValues) values.set(name, cx(value, 0));
    return values;
  }

  private rebuild(
    transform: (lines: readonly ExpressionLine[]) => readonly ExpressionLine[],
    extra: Partial<Pick<WorkspaceState, 'focusedLineId'>> = {},
  ): void {
    this.update((state) => {
      const lines = transform(state.lines);
      const workspace = buildWorkspace(lines.map(workspaceInput));
      const focusedLineId =
        extra.focusedLineId !== undefined && lines.some((line) => line.id === extra.focusedLineId)
          ? extra.focusedLineId
          : focusedStillExists(state.focusedLineId, lines)
            ? state.focusedLineId
            : (lines[lines.length - 1]?.id ?? null);

      return {
        ...state,
        ...extra,
        lines,
        workspace,
        // Slider values are reconciled, not replaced: a parameter that still
        // exists keeps the value the user dragged it to, and a new one starts at
        // the value its definition gives.
        parameterValues: reconcileParameters(workspace, state.parameterValues),
        views: state.viewsFollowInference
          ? reInferViews(state, workspace, focusedLineId, this.drawableKinds)
          : state.views,
        focusedLineId,
      };
    });
  }
}

/**
 * The views a workspace should open with, as a plan.
 *
 * Separate from turning the plan into views because a plan costs nothing to
 * compare and a view costs an identifier: rebuilding on every keystroke must not
 * churn identities, or every view would remount and lose its canvas.
 */
function planOpeningViews(
  workspace: Workspace,
  focusedLineId: string | null,
  drawableKinds: ReadonlySet<MathObjectKind>,
  subsystem: SubsystemId,
): readonly ViewBlueprint[] {
  const active = selectActiveExpression(workspace, focusedLineId, drawableKinds);
  const blueprints = defaultViewKinds(active?.signature, active?.entry.type?.classification.kind);
  if (blueprints.length > 0) return blueprints;
  // Nothing drawable to infer from: open on a pane that can explain itself.
  return [{ kind: nominalViewKind(subsystem), mode: defaultModeFor(active?.signature.codomain) }];
}

/** Give a plan its identities. The only place a view identifier is minted. */
function withFreshIds(blueprints: readonly ViewBlueprint[]): ViewSpec[] {
  return blueprints.map((blueprint) => ({
    id: nextViewId(),
    kind: blueprint.kind,
    mode: blueprint.mode,
  }));
}

/**
 * Follow the expression, but only when doing so would change something.
 *
 * The comparison is on kinds and modes rather than on identity, so a rebuild that
 * leaves the views where they are keeps the same ones — which is the difference
 * between a shader that keeps its compiled program and one that is rebuilt on
 * every keystroke.
 */
function reInferViews(
  state: WorkspaceState,
  workspace: Workspace,
  focusedLineId: string | null,
  drawableKinds: ReadonlySet<MathObjectKind>,
): readonly ViewSpec[] {
  const plan = planOpeningViews(workspace, focusedLineId, drawableKinds, state.subsystem);
  const unchanged =
    plan.length === state.views.length &&
    plan.every((blueprint, index) => {
      const existing = state.views[index];
      return (
        existing !== undefined &&
        existing.kind === blueprint.kind &&
        existing.mode === blueprint.mode
      );
    });
  return unchanged ? state.views : withFreshIds(plan);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function focusedStillExists(
  focusedLineId: string | null,
  lines: readonly ExpressionLine[],
): boolean {
  return focusedLineId !== null && lines.some((line) => line.id === focusedLineId);
}

/** Slider values for the parameters of a workspace, starting from their definitions. */
export function collectSliderValues(workspace: Workspace): Map<string, number> {
  const values = new Map<string, number>();
  for (const parameter of workspace.parameters) {
    if (parameter.slider) values.set(parameter.name, parameter.value.re);
  }
  return values;
}

function reconcileParameters(
  workspace: Workspace,
  current: ReadonlyMap<string, number>,
): Map<string, number> {
  const values = new Map<string, number>();
  for (const parameter of workspace.parameters) {
    if (!parameter.slider) continue;
    const existing = current.get(parameter.name);
    values.set(parameter.name, existing ?? parameter.value.re);
  }
  return values;
}

/**
 * How the variables of an expression map onto the plane.
 *
 * A complex variable is the plane point itself; a real variable is one
 * coordinate. For a function of two real variables the parameter order gives the
 * axis order, so `f(x, y)` puts x on the horizontal axis and y on the vertical
 * one, as written.
 */
export function variableBindingsFor(entry: WorkspaceEntry): Map<string, VariableBinding> {
  const bindings = new Map<string, VariableBinding>();
  if (entry.statement === null || entry.type === null) return bindings;

  const { domain } = entry.type.signature;
  const names =
    entry.statement.kind === 'function-definition'
      ? entry.statement.parameters
      : collectVariableNames(entry.statement.body);

  if (domain.kind === 'C') {
    const first = names[0];
    if (first !== undefined) bindings.set(first, { kind: 'complex' });
    return bindings;
  }

  names.slice(0, domain.dim).forEach((name, index) => {
    bindings.set(name, { kind: 'real', axis: index === 0 ? 0 : 1 });
  });
  return bindings;
}

/** The parameters an entry's expression actually mentions. */
export function parametersUsedBy(entry: WorkspaceEntry, workspace: Workspace): string[] {
  if (entry.statement === null) return [];

  const mentioned = new Set<string>();
  walk(entry.statement.body, (node) => {
    if (node.kind === 'variable') mentioned.add(node.name);
  });

  return workspace.parameters
    .map((parameter) => parameter.name)
    .filter((name) => mentioned.has(name));
}

/**
 * Why a line has no value, whether the failure was lexical or mathematical.
 *
 * Both kinds are returned because from the interface's point of view they are the
 * same event: this line does not produce mathematics, and here is the sentence
 * saying why.
 */
export function lineIssue(entry: WorkspaceEntry | null): ParseError | MathIssue | null {
  if (entry === null) return null;
  return entry.typeIssue ?? entry.parseError ?? null;
}

/** The scalar range of no field, used before one has been measured. */
export const UNMEASURED_RANGE: ScalarRange = { min: -1, max: 1 };
