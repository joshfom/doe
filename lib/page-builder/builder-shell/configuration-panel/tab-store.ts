"use client";

/**
 * TabStore — holds the active ConfigurationPanel tab for an editor session.
 *
 * Spec: custom-branded-page-builder — Requirement 3.3 (tab state preserved
 * across block selection changes).
 *
 * The store is module-scoped and framework-agnostic. It's built on the same
 * tiny pub/sub primitive used by `document-store` and `selection-store`
 * (`../store.ts`), which keeps the builder-shell consistent and lets us
 * unit/property-test without React.
 *
 * Consumer patterns:
 *   - React components use the `useTabStore()` hook
 *   - Non-React consumers (tests, helpers) use `tabStore.getState()` and
 *     `tabStore.setActiveTab(...)` directly against the module-level instance.
 *
 * Scope: per editor session (see `design.md` state-store table). There is
 * no persistence to `localStorage` or `sessionStorage` — a browser refresh
 * resets the active tab to the default `"configurations"`.
 */

import React from "react";
import { createStore } from "../store";
import type { ConfigurationTab } from "./ConfigurationPanel";

export interface TabState {
  activeTab: ConfigurationTab;
}

export interface TabStoreApi {
  getState: () => TabState;
  subscribe: (listener: () => void) => () => void;
  setActiveTab: (tab: ConfigurationTab) => void;
  reset: () => void;
}

const DEFAULT_TAB: ConfigurationTab = "configurations";

/**
 * Create a fresh tab store instance. Exported for tests and for
 * components that want their own isolated store.
 */
export function createTabStore(
  initial: ConfigurationTab = DEFAULT_TAB,
): TabStoreApi {
  const store = createStore<TabState>({ activeTab: initial });
  return {
    getState: store.getState,
    subscribe: store.subscribe,
    setActiveTab: (tab) =>
      store.setState((prev) =>
        prev.activeTab === tab ? prev : { ...prev, activeTab: tab },
      ),
    reset: () =>
      store.setState((prev) =>
        prev.activeTab === DEFAULT_TAB
          ? prev
          : { ...prev, activeTab: DEFAULT_TAB },
      ),
  };
}

/**
 * Module-scoped singleton. This is the store the `ConfigurationPanel`
 * binds to so tab state survives selection changes within a session.
 */
export const tabStore: TabStoreApi = createTabStore();

/**
 * React hook that subscribes to the module-scoped tab store.
 * Returns a tuple-shaped object for ergonomic destructuring.
 */
export function useTabStore(): {
  activeTab: ConfigurationTab;
  setActiveTab: (tab: ConfigurationTab) => void;
} {
  const activeTab = React.useSyncExternalStore(
    tabStore.subscribe,
    () => tabStore.getState().activeTab,
    () => DEFAULT_TAB,
  );
  return { activeTab, setActiveTab: tabStore.setActiveTab };
}
