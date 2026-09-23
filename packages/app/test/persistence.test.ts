/**
 * Reading back what was stored.
 *
 * This is the only irreversible thing in the application. A wrong picture is
 * visible and fixable; a lost arrangement is neither. So the interesting cases
 * here are not the happy path — they are the ones where something is *nearly*
 * readable, and the question is whether the reader degrades to a smaller truth or
 * to no truth at all.
 *
 * The rule the tests below pin: a record is never dropped for one bad field, one
 * view is never dropped for a whole record, and an old vocabulary is translated
 * rather than thrown away.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createWorkspaceWriter,
  loadWorkspace,
  saveWorkspace,
  type PersistedWorkspace,
} from '../src/state/persistence';

const V3 = 'mathviz.workspaces.v3';
const V2 = 'mathviz.workspaces.v2';
const V1 = 'mathviz.workspaces.v1';

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

function writeFile(key: string, file: unknown): void {
  localStorage.setItem(key, JSON.stringify(file));
}

function workspace(overrides: Partial<PersistedWorkspace> = {}): PersistedWorkspace {
  return {
    lines: ['z'],
    parameterValues: {},
    viewport: { centreRe: 0, centreIm: 0, halfWidth: 2.4 },
    views: [{ kind: 'domain-coloring', mode: 'complex' }],
    ...overrides,
  };
}

describe('which version is read', () => {
  it('reads the current one', () => {
    writeFile(V3, { complex: { lines: ['z^2'] } });
    expect(loadWorkspace('complex')?.lines).toEqual(['z^2']);
  });

  it('reports nothing when there is nothing', () => {
    expect(loadWorkspace('complex')).toBeNull();
  });

  it('falls back to the previous version, translating the view names', () => {
    // The vocabulary changed. An arrangement written by an older build must come
    // back as the same arrangement, not as an empty one.
    writeFile(V2, {
      complex: {
        lines: ['z^2'],
        views: [
          { kind: 'field', mode: 'complex' },
          { kind: 'mapped-grid', mode: 'complex' },
        ],
      },
    });
    const loaded = loadWorkspace('complex');
    expect(loaded?.views.views.map((view) => view.kind)).toEqual([
      'domain-coloring',
      'mapped-grid',
    ]);
  });

  it('translates the oldest vocabulary as well, including its plain-text lines', () => {
    writeFile(V1, { complex: { lines: ['1/z'], views: [{ kind: 'plot', mode: 'real' }] } });
    const loaded = loadWorkspace('complex');
    // Version 1 stored plain source, which comes back as the LaTeX the editor
    // reads — through the canonical AST, so the two say the same thing.
    expect(loaded?.lines[0]).toContain('\\frac');
    expect(loaded?.views.views.map((view) => view.kind)).toEqual(['cartesian-2d']);
  });

  it('prefers the newest version when more than one is present', () => {
    writeFile(V1, { complex: { lines: ['oldest'] } });
    writeFile(V2, { complex: { lines: ['previous'] } });
    writeFile(V3, { complex: { lines: ['current'] } });
    expect(loadWorkspace('complex')?.lines).toEqual(['current']);
  });

  it('falls through when the newest version is unreadable', () => {
    localStorage.setItem(V3, '{ this is not json');
    writeFile(V2, { complex: { lines: ['previous'] } });
    expect(loadWorkspace('complex')?.lines).toEqual(['previous']);
  });

  it('falls through when the newest version simply has no entry for this subsystem', () => {
    writeFile(V3, { transforms: { lines: ['elsewhere'] } });
    writeFile(V2, { complex: { lines: ['previous'] } });
    expect(loadWorkspace('complex')?.lines).toEqual(['previous']);
  });

  it('keeps the subsystems apart', () => {
    saveWorkspace('complex', workspace({ lines: ['a'] }));
    saveWorkspace('transforms', workspace({ lines: ['b'] }));
    saveWorkspace('complex', workspace({ lines: ['c'] }));

    expect(loadWorkspace('complex')?.lines).toEqual(['c']);
    expect(loadWorkspace('transforms')?.lines).toEqual(['b']);
  });

  it('round-trips the explicit frequency viewport', () => {
    const frequencyViewport = { xMin: -8, xMax: 8, yMin: -1, yMax: 3 };
    saveWorkspace('transforms', workspace({ frequencyViewport }));

    expect(loadWorkspace('transforms')?.frequencyViewport).toEqual(frequencyViewport);
  });

  it('round-trips a contour view as a current view kind', () => {
    saveWorkspace('calculus', workspace({ views: [{ kind: 'contour', mode: 'real' }] }));

    expect(loadWorkspace('calculus')?.views.views).toEqual([{ kind: 'contour', mode: 'real' }]);
  });

  it('normalizes an invalid complex mode on a frequency view', () => {
    writeFile(V3, {
      transforms: {
        lines: ['f(t)=exp(-t^2)', 'F(ω)=Fourier(f(t))'],
        views: [{ kind: 'frequency-domain', mode: 'complex' }],
      },
    });
    expect(loadWorkspace('transforms')?.views.views).toEqual([
      { kind: 'frequency-domain', mode: 'magnitude' },
    ]);
  });

  it('never writes to the older keys', () => {
    writeFile(V2, { complex: { lines: ['untouched'] } });
    saveWorkspace('complex', workspace({ lines: ['new'] }));

    // An older build in another tab reads version 2 and cannot be confused by
    // anything written here.
    expect(JSON.parse(localStorage.getItem(V2) ?? '{}').complex.lines).toEqual(['untouched']);
  });
});

describe('a view that cannot be read', () => {
  it('is dropped on its own, and the rest of the record survives', () => {
    writeFile(V3, {
      complex: {
        lines: ['z^2'],
        parameterValues: { a: 2 },
        views: [
          { kind: 'domain-coloring', mode: 'complex' },
          { kind: 'something-else', mode: 'complex' },
        ],
      },
    });
    const loaded = loadWorkspace('complex');
    expect(loaded?.views.views).toHaveLength(1);
    expect(loaded?.views.hadInvalid).toBe(true);
    // ... and nothing else was thrown away with it.
    expect(loaded?.lines).toEqual(['z^2']);
    expect(loaded?.parameterValues).toEqual({ a: 2 });
  });

  it('is dropped when its mode is the unreadable part', () => {
    writeFile(V3, { complex: { views: [{ kind: 'domain-coloring', mode: 'sideways' }] } });
    const loaded = loadWorkspace('complex');
    expect(loaded?.views.views).toEqual([]);
    expect(loaded?.views.hadInvalid).toBe(true);
  });

  it('is distinguishable from having stored no views at all', () => {
    // The distinction the whole object exists for: "nothing was stored" lets the
    // application infer a layout, and "something was stored and none of it could
    // be read" must not be mistaken for it.
    writeFile(V3, { complex: { lines: ['z^2'] } });
    expect(loadWorkspace('complex')?.views).toEqual({
      present: false,
      views: [],
      hadInvalid: false,
    });

    writeFile(V3, { complex: { views: [] } });
    expect(loadWorkspace('complex')?.views).toEqual({
      present: true,
      views: [],
      hadInvalid: false,
    });

    writeFile(V3, { complex: { views: [{ kind: 'gone', mode: 'complex' }] } });
    expect(loadWorkspace('complex')?.views).toEqual({
      present: true,
      views: [],
      hadInvalid: true,
    });
  });
});

describe('the rest of a record', () => {
  it('discards a viewport that is not a viewport', () => {
    writeFile(V3, { complex: { viewport: { centreRe: 0, centreIm: 0, halfWidth: -1 } } });
    expect(loadWorkspace('complex')?.viewport).toEqual({
      centreRe: 0,
      centreIm: 0,
      halfWidth: 2.4,
    });
  });

  it('keeps only the parameter values that are numbers', () => {
    writeFile(V3, {
      complex: { parameterValues: { a: 2, b: 'two', c: NaN, d: 4 } },
    });
    // `NaN` does not survive JSON, so it arrives as null and is dropped with the
    // string. Neither is a value a slider could show.
    expect(loadWorkspace('complex')?.parameterValues).toEqual({ a: 2, d: 4 });
  });

  it('keeps only the lines that are strings', () => {
    writeFile(V3, { complex: { lines: ['z^2', 7, null, 'z^3'] } });
    expect(loadWorkspace('complex')?.lines).toEqual(['z^2', 'z^3']);
  });
});

describe('where the camera was looking from', () => {
  const camera = {
    azimuth: 1.2,
    elevation: 0.4,
    distance: 17.5,
    targetX: 0,
    targetY: 0,
    targetZ: 1,
  };

  it('comes back as it was written', () => {
    writeFile(V3, { complex: { camera } });
    expect(loadWorkspace('complex')?.camera).toEqual({
      azimuth: 1.2,
      elevation: 0.4,
      distance: 17.5,
      target: { x: 0, y: 0, z: 1 },
    });
  });

  it('is simply absent when it was never stored', () => {
    // Which is what a record written before there was a 3D view looks like. No
    // key had to be added for this, which is the whole reason the reader treats a
    // missing field as "use the default".
    writeFile(V3, { complex: { lines: ['z^2'] } });
    expect(loadWorkspace('complex')?.camera).toBeNull();
  });

  it('is discarded when it is not a camera position', () => {
    // Zero is not a position. Substituting the default would hide a corrupted
    // record rather than treating it as one.
    writeFile(V3, { complex: { camera: { ...camera, distance: 0 } } });
    expect(loadWorkspace('complex')?.camera).toBeNull();

    writeFile(V3, { complex: { camera: { ...camera, elevation: 'high' } } });
    expect(loadWorkspace('complex')?.camera).toBeNull();

    writeFile(V3, { complex: { camera: { ...camera, targetZ: null } } });
    expect(loadWorkspace('complex')?.camera).toBeNull();
  });

  it('does not take the rest of the record with it', () => {
    writeFile(V3, { complex: { lines: ['z^2'], camera: { broken: true } } });
    const loaded = loadWorkspace('complex');
    expect(loaded?.camera).toBeNull();
    expect(loaded?.lines).toEqual(['z^2']);
  });
});

describe('the writer', () => {
  it('waits for the changes to stop', () => {
    vi.useFakeTimers();
    const writer = createWorkspaceWriter('complex');
    writer.save(workspace({ lines: ['a'] }));

    expect(localStorage.getItem(V3)).toBeNull();
    vi.advanceTimersByTime(300);
    expect(loadWorkspace('complex')?.lines).toEqual(['a']);
  });

  it('writes only the last of a burst', () => {
    vi.useFakeTimers();
    const writer = createWorkspaceWriter('complex');
    writer.save(workspace({ lines: ['a'] }));
    writer.save(workspace({ lines: ['b'] }));
    writer.save(workspace({ lines: ['c'] }));
    vi.advanceTimersByTime(300);

    expect(loadWorkspace('complex')?.lines).toEqual(['c']);
  });

  it('writes immediately when told to, which is how a closing tab is covered', () => {
    vi.useFakeTimers();
    const writer = createWorkspaceWriter('complex');
    writer.save(workspace({ lines: ['a'] }));
    writer.flush();

    expect(loadWorkspace('complex')?.lines).toEqual(['a']);
  });

  it('does nothing when there is nothing pending', () => {
    vi.useFakeTimers();
    const writer = createWorkspaceWriter('complex');
    writer.flush();
    expect(localStorage.getItem(V3)).toBeNull();
  });
});
