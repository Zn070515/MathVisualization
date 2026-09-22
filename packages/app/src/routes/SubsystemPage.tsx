/**
 * A subsystem page.
 *
 * All three routes render this component. There is one expression panel, one canvas,
 * one readout, one keypad and one analyzer, parameterised by the subsystem
 * definition. That is what stops the three from drifting into three applications
 * (GOAL.md 6, 22, 23).
 *
 * The layout is the one GOAL.md section 5.1 asks for — expressions beside the canvas
 * — with the keypad pinned under the expression list, where it is part of input
 * rather than a separate tool.
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
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [keypadOpen, setKeypadOpen] = useState(false);

  return (
    <div className="workspace">
      <div className="workspace__side">
        <ExpressionPanel
          store={store}
          keypadOpen={keypadOpen}
          onKeypadToggle={() => {
            setKeypadOpen((open) => !open);
          }}
        />
      </div>

      <div className="workspace__main">
        <ViewCanvas
          store={store}
          analysisOpen={analysisOpen}
          onAnalysisToggle={() => {
            setAnalysisOpen((open) => !open);
          }}
          analysis={
            <>
              <CapabilityList subsystem={definition} />
              {subsystem === 'complex' && <SymbolicPanel store={store} />}
            </>
          }
        />
        <ReadoutBar store={store} />
      </div>
    </div>
  );
}
