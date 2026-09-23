/**
 * Local persistence.
 *
 * GOAL.md section 3.2 allows local storage and wants it used where it helps. The
 * one thing that genuinely helps here is not losing the expressions you were working
 * on when you navigate to another subsystem or close the tab. There is no account
 * system and no backend, so this is the whole of it.
 *
 * What is stored is LaTeX, because that is the line's source: it is what the
 * structured editor writes and what it must be given back, unaltered, for a
 * restored session to look like the one that was left.
 *
 * Storage is treated as untrusted input. Anything unreadable, malformed, or of an
 * unexpected shape is discarded in favour of the defaults, because a stale or
 * hand-edited entry must never stop the application from starting.
 *
 * ## Why the key is versioned rather than reused
 *
 * The views a workspace has open are stored by *name*, and the names changed. The
 * tempting move — keep the key and teach the reader the new names — breaks in both
 * directions at once. An older build, still in a tab, would find no view kind it
 * recognised, drop every one of them, open on its own defaults, and then write
 * those back; the arrangement would be gone before anyone noticed. And a newer
 * build that reused the key could not tell "no views stored" from "views stored in
 * a vocabulary I do not know".
 *
 * So version 3 has its own key. The old builds keep reading and writing version 2
 * and never see version 3 at all; this build reads 3, then 2, then 1, and writes
 * only 3. Nothing is deleted, so nothing is lost.
 */
import { plainToLatex, type FieldMode } from '@mathviz/mathcore';
import type { Camera3d } from '../render/camera3d';
import type { ViewKind } from './workspaceStore';

const STORAGE_KEY = 'mathviz.workspaces.v3';
/** Version 2 also stored LaTeX. Version 1 stored plain text, converted on read. */
const PREVIOUS_STORAGE_KEY = 'mathviz.workspaces.v2';
const LEGACY_STORAGE_KEY = 'mathviz.workspaces.v1';

/**
 * Every view kind this application has ever written, mapped to what it is called
 * now.
 *
 * One table doing two jobs, because they must not drift apart: the keys are the
 * allowlist the reader validates against, and the values are the names it returns.
 * A kind that is absent is dropped — one view, never the whole record — and a kind
 * that is present always comes back as a current name.
 */
const VIEW_KIND_MIGRATION: Readonly<Record<string, ViewKind>> = {
  'cartesian-2d': 'cartesian-2d',
  'cartesian-3d': 'cartesian-3d',
  'complex-plane': 'complex-plane',
  'domain-coloring': 'domain-coloring',
  'frequency-domain': 'frequency-domain',
  'mapped-grid': 'mapped-grid',
  // The old `field` view *is* the fragment-shader view with its modes, so it
  // becomes domain colouring. A returning user keeps the heatmap they had; a
  // fresh one gets whatever the object calls for now. Nobody's picture changes
  // under them.
  field: 'domain-coloring',
  // A plot of a function of one real variable was drawn on a pair of axes with
  // the same sampling and the same range statement, so this is a rename.
  plot: 'cartesian-2d',
};

const FIELD_MODES: readonly FieldMode[] = ['complex', 'magnitude', 'phase', 'real', 'imaginary'];

export interface PersistedView {
  readonly kind: ViewKind;
  readonly mode: FieldMode;
}

/**
 * Where the three-dimensional view was looking from.
 *
 * Flat fields rather than a nested target, matching the viewport above: both are
 * plain numbers being written to JSON, and a shape that mirrors how it is read is
 * one fewer thing to get wrong.
 */
export interface PersistedCamera3d {
  readonly azimuth: number;
  readonly elevation: number;
  readonly distance: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly targetZ: number;
}

/** What is written. */
export interface PersistedWorkspace {
  readonly lines: readonly string[];
  readonly parameterValues: Record<string, number>;
  readonly viewport: { centreRe: number; centreIm: number; halfWidth: number };
  /**
   * Optional, and that is not a compromise: an older build wrote records without
   * it, and the reader already treats a missing field as "use the default". A new
   * key would have been needed to add a *required* field, and needing a key bump
   * for every addition is what makes a versioned format expensive.
   */
  readonly camera?: PersistedCamera3d;
  readonly views: readonly PersistedView[];
}

/**
 * What was read, including how the reading went.
 *
 * The distinction between "no views were stored" and "views were stored and none
 * of them could be read" is the whole reason this is an object. The first means
 * the stored layout was never there and the writer is free to infer one; the
 * second means somebody's arrangement existed and could not be understood, which
 * is worth saying out loud instead of quietly opening on something else.
 */
export interface StoredViews {
  /** Whether a `views` key was present and an array. */
  readonly present: boolean;
  /** The entries that were readable, already migrated to current kind names. */
  readonly views: readonly PersistedView[];
  /** Whether the array held an entry that could not be read. */
  readonly hadInvalid: boolean;
}

/** What is read. */
export interface LoadedWorkspace {
  readonly lines: readonly string[];
  readonly parameterValues: Record<string, number>;
  readonly viewport: PersistedWorkspace['viewport'];
  /** Null when nothing usable was stored, which is what the store's default is for. */
  readonly camera: Camera3d | null;
  readonly views: StoredViews;
}

type StoredFile = Record<string, unknown>;

function readKey(key: string): StoredFile {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as StoredFile;
  } catch {
    // A corrupted entry is not worth reporting: the defaults are a good state.
    return {};
  }
}

function writeKey(key: string, file: StoredFile): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(file));
  } catch {
    // Storage can be full or disabled. Neither is a reason to break the app.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseView(value: unknown): PersistedView | null {
  if (!isRecord(value)) return null;
  const kind = value['kind'];
  const mode = value['mode'];
  if (typeof kind !== 'string') return null;
  const migrated = VIEW_KIND_MIGRATION[kind];
  if (migrated === undefined) return null;
  if (typeof mode !== 'string' || !FIELD_MODES.includes(mode as FieldMode)) return null;
  return {
    kind: migrated,
    // Frequency frames never had a complex projection; normalize a malformed
    // or hand-edited persisted value to the visible default.
    mode: migrated === 'frequency-domain' && mode === 'complex' ? 'magnitude' : (mode as FieldMode),
  };
}

function readLines(entry: Record<string, unknown>, migrate: (line: string) => string): string[] {
  const stored = entry['lines'];
  if (!Array.isArray(stored)) return [];
  return stored.filter((line): line is string => typeof line === 'string').map(migrate);
}

function readViewport(entry: Record<string, unknown>): PersistedWorkspace['viewport'] {
  const fallback = { centreRe: 0, centreIm: 0, halfWidth: 2.4 };
  const stored = entry['viewport'];
  if (!isRecord(stored)) return fallback;

  const centreRe = stored['centreRe'];
  const centreIm = stored['centreIm'];
  const halfWidth = stored['halfWidth'];
  const usable =
    typeof centreRe === 'number' &&
    Number.isFinite(centreRe) &&
    typeof centreIm === 'number' &&
    Number.isFinite(centreIm) &&
    typeof halfWidth === 'number' &&
    Number.isFinite(halfWidth) &&
    halfWidth > 0;
  return usable ? { centreRe, centreIm, halfWidth } : fallback;
}

function readParameterValues(entry: Record<string, unknown>): Record<string, number> {
  const values: Record<string, number> = {};
  const stored = entry['parameterValues'];
  if (!isRecord(stored)) return values;
  for (const [name, value] of Object.entries(stored)) {
    if (typeof value === 'number' && Number.isFinite(value)) values[name] = value;
  }
  return values;
}

/**
 * Where the camera was, or null.
 *
 * A distance of zero or less is rejected rather than clamped: it is not a camera
 * position at all, and silently substituting the default would hide a record that
 * had been corrupted. Every other unusable value falls back the same way.
 */
function readCamera(entry: Record<string, unknown>): Camera3d | null {
  const stored = entry['camera'];
  if (!isRecord(stored)) return null;

  const azimuth = stored['azimuth'];
  const elevation = stored['elevation'];
  const distance = stored['distance'];
  const targetX = stored['targetX'];
  const targetY = stored['targetY'];
  const targetZ = stored['targetZ'];

  const usable =
    typeof azimuth === 'number' &&
    Number.isFinite(azimuth) &&
    typeof elevation === 'number' &&
    Number.isFinite(elevation) &&
    typeof distance === 'number' &&
    Number.isFinite(distance) &&
    distance > 0 &&
    typeof targetX === 'number' &&
    Number.isFinite(targetX) &&
    typeof targetY === 'number' &&
    Number.isFinite(targetY) &&
    typeof targetZ === 'number' &&
    Number.isFinite(targetZ);

  return usable
    ? { azimuth, elevation, distance, target: { x: targetX, y: targetY, z: targetZ } }
    : null;
}

function readViews(entry: Record<string, unknown>): StoredViews {
  const stored = entry['views'];
  if (!Array.isArray(stored)) return { present: false, views: [], hadInvalid: false };

  const views: PersistedView[] = [];
  let hadInvalid = false;
  for (const candidate of stored) {
    const view = parseView(candidate);
    if (view === null) hadInvalid = true;
    else views.push(view);
  }
  return { present: true, views, hadInvalid };
}

function readEntry(
  entry: Record<string, unknown>,
  migrateLines: (line: string) => string,
): LoadedWorkspace {
  return {
    lines: readLines(entry, migrateLines),
    parameterValues: readParameterValues(entry),
    viewport: readViewport(entry),
    camera: readCamera(entry),
    views: readViews(entry),
  };
}

/**
 * Read the stored state for one subsystem, or null when there is none.
 *
 * Newest key first. A version 1 session holds plain text, which is converted
 * through the canonical AST so that an existing session opens in the structured
 * editor with the same mathematics it had before.
 */
export function loadWorkspace(subsystem: string): LoadedWorkspace | null {
  const current: unknown = readKey(STORAGE_KEY)[subsystem];
  if (isRecord(current)) return readEntry(current, (line) => line);

  const previous: unknown = readKey(PREVIOUS_STORAGE_KEY)[subsystem];
  if (isRecord(previous)) return readEntry(previous, (line) => line);

  const legacy: unknown = readKey(LEGACY_STORAGE_KEY)[subsystem];
  if (!isRecord(legacy)) return null;
  return readEntry(legacy, plainToLatex);
}

/** Write the state for one subsystem, keeping the other subsystems' state. */
export function saveWorkspace(subsystem: string, workspace: PersistedWorkspace): void {
  const file = readKey(STORAGE_KEY);
  file[subsystem] = workspace;
  writeKey(STORAGE_KEY, file);
}

/** How long changes are allowed to accumulate before they are written. */
const WRITE_DELAY_MS = 250;

export interface WorkspaceWriter {
  /** Record a change. The write happens once the changes stop. */
  save(workspace: PersistedWorkspace): void;
  /** Write anything outstanding, now. */
  flush(): void;
}

/**
 * A writer that waits for the changes to stop.
 *
 * The store notifies on every change, including the pointer moving, and
 * `localStorage.setItem` is synchronous and shared across tabs. Writing on each
 * notification meant serialising the whole document many times a second while
 * somebody moved the mouse across a plot, to store a hover position that is not
 * even persisted. This waits.
 *
 * `flush` exists because waiting is not allowed to lose anything: the caller wires
 * it to the page being hidden or unloaded, which are the moments a pending write
 * would otherwise be dropped.
 */
export function createWorkspaceWriter(subsystem: string): WorkspaceWriter {
  let pending: PersistedWorkspace | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const write = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending === null) return;
    saveWorkspace(subsystem, pending);
    pending = null;
  };

  return {
    save(workspace) {
      pending = workspace;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(write, WRITE_DELAY_MS);
    },
    flush: write,
  };
}
