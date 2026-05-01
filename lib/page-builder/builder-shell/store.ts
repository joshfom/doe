/**
 * Tiny vanilla pub/sub store. Framework-agnostic so we can unit/property
 * test without React, and consumed in React via `useSyncExternalStore`.
 */

export interface Store<State> {
  getState: () => State;
  setState: (updater: (prev: State) => State) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createStore<State>(initial: State): Store<State> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    setState: (updater) => {
      const next = updater(state);
      if (Object.is(next, state)) return;
      state = next;
      listeners.forEach((fn) => fn());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
