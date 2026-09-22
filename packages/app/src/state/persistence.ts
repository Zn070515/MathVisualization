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
 */
import { plainToLatex, type FieldMode } from '@mathviz/mathcore';
import type { ViewKind } from './workspaceStore';

/** Version 2 stores LaTeX. Version 1 stored plain text and is converted on read. */
const STORAGE_KEY = 'mathviz.workspaces.v2';
const LEGACY_STORAGE_KEY = 'mathviz.workspaces.v1';

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

function readFile(): StoredFile {
  return readKey(STORAGE_KEY);
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

function readLines(entry: Record<string, unknown>, migrate: (line: string) => string): string[] {
  const stored = entry['lines'];
  if (!Array.isArray(stored)) return [];
  return stored
    .filter((line): line is string => typeof line === 'string')
    .map(migrate);
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

function readViews(entry: Record<string, unknown>): PersistedView[] {
  const stored = entry['views'];
  if (!Array.isArray(stored)) return [];
  return stored.map(parseView).filter((view): view is PersistedView => view !== null);
}

/**
 * Read the stored state for one subsystem, or null when there is none.
 *
 * A session stored by version 1 holds plain text, which is converted through the
 * canonical AST so that an existing session opens in the structured editor with the
 * same mathematics it had before.
 */
export function loadWorkspace(subsystem: string): PersistedWorkspace | null {
  const current: unknown = readFile()[subsystem];
  if (isRecord(current)) {
    return {
      lines: readLines(current, (line) => line),
      parameterValues: readParameterValues(current),
      viewport: readViewport(current),
      views: readViews(current),
    };
  }

  const legacy: unknown = readKey(LEGACY_STORAGE_KEY)[subsystem];
  if (!isRecord(legacy)) return null;
  return {
    lines: readLines(legacy, plainToLatex),
    parameterValues: readParameterValues(legacy),
    viewport: readViewport(legacy),
    views: readViews(legacy),
  };
}

/** Write the state for one subsystem, keeping the other subsystems' state. */
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
