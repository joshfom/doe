"use client";

/**
 * ComponentSheet — ORA-branded, bottom-anchored draggable "add component"
 * sheet for the Live_Editor (`/ora-panel/live/[id]`).
 *
 * Spec: live-page-editor — task 7.1 (base + drag states + ORA chrome),
 *       task 7.3 (palette listing + search filter).
 * _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.11_
 *
 * Scope of task 7.1 (base):
 *   - A bottom-anchored floating sheet within the Editor_Shell (Req 6.1) with
 *     two states: `collapsed` (drag handle only — Req 6.2) and `expanded`.
 *   - State derived from a drag of the handle versus a threshold of 20% of the
 *     Editor_Shell height: dragging the handle UP past the threshold expands
 *     the sheet (Req 6.3); dragging DOWN below the threshold collapses it
 *     (Req 6.4). The threshold decision is factored into the pure, exported
 *     `resolveSheetState` helper so task 7.2's property test can import it.
 *   - ORA tokens (`ORA_THEME`) throughout (Req 6.11).
 *   - The sheet root carries `data-inline-editor-ui` so the
 *     Navigation_Neutralizer exempts it from neutralization / block selection
 *     (Req 4.7).
 *
 * Scope of task 7.3 (palette listing + search):
 *   - The expanded state lists every palette component derived from the live
 *     Puck config's `categories` + `components`, grouped/labeled exactly like
 *     the builder's `ComponentPalette` via the shared `buildPaletteGroups`
 *     helper + `PALETTE_META`/`FALLBACK_META`, in a vertically scrollable area
 *     (Req 6.5).
 *   - The search field filters via the pure, re-exported `matchesQuery`
 *     helper (case-insensitive substring over name + description). An empty
 *     query lists all components; a non-matching query shows the empty-result
 *     indicator and lists zero components (Req 6.6, 6.7).
 *
 * Deferred to later tasks (clearly-marked extension points below):
 *   - Task 7.5 — insertion dispatch wiring (`onInsert` is invoked from
 *     `handleSelect`; the real Puck `insert` dispatch + position logic lands
 *     there) (Req 6.8, 6.9, 6.10).
 *
 * The prop interface is the `ComponentSheet` contract from design.md.
 */

import React from "react";
import { ORA_THEME } from "@/lib/page-builder/builder-shell/inspector/tokens";
import { usePuckStore } from "@/lib/page-builder/use-puck-store";
import {
  PALETTE_META,
  FALLBACK_META,
  buildPaletteGroups,
  matchesQuery,
  type PaletteCategory,
  type PaletteComponentDef,
} from "@/lib/page-builder/builder-shell/palette-meta";

/**
 * Re-exported pure search helper (task 7.3 / design Property 5).
 *
 * `matchesQuery(label, description, query)` is a case-insensitive substring
 * match across a component's name and description; an empty query matches
 * everything. It is the single source of truth shared with the builder's
 * `ComponentPalette`, re-exported here so task 7.4's property test can import
 * it directly from the ComponentSheet module (Req 6.6, 6.7).
 */
export { matchesQuery } from "@/lib/page-builder/builder-shell/palette-meta";

/** Collapsed (handle only) vs expanded (palette visible). */
export type SheetState = "collapsed" | "expanded";

/** Drag distance, as a fraction of Editor_Shell height, that toggles state. */
export const SHEET_DRAG_THRESHOLD_RATIO = 0.2;

/**
 * resolveSheetState — pure threshold decision for the component sheet.
 *
 * Sign convention (DOM-native): `dragDeltaPx` is the cumulative vertical
 * pointer movement from the drag start, where DOWN is POSITIVE and UP is
 * NEGATIVE (matching `clientY`, which increases downward). The upward drag
 * distance is therefore `-dragDeltaPx` (positive while dragging up).
 *
 * Decision (Req 6.3, 6.4 / design Property 7): the sheet is `expanded` iff the
 * upward drag distance exceeds 20% of the Editor_Shell height, and `collapsed`
 * otherwise:
 *
 *     expanded  ⟺  (-dragDeltaPx) > 0.2 * shellHeightPx
 *
 * `current` is returned unchanged only for a degenerate (non-positive or
 * non-finite) shell height, where no meaningful threshold can be computed; for
 * every positive height the result depends solely on the drag delta, so the
 * threshold is a strict function of `(dragDeltaPx, shellHeightPx)`.
 *
 * Pure: no I/O, no DOM, no React — directly unit-/property-testable.
 */
export function resolveSheetState(
  dragDeltaPx: number,
  shellHeightPx: number,
  current: SheetState,
): SheetState {
  if (!Number.isFinite(shellHeightPx) || shellHeightPx <= 0) {
    // Cannot compute a threshold against an unmeasured/degenerate shell —
    // retain the current state rather than guessing.
    return current;
  }
  const threshold = SHEET_DRAG_THRESHOLD_RATIO * shellHeightPx;
  const upwardDistancePx = -dragDeltaPx; // up is negative delta
  return upwardDistancePx > threshold ? "expanded" : "collapsed";
}

/**
 * A single palette entry the expanded sheet lists and can insert. Built from
 * the Puck config's `components` (label) and the shared `PALETTE_META`
 * (description), so the listing matches the builder's `ComponentPalette`.
 */
export interface PaletteItem {
  /** Puck component type, passed to `onInsert`. */
  type: string;
  /** Human-readable label shown in the list. */
  label: string;
  /** Description used by the search filter and shown under the label. */
  description: string;
}

/** A titled group of palette items, mirroring `ComponentPalette` grouping. */
interface PaletteItemGroup {
  key: string;
  title: string;
  items: PaletteItem[];
}

/**
 * usePaletteItemGroups — derive the grouped, ordered palette listing from the
 * live Puck config (Req 6.5).
 *
 * Reuses the SAME derivation as the builder's `ComponentPalette`:
 * `buildPaletteGroups` (category ordering + "Other" bucket) for grouping, the
 * config's per-component `label` for names, and `PALETTE_META`/`FALLBACK_META`
 * for descriptions. This component is mounted inside `<Puck>`, so the config is
 * read via `usePuckStore` exactly as `ComponentPalette` does — no separate
 * registry to keep in sync.
 */
function usePaletteItemGroups(): PaletteItemGroup[] {
  const config = usePuckStore((s) => s.config);

  const categories = React.useMemo(
    () => (config.categories ?? {}) as Record<string, PaletteCategory>,
    [config.categories],
  );
  const components = React.useMemo(
    () => (config.components ?? {}) as Record<string, PaletteComponentDef>,
    [config.components],
  );

  return React.useMemo(() => {
    return buildPaletteGroups(categories, components).map((group) => ({
      key: group.key,
      title: group.title,
      items: group.items.map((name) => {
        const meta = PALETTE_META[name] ?? FALLBACK_META;
        return {
          type: name,
          label: components[name]?.label ?? name,
          description: meta.description,
        };
      }),
    }));
  }, [categories, components]);
}

export interface ComponentSheetProps {
  /** Drives insertion target; null → insert at end of page (Req 6.9). */
  selectedId: string | null;
  /** Insert a component type; resolves false on failure (Req 6.10). */
  onInsert: (type: string) => Promise<boolean> | boolean;
}

/** Distance (px) below which a pointer gesture is treated as a tap, not a drag. */
const TAP_TOLERANCE_PX = 4;

/** Resolve the Editor_Shell height the threshold is measured against. */
function getShellHeightPx(sheetEl: HTMLElement | null): number {
  // The sheet is bottom-anchored *within* the Editor_Shell, so its offset
  // parent is the shell's positioned container.
  const parent = sheetEl?.offsetParent as HTMLElement | null;
  if (parent && parent.clientHeight > 0) return parent.clientHeight;
  if (typeof window !== "undefined") return window.innerHeight;
  return 0;
}

export function ComponentSheet({
  selectedId,
  onInsert,
}: ComponentSheetProps): React.ReactElement {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const dragStartYRef = React.useRef<number | null>(null);

  // Palette listing derived from the live Puck config (Req 6.5).
  const itemGroups = usePaletteItemGroups();

  const [state, setState] = React.useState<SheetState>("collapsed");
  const [dragging, setDragging] = React.useState(false);
  // Live drag delta (px) for visual feedback while the handle is held.
  const [dragDeltaPx, setDragDeltaPx] = React.useState(0);
  // Search query — filters the listing via the pure `matchesQuery` helper.
  const [query, setQuery] = React.useState("");
  // Inline error indication for a failed insertion (Req 6.10; wired in 7.5).
  const [insertError, setInsertError] = React.useState<string | null>(null);

  const expanded = state === "expanded";

  // Filter each group's items by the case-insensitive substring match over
  // name + description (Req 6.6). An empty query matches everything (so all
  // components are listed); groups with zero matches collapse away. The flat
  // match count drives the empty-result indicator (Req 6.7).
  const filteredGroups = React.useMemo(
    () =>
      itemGroups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) =>
            matchesQuery(item.label, item.description, query),
          ),
        }))
        .filter((group) => group.items.length > 0),
    [itemGroups, query],
  );

  const matchCount = React.useMemo(
    () => filteredGroups.reduce((total, group) => total + group.items.length, 0),
    [filteredGroups],
  );

  const trimmedQuery = query.trim();

  const toggle = React.useCallback(() => {
    setState((prev) => (prev === "expanded" ? "collapsed" : "expanded"));
  }, []);

  // ── Drag handling on the handle ────────────────────────────────────────
  const onHandlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      dragStartYRef.current = event.clientY;
      setDragging(true);
      setDragDeltaPx(0);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [],
  );

  const onHandlePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (dragStartYRef.current === null) return;
      setDragDeltaPx(event.clientY - dragStartYRef.current);
    },
    [],
  );

  const endDrag = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (dragStartYRef.current === null) return;
      const delta = event.clientY - dragStartYRef.current;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      dragStartYRef.current = null;
      setDragging(false);
      setDragDeltaPx(0);

      if (Math.abs(delta) < TAP_TOLERANCE_PX) {
        // Negligible movement → treat as a tap toggle for pointer + a11y parity.
        toggle();
        return;
      }
      const shellHeight = getShellHeightPx(rootRef.current);
      setState((prev) => resolveSheetState(delta, shellHeight, prev));
    },
    [toggle],
  );

  const onHandleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        toggle();
      }
    },
    [toggle],
  );

  // ── Insertion select wiring (real dispatch lands in task 7.5) ──────────
  const handleSelect = React.useCallback(
    async (type: string) => {
      setInsertError(null);
      try {
        const ok = await onInsert(type);
        if (!ok) {
          setInsertError("Couldn't add that component. Please try again.");
        }
      } catch {
        setInsertError("Couldn't add that component. Please try again.");
      }
    },
    [onInsert],
  );

  // Insertion-target hint: after the selected block, else at the end (Req 6.8/6.9).
  const insertionHint =
    selectedId !== null ? "Inserts after the selected block" : "Inserts at the end of the page";

  // Visual feedback: while dragging, nudge the sheet with the live delta so the
  // gesture feels direct. Final state is decided in `endDrag` via the pure
  // threshold helper. Negative delta (dragging up) lifts the sheet.
  const dragNudgePx = dragging ? Math.min(0, dragDeltaPx) : 0;

  return (
    <div
      ref={rootRef}
      data-inline-editor-ui=""
      data-testid="live-component-sheet"
      data-state={state}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        background: ORA_THEME.charcoal,
        color: ORA_THEME.white,
        borderTop: `1px solid ${ORA_THEME.border}`,
        boxShadow: "0 -4px 24px rgba(0,0,0,0.28)",
        transform: `translateY(${dragNudgePx}px)`,
        transition: dragging ? "none" : "transform 200ms ease",
        fontFamily: "inherit",
      }}
    >
      {/* Drag handle — the only affordance shown while collapsed (Req 6.2). */}
      <button
        type="button"
        aria-label="Component library"
        aria-expanded={expanded}
        data-testid="live-component-sheet-handle"
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onHandleKeyDown}
        style={{
          appearance: "none",
          border: "none",
          background: "transparent",
          color: ORA_THEME.white,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          padding: "10px 16px",
          cursor: dragging ? "grabbing" : "grab",
          touchAction: "none",
        }}
      >
        {/* Grabber pill */}
        <span
          aria-hidden="true"
          style={{
            width: 44,
            height: 5,
            borderRadius: 0,
            background: ORA_THEME.gold,
            display: "block",
          }}
        />
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: ORA_THEME.white,
          }}
        >
          {expanded ? "Drag down to close" : "Add component"}
        </span>
      </button>

      {/* Expanded body — palette listing + search land in task 7.3. */}
      {expanded ? (
        <div
          data-testid="live-component-sheet-body"
          style={{
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            maxHeight: "60vh",
            borderTop: `1px solid ${ORA_THEME.charcoalDark}`,
          }}
        >
          {/* Search field (filtering implemented in task 7.3). */}
          <div style={{ padding: "12px 16px 8px" }}>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search components"
              aria-label="Search components"
              data-testid="live-component-sheet-search"
              style={{
                width: "100%",
                height: 34,
                padding: "0 12px",
                fontSize: 13,
                color: ORA_THEME.charcoalDark,
                background: ORA_THEME.white,
                border: `1px solid ${ORA_THEME.border}`,
                borderRadius: 0,
                outline: "none",
              }}
            />
            <p
              style={{
                margin: "8px 0 0",
                fontSize: 11,
                letterSpacing: "0.04em",
                color: ORA_THEME.gold,
              }}
            >
              {insertionHint}
            </p>
          </div>

          {/* Failed-insertion indication (Req 6.10; populated in task 7.5). */}
          {insertError !== null ? (
            <div
              role="alert"
              data-testid="live-component-sheet-error"
              style={{
                margin: "0 16px 8px",
                padding: "6px 10px",
                background: ORA_THEME.danger,
                color: ORA_THEME.white,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {insertError}
            </div>
          ) : null}

          {/* Scrollable palette list (Req 6.5), grouped/labeled to mirror the
              builder's ComponentPalette. Filtered by the case-insensitive
              search (Req 6.6); zero matches shows the empty-result indicator
              and lists no components (Req 6.7). */}
          <div
            role="list"
            data-testid="live-component-sheet-list"
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              padding: "0 16px 16px",
            }}
          >
            {matchCount === 0 ? (
              // Empty-result indicator (Req 6.7).
              <p
                role="status"
                data-testid="live-component-sheet-empty"
                style={{ color: ORA_THEME.muted, fontSize: 13, padding: "12px 0" }}
              >
                {trimmedQuery
                  ? `No components match "${trimmedQuery}".`
                  : "No components available."}
              </p>
            ) : (
              filteredGroups.map((group) => (
                <section key={group.key} aria-label={group.title}>
                  <h3
                    style={{
                      margin: 0,
                      padding: "12px 0 4px",
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: ORA_THEME.gold,
                    }}
                  >
                    {group.title}
                  </h3>
                  {group.items.map((item) => (
                    <button
                      key={item.type}
                      type="button"
                      role="listitem"
                      data-testid="live-component-sheet-item"
                      data-component-type={item.type}
                      onClick={() => handleSelect(item.type)}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 12px",
                        marginBottom: 6,
                        background: ORA_THEME.charcoalDark,
                        color: ORA_THEME.white,
                        border: `1px solid ${ORA_THEME.border}`,
                        borderRadius: 0,
                        cursor: "pointer",
                        fontSize: 13,
                      }}
                    >
                      <span style={{ display: "block", fontWeight: 600 }}>
                        {item.label}
                      </span>
                      <span
                        style={{
                          display: "block",
                          marginTop: 2,
                          fontSize: 11,
                          lineHeight: 1.35,
                          color: ORA_THEME.muted,
                        }}
                      >
                        {item.description}
                      </span>
                    </button>
                  ))}
                </section>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default ComponentSheet;
