"use client";

/**
 * TabGroup runtime — the interactive part of the `TabGroup` block (real content
 * tabs, distinct from the link-based `FilterTabs`).
 *
 * Design reference: `.kiro/specs/page-builder-block-library/design.md`
 *   §"Block 3 — TabGroup" → "TabGroupRuntime ('use client'): implements the
 *   WAI-ARIA tabs pattern …".
 * Validates: Requirements 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 13.2,
 *   13.3 and Property 7 (the Tabs invariant).
 *
 * Why a runtime component:
 *   Tabs need client state (which panel is visible) and keyboard focus
 *   management (roving tabindex + Arrow/Home/End). Exactly like
 *   `ImageCarouselRuntime` / `GalleryRuntime` / `TestimonialRuntime`, that lives
 *   in a dedicated `"use client"` component, and the block's `render` in
 *   `config.ts` delegates to it via `React.createElement(TabGroupRuntime, …)`
 *   wrapped in `styledRender` (wired in task 7.2).
 *
 * Reuse, not reinvention — the runtime is a pure tab *shell*:
 *   It receives the already-resolved panel nodes + their labels. The block's
 *   `render` invokes each Puck slot "the Columns way"
 *   (`typeof props["tab-0"] === "function" ? props["tab-0"]() : null`) and hands
 *   the resulting React nodes in as `tabs[i].panel`. The runtime never re-derives
 *   panel markup; it only adds the tablist chrome, roles/state wiring, roving
 *   tabindex, and keyboard navigation. This keeps the panel content identical to
 *   any other nested-block rendering and keeps this file unit-testable in
 *   isolation. It mirrors how `TestimonialRuntime` receives pre-rendered slides.
 *
 * Hydration / byte-stability (this block is NOT excluded from the byte-stability
 * guarantee — only Countdown is, per Req 11.3):
 *   - The initial render is fully deterministic. `selected` starts at the
 *     clamped `defaultIndex` (derived from props only), `isRtl` starts at
 *     `false`, and panel `hidden` flags follow `selected` deterministically. So
 *     the default-tab server markup is byte-identical to the first client paint
 *     and React hydrates without a mismatch (Req 3.3, 3.11).
 *   - Text direction (`dir="rtl"`, inherited from the `ar` locale wrapper) is
 *     read in a post-mount `useEffect`; it only changes which Arrow key advances
 *     selection, never the markup.
 *   - Tab/panel ids are derived deterministically from the stable `idBase`
 *     prop (the Puck block instance id, passed by the block's `render` in
 *     `config.ts`) rather than `React.useId()`. `useId` increments a per-render
 *     global counter, so two *independent* renders of the same props produce
 *     different ids (`_r_0_` vs `_r_1_`) and break byte-stability. A prop-derived
 *     prefix is identical across renders for fixed props and unique per instance
 *     (Puck ids are unique), keeping both the byte-stable render guarantee and
 *     the ARIA wiring intact. `useId` is kept only as a fallback for standalone
 *     usage where no `idBase` is supplied.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from "react";

export interface TabGroupTab {
  /** The author-editable tab label shown in the tablist. */
  label: string;
  /**
   * The resolved panel content for this tab — the React node produced by the
   * block's Puck slot (`tab-N`). May be `null`/empty for an empty slot.
   */
  panel: React.ReactNode;
}

export interface TabGroupRuntimeProps {
  /** One entry per tab: its label + already-resolved panel node. */
  tabs: TabGroupTab[];
  /**
   * Index of the tab shown on first render (the author-designated default tab).
   * Clamped into range; defaults to `0`.
   */
  defaultIndex?: number;
  /** Accessible name for the tablist. Defaults to `"Content tabs"`. */
  ariaLabel?: string;
  /**
   * Stable, instance-unique prefix for the generated tab/panel ids. The block's
   * `render` passes the Puck block instance id here so that two independent
   * renders of the same props emit byte-identical ids (see file header). When
   * omitted (standalone usage), a `useId`-derived prefix is used instead — that
   * is unique but NOT byte-stable across separate render trees.
   */
  idBase?: string;
}

// ─── Default ORA styling ───────────────────────────────────────────────────
// The block's `render` applies spacing/border/animation via `styledRender`; the
// runtime only owns the interactive tab chrome. Colors come from the ORA palette
// (charcoal text / sand border) and meet WCAG AA on the shipped light surface.
const COLOR_ACTIVE = "#2C2C2C"; // charcoal
const COLOR_INACTIVE = "#6B6B6B"; // slate
const COLOR_BORDER = "#E8E4DF"; // sand

const TABLIST_STYLE: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 4,
  borderBottom: `1px solid ${COLOR_BORDER}`,
  // Logical margin so it flips correctly under RTL (no hard-coded left/right).
  marginBottom: 16,
};

function tabButtonStyle(isSelected: boolean): React.CSSProperties {
  return {
    appearance: "none",
    background: "transparent",
    border: "none",
    // The active indicator is a *bottom* edge (orientation-neutral, unaffected
    // by RTL), so a physical bottom border is correct here.
    borderBottom: `2px solid ${isSelected ? COLOR_ACTIVE : "transparent"}`,
    padding: "10px 16px",
    marginBottom: -1, // overlap the tablist's 1px bottom border
    font: "inherit",
    fontWeight: isSelected ? 600 : 400,
    color: isSelected ? COLOR_ACTIVE : COLOR_INACTIVE,
    cursor: "pointer",
    // Logical text alignment so labels read correctly under RTL.
    textAlign: "start",
    whiteSpace: "nowrap",
  };
}

const PANEL_STYLE: React.CSSProperties = {
  outline: "none",
};

/** Clamp an index into `[0, count - 1]`, returning `0` when there are no tabs. */
function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  const floored = Math.floor(index);
  if (floored < 0) return 0;
  if (floored > count - 1) return count - 1;
  return floored;
}

export function TabGroupRuntime({
  tabs,
  defaultIndex = 0,
  ariaLabel = "Content tabs",
  idBase,
}: TabGroupRuntimeProps) {
  const count = tabs.length;

  // Deterministic initial selection from props only (hydration-safe).
  const [selected, setSelected] = useState(() => clampIndex(defaultIndex, count));

  // Derive the effective index at render time so a shrinking tab count (author
  // removed a tab) self-corrects without a setState-in-effect cascade. The state
  // is only the *intent*; `activeIndex` is always in range.
  const activeIndex = clampIndex(selected, count);

  // SSR-safe default; corrected post-mount so the markup never differs between
  // server and first client paint (see file header). Only affects which Arrow
  // key advances selection.
  const [isRtl, setIsRtl] = useState(false);

  const tablistRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Stable ids for the tab/panel aria wiring. Prefer the prop-derived `idBase`
  // (the Puck instance id) so the markup is byte-identical across independent
  // renders of the same props (Req 3.11 / Property 3). `useId` is only the
  // fallback for standalone usage without an `idBase`; it is unique but its
  // global counter advances per render tree, so it is not byte-stable.
  const fallbackId = useId();
  const baseId = idBase ?? fallbackId;
  const tabId = useCallback((i: number) => `${baseId}-tab-${i}`, [baseId]);
  const panelId = useCallback((i: number) => `${baseId}-panel-${i}`, [baseId]);

  // ── Read inherited text direction once, after mount (RTL — Req 3.9) ────────
  useEffect(() => {
    const el = tablistRef.current;
    if (!el || typeof window === "undefined") return;
    setIsRtl(window.getComputedStyle(el).direction === "rtl");
  }, []);

  // Move selection to `index` and move keyboard focus to that tab. This is the
  // WAI-ARIA "tabs with automatic activation" model: focus and selection move
  // together, so exactly one tab has aria-selected="true" and tabindex="0"
  // (Property 7, Req 3.4, 3.7).
  const activate = useCallback(
    (index: number) => {
      if (count === 0) return;
      const wrapped = ((index % count) + count) % count;
      setSelected(wrapped);
      tabRefs.current[wrapped]?.focus();
    },
    [count],
  );

  // ── Keyboard navigation mapped to visual reading direction (Req 3.6, 3.9,
  //    13.2). Arrow moves selection by one (wrapping); Home/End jump to the
  //    first/last tab. Under RTL, Left/Right are swapped so they follow the
  //    visual order. ───────────────────────────────────────────────────────
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (count <= 1) return;
      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          activate(activeIndex + (isRtl ? -1 : 1));
          break;
        case "ArrowLeft":
          e.preventDefault();
          activate(activeIndex + (isRtl ? 1 : -1));
          break;
        case "Home":
          e.preventDefault();
          activate(0);
          break;
        case "End":
          e.preventDefault();
          activate(count - 1);
          break;
        default:
          break;
      }
    },
    [count, activeIndex, isRtl, activate],
  );

  // ── Empty state: render a neutral hint rather than throwing (parity with the
  //    sibling carousel runtimes). A real TabGroup always has tabCount ≥ 1, so
  //    this only shows in degenerate/builder states. ─────────────────────────
  if (count === 0) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 80,
          background: "#F2EDE3",
          color: COLOR_INACTIVE,
          fontSize: 14,
        }}
      >
        Add tabs to the tab group
      </div>
    );
  }

  return (
    <div>
      {/* Tab list — order follows the DOM; `dir="rtl"` flips it visually. */}
      <div
        ref={tablistRef}
        role="tablist"
        aria-label={ariaLabel}
        aria-orientation="horizontal"
        style={TABLIST_STYLE}
      >
        {tabs.map((tab, i) => {
          const isSelected = i === activeIndex;
          return (
            <button
              key={i}
              ref={(node) => {
                tabRefs.current[i] = node;
              }}
              type="button"
              role="tab"
              id={tabId(i)}
              aria-selected={isSelected}
              aria-controls={panelId(i)}
              // Roving tabindex: exactly one tab is in the page tab order
              // (Req 3.7, Property 7).
              tabIndex={isSelected ? 0 : -1}
              onClick={() => activate(i)}
              onKeyDown={onKeyDown}
              style={tabButtonStyle(isSelected)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Panels — all rendered for deterministic, byte-stable markup; inactive
          ones carry the `hidden` attribute so only the selected panel shows
          (Req 3.3, 3.4, 3.11). */}
      {tabs.map((tab, i) => {
        const isSelected = i === activeIndex;
        return (
          <div
            key={i}
            role="tabpanel"
            id={panelId(i)}
            aria-labelledby={tabId(i)}
            hidden={!isSelected}
            // APG: give the panel tabindex=0 so keyboard users can reach panel
            // content that has no focusable element of its own.
            tabIndex={0}
            style={PANEL_STYLE}
          >
            {tab.panel}
          </div>
        );
      })}
    </div>
  );
}
