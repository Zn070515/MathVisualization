/**
 * The store context.
 *
 * Each subsystem route gets its own store, created when the route mounts and
 * discarded when it unmounts. Sharing one store across all three subsystems
 * would be wrong: a scalar field f(x, y) and a complex function f(z) are
 * different documents, and GOAL.md wants the three to be peers rather than views
 * of one workspace.
 *
 * The store is created inside `useMemo` so that a re-render does not restart the
 * session, and the persistence side effect is wired once per store.
 *
 * Where the views open is *not* decided here any more. It used to be, by the name
 * of the subsystem, and that is why `f(x, y) = x² − y²` opened as a heatmap: the
 * calculus subsystem had a field view, so a field view is what you got. The store
 * now infers its opening views from the expression, which it can only do once the
 * workspace has been built — and the workspace is built *in* the store.
 */
import { useEffect, useMemo, type ReactNode } from 'react';
import { DEFAULT_VIEWPORT, WorkspaceStore, type ViewBlueprint } from './workspaceStore';
import { WorkspaceStoreContext } from './storeContext';
import { createWorkspaceWriter, loadWorkspace } from './persistence';
import { cx, plainToLatex } from '@mathviz/mathcore';
import { subsystemById, type SubsystemId } from '../subsystems';

export function WorkspaceProvider({
  subsystem,
  children,
}: {
  subsystem: SubsystemId;
  children: ReactNode;
}): React.JSX.Element {
  const store = useMemo(() => {
    const definition = subsystemById(subsystem);
    const restored = loadWorkspace(subsystem);

    // The examples are written in the plain syntax because that is the readable way
    // to keep one description of each. They reach the editor as LaTeX, converted
    // through the canonical AST so that the two cannot say different things.
    const opening = (restored?.lines ?? definition.examples.slice(0, 2)).map((line) =>
      restored === null ? plainToLatex(line) : line,
    );

    const created = new WorkspaceStore({
      subsystem,
      initialLines: opening,
      drawableKinds: definition.drawableKinds,
    });

    /*
     * Only an arrangement that actually came back is handed over.
     *
     * "No views were stored" and "views were stored and none could be read" both
     * leave the inferred views standing, because in neither case is there
     * anything better to use — and an empty array must never be mistaken for an
     * empty layout, which is what would quietly replace somebody's panes with the
     * defaults the moment a stored kind stopped being recognised.
     *
     * Restored views carry only a kind and a mode; the store assigns identities,
     * since an identifier is a handle for this session rather than stored state.
     */
    const storedViews: readonly ViewBlueprint[] =
      restored?.views.views.map((view) => ({
        kind: view.kind,
        mode: view.mode,
      })) ?? [];

    created.restore({
      ...(restored === null
        ? { viewport: DEFAULT_VIEWPORT }
        : {
            parameterValues: new Map(Object.entries(restored.parameterValues)),
            viewport: {
              centre: cx(restored.viewport.centreRe, restored.viewport.centreIm),
              halfWidth: restored.viewport.halfWidth,
            },
            ...(restored.camera === null ? {} : { camera3d: restored.camera }),
            ...(storedViews.length > 0 ? { views: storedViews } : {}),
          }),
    });

    return created;
  }, [subsystem]);

  useEffect(() => {
    const writer = createWorkspaceWriter(subsystem);
    const unsubscribe = store.subscribe(() => {
      const state = store.getState();
      writer.save({
        lines: state.lines.map((line) => line.latex),
        parameterValues: Object.fromEntries(state.parameterValues),
        viewport: {
          centreRe: state.viewport.centre.re,
          centreIm: state.viewport.centre.im,
          halfWidth: state.viewport.halfWidth,
        },
        camera: {
          azimuth: state.camera3d.azimuth,
          elevation: state.camera3d.elevation,
          distance: state.camera3d.distance,
          targetX: state.camera3d.target.x,
          targetY: state.camera3d.target.y,
          targetZ: state.camera3d.target.z,
        },
        views: state.views.map((view) => ({ kind: view.kind, mode: view.mode })),
      });
    });

    // A pending write must not be lost to a tab that is closing, and a closing
    // tab does not wait for a timer. `pagehide` covers navigation and closing;
    // the visibility change covers being backgrounded, which on mobile is how
    // most sessions actually end.
    const flush = (): void => writer.flush();
    const flushWhenHidden = (): void => {
      if (document.visibilityState === 'hidden') writer.flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flushWhenHidden);

    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flushWhenHidden);
      unsubscribe();
      // Leaving the route flushes too: the store is about to be discarded, and
      // anything still pending would go with it.
      writer.flush();
    };
  }, [store, subsystem]);

  return <WorkspaceStoreContext.Provider value={store}>{children}</WorkspaceStoreContext.Provider>;
}
