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
  type FieldMode,
  type GlslLoweringOptions,
  type MathIssue,
  type MathObjectKind,
  type ParseError,
  type ScalarRange,
  type Signature,
  type Space,
  type VariableBinding,
  type Workspace,
  type WorkspaceEntry,
  buildWorkspace,
  collectVariableNames,
  cx,
  walk,
} from '@mathviz/mathcore';
import { MutableStore } from './store';
import type { SubsystemId } from '../subsystems';

/** One editable line, with a stable identity so focus and errors survive edits. */
export interface ExpressionLine {
  readonly id: string;
  readonly source: string;
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

/** What a canvas pane is showing. */
export type ViewKind = 'field' | 'mapped-grid' | 'plot';

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

/** Which mode is the natural default for a codomain. */
export function defaultModeFor(codomain: Space | undefined): FieldMode {
  if (codomain === undefined) return 'complex';
  return codomain.kind === 'C' ? 'complex' : 'real';
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
  readonly viewport: Viewport;
  readonly views: readonly ViewSpec[];
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
  const entry = focused ?? (drawable[0] as WorkspaceEntry);
  if (entry.type === null) return null;

  return {
    entry,
    signature: entry.type.signature,
    bindings: variableBindingsFor(entry),
    parameterNames: parametersUsedBy(entry, workspace),
  };
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
    const lines: ExpressionLine[] = (options.initialLines ?? []).map((source) => ({
      id: nextLineId(),
      source,
    }));

    super({
      subsystem: options.subsystem,
      lines,
      workspace: buildWorkspace(lines),
      parameterValues: collectSliderValues(buildWorkspace(lines)),
      hover: null,
      selection: null,
      viewport: DEFAULT_VIEWPORT,
      views: [{ id: nextViewId(), kind: 'field', mode: 'complex' }],
      focusedLineId: lines[0]?.id ?? null,
    });

    this.drawableKinds = new Set(options.drawableKinds);
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
    views?: readonly ViewBlueprint[];
  }): void {
    this.update((state) => ({
      ...state,
      parameterValues:
        parts.parameterValues === undefined
          ? state.parameterValues
          : reconcileParameters(state.workspace, parts.parameterValues),
      viewport: parts.viewport ?? state.viewport,
      views:
        parts.views === undefined
          ? state.views
          : parts.views.map((view) => ({ id: nextViewId(), kind: view.kind, mode: view.mode })),
    }));
  }

  // ------------------------------------------------------------------ lines

  setLineSource(id: string, source: string): void {
    this.rebuild((lines) => lines.map((line) => (line.id === id ? { ...line, source } : line)));
  }

  addLine(source = '', options: { focus?: boolean } = {}): string {
    const line: ExpressionLine = { id: nextLineId(), source };
    this.rebuild(
      (lines) => [...lines, line],
      options.focus === false ? {} : { focusedLineId: line.id },
    );
    return line.id;
  }

  /** Add an empty line directly below an existing one, and focus it. */
  insertLineAfter(id: string): string {
    const line: ExpressionLine = { id: nextLineId(), source: '' };
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
    if (line.source.trim() === '') {
      this.removeLine(id);
      return;
    }
    this.setLineSource(id, '');
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
    this.update((state) => ({ ...state, hover: point }));
  }

  setSelection(point: Complex | null): void {
    this.update((state) => ({ ...state, selection: point }));
  }

  /** Clear the cursor, for when the pointer leaves every view. */
  clearCursor(): void {
    this.update((state) => (state.hover === null ? state : { ...state, hover: null }));
  }

  // ------------------------------------------------------------- the viewport

  setViewport(viewport: Viewport): void {
    this.update((state) => ({ ...state, viewport }));
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
    this.setViewport(DEFAULT_VIEWPORT);
  }

  // ------------------------------------------------------------------ views

  setViewMode(viewId: string, mode: FieldMode): void {
    this.update((state) => ({
      ...state,
      views: state.views.map((view) => (view.id === viewId ? { ...view, mode } : view)),
    }));
  }

  addView(kind: ViewKind, mode: FieldMode): string {
    const id = nextViewId();
    this.update((state) => ({ ...state, views: [...state.views, { id, kind, mode }] }));
    return id;
  }

  removeView(id: string): void {
    this.update((state) => {
      // Always leave one view: an empty canvas has no useful state.
      if (state.views.length <= 1) return state;
      return { ...state, views: state.views.filter((view) => view.id !== id) };
    });
  }

  // ---------------------------------------------------------------- analysis

  /** The entry a canvas should draw, or null when nothing is drawable yet. */
  activeExpression(): ActiveExpression | null {
    const { workspace, focusedLineId } = this.getState();
    return selectActiveExpression(workspace, focusedLineId, this.drawableKinds);
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
      const workspace = buildWorkspace(lines);
      return {
        ...state,
        ...extra,
        lines,
        workspace,
        // Slider values are reconciled, not replaced: a parameter that still
        // exists keeps the value the user dragged it to, and a new one starts at
        // the value its definition gives.
        parameterValues: reconcileParameters(workspace, state.parameterValues),
        focusedLineId:
          extra.focusedLineId !== undefined &&
          lines.some((line) => line.id === extra.focusedLineId)
            ? extra.focusedLineId
            : focusedStillExists(state.focusedLineId, lines)
              ? state.focusedLineId
              : (lines[lines.length - 1]?.id ?? null),
      };
    });
  }
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
