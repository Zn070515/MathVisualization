/**
 * Which views a subsystem can open.
 *
 * Kept out of the provider module so that the provider exports components only,
 * which is what lets fast refresh work. The rule it encodes is a statement about
 * the mathematics, not about React: a subsystem offers the views it can actually
 * draw, so the toolbar cannot offer a view that would show nothing.
 */
import type { SubsystemId } from '../subsystems';
import type { ViewKind } from './workspaceStore';

export function availableViewKinds(subsystem: SubsystemId): readonly ViewKind[] {
  if (subsystem === 'transforms') return ['plot'];
  if (subsystem === 'calculus') return ['field'];
  return ['field', 'mapped-grid', 'plot'];
}
