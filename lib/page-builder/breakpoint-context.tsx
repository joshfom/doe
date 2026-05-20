"use client";

/**
 * Breakpoint React context — provider + hook.
 *
 * Spec: custom-branded-page-builder — Requirement 12.4 (default to desktop),
 * Requirement 11 (breakpoint-aware field storage), Slice 1 scaffolding for
 * task 8.1.
 *
 * This file lives alongside the pure helpers in `./breakpoints.ts` so both
 * the public renderer (which needs only the type helpers) and the builder
 * shell (which needs the React context) can coexist in the same directory
 * without conflicting module resolution:
 *
 *   - `breakpoints.ts`         — pure helpers, no React, no DOM. Safe to
 *                                import from server components.
 *   - `breakpoint-context.tsx` — React context, provider, hook. Carries
 *                                the `"use client"` directive.
 *
 * Slice 1 stub
 * ------------
 * For task 8.1 (Slice 1 — ORA-Branded Builder Shell), the provider exposes
 * a fixed `"desktop"` active breakpoint and a no-op setter. That's enough
 * to let the shell wrap its tree with a real provider today without
 * breaking the promise that "full switcher arrives in Slice 3" (task 10.1).
 * When Slice 3 lands this file will be consolidated with `breakpoints.ts`
 * into a single `breakpoints.tsx` (per design.md), exposing a real
 * `useState`-backed provider and the BreakpointSwitcher integration.
 * Consumers keep working because `useBreakpoint()` already returns the
 * `{ activeBreakpoint, setActiveBreakpoint }` shape.
 *
 * Re-exports
 * ----------
 * Every pure helper and type from `./breakpoints.ts` is re-exported here
 * so consumers that need both the React context *and* helpers can import
 * from a single module.
 */

import React from "react";
import {
  type Breakpoint,
  BREAKPOINTS,
  type BreakpointsThresholds,
  type BreakpointValue,
  type VisibilityFlags,
  clearSlot,
  isBreakpointValue,
  migrateLegacyScalar,
  resolveBreakpointValue,
} from "./breakpoints";

// Re-export pure helpers + types so callers only need this one module.
export {
  type Breakpoint,
  BREAKPOINTS,
  type BreakpointsThresholds,
  type BreakpointValue,
  type VisibilityFlags,
  clearSlot,
  isBreakpointValue,
  migrateLegacyScalar,
  resolveBreakpointValue,
};

// ─── Context ────────────────────────────────────────────────────────────────

export interface BreakpointContextValue {
  /**
   * The breakpoint that receives writes from the ConfigurationPanel and
   * that `BreakpointAwareFieldWrapper` resolves displayed values against.
   *
   * Slice 1: always `"desktop"`.
   * Slice 3: driven by the `BreakpointSwitcher` in the top bar.
   */
  activeBreakpoint: Breakpoint;

  /**
   * Change the active breakpoint. In Slice 1 this is a no-op — the stub
   * provider keeps the value pinned to `"desktop"` (Req 12.4 default)
   * because the switcher UI hasn't shipped yet. Keeping the setter in
   * the hook's return shape means no call-site has to change when Slice
   * 3 swaps the implementation.
   */
  setActiveBreakpoint: (bp: Breakpoint) => void;
}

const DEFAULT_CONTEXT_VALUE: BreakpointContextValue = {
  activeBreakpoint: "desktop",
  setActiveBreakpoint: () => {
    // No-op in Slice 1. Slice 3 replaces the provider with a stateful
    // implementation backed by `useState` + a `BreakpointSwitcher`.
  },
};

const BreakpointContext = React.createContext<BreakpointContextValue>(
  DEFAULT_CONTEXT_VALUE,
);
BreakpointContext.displayName = "BreakpointContext";

// ─── Provider ───────────────────────────────────────────────────────────────

export interface BreakpointProviderProps {
  /**
   * Optional initial breakpoint. Defaults to `"desktop"` per Requirement
   * 12.4. The Slice 1 stub ignores changes to this value after mount —
   * the intent is documented so tests can pass a non-default for future
   * slices without rewriting the stub.
   */
  initial?: Breakpoint;
  children: React.ReactNode;
}

/**
 * BreakpointProvider — stateful, Slice 3.
 *
 * Holds the active breakpoint in `useState`, defaulting to `"desktop"`
 * (Req 12.4). The setter is exposed via `useBreakpoint()` so the
 * BreakpointSwitcher in the top bar (task 10.2) and any consumer can
 * change the active tier.
 */
export function BreakpointProvider({
  initial = "desktop",
  children,
}: BreakpointProviderProps): React.ReactElement {
  const [activeBreakpoint, setActiveBreakpoint] =
    React.useState<Breakpoint>(initial);

  const value = React.useMemo<BreakpointContextValue>(
    () => ({ activeBreakpoint, setActiveBreakpoint }),
    [activeBreakpoint],
  );

  return (
    <BreakpointContext.Provider value={value}>
      {children}
    </BreakpointContext.Provider>
  );
}

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Read the active breakpoint and its setter.
 *
 * When called outside of a `<BreakpointProvider>`, returns a sensible
 * default (`"desktop"` + no-op setter) so unit tests and renderer paths
 * that don't mount the provider don't need defensive wiring.
 */
export function useBreakpoint(): BreakpointContextValue {
  return React.useContext(BreakpointContext);
}
