"use client";

/**
 * SelectionLiveRegion — visually-hidden `aria-live="polite"` region that
 * announces block selection changes to assistive tech.
 *
 * Spec: custom-branded-page-builder — task 8.3
 * _Requirements: 18.4_
 *
 * Mounted inside `<Puck>` so it can read the current selection via
 * `usePuck()`. The announcement string mirrors the label resolution used by
 * `SelectedElementHeader` (instance `_label` → registered `label` →
 * component type) so screen readers and the floating toolbar stay in sync.
 *
 * Also exposes `SelectionAnnounceProvider` and `useSelectionAnnounce()` for
 * imperative announcements triggered by breadcrumb/tree navigation (task 11.2).
 */

import React from "react";
import { usePuckStore } from "../use-puck-store";

const VISUALLY_HIDDEN: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0,0,0,0)",
  whiteSpace: "nowrap",
  border: 0,
};

// ─── Context for imperative announcements ────────────────────────────────────

type AnnounceFunction = (label: string) => void;

const SelectionAnnounceContext = React.createContext<AnnounceFunction>(() => {});

/**
 * Hook for imperatively announcing a selection change through the live region.
 * Used by breadcrumb and outline tree `onSelect` handlers to ensure the
 * announcement fires even when the Puck store selection hasn't changed
 * (e.g., re-selecting the same block).
 */
export function useSelectionAnnounce(): AnnounceFunction {
  return React.useContext(SelectionAnnounceContext);
}

/**
 * Provider that wraps the builder shell and exposes the `announce` function
 * to sibling/descendant components. Must be mounted above both the live region
 * and the components that call `useSelectionAnnounce()`.
 */
export function SelectionAnnounceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [imperative, setImperative] = React.useState<{
    message: string;
    key: number;
  } | null>(null);

  const keyRef = React.useRef(0);

  const announce = React.useCallback<AnnounceFunction>((label: string) => {
    keyRef.current += 1;
    setImperative({ message: `${label} selected`, key: keyRef.current });
  }, []);

  // Clear imperative announcement after a short delay so the store-driven
  // message takes over again for subsequent automatic announcements.
  React.useEffect(() => {
    if (imperative == null) return;
    const timer = setTimeout(() => setImperative(null), 1000);
    return () => clearTimeout(timer);
  }, [imperative]);

  return (
    <SelectionAnnounceContext.Provider value={announce}>
      {children}
      {imperative && (
        <div
          role="log"
          aria-live="assertive"
          aria-atomic="true"
          data-testid="ora-selection-announce"
          style={VISUALLY_HIDDEN}
          key={imperative.key}
        >
          {imperative.message}
        </div>
      )}
    </SelectionAnnounceContext.Provider>
  );
}

export function SelectionLiveRegion() {
  const selectedItem = usePuckStore((s) => s.selectedItem);
  const config = usePuckStore((s) => s.config);

  const message = React.useMemo(() => {
    if (!selectedItem) return "Selection cleared";
    const instanceLabel = (selectedItem.props as { _label?: unknown })._label;
    if (typeof instanceLabel === "string" && instanceLabel.length > 0) {
      return `${instanceLabel} selected`;
    }
    const registered = (
      config.components?.[selectedItem.type] as { label?: unknown } | undefined
    )?.label;
    if (typeof registered === "string" && registered.length > 0) {
      return `${registered} selected`;
    }
    return `${selectedItem.type} selected`;
  }, [selectedItem, config]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="ora-selection-live-region"
      style={VISUALLY_HIDDEN}
    >
      {message}
    </div>
  );
}
