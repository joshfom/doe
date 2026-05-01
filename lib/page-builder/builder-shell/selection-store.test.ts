import { describe, it, expect } from "vitest";
import { createSelectionStore } from "./selection-store";

describe("selectionStore", () => {
  it("starts at none and transitions cleanly", () => {
    const store = createSelectionStore();
    expect(store.getState()).toEqual({ kind: "none" });
    store.selectDocument();
    expect(store.getState()).toEqual({ kind: "document" });
    store.selectSlide("s-1");
    expect(store.getState()).toEqual({ kind: "slide", slideId: "s-1" });
    store.selectComponent("c-9");
    expect(store.getState()).toEqual({ kind: "component", itemId: "c-9" });
    store.selectNone();
    expect(store.getState()).toEqual({ kind: "none" });
  });

  it("notifies subscribers on change", () => {
    const store = createSelectionStore();
    let calls = 0;
    const unsub = store.subscribe(() => {
      calls += 1;
    });
    store.selectDocument();
    store.selectSlide("s-1");
    unsub();
    store.selectNone();
    expect(calls).toBe(2);
  });
});
