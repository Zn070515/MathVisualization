/**
 * The context a subsystem's store is reached through.
 *
 * The context and its accessor live in their own module so that the provider
 * component can be the only export of its file. That is not tidiness for its own
 * sake: a module mixing a component with other exports cannot be fast-refreshed,
 * and losing fast refresh on the one piece of state wiring in the application
 * would make every change to it a full reload.
 */
import { createContext, useContext } from 'react';
import type { WorkspaceStore } from './workspaceStore';

export const WorkspaceStoreContext = createContext<WorkspaceStore | null>(null);

export function useWorkspaceStore(): WorkspaceStore {
  const store = useContext(WorkspaceStoreContext);
  if (store === null) {
    throw new Error('useWorkspaceStore must be used inside a WorkspaceProvider');
  }
  return store;
}
