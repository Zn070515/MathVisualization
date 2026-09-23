/**
 * Interaction tests.
 *
 * GOAL.md section 24 asks specifically for tests of "expression update, parameter
 * update, linked cursor, linked selection, multi-view synchronization". All of
 * that lives in the store, which is plain TypeScript precisely so that it can be
 * tested here without a DOM, without rendering, and without timing.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { latex, makeStore, makeStoreFromLatex, toLatex } from './helpers';
import { cx } from '@mathviz/mathcore';
import {
  DEFAULT_VIEWPORT,
  collectSliderValues,
  parametersUsedBy,
  resetLineIds,
  variableBindingsFor,
  type WorkspaceStore,
} from '../src/state/workspaceStore';

beforeEach(() => {
  resetLineIds();
});

/** The kinds of the open views, in order. */
function kindsOf(store: WorkspaceStore): string[] {
  return store.getState().views.map((view) => view.kind);
}

describe('expression updates', () => {
  it('re-analyses the workspace when a line is edited', () => {
    const store = makeStore(['f(z)=z^2'], 'complex');
    expect(store.getState().workspace.entries[0]?.type?.classification.kind).toBe(
      'complex-function',
    );

    const id = store.getState().lines[0]?.id as string;
    store.setLineLatex(id, 'f(x)=x^2');
    expect(store.getState().workspace.entries[0]?.type?.classification.kind).toBe('real-function');
  });

  it('reports a parse error without discarding the other lines', () => {
    const store = makeStore(['f(z)=z^2', 'a=2'], 'complex');
    const first = store.getState().lines[0]?.id as string;
    store.setLineLatex(first, 'f(z)=z^');

    const [firstEntry, secondEntry] = store.getState().workspace.entries;
    expect(firstEntry?.parseError).not.toBeNull();
    expect(secondEntry?.typeIssue).toBeNull();
    expect(secondEntry?.role).toBe('parameter');
  });

  it('adds a line after another and focuses it', () => {
    const store = makeStore(['f(z)=z^2', 'a=2'], 'complex');
    const first = store.getState().lines[0]?.id as string;
    const created = store.insertLineAfter(first);

    expect(store.getState().lines.map((line) => line.id)).toEqual([
      first,
      created,
      (store.getState().lines[2] as { id: string }).id,
    ]);
    expect(store.getState().focusedLineId).toBe(created);
  });

  it('clears a line that has content, and removes one that is empty', () => {
    const store = makeStore(['f(z)=z^2', ''], 'complex');
    const [first, second] = store.getState().lines;
    store.clearOrRemoveLine(first?.id as string);
    expect(store.getState().lines).toHaveLength(2);
    expect(store.getState().lines[0]?.latex).toBe('');

    store.clearOrRemoveLine(second?.id as string);
    expect(store.getState().lines).toHaveLength(1);
  });
});

describe('parameter updates', () => {
  it('turns a real assignment into a slider value', () => {
    const store = makeStore(['a=2'], 'complex');
    expect(store.getState().parameterValues.get('a')).toBe(2);
  });

  it('lets a slider override the defined value, and reset it', () => {
    const store = makeStore(['a=2'], 'complex');
    store.setParameter('a', 7);
    expect(store.getState().parameterValues.get('a')).toBe(7);

    store.resetParameter('a');
    expect(store.getState().parameterValues.get('a')).toBe(2);
  });

  it('makes the new value visible to evaluation', () => {
    const store = makeStore(['a=2', 'f(z)=a*z'], 'complex');
    store.setParameter('a', 5);
    expect(store.evaluationValues().get('a')).toEqual(cx(5, 0));
  });

  it('keeps an explicit frequency viewport when parameters change', () => {
    const store = makeStoreFromLatex(
      [
        'a=1',
        'f(t)=\\exp\\left(-a\\cdot t^{2}\\right)',
        'F(\\omega)=\\operatorname{Fourier}\\left(f(t)\\right)',
      ],
      'transforms',
    );
    const viewport = { ...store.getState().frequencyViewport, yMax: 3 };

    store.setFrequencyViewport(viewport);
    store.setParameter('a', 2);

    expect(store.getState().frequencyViewport).toEqual(viewport);
  });

  it('keeps a dragged value when an unrelated line changes', () => {
    const store = makeStore(['a=2', 'b=3'], 'complex');
    store.setParameter('a', 9);
    const other = store.getState().lines[1]?.id as string;
    store.setLineLatex(other, 'b=4');

    expect(store.getState().parameterValues.get('a')).toBe(9);
    // A parameter whose definition changed keeps its dragged value; the value in
    // the definition is where it starts, not a value it is pinned to.
    expect(store.getState().parameterValues.get('b')).toBe(3);
  });

  it('drops a parameter that no longer exists', () => {
    const store = makeStore(['a=2', 'b=3'], 'complex');
    store.setParameter('a', 9);
    const first = store.getState().lines[0]?.id as string;
    store.setLineLatex(first, 'c=1');

    expect(store.getState().parameterValues.has('a')).toBe(false);
    expect(store.getState().parameterValues.get('b')).toBe(3);
  });

  it('offers no slider for a complex parameter', () => {
    const store = makeStore(['a=2i'], 'complex');
    expect(store.getState().parameterValues.has('a')).toBe(false);
    expect(store.getState().workspace.parameters[0]?.slider).toBe(false);
  });
});

describe('the shared cursor', () => {
  it('starts empty', () => {
    const store = makeStore([], 'complex');
    expect(store.getState().hover).toBeNull();
    expect(store.getState().selection).toBeNull();
  });

  it('holds one hover point and one selection for every view', () => {
    const store = makeStore(['f(z)=z^2', 'g(z)=1/z'], 'complex');
    // With three views open, all of them read these same two fields. There is no
    // per-view cursor that could get out of step with the others.
    store.addView('mapped-grid', 'complex');
    expect(store.getState().views).toHaveLength(3);

    const point = cx(0.75, -1.25);
    store.setHover(point);
    expect(store.getState().hover).toEqual(point);

    store.setSelection(cx(1, 1));
    expect(store.getState().selection).toEqual(cx(1, 1));
    // Selecting does not move the hover: they are different things.
    expect(store.getState().hover).toEqual(point);
  });

  it('keeps frequency cursors separate from plane cursors', () => {
    const store = makeStore([], 'transforms');
    store.setFrequencyHover(2.5);
    store.setFrequencySelection(-1.25);

    expect(store.getState().frequencyHover).toBe(2.5);
    expect(store.getState().frequencySelection).toBe(-1.25);
    expect(store.getState().hover).toBeNull();
    expect(store.getState().selection).toBeNull();

    store.setHover(cx(1, 0));
    expect(store.getState().frequencyHover).toBeNull();
    expect(store.getState().frequencySelection).toBe(-1.25);
  });

  it('clears the hover without touching the selection', () => {
    const store = makeStore([], 'complex');
    store.setHover(cx(1, 2));
    store.setSelection(cx(3, 4));
    store.clearCursor();

    expect(store.getState().hover).toBeNull();
    expect(store.getState().selection).toEqual(cx(3, 4));
  });

  it('notifies subscribers when the cursor moves', () => {
    const store = makeStore([], 'complex');
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });

    store.setHover(cx(1, 1));
    store.setHover(cx(1, 2));
    expect(notifications).toBe(2);

    unsubscribe();
    store.setHover(cx(2, 2));
    expect(notifications).toBe(2);
  });
});

describe('the viewport', () => {
  it('pans by a plane offset', () => {
    const store = makeStore([], 'complex');
    store.panViewport(0.5, -0.25);
    expect(store.getState().viewport.centre).toEqual(cx(0.5, -0.25));
    // Panning does not change the scale.
    expect(store.getState().viewport.halfWidth).toBe(DEFAULT_VIEWPORT.halfWidth);
  });

  it('zooms about a point, leaving that point where it was', () => {
    const store = makeStore([], 'complex');
    const anchor = cx(1, 0);
    store.zoomViewport(0.5, anchor);

    expect(store.getState().viewport.halfWidth).toBeCloseTo(1.2, 12);
    // The anchor was at distance 1 from a centre of 0; after halving the scale the
    // centre must move halfway towards it to keep the anchor fixed on screen.
    expect(store.getState().viewport.centre.re).toBeCloseTo(0.5, 12);
    expect(store.getState().viewport.centre.im).toBeCloseTo(0, 12);
  });

  it('zooms about the centre when no anchor is given', () => {
    const store = makeStore([], 'complex');
    store.panViewport(2, 3);
    store.zoomViewport(0.5);
    expect(store.getState().viewport.centre).toEqual(cx(2, 3));
    expect(store.getState().viewport.halfWidth).toBeCloseTo(1.2, 12);
  });

  it('clamps the zoom so the plane cannot collapse or fly away', () => {
    const store = makeStore([], 'complex');
    store.zoomViewport(1e-9);
    expect(store.getState().viewport.halfWidth).toBeGreaterThan(0);
    store.zoomViewport(1e12);
    expect(store.getState().viewport.halfWidth).toBeLessThanOrEqual(1e6);
  });

  it('resets to the default', () => {
    const store = makeStore([], 'complex');
    store.panViewport(9, 9);
    store.zoomViewport(0.1);
    store.resetViewport();
    expect(store.getState().viewport).toEqual(DEFAULT_VIEWPORT);
  });
});

describe('multiple views', () => {
  it('opens on the views the mathematical object calls for, not on the subsystem', () => {
    // A complex function is a map of the plane: the plane itself, and then the
    // colouring of the map on it. Neither of those is anything the *subsystem*
    // decides — the subsystem is only where the examples come from.
    expect(kindsOf(makeStore(['f(z)=z^2'], 'complex'))).toEqual([
      'complex-plane',
      'domain-coloring',
    ]);
    // A function of one real variable opens on a pair of axes.
    expect(kindsOf(makeStore(['f(t)=exp(-t^2)'], 'transforms'))).toEqual(['cartesian-2d']);
    expect(
      kindsOf(
        makeStoreFromLatex(
          ['f(t)=\\exp\\left(-t^{2}\\right)', 'F(\\omega)=\\operatorname{Fourier}\\left(f(t)\\right)'],
          'transforms',
        ),
      ),
    ).toEqual(['cartesian-2d', 'frequency-domain']);
    // A scalar over the plane opens on a surface, not on the same numbers read
    // from above.
    expect(kindsOf(makeStore(['f(x,y)=x^2+y^2'], 'calculus'))).toEqual(['cartesian-3d']);
  });

  it('opens on a coordinate space when there is nothing to infer from', () => {
    // Not on a field renderer: with no expression there is nothing for it to
    // render, so the user would be looking at nothing while they type their first
    // line. The plane is the world the mathematics happens in, and it is there
    // whether or not anything is being drawn on it.
    const store = makeStore([], 'complex');
    expect(store.getState().views).toHaveLength(1);
    expect(store.getState().views[0]?.kind).toBe('complex-plane');
  });

  it('adds and removes views', () => {
    const store = makeStore([], 'complex');
    const id = store.addView('mapped-grid', 'complex');
    expect(store.getState().views).toHaveLength(2);

    store.removeView(id);
    expect(store.getState().views).toHaveLength(1);
  });

  it('refuses to remove the last view, since an empty canvas has no state', () => {
    const store = makeStore([], 'complex');
    const only = store.getState().views[0]?.id as string;
    store.removeView(only);
    expect(store.getState().views).toHaveLength(1);
  });

  it('changes one view mode without touching the others', () => {
    const store = makeStore([], 'complex');
    const second = store.addView('domain-coloring', 'complex');
    const [first] = store.getState().views;

    store.setViewMode(second, 'magnitude');
    const views = store.getState().views;
    expect(views.find((view) => view.id === second)?.mode).toBe('magnitude');
    expect(views.find((view) => view.id === first?.id)?.mode).toBe('complex');
  });
});

describe('the views follow the expression until they are arranged', () => {
  it('starts out following, because they were inferred', () => {
    expect(makeStore(['f(z)=z^2'], 'complex').getState().viewsFollowInference).toBe(true);
  });

  it('re-derives when the object changes class', () => {
    // Retyping a surface as a curve is a different object, and the panes follow.
    const store = makeStore(['f(x,y)=x^2+y^2'], 'calculus');
    expect(kindsOf(store)).toEqual(['cartesian-3d']);

    const line = store.getState().lines[0];
    if (line === undefined) throw new Error('expected a line');
    store.setLineLatex(line.id, toLatex('f(x)=x^2'));

    expect(kindsOf(store)).toEqual(['cartesian-2d']);
  });

  it('keeps the same view identities while nothing changes', () => {
    // A rebuild happens on every keystroke. If it minted new identifiers the
    // canvases would remount and lose their compiled shaders as you typed.
    const store = makeStore(['f(z)=z^2'], 'complex');
    const before = store.getState().views[0]?.id;

    const line = store.getState().lines[0];
    if (line === undefined) throw new Error('expected a line');
    store.setLineLatex(line.id, toLatex('f(z)=z^3'));

    expect(store.getState().views[0]?.id).toBe(before);
  });

  it('stops following the moment a view is arranged', () => {
    const store = makeStore(['f(x,y)=x^2+y^2'], 'calculus');
    const only = store.getState().views[0];
    if (only === undefined) throw new Error('expected a view');

    store.setViewMode(only.id, 'real');
    expect(store.getState().viewsFollowInference).toBe(false);

    const line = store.getState().lines[0];
    if (line === undefined) throw new Error('expected a line');
    store.setLineLatex(line.id, toLatex('f(x)=x^2'));

    // The object changed class and the panes did not move: they are the user's.
    expect(kindsOf(store)).toEqual(['cartesian-3d']);
  });

  it('does not start following again after that', () => {
    const store = makeStore(['f(z)=z^2'], 'complex');
    const only = store.getState().views[0];
    if (only === undefined) throw new Error('expected a view');

    store.addView('mapped-grid', 'complex');
    store.removeView(only.id);
    expect(store.getState().viewsFollowInference).toBe(false);
  });
});

describe('choosing what to draw', () => {
  it('draws the focused expression when it is drawable', () => {
    const store = makeStore(['f(z)=z^2', 'g(z)=1/z'], 'complex');
    const second = store.getState().lines[1]?.id as string;
    store.focusLine(second);
    // The entry's source is the LaTeX the editor holds.
    expect(store.activeExpression()?.entry.source).toBe(latex('g(z)=1/z')[0]);
  });

  it('falls back to the first drawable expression', () => {
    const store = makeStore(['a=2', 'f(z)=z^2'], 'complex');
    expect(store.activeExpression()?.entry.source).toBe(latex('f(z)=z^2')[0]);
  });

  it('skips expressions this subsystem cannot draw', () => {
    // A scalar field is not a complex function, so the complex subsystem has
    // nothing to show for it.
    const store = makeStore(['f(x,y)=x^2+y^2'], 'complex');
    expect(store.activeExpression()).toBeNull();
  });

  it('recognises a scalar field in the calculus subsystem', () => {
    const store = makeStore(['f(x,y)=x^2-y^2'], 'calculus');
    const active = store.activeExpression();
    expect(active).not.toBeNull();
    expect(active?.bindings.get('x')).toEqual({ kind: 'real', axis: 0 });
    expect(active?.bindings.get('y')).toEqual({ kind: 'real', axis: 1 });
  });

  it('binds a complex variable to the plane point itself', () => {
    const store = makeStore(['f(z)=z^2'], 'complex');
    expect(store.activeExpression()?.bindings.get('z')).toEqual({ kind: 'complex' });
  });

  it('reports only the parameters an expression mentions', () => {
    const store = makeStore(['a=2', 'b=3', 'f(z)=a*z'], 'complex');
    const entry = store.getState().workspace.entries[2];
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    expect(parametersUsedBy(entry, store.getState().workspace)).toEqual(['a']);
  });

  it('produces lowering options that match the active expression', () => {
    const store = makeStore(['a=2', 'f(z)=a*z^2'], 'complex');
    const options = store.loweringOptions();
    expect(options?.parameters).toEqual(['a']);
    expect(options?.variables.get('z')).toEqual({ kind: 'complex' });
  });
});

describe('derived helpers', () => {
  it('collects slider values from a workspace', () => {
    const store = makeStore(['a=2', 'b=3i'], 'complex');
    const values = collectSliderValues(store.getState().workspace);
    expect([...values.keys()]).toEqual(['a']);
  });

  it('binds free variables of a bare expression by convention', () => {
    const store = makeStore(['z^2'], 'complex');
    const entry = store.getState().workspace.entries[0];
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    expect(variableBindingsFor(entry).get('z')).toEqual({ kind: 'complex' });
  });
});
