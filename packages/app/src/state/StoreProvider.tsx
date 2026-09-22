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
 */
import { useEffect, useMemo, type ReactNode } from 'react';
import { DEFAULT_VIEWPORT, WorkspaceStore, type ViewBlueprint } from './workspaceStore';
import { WorkspaceStoreContext } from './storeContext';
import { loadWorkspace, saveWorkspace } from './persistence';
import { cx, plainToLatex } from '@mathviz/mathcore';
import { subsystemById, type SubsystemId } from '../subsystems';

/** The views a subsystem opens with. */
function defaultViews(subsystem: SubsystemId): ViewBlueprint[] {
  if (subsystem === 'transforms') return [{ kind: 'plot', mode: 'real' }];
  if (subsystem === 'calculus') return [{ kind: 'field', mode: 'real' }];
  // The complex subsystem opens with the two views that show the most: the field
  // itself, and the grid deformed by the map.
  return [
    { kind: 'field', mode: 'complex' },
    { kind: 'mapped-grid', mode: 'complex' },
  ];
}

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

    // Restored views carry only a kind and a mode; the store assigns identities,
    // since an identifier is a handle for this session rather than stored state.
    const views: ViewBlueprint[] = (restored?.views ?? []).map((view) => ({
      kind: view.kind,
      mode: view.mode,
    }));

    created.restore({
      ...(restored === null
        ? {}
        : {
            parameterValues: new Map(Object.entries(restored.parameterValues)),
            viewport: {
              centre: cx(restored.viewport.centreRe, restored.viewport.centreIm),
              halfWidth: restored.viewport.halfWidth,
            },
          }),
      views: views.length > 0 ? views : defaultViews(subsystem),
      ...(restored === null ? { viewport: DEFAULT_VIEWPORT } : {}),
    });

    return created;
  }, [subsystem]);

  useEffect(() => {
    return store.subscribe(() => {
      const state = store.getState();
      saveWorkspace(subsystem, {
        lines: state.lines.map((line) => line.latex),
        parameterValues: Object.fromEntries(state.parameterValues),
        viewport: {
          centreRe: state.viewport.centre.re,
          centreIm: state.viewport.centre.im,
          halfWidth: state.viewport.halfWidth,
        },
        views: state.views.map((view) => ({ kind: view.kind, mode: view.mode })),
      });
    });
  }, [store, subsystem]);

  return <WorkspaceStoreContext.Provider value={store}>{children}</WorkspaceStoreContext.Provider>;
}
