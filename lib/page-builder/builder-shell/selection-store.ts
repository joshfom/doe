/**
 * SelectionStore — what is currently selected in the BuilderShell.
 *
 * The Inspector reads this to decide which fields to render.
 */

import { createStore } from "./store";
import type { Selection } from "./types";

export interface SelectionStoreApi {
  getState: () => Selection;
  subscribe: (listener: () => void) => () => void;
  selectNone: () => void;
  selectDocument: () => void;
  selectSlide: (slideId: string) => void;
  selectComponent: (itemId: string) => void;
}

export function createSelectionStore(
  initial: Selection = { kind: "none" },
): SelectionStoreApi {
  const store = createStore<Selection>(initial);
  return {
    getState: store.getState,
    subscribe: store.subscribe,
    selectNone: () => store.setState(() => ({ kind: "none" })),
    selectDocument: () => store.setState(() => ({ kind: "document" })),
    selectSlide: (slideId) => store.setState(() => ({ kind: "slide", slideId })),
    selectComponent: (itemId) =>
      store.setState(() => ({ kind: "component", itemId })),
  };
}
