/**
 * How a subsystem opens, and what it keeps.
 *
 * The persistence tests cover what the reader does with a stored record. This
 * covers what the *provider* does with the answer — which is where the one
 * decision that could lose somebody's work actually lives: whether an
 * arrangement that did not come back should be replaced by an inferred one.
 *
 * It is a rendering test rather than a store test because that decision is made
 * in the wiring, which only exists while a route is mounted.
 */
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { WorkspaceProvider } from '../src/state/StoreProvider';
import { useWorkspaceStore } from '../src/state/storeContext';
import { useStore } from '../src/state/store';
import { resetLineIds, type WorkspaceStore } from '../src/state/workspaceStore';

const V2 = 'mathviz.workspaces.v2';
const V3 = 'mathviz.workspaces.v3';

/** The store the mounted provider created, so a test can drive it. */
let captured: WorkspaceStore | null = null;

beforeEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  resetLineIds();
  captured = null;
});

/** Shows what the subsystem opened with, and hands the store back to the test. */
function Probe(): React.JSX.Element {
  const store = useWorkspaceStore();
  const views = useStore(store, (current) => current.views);
  const lines = useStore(store, (current) => current.lines);
  useEffect(() => {
    captured = store;
  }, [store]);
  return (
    <>
      <p data-testid="views">{views.map((view) => view.kind).join(',')}</p>
      <p data-testid="lines">{lines.map((line) => line.latex).join('|')}</p>
    </>
  );
}

function mount(subsystem: 'complex' | 'transforms' | 'calculus' = 'complex'): string {
  render(
    <WorkspaceProvider subsystem={subsystem}>
      <Probe />
    </WorkspaceProvider>,
  );
  return screen.getByTestId('views').textContent ?? '';
}

function mountedStore(): WorkspaceStore {
  if (captured === null) throw new Error('expected a mounted provider');
  return captured;
}

function stored(subsystem = 'complex'): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(V3) ?? '{}')[subsystem] ?? {};
}

function writeFile(key: string, file: unknown): void {
  localStorage.setItem(key, JSON.stringify(file));
}

describe('opening with nothing stored', () => {
  it('opens on the views the examples call for', () => {
    // The complex examples are complex functions: the plane they are maps of,
    // and the colouring of the map on it.
    expect(mount('complex')).toBe('complex-plane,domain-coloring');
  });

  it('opens on a pair of axes where that is what the examples are', () => {
    expect(mount('transforms')).toBe('cartesian-2d');
  });
});

describe('opening with something stored', () => {
  it('gives back the arrangement that was saved', () => {
    writeFile(V3, {
      complex: {
        lines: ['z^2'],
        views: [
          { kind: 'mapped-grid', mode: 'complex' },
          { kind: 'domain-coloring', mode: 'magnitude' },
        ],
      },
    });
    expect(mount('complex')).toBe('mapped-grid,domain-coloring');
  });

  it('gives back an arrangement saved under the old vocabulary', () => {
    writeFile(V2, {
      complex: {
        lines: ['z^2'],
        views: [
          { kind: 'field', mode: 'complex' },
          { kind: 'mapped-grid', mode: 'complex' },
        ],
      },
    });
    expect(mount('complex')).toBe('domain-coloring,mapped-grid');
  });

  it('falls back to inference rather than to an empty canvas when nothing is readable', () => {
    // The case the `StoredViews` distinction exists for. An empty result from the
    // reader must not be mistaken for "the user wanted no views", or a stored
    // kind that stops being recognised would silently wipe the layout — which is
    // precisely what reusing the old storage key would have done.
    writeFile(V3, {
      complex: {
        lines: ['z^2'],
        views: [{ kind: 'a-kind-from-the-future', mode: 'complex' }],
      },
    });
    expect(mount('complex')).toBe('complex-plane,domain-coloring');
  });

  it('infers when the record has no views key at all', () => {
    writeFile(V3, { complex: { lines: ['z^2'] } });
    expect(mount('complex')).toBe('complex-plane,domain-coloring');
  });

  it('keeps the camera the user left behind', () => {
    writeFile(V3, {
      calculus: {
        lines: ['f(x,y)=x^2+y^2'],
        views: [{ kind: 'cartesian-3d', mode: 'real' }],
        camera: { azimuth: 2, elevation: 0.5, distance: 12, targetX: 1, targetY: 0, targetZ: 0 },
      },
    });
    mount('calculus');
    expect(mountedStore().getState().camera3d).toEqual({
      azimuth: 2,
      elevation: 0.5,
      distance: 12,
      target: { x: 1, y: 0, z: 0 },
    });
  });

  it('does not lose the lines when only the views were unreadable', () => {
    writeFile(V3, {
      complex: { lines: ['z^3'], views: [{ kind: 'gone', mode: 'complex' }] },
    });
    mount('complex');
    // A layout is cheap to rebuild; the lines are the work. They are read
    // independently of the views, so losing one never loses the other.
    expect(screen.getByTestId('lines').textContent).toBe('z^3');
  });
});

describe('writing changes back', () => {
  it('writes nothing merely for having opened', () => {
    vi.useFakeTimers();
    mount('complex');
    expect(localStorage.getItem(V3)).toBeNull();
  });

  it('writes shortly after a change, not on every one', () => {
    vi.useFakeTimers();
    mount('complex');

    mountedStore().panViewport(2, 0);
    // Queued: this is the whole point of waiting.
    expect(localStorage.getItem(V3)).toBeNull();

    vi.advanceTimersByTime(300);
    expect(stored().viewport).toMatchObject({ centreRe: 2 });
  });

  it('flushes what is pending when the subsystem unmounts', () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <WorkspaceProvider subsystem="complex">
        <Probe />
      </WorkspaceProvider>,
    );

    mountedStore().panViewport(1, 1);
    expect(localStorage.getItem(V3)).toBeNull();

    // The store is about to be discarded, so what was pending goes with it
    // rather than being dropped.
    unmount();
    expect(stored().viewport).toMatchObject({ centreRe: 1 });
  });

  it('records the arrangement, so it can be given back next time', () => {
    vi.useFakeTimers();
    mount('complex');

    mountedStore().addView('mapped-grid', 'complex');
    vi.advanceTimersByTime(300);

    expect(stored().views).toEqual([
      { kind: 'complex-plane', mode: 'complex' },
      { kind: 'domain-coloring', mode: 'complex' },
      { kind: 'mapped-grid', mode: 'complex' },
    ]);
  });
});
