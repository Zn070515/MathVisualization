/**
 * Local persistence.
 *
 * GOAL.md section 3.2 allows local storage and wants it used where it helps. The
 * one thing that genuinely helps here is not losing the expressions you were
 * working on when you navigate to another subsystem or close the tab. There is no
 * account system and no backend, so this is the whole of it.
 *
 * Storage is treated as untrusted input: anything unreadable, malformed, or of an
 * unexpected shape is discarded in favour of the defaults, because a stale or
 * hand-edited entry must never stop the application from starting.
 */
import type { FieldMode } from '@mathviz/mathcore';
import type { ViewKind } from './workspaceStore';

const STORAGE_KEY = 'mathviz.workspaces.v1';

export interface PersistedView {
  readonly kind: ViewKind;
  readonly mode: FieldMode;
}

export interface PersistedWorkspace {
  readonly lines: readonly string[];
  readonly parameterValues: Record<string, number>;
  readonly viewport: { centreRe: number; centreIm: number; halfWidth: number };
  readonly views: readonly PersistedView[];
}

const VIEW_KINDS: readonly ViewKind[] = ['field', 'mapped-grid', 'plot'];
const FIELD_MODES: readonly FieldMode[] = [
  'complex',
  'magnitude',
  'phase',
  'real',
  'imaginary',
];

type StoredFile = Record<string, unknown>;

function readFile(): StoredFile {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as StoredFile;
  } catch {
    // A corrupted entry is not worth reporting: the defaults are a good state.
    return {};
  }
}

function writeFile(file: StoredFile): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(file));
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
  if (typeof kind !== 'string' || !VIEW_KINDS.includes(kind as ViewKind)) return null;
  if (typeof mode !== 'string' || !FIELD_MODES.includes(mode as FieldMode)) return null;
  return { kind: kind as ViewKind, mode: mode as FieldMode };
}

/** Read the stored state for one subsystem, or null when there is none. */
export function loadWorkspace(subsystem: string): PersistedWorkspace | null {
  const entry: unknown = readFile()[subsystem];
  if (!isRecord(entry)) return null;

  const lines = Array.isArray(entry['lines'])
    ? entry['lines'].filter((line): line is string => typeof line === 'string')
    : [];

  const parameterValues: Record<string, number> = {};
  const storedParameters = entry['parameterValues'];
  if (isRecord(storedParameters)) {
    for (const [name, value] of Object.entries(storedParameters)) {
      if (typeof value === 'number' && Number.isFinite(value)) parameterValues[name] = value;
    }
  }

  let viewport: PersistedWorkspace['viewport'] = {
    centreRe: 0,
    centreIm: 0,
    halfWidth: 2.4,
  };
  const storedViewport = entry['viewport'];
  if (isRecord(storedViewport)) {
    const centreRe = storedViewport['centreRe'];
    const centreIm = storedViewport['centreIm'];
    const halfWidth = storedViewport['halfWidth'];
    if (
      typeof centreRe === 'number' &&
      Number.isFinite(centreRe) &&
      typeof centreIm === 'number' &&
      Number.isFinite(centreIm) &&
      typeof halfWidth === 'number' &&
      Number.isFinite(halfWidth) &&
      halfWidth > 0
    ) {
      viewport = { centreRe, centreIm, halfWidth };
    }
  }

  const views = Array.isArray(entry['views'])
    ? entry['views'].map(parseView).filter((view): view is PersistedView => view !== null)
    : [];

  return { lines, parameterValues, viewport, views };
}

/** Write the state for one subsystem, merging with the other subsystems' state. */
export function saveWorkspace(subsystem: string, workspace: PersistedWorkspace): void {
  const file = readFile();
  file[subsystem] = workspace;
  writeFile(file);
}

/** Forget one subsystem's stored state. */
export function clearWorkspace(subsystem: string): void {
  const file = readFile();
  delete file[subsystem];
  writeFile(file);
}
