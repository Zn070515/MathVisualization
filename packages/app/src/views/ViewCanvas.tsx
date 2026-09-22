/**
 * The canvas: a grid of composable, linked views.
 *
 * Any number of views may be open, and they all read the same hover, the same
 * selection, the same parameters and the same expressions from the store. Nothing
 * is synchronised between them because there is nothing to synchronise: they are
 * already looking at the same state.
 *
 * The default is one view. Adding a second is a deliberate act, which is how
 * GOAL.md section 5.4 wants multi-view to work — available, but not imposed.
 */
import {
  FIELD_MODE_DESCRIPTIONS,
  FIELD_MODE_LABELS,
  FIELD_MODES,
  type FieldMode,
} from '@mathviz/mathcore';
import { useStore } from '../state/store';
import {
  defaultModeFor,
  type ViewKind,
  type ViewSpec,
  type WorkspaceStore,
} from '../state/workspaceStore';
import { availableViewKinds } from '../state/viewKinds';
import { FieldView } from './FieldView';
import { MappedGridView } from './MappedGridView';
import { PlotView } from './PlotView';

const VIEW_TITLES: Readonly<Record<ViewKind, string>> = {
  field: 'Field',
  'mapped-grid': 'Mapped grid',
  plot: 'Plot',
};

export function ViewCanvas({ store }: { store: WorkspaceStore }): React.JSX.Element {
  const views = useStore(store, (current) => current.views);
  const subsystem = useStore(store, (current) => current.subsystem);
  const addable = availableViewKinds(subsystem);

  return (
    <div className="canvas">
      {/* Views are added deliberately rather than being present by default, which
          is how GOAL.md section 5.4 wants multi-view to behave: available, and
          never imposed. */}
      <div className="canvas__bar">
        <span className="canvas__bar-label">Add view</span>
        {addable.map((kind) => (
          <button
            key={kind}
            type="button"
            className="canvas__add"
            onClick={() => {
              store.addView(kind, defaultModeFor(store.activeExpression()?.signature.codomain));
            }}
          >
            {VIEW_TITLES[kind]}
          </button>
        ))}
        <button
          type="button"
          className="canvas__reset"
          onClick={() => {
            store.resetViewport();
          }}
          title="Reset the visible region"
        >
          Reset view
        </button>
      </div>

      <div className={`canvas-grid canvas-grid--${Math.min(views.length, 2)}`}>
        {views.map((view) => (
          <ViewFrame key={view.id} store={store} view={view} removable={views.length > 1} />
        ))}
      </div>
    </div>
  );
}

function ViewFrame({
  store,
  view,
  removable,
}: {
  store: WorkspaceStore;
  view: ViewSpec;
  removable: boolean;
}): React.JSX.Element {
  const subsystem = useStore(store, (current) => current.subsystem);

  return (
    <section className="frame" aria-label={`${VIEW_TITLES[view.kind]} view`}>
      <header className="frame__header">
        <h2 className="frame__title">{VIEW_TITLES[view.kind]}</h2>

        {view.kind !== 'mapped-grid' && (
          <label className="frame__mode">
            <span className="visually-hidden">Display mode</span>
            <select
              value={view.mode}
              onChange={(event) => {
                store.setViewMode(view.id, event.target.value as FieldMode);
              }}
            >
              {FIELD_MODES.map((mode) => (
                <option key={mode} value={mode} title={FIELD_MODE_DESCRIPTIONS[mode]}>
                  {FIELD_MODE_LABELS[mode]}
                </option>
              ))}
            </select>
          </label>
        )}

        {removable && (
          <button
            type="button"
            className="frame__close"
            onClick={() => {
              store.removeView(view.id);
            }}
            aria-label={`Close the ${VIEW_TITLES[view.kind]} view`}
          >
            ×
          </button>
        )}

        <span className="frame__subsystem">{subsystem}</span>
      </header>

      <div className="frame__body">
        {view.kind === 'field' && <FieldView store={store} view={view} />}
        {view.kind === 'mapped-grid' && <MappedGridView store={store} view={view} />}
        {view.kind === 'plot' && <PlotView store={store} />}
      </div>
    </section>
  );
}
