/**
 * A subsystem page.
 *
 * All three routes render this component. There is one expression panel, one
 * canvas, one readout and one capability list, parameterised by the subsystem
 * definition. That is what stops the three from drifting into three applications
 * (GOAL.md 6, 22, 23).
 *
 * The layout is the one GOAL.md section 5.1 asks for — expressions beside the
 * canvas — with the capability list and the symbolic panel behind a disclosure,
 * so the default view stays simple.
 */
import { useState } from 'react';
import { subsystemById, type SubsystemId } from '../subsystems';
import { WorkspaceProvider } from '../state/StoreProvider';
import { useWorkspaceStore } from '../state/storeContext';
import { ExpressionPanel } from '../expression/ExpressionPanel';
import { ViewCanvas } from '../views/ViewCanvas';
import { ReadoutBar } from '../readout/ReadoutBar';
import { SymbolicPanel } from '../symbolic/SymbolicPanel';
import { CapabilityList } from '../analysis/CapabilityList';

export function SubsystemPage({ subsystem }: { subsystem: SubsystemId }): React.JSX.Element {
  return (
    <WorkspaceProvider subsystem={subsystem}>
      <SubsystemWorkspace subsystem={subsystem} />
    </WorkspaceProvider>
  );
}

function SubsystemWorkspace({ subsystem }: { subsystem: SubsystemId }): React.JSX.Element {
  const store = useWorkspaceStore();
  const definition = subsystemById(subsystem);
  const [showAnalysis, setShowAnalysis] = useState(false);

  return (
    <div className="workspace">
      <div className="workspace__side">
        <ExpressionPanel store={store} />

        <div className="disclosure">
          <button
            type="button"
            className="disclosure__toggle"
            aria-expanded={showAnalysis}
            onClick={() => {
              setShowAnalysis((open) => !open);
            }}
          >
            {showAnalysis ? 'Hide analysis' : 'Analysis and capabilities'}
          </button>

          {showAnalysis && (
            <div className="disclosure__body">
              <CapabilityList subsystem={definition} />
              {subsystem === 'complex' && <SymbolicPanel store={store} />}
            </div>
          )}
        </div>
      </div>

      <div className="workspace__main">
        <ViewCanvas store={store} />
        <ReadoutBar store={store} />
      </div>
    </div>
  );
}
