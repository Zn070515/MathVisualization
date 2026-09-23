/**
 * The canvas: a grid of composable, linked views.
 *
 * Any number of views may be open, and they all read the same hover, the same
 * selection, the same parameters and the same expressions from the store. Nothing
 * is synchronised between them because there is nothing to synchronise: they are
 * already looking at the same state.
 *
 * The default is whatever the expression calls for. Adding a second is a
 * deliberate act, which is how GOAL.md section 5.4 wants multi-view to work —
 * available, but not imposed.
 */
import { type ReactNode, useMemo } from 'react';
import {
  FIELD_MODE_DESCRIPTIONS,
  FIELD_MODE_LABELS,
  FIELD_MODES,
  type FieldMode,
} from '@mathviz/mathcore';
import { useStore } from '../state/store';
import {
  selectActiveExpression,
  type ViewKind,
  type ViewRendererProps,
  type ViewSpec,
  type WorkspaceStore,
} from '../state/workspaceStore';
import { defaultModeFor, drawableViewKinds, nominalViewKind } from '../state/viewKinds';
import { Cartesian3DView } from './Cartesian3DView';
import { CartesianView } from './CartesianView';
import { ComplexPlaneView } from './ComplexPlaneView';
import { ContourView } from './ContourView';
import { FieldView } from './FieldView';
import { FrequencyDomainView } from './FrequencyDomainView';
import { MappedGridView } from './MappedGridView';

const VIEW_TITLES: Readonly<Record<ViewKind, string>> = {
  'cartesian-2d': 'Cartesian plot',
  'cartesian-3d': '3D surface',
  'complex-plane': 'Complex plane',
  contour: 'Contours',
  'domain-coloring': 'Domain colouring',
  'frequency-domain': 'Frequency domain',
  'mapped-grid': 'Mapped grid',
};

/**
 * Which kinds have display modes.
 *
 * Only domain colouring does. Listing them rather than testing for one name keeps
 * the reason in one place: the others show what they show, and offering them a
 * mode selector would be offering a control that changes nothing.
 */
const MODED_KINDS: ReadonlySet<ViewKind> = new Set<ViewKind>([
  'domain-coloring',
  'frequency-domain',
]);

/**
 * The dispatch, exhaustive over the taxonomy.
 *
 * A record rather than a chain of conditionals, so that adding a kind is a
 * compile error in two places instead of a frame that quietly renders nothing —
 * which is exactly what the previous switch would have done.
 */
const VIEW_RENDERERS: Readonly<Record<ViewKind, (props: ViewRendererProps) => React.JSX.Element>> =
  {
    'cartesian-2d': CartesianView,
    'cartesian-3d': Cartesian3DView,
    'complex-plane': ComplexPlaneView,
    contour: ContourView,
    'domain-coloring': FieldView,
    'frequency-domain': FrequencyDomainView,
    'mapped-grid': MappedGridView,
  };

/**
 * The title of a pane.
 *
 * For domain colouring it names the projection as well, because "domain
 * colouring" showing a magnitude plot is a small lie that the title can avoid
 * telling.
 */
function titleOf(view: ViewSpec): string {
  const base = VIEW_TITLES[view.kind];
  return view.kind === 'domain-coloring' && view.mode !== 'complex'
    ? `${base} · ${FIELD_MODE_LABELS[view.mode]}`
    : base;
}

export interface ViewCanvasProps {
  readonly store: WorkspaceStore;
  /** Whether the analysis drawer is showing. */
  readonly analysisOpen: boolean;
  readonly onAnalysisToggle: () => void;
  /** The drawer's contents, supplied by the page so this component stays about views. */
  readonly analysis: ReactNode;
}

export function ViewCanvas({
  store,
  analysisOpen,
  onAnalysisToggle,
  analysis,
}: ViewCanvasProps): React.JSX.Element {
  const views = useStore(store, (current) => current.views);
  const subsystem = useStore(store, (current) => current.subsystem);
  const workspace = useStore(store, (current) => current.workspace);
  const focusedLineId = useStore(store, (current) => current.focusedLineId);

  const active = useMemo(
    () => selectActiveExpression(workspace, focusedLineId, store.drawableKinds),
    [workspace, focusedLineId, store.drawableKinds],
  );

  const addable = useMemo((): readonly ViewKind[] => {
    const preferred = drawableViewKinds(active?.signature, active?.entry.type?.classification.kind);
    // With nothing drawable there is no signature to consult, and a row of "Add
    // view" with nothing under it is a dead end. A nominal view is offered
    // instead, and it renders its own explanation rather than an empty frame.
    return preferred.length > 0 ? preferred : [nominalViewKind(subsystem)];
  }, [active, subsystem]);

  return (
    <div className="canvas">
      {/* Views are added deliberately rather than being present by default, which is
          how GOAL.md section 5.4 wants multi-view to behave: available, and never
          imposed. */}
      <div className="canvas__bar">
        <span className="canvas__bar-label">Add view</span>
        {addable.map((kind) => (
          <button
            key={kind}
            type="button"
            className="canvas__add"
            onClick={() => {
              store.addView(kind, defaultModeFor(active?.signature.codomain));
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

        {/* Analysis lives here rather than under the expression list, because the
            bottom of that panel belongs to input. Both reveal the same mathematics
            as before; only their address has changed. */}
        <button
          type="button"
          className={analysisOpen ? 'canvas__analysis canvas__analysis--on' : 'canvas__analysis'}
          aria-expanded={analysisOpen}
          onClick={onAnalysisToggle}
          title={analysisOpen ? 'Hide analysis' : 'Show analysis and capabilities'}
        >
          Analysis
        </button>
      </div>

      <div className={`canvas-grid canvas-grid--${Math.min(views.length, 2)}`}>
        {views.map((view) => (
          <ViewFrame key={view.id} store={store} view={view} removable={views.length > 1} />
        ))}
      </div>

      {analysisOpen && <div className="canvas__drawer">{analysis}</div>}
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
  const Renderer = VIEW_RENDERERS[view.kind];
  const title = titleOf(view);

  return (
    <section className="frame" aria-label={`${title} view`}>
      <header className="frame__header">
        <h2 className="frame__title">{title}</h2>

        {MODED_KINDS.has(view.kind) && (
          <label className="frame__mode">
            <span className="visually-hidden">Display mode</span>
            <select
              value={view.mode}
              onChange={(event) => {
                store.setViewMode(view.id, event.target.value as FieldMode);
              }}
            >
              {(view.kind === 'frequency-domain'
                ? FIELD_MODES.filter((mode) => mode !== 'complex')
                : FIELD_MODES
              ).map((mode) => (
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
            aria-label={`Close the ${title} view`}
          >
            ×
          </button>
        )}

        <span className="frame__subsystem">{subsystem}</span>
      </header>

      <div className="frame__body">
        <Renderer store={store} view={view} />
      </div>
    </section>
  );
}
