/**
 * A minimal external store.
 *
 * Deliberately hand-written rather than pulled from a library. Two reasons, both
 * architectural rather than stylistic:
 *
 * 1. The interaction semantics of this product — a shared cursor, a shared
 *    selection, a parameter change propagating to every linked view — are the
 *    thing GOAL.md section 24 asks to be tested. Keeping them in plain TypeScript
 *    outside React means they can be tested directly, with no DOM and no
 *    rendering, which is what `test/workspaceStore.test.ts` does.
 * 2. The state is small and the update rules are ours to state. A general state
 *    library would add a dependency without answering any question this code has.
 *
 * React subscribes through `useSyncExternalStore`, so a store update is a single
 * render pass and there is no provider nesting to reason about.
 */
import { useSyncExternalStore } from 'react';

export type Listener = () => void;

export interface Store<T> {
  getState(): T;
  subscribe(listener: Listener): () => void;
}

/** A store whose state is replaced wholesale by its own actions. */
export class MutableStore<T> implements Store<T> {
  private state: T;
  private readonly listeners = new Set<Listener>();

  constructor(initial: T) {
    this.state = initial;
  }

  getState = (): T => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Replace the state, or keep the existing object when nothing changed.
   *
   * Returning the same reference for an unchanged state matters: the store drives
   * a WebGL redraw and a shader is expensive to rebuild, so a no-op update must
   * not look like a change.
   */
  protected setState(next: T): void {
    if (Object.is(next, this.state)) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  /** Mutate through a recipe that returns the next state. */
  protected update(recipe: (current: T) => T): void {
    this.setState(recipe(this.state));
  }
}

/** Subscribe a component to a store, selecting the part it needs. */
export function useStore<T, Selected>(store: Store<T>, select: (state: T) => Selected): Selected {
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.getState()),
    () => select(store.getState()),
  );
}
