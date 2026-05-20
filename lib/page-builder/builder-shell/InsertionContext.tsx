"use client";

/**
 * InsertionContext — coordinates the insertion-button → component-picker flow.
 *
 * Spec: builder-outline-tree-and-toolbar
 * _Requirements: 5.3, 5.4, 5.5_
 *
 * Task 2.1 introduces a lightweight context that bridges two components
 * which are mounted in different parts of the React tree:
 *
 *   - `InsertionButton` instances are rendered *inside* the Puck preview
 *     by the `componentItem` override (task 4.x). They need a way to
 *     request that the picker open at their viewport position.
 *   - `ComponentPickerPopover` is mounted *once* near the BuilderShell
 *     root and portals to `document.body` (task 7.x). It needs to know
 *     which button (anchor) opened it and where the new component
 *     should land in Puck's data model.
 *
 * Prop-drilling through the Puck render tree is impractical because the
 * tree is owned by Puck internals; React context is the natural seam.
 *
 * Dispatch mapping (per design "InsertionContext (State Management)"):
 *   - `insertComponent(type)` →
 *       1. `dispatch({ type: "insert", componentType: type, destinationZone,
 *           destinationIndex, id })` with a freshly generated id
 *       2. `dispatch({ type: "setUi", ui: { itemSelector: { zone, index } } })`
 *           so the new block is selected and its props appear in the
 *           Configuration_Panel (Req 5.4)
 *       3. `closePicker()` so the popover unmounts (Req 5.5)
 *
 * The id-generation strategy mirrors `SelectedElementHeader.tsx` exactly —
 * keeping the helper local avoids importing the heavier
 * `templates/component-templates.ts` module into the shell's tree-shake
 * graph, while still producing the same `${type}-${uuid}` shape Puck
 * already uses elsewhere.
 */

import React from "react";
import { usePuckStore } from "../use-puck-store";
import { useSelectionAnnounce } from "./SelectionLiveRegion";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface InsertionState {
  /** The DOM element the picker should anchor to. */
  anchorEl: HTMLElement;
  /** The zone compound key (e.g. "root:default-zone") to insert into. */
  zone: string;
  /** The index within the zone where the new component will land. */
  index: number;
}

export interface InsertionContextValue {
  /** Current picker state. `null` when the picker is closed. */
  state: InsertionState | null;
  /** Open the picker anchored to a button at the given zone/index. */
  openPicker: (anchorEl: HTMLElement, zone: string, index: number) => void;
  /** Close the picker without inserting. */
  closePicker: () => void;
  /**
   * Insert a component of the given type at the currently-open picker's
   * zone/index, then select it and close the picker. No-op if the picker
   * is closed.
   */
  insertComponent: (componentType: string) => void;
}

// ─── ID generation ───────────────────────────────────────────────────────────

/**
 * Generate a fresh component instance id. Identical strategy to
 * `SelectedElementHeader.tsx` — the format is opaque to Puck (which only
 * requires uniqueness) and the `crypto.randomUUID` fallback keeps the
 * helper safe in environments where the API is missing (older jsdom).
 */
function generateComponentId(componentType: string): string {
  const suffix =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${componentType}-${suffix}`;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const InsertionContext = React.createContext<InsertionContextValue | null>(
  null,
);

export interface InsertionProviderProps {
  children: React.ReactNode;
}

export function InsertionProvider({ children }: InsertionProviderProps) {
  const dispatch = usePuckStore((s) => s.dispatch);
  const config = usePuckStore((s) => s.config);
  const announce = useSelectionAnnounce();
  const [state, setState] = React.useState<InsertionState | null>(null);

  // Track the latest state in a ref so callbacks can read it without
  // taking a dependency on `state` (which would force their identities
  // to churn on every open/close and re-arm effects in
  // `ComponentPickerPopover`). The ref is updated synchronously on each
  // render via `useRef` initialization + assignment below — this is
  // safe because we only read it from event handlers, never during
  // render itself.
  const stateRef = React.useRef<InsertionState | null>(state);
  stateRef.current = state;

  const openPicker = React.useCallback(
    (anchorEl: HTMLElement, zone: string, index: number) => {
      setState({ anchorEl, zone, index });
    },
    [],
  );

  const closePicker = React.useCallback(() => {
    // Focus restoration (Req 6.4) — when the picker closes without an
    // insertion (Escape, click-outside, or programmatic close from a
    // consumer), return focus to the InsertionButton that opened it so
    // keyboard users land back at the trigger they were operating. The
    // anchor element is the canonical reference because it IS the
    // triggering button: InsertionButton calls
    // `openPicker(buttonEl, ...)` with its own DOM node.
    //
    // We focus BEFORE clearing state so the ref still points at the
    // anchor; the order is observationally identical to the user (the
    // popover unmounts on the next render either way), and it keeps
    // the focus side effect out of the setState updater so React's
    // strict-mode double-invocation never re-fires `focus`.
    //
    // Focus is intentionally skipped in `insertComponent` — once the
    // editor selects a component, focus belongs to the newly inserted
    // block (selection moves there via the `setUi` dispatch and the
    // live region announces the change), not the trigger button.
    const anchorEl = stateRef.current?.anchorEl;
    if (anchorEl) {
      anchorEl.focus();
    }
    setState(null);
  }, []);

  const insertComponent = React.useCallback(
    (componentType: string) => {
      // Snapshot the current state so the dispatches use a stable target
      // even though we close the picker (and thus reset state) below.
      // React batches the setState in `closePicker` so this is mostly
      // theoretical, but keeping the local copy makes the action atomic
      // from the caller's perspective.
      setState((prev) => {
        if (!prev) return prev;

        const { zone, index } = prev;
        const id = generateComponentId(componentType);

        // Step 1 — insert a fresh component at the requested position.
        // Puck's reducer builds the new item from `componentType` + `id`
        // and the block's `defaultProps`. Picker callers may follow this
        // up with a `replace` if they need custom initial props; the
        // default flow (task 5.3) uses defaults.
        dispatch({
          type: "insert",
          componentType,
          destinationIndex: index,
          destinationZone: zone,
          id,
        });

        // Step 2 — move selection to the newly inserted item so its
        // configuration fields appear in the right-side panel
        // (Req 5.4). Puck's `insert` reducer does not touch the item
        // selector, so we set it explicitly.
        dispatch({
          type: "setUi",
          ui: {
            itemSelector: { zone, index },
          },
        });

        // Step 3 — announce the selection through the shared live
        // region (Req 6.5). The label resolution mirrors the convention
        // used by `SelectionLiveRegion` and `SelectedElementHeader`
        // (registered config label → component type) so screen readers
        // hear the same name they would on direct canvas selection.
        // A freshly inserted block has no per-instance `_label` yet, so
        // we skip that step. `useSelectionAnnounce` returns a no-op when
        // there is no `<SelectionAnnounceProvider>` ancestor, so this
        // call is safe even in test harnesses that omit the provider.
        const registeredLabel = (
          config?.components?.[componentType] as
            | { label?: unknown }
            | undefined
        )?.label;
        const label =
          typeof registeredLabel === "string" && registeredLabel.length > 0
            ? registeredLabel
            : componentType;
        announce(label);

        // Step 4 — close the picker (Req 5.5). Returning `null` from the
        // updater is equivalent to calling `closePicker()` without the
        // extra render pass.
        return null;
      });
    },
    [dispatch, config, announce],
  );

  const value = React.useMemo<InsertionContextValue>(
    () => ({ state, openPicker, closePicker, insertComponent }),
    [state, openPicker, closePicker, insertComponent],
  );

  return (
    <InsertionContext.Provider value={value}>
      {children}
    </InsertionContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Read the insertion context. Must be called from a descendant of
 * `<InsertionProvider>`. Throws otherwise so missing providers fail loudly
 * at mount time rather than producing silent no-op buttons.
 */
export function useInsertion(): InsertionContextValue {
  const value = React.useContext(InsertionContext);
  if (!value) {
    throw new Error(
      "useInsertion must be called inside an <InsertionProvider>",
    );
  }
  return value;
}
