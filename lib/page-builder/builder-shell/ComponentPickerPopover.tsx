"use client";

/**
 * ComponentPickerPopover — categorized, searchable popover that opens when
 * an `InsertionButton` is clicked on the canvas, listing the components the
 * editor can drop at that exact zone/index.
 *
 * Spec: builder-outline-tree-and-toolbar (Tasks 7.1, 7.2, 7.3)
 * _Requirements: 5.1, 5.2, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 6.3, 6.4_
 *
 * Task 7.1 implemented the BASE popover (portal, positioning, listing,
 * search, zone filtering). Task 7.2 layered in keyboard-and-pointer
 * dismissal and the focus trap. Task 7.3 covers the zero-results UX:
 * when `filteredGroups` is empty, render a single "No components match"
 * message and skip all category headings entirely (Req 5.7) — because
 * empty `<section>` blocks would otherwise leak ghost headings into the
 * accessibility tree.
 *
 * ─── Focus trap & dismissal (Req 5.8, 5.10, 6.3, 6.4) ───────────────────────
 *
 * The popover root carries an `onKeyDown` handler that:
 *   - Closes the popover on `Escape`, calling `onClose`. Focus restoration
 *     to the triggering `InsertionButton` is the caller's responsibility —
 *     the InsertionContext owner re-focuses the trigger element on close.
 *   - Traps `Tab` / `Shift+Tab` so focus cycles only through the popover's
 *     focusable descendants (Req 5.10 / Req 6.3). This is implemented as a
 *     bounded sentinel scheme: when Tab would move focus past the LAST
 *     focusable, we redirect to the FIRST; when Shift+Tab would move past
 *     the FIRST (or focus is currently outside the popover), we redirect
 *     to the LAST.
 *
 * Click-outside dismissal uses a `mousedown` listener on `document` (rather
 * than `click`) so the popover closes before any downstream `click` fires
 * — this prevents the situation where dismissing the popover by clicking
 * an element on the canvas would also trigger that element's click action
 * race-y with the close. The listener ignores clicks on the popover itself
 * AND on the `anchorEl` (the triggering InsertionButton). Excluding the
 * anchor ensures the InsertionButton's own click handler runs unhindered
 * — without this, a click on the same button that opened the popover
 * would close it via the outside-click path before the button's onClick
 * had a chance to (e.g.) toggle the picker shut.
 *
 * ─── Portal & positioning (Req 5.11) ────────────────────────────────────────
 *
 * Mirrors the `ElementHeader` portal pattern: `createPortal` to
 * `document.body` so the popover escapes the canvas's overflow/transform
 * stacking context, position computed from `anchorEl.getBoundingClientRect()`
 * and routed through `useSyncExternalStore` so scroll/resize updates flow
 * through subscriptions rather than effect-driven setState. We center the
 * popover below the anchor and then clamp horizontally and vertically to
 * stay inside the viewport (Req 5.11 forbids overflow in either axis).
 *
 * ─── Component listing (Req 5.1, 5.2) ───────────────────────────────────────
 *
 * The same metadata source as `ComponentPalette` (`palette-meta.ts`) drives
 * the icons and descriptions, so the picker and the palette never drift.
 * Categories render in `CATEGORY_ORDER`; any extra categories appear after
 * the fixed three; unregistered components fall into an "Other" group.
 *
 * ─── Zone filtering (Req 5.9) ───────────────────────────────────────────────
 *
 * `resolveZoneConstraints(zone, config, data)` returns `{ allow, disallow }`
 * for the target zone. We strip disallowed types and (when `allow` is
 * non-empty) keep only allowed types before grouping. This is applied
 * before search filtering so the search can never reveal a disallowed
 * component (Property 2 from the design).
 *
 * ─── Search input (Req 5.6, 5.7) ────────────────────────────────────────────
 *
 * The input is auto-focused on open and updates query state on every
 * keystroke (no debounce). `matchesQuery` (the same helper the palette uses)
 * does case-insensitive substring matching on label + description. When
 * the filter pipeline yields zero matches across all categories, the body
 * renders a single "No components match" message and ALL category
 * headings are suppressed (Req 5.7) — implemented by branching on
 * `filteredGroups.length === 0` rather than mapping empty groups, so
 * neither headings nor empty sections reach the DOM.
 */

import React from "react";
import { createPortal } from "react-dom";
import { usePuckStore } from "../use-puck-store";
import {
  PALETTE_META,
  FALLBACK_META,
  CATEGORY_ORDER,
  matchesQuery,
  type PaletteMeta,
} from "./palette-meta";
import { resolveZoneConstraints } from "./zone-constraints";
import { ORA_THEME } from "./inspector/tokens";

// ─── Public API ──────────────────────────────────────────────────────────────

export interface ComponentPickerPopoverProps {
  /** The DOM element to anchor the popover to. `null` ⇒ hidden. */
  anchorEl: HTMLElement | null;
  /** Zone compound key (e.g. "root:default-zone") for the insertion target. */
  zone: string;
  /** Index within the zone where the new component will land. */
  index: number;
  /** Called when the editor selects a component to insert. */
  onInsert: (componentType: string, zone: string, index: number) => void;
  /** Called when the popover should close without inserting. */
  onClose: () => void;
}

// ─── Sizing & layout constants ───────────────────────────────────────────────

/** Default popover width. The popover is allowed to shrink to fit the viewport. */
const POPOVER_WIDTH = 360;
/** Maximum popover height. Body scrolls within. */
const POPOVER_MAX_HEIGHT = 480;
/** Vertical gap between the anchor and the popover. */
const ANCHOR_GAP = 8;
/** Minimum margin from any viewport edge so the popover never sits flush. */
const VIEWPORT_MARGIN = 8;

// ─── Types & helpers ─────────────────────────────────────────────────────────

interface Position {
  top: number;
  left: number;
  width: number;
  /** Computed max-height so the popover fits below the anchor without overflow. */
  maxHeight: number;
}

type PaletteCategory = {
  title?: string;
  components?: string[];
};

type PaletteComponent = {
  label?: string;
};

/**
 * Compute the popover's clamped viewport position from the anchor's
 * bounding rect.
 *
 * Strategy:
 *   1. Try centered below the anchor with `ANCHOR_GAP` of breathing room.
 *   2. If horizontal overflow would occur, clamp `left` to viewport bounds.
 *   3. If vertical overflow would occur (anchor near the bottom of the
 *      viewport), flip ABOVE the anchor when more room exists there, else
 *      cap `maxHeight` so the popover scrolls within the available band.
 */
function computePosition(anchorEl: HTMLElement): Position {
  const rect = anchorEl.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // Width: never wider than the viewport (minus margins) so we always fit.
  const width = Math.min(
    POPOVER_WIDTH,
    viewportWidth - VIEWPORT_MARGIN * 2,
  );

  // Horizontal centering relative to the anchor, clamped to viewport.
  const anchorCenterX = rect.left + rect.width / 2;
  let left = anchorCenterX - width / 2;
  const maxLeft = viewportWidth - VIEWPORT_MARGIN - width;
  if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
  else if (left > maxLeft) left = maxLeft;

  // Available room below vs above the anchor (after subtracting the gap).
  const roomBelow = viewportHeight - rect.bottom - ANCHOR_GAP - VIEWPORT_MARGIN;
  const roomAbove = rect.top - ANCHOR_GAP - VIEWPORT_MARGIN;

  // Prefer below; flip above if there's meaningfully more room there AND
  // the natural popover height would otherwise be cramped below.
  let top: number;
  let maxHeight: number;
  if (roomBelow >= POPOVER_MAX_HEIGHT || roomBelow >= roomAbove) {
    top = rect.bottom + ANCHOR_GAP;
    maxHeight = Math.max(0, Math.min(POPOVER_MAX_HEIGHT, roomBelow));
  } else {
    maxHeight = Math.max(0, Math.min(POPOVER_MAX_HEIGHT, roomAbove));
    top = rect.top - ANCHOR_GAP - maxHeight;
  }

  // Final safety clamp: never let `top` push us above the viewport.
  if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;

  return { top, left, width, maxHeight };
}

/**
 * `useSyncExternalStore` snapshot of the anchor's viewport position. Mirrors
 * the pattern used by `ElementHeader.useAnchoredPosition` so scroll/resize
 * updates flow through subscriptions and the snapshot is referentially
 * stable while the geometry is unchanged.
 */
function useAnchoredPosition(anchorEl: HTMLElement | null): Position | null {
  const cachedKey = React.useRef<string>("");
  const cachedValue = React.useRef<Position | null>(null);

  const getSnapshot = React.useCallback((): Position | null => {
    if (!anchorEl || typeof window === "undefined") {
      if (cachedKey.current !== "__null__") {
        cachedKey.current = "__null__";
        cachedValue.current = null;
      }
      return cachedValue.current;
    }
    const pos = computePosition(anchorEl);
    const key = `${pos.top}:${pos.left}:${pos.width}:${pos.maxHeight}`;
    if (key !== cachedKey.current) {
      cachedKey.current = key;
      cachedValue.current = pos;
    }
    return cachedValue.current;
  }, [anchorEl]);

  const getServerSnapshot = React.useCallback((): Position | null => null, []);

  const subscribe = React.useCallback(
    (notify: () => void) => {
      if (!anchorEl || typeof window === "undefined") return () => {};

      // rAF-throttle bursts of scroll/resize so we read layout at most
      // once per frame.
      let rafId: number | null = null;
      let pending = false;
      const schedule = () => {
        if (pending) return;
        pending = true;
        rafId = requestAnimationFrame(() => {
          pending = false;
          rafId = null;
          notify();
        });
      };

      // Capture-phase scroll catches ancestor scroll containers (the
      // canvas typically lives inside a scrollable pane).
      window.addEventListener("scroll", schedule, true);
      window.addEventListener("resize", schedule);

      let resizeObserver: ResizeObserver | null = null;
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(schedule);
        resizeObserver.observe(anchorEl);
      }

      return () => {
        window.removeEventListener("scroll", schedule, true);
        window.removeEventListener("resize", schedule);
        if (resizeObserver) resizeObserver.disconnect();
        if (rafId !== null) cancelAnimationFrame(rafId);
      };
    },
    [anchorEl],
  );

  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Returns `true` once the component has hydrated on the client. Gates the
 * portal so SSR output stays empty.
 */
function useIsClient(): boolean {
  return React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/**
 * Resolve label + meta for a single component type. Keeps the rendering
 * path tiny and matches the priority order used elsewhere in the shell:
 * `config.components[type].label` → component type name as the fallback.
 */
function resolveComponentDisplay(
  type: string,
  components: Record<string, PaletteComponent>,
): { label: string; meta: PaletteMeta } {
  const registeredLabel = components[type]?.label;
  const label =
    typeof registeredLabel === "string" && registeredLabel.length > 0
      ? registeredLabel
      : type;
  const meta = PALETTE_META[type] ?? FALLBACK_META;
  return { label, meta };
}

/**
 * Selector matching the elements we treat as focusable inside the popover.
 * Mirrors the standard "focusable elements" list used by accessible
 * dialog / focus-trap libraries: links with hrefs, form controls that
 * aren't disabled, and any element with a non-negative tabindex. Items
 * with `tabindex="-1"` are intentionally excluded so programmatic focus
 * targets don't pollute the Tab cycle.
 */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Enumerate the popover's currently focusable descendants in tab order.
 * `el.offsetParent === null` filters out elements hidden via
 * `display: none` (or detached subtrees). This list is computed lazily on
 * each Tab keystroke so dynamic content (e.g. items appearing as the
 * search filter changes) is always reflected.
 */
function getFocusableElements(root: HTMLElement): HTMLElement[] {
  const nodes = root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  const result: HTMLElement[] = [];
  for (const node of Array.from(nodes)) {
    if (node.offsetParent === null && node !== document.activeElement) {
      // Hidden subtree — skip.
      continue;
    }
    result.push(node);
  }
  return result;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ComponentPickerPopover({
  anchorEl,
  zone,
  index,
  onInsert,
  onClose,
}: ComponentPickerPopoverProps) {
  const isClient = useIsClient();
  const position = useAnchoredPosition(anchorEl);

  // Ref to the popover root — used by both the focus trap (to enumerate
  // focusable descendants) and the click-outside detector (to ignore
  // mousedowns inside the popover itself).
  const popoverRef = React.useRef<HTMLDivElement | null>(null);

  // ── Read Puck config + data slices ──────────────────────────────────────
  const config = usePuckStore((s) => s.config);
  const data = usePuckStore((s) => s.appState.data);

  const categories = React.useMemo(
    () => (config.categories ?? {}) as Record<string, PaletteCategory>,
    [config.categories],
  );
  const components = React.useMemo(
    () => (config.components ?? {}) as Record<string, PaletteComponent>,
    [config.components],
  );
  const allComponentTypes = React.useMemo(
    () => Object.keys(components),
    [components],
  );

  // ── Search query state ──────────────────────────────────────────────────
  // Empty by default. Reset whenever the popover opens against a fresh
  // anchor so a previous query doesn't leak into a new insertion target.
  const [query, setQuery] = React.useState("");
  React.useEffect(() => {
    if (anchorEl) setQuery("");
  }, [anchorEl]);

  // ── Auto-focus the search input on open (Req 5.6 implies focus on open) ──
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(() => {
    if (anchorEl && searchInputRef.current) {
      // `requestAnimationFrame` defers focus until after the portal
      // mounts so the focus call lands on the actually-rendered element.
      const id = requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [anchorEl]);

  // ── Build the filtered, grouped list of insertable components ───────────
  //
  // Pipeline:
  //   1. Apply zone constraints (drop disallowed; if `allow` non-empty,
  //      keep only allowed). This is the gate for Req 5.9 / Property 2 —
  //      no codepath downstream (search, category bucketing) can resurrect
  //      a disallowed type.
  //   2. Group by category in `CATEGORY_ORDER`, then any extra categories,
  //      then "Other" for unregistered types — same logic as
  //      `ComponentPalette` so the two surfaces stay aligned.
  //   3. Apply the search filter via `matchesQuery` on label + description
  //      from `palette-meta.ts`.
  const allowedTypes = React.useMemo(() => {
    const constraints = resolveZoneConstraints(zone, config, data);
    const allowSet =
      constraints.allow.length > 0 ? new Set(constraints.allow) : null;
    const disallowSet = new Set(constraints.disallow);
    return new Set(
      allComponentTypes.filter((type) => {
        if (disallowSet.has(type)) return false;
        if (allowSet && !allowSet.has(type)) return false;
        return true;
      }),
    );
  }, [zone, config, data, allComponentTypes]);

  const groups = React.useMemo(() => {
    const result: Array<{ key: string; title: string; items: string[] }> = [];
    const used = new Set<string>();

    // 1. Fixed-order categories first.
    for (const key of CATEGORY_ORDER) {
      const cat = categories[key];
      if (!cat) continue;
      const items = (cat.components ?? []).filter(
        (name) => allowedTypes.has(name),
      );
      items.forEach((name) => used.add(name));
      if (items.length > 0) {
        result.push({ key, title: cat.title ?? key, items });
      }
    }

    // 2. Any additional categories not in the fixed order.
    for (const [key, cat] of Object.entries(categories)) {
      if ((CATEGORY_ORDER as readonly string[]).includes(key)) continue;
      const items = (cat.components ?? []).filter(
        (name) => allowedTypes.has(name),
      );
      items.forEach((name) => used.add(name));
      if (items.length > 0) {
        result.push({ key, title: cat.title ?? key, items });
      }
    }

    // 3. "Other" bucket for any allowed type not covered above.
    const leftover = Array.from(allowedTypes).filter((name) => !used.has(name));
    if (leftover.length > 0) {
      result.push({ key: "other", title: "Other", items: leftover });
    }
    return result;
  }, [categories, allowedTypes]);

  const filteredGroups = React.useMemo(() => {
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((name) => {
          const { label, meta } = resolveComponentDisplay(name, components);
          return matchesQuery(label, meta.description, query);
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, components, query]);

  // ── Item activation ─────────────────────────────────────────────────────
  const handleSelect = React.useCallback(
    (componentType: string) => {
      onInsert(componentType, zone, index);
    },
    [onInsert, zone, index],
  );

  // ── Click-outside dismissal (Req 5.8) ───────────────────────────────────
  //
  // Listens on the document for `mousedown` so the popover dismisses
  // before any downstream `click` handler fires. A click on the
  // triggering `anchorEl` is treated as "inside" so the InsertionButton's
  // own onClick can run — without this, the open-button's click would
  // race with the outside-close listener.
  React.useEffect(() => {
    if (!anchorEl) return undefined;
    if (typeof document === "undefined") return undefined;

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (popoverRef.current && popoverRef.current.contains(target)) return;
      if (anchorEl.contains(target)) return;
      onClose();
    };

    // Capture-phase so we see the event even if a descendant calls
    // `stopPropagation`. The popover is portal-rendered to <body>, so
    // there's no risk of self-cancelling our own listener.
    document.addEventListener("mousedown", handleMouseDown, true);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown, true);
    };
  }, [anchorEl, onClose]);

  // ── Keyboard handling: Escape close + Tab focus trap (Req 5.8, 5.10) ────
  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const root = popoverRef.current;
      if (!root) return;

      const focusables = getFocusableElements(root);
      if (focusables.length === 0) {
        // Nothing focusable inside — keep focus on the popover root by
        // swallowing the Tab.
        event.preventDefault();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const activeInPopover = active != null && root.contains(active);

      if (event.shiftKey) {
        // Shift+Tab from the first focusable (or from outside the
        // popover) → wrap to the last.
        if (!activeInPopover || active === first) {
          event.preventDefault();
          last.focus();
        }
      } else {
        // Tab from the last focusable (or from outside the popover) →
        // wrap to the first.
        if (!activeInPopover || active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    },
    [onClose],
  );

  // ── Render gate ─────────────────────────────────────────────────────────
  if (!isClient || typeof document === "undefined") return null;
  if (!anchorEl || !position) return null;

  const popover = (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Insert component"
      data-testid="ora-component-picker-popover"
      data-zone={zone}
      data-index={index}
      onKeyDown={handleKeyDown}
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        width: position.width,
        maxHeight: position.maxHeight,
        display: "flex",
        flexDirection: "column",
        background: ORA_THEME.white,
        color: ORA_THEME.charcoal,
        border: `1px solid ${ORA_THEME.border}`,
        borderTop: `2px solid ${ORA_THEME.gold}`,
        boxShadow: "0 12px 32px rgba(0, 0, 0, 0.18)",
        fontFamily: "system-ui, sans-serif",
        zIndex: 10000,
        overflow: "hidden",
      }}
    >
      {/* Search */}
      <div
        style={{
          padding: "10px 12px",
          borderBottom: `1px solid ${ORA_THEME.border}`,
          background: ORA_THEME.creamLight,
        }}
      >
        <label style={{ display: "block" }}>
          <span
            // Visually hidden label — the input also carries `aria-label`,
            // but the visible <label> association keeps the input
            // keyboard-discoverable to assistive tech.
            style={{
              position: "absolute",
              width: 1,
              height: 1,
              padding: 0,
              margin: -1,
              overflow: "hidden",
              clip: "rect(0 0 0 0)",
              whiteSpace: "nowrap",
              border: 0,
            }}
          >
            Search components
          </span>
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search components"
            aria-label="Search components"
            data-testid="ora-component-picker-search"
            style={{
              width: "100%",
              minHeight: 32,
              padding: "6px 10px",
              border: `1px solid ${ORA_THEME.border}`,
              borderRadius: 4,
              background: ORA_THEME.white,
              color: ORA_THEME.charcoal,
              fontSize: 13,
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </label>
      </div>

      {/* Body — categories + items, or zero-results message (Req 5.7) */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "4px 0 8px",
        }}
      >
        {filteredGroups.length === 0 ? (
          <p
            // `role="status"` + `aria-live="polite"` so screen readers
            // hear the empty-state update without losing the editor's
            // current focus position. The visible text doubles as the
            // accessible message (no separate aria-label needed).
            role="status"
            aria-live="polite"
            data-testid="ora-component-picker-empty"
            style={{
              margin: 0,
              padding: "16px 12px",
              fontSize: 13,
              color: ORA_THEME.muted,
              textAlign: "center",
            }}
          >
            No components match
          </p>
        ) : (
          filteredGroups.map((group) => (
            <section
              key={group.key}
              aria-label={group.title}
              style={{ marginBottom: 6 }}
            >
              <h3
                style={{
                  margin: 0,
                  padding: "8px 12px 4px",
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: ORA_THEME.muted,
                }}
              >
                {group.title}
              </h3>
              <ul
                role="list"
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  display: "grid",
                  // Two-column grid of items — readable at the default
                  // popover width (360px) and falls back to a single column
                  // when clamped narrower than ~260px.
                  gridTemplateColumns:
                    position.width >= 260 ? "1fr 1fr" : "1fr",
                  gap: 0,
                }}
              >
                {group.items.map((name) => {
                  const { label, meta } = resolveComponentDisplay(
                    name,
                    components,
                  );
                  const Icon = meta.Icon;
                  return (
                    <li key={name} style={{ margin: 0, padding: 0 }}>
                      <button
                        type="button"
                        onClick={() => handleSelect(name)}
                        data-testid="ora-component-picker-item"
                        data-component-type={name}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          width: "100%",
                          padding: "8px 12px",
                          background: "transparent",
                          border: 0,
                          borderTop: `1px solid ${ORA_THEME.border}`,
                          color: ORA_THEME.charcoal,
                          fontFamily: "inherit",
                          fontSize: 13,
                          textAlign: "left",
                          cursor: "pointer",
                        }}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            flex: "0 0 auto",
                            width: 28,
                            height: 28,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: ORA_THEME.cream,
                            border: `1px solid ${ORA_THEME.border}`,
                            borderRadius: 4,
                            color: ORA_THEME.gold,
                          }}
                        >
                          <Icon size={16} strokeWidth={1.75} />
                        </span>
                        <span
                          style={{
                            fontWeight: 600,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );

  return createPortal(popover, document.body);
}
