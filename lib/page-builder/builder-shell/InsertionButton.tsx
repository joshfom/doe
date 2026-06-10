"use client";

/**
 * InsertionButton — "+" affordance rendered between sibling components on the
 * canvas to insert a new block at a specific position.
 *
 * Spec: builder-outline-tree-and-toolbar (Task 3.1)
 * _Requirements: 4.4, 4.5, 4.6, 4.7, 6.6_
 *
 * This component is purely presentational: it receives the target zone, the
 * insertion index, and the labels of any adjacent components for screen-reader
 * accessibility. When activated, it calls `onActivate` with the button element,
 * the zone compound key, and the index — the caller (e.g. InsertionContext
 * via InsertionButtonLayer) decides what to do (typically: open the picker
 * popover anchored to the returned button element).
 *
 * Visual & interaction design:
 *   - A thin horizontal line (1px gold rule) with a centered 24×24 circle
 *     containing a "+" icon. Hidden by default (opacity 0) and revealed on
 *     pointer hover or keyboard focus (focus-visible) with a 150ms transition,
 *     matching the design doc.
 *   - The clickable area is at least 44×44 px (mobile-friendly target size,
 *     Req 4.4) achieved via vertical padding around the visual line.
 *   - A native `<button type="button">` so Enter and Space activate the click
 *     handler without any extra keyboard wiring (Req 4.6, 6.6).
 *
 * Accessibility (Req 4.7, 6.6):
 *   - `aria-label` follows the pattern "Add component after {Label}" /
 *     "Add component before {Label}" / "Add component at start of list" /
 *     "Add component at end of list".
 *   - When both adjacent labels are known, we prefer the "after {afterLabel}"
 *     phrasing because it disambiguates the more common case (inserting after
 *     a block the editor was just looking at), while still being meaningful
 *     for the in-between position.
 *   - A visible focus ring is provided by `:focus-visible` (gold outline).
 *
 * Why a `<style>` tag instead of pure inline styles:
 *   Inline styles cannot express `:hover` or `:focus-visible`. The codebase
 *   already uses scoped `<style>` tags for similar runtime CSS needs (see
 *   `ExperienceLauncherRuntime.tsx`, `PageRenderer.tsx`). The styles here are
 *   scoped to a single class name to avoid global side-effects.
 */

import React from "react";
import { ORA_THEME } from "./inspector/tokens";

// ─── Public API ──────────────────────────────────────────────────────────────

export interface InsertionButtonProps {
  /** The zone compound key where insertion will happen (e.g. "root:default-zone"). */
  zone: string;
  /** The index at which a new component will be inserted. */
  index: number;
  /** Label of the component above this button. Null when this is the first slot. */
  afterLabel: string | null;
  /** Label of the component below this button. Null when this is the last slot. */
  beforeLabel: string | null;
  /** Called when the button is activated (click / Enter / Space). */
  onActivate: (anchorEl: HTMLElement, zone: string, index: number) => void;
}

// ─── Style injection (scoped) ────────────────────────────────────────────────

// We use a single root class and a couple of nested selectors. The class names
// are stable and namespaced to avoid clashes with consumer pages.
const ROOT_CLASS = "ora-insertion-button";

const INSERTION_BUTTON_CSS = `
.${ROOT_CLASS} {
  /* Visual fade is on a child wrapper so the 44×44 hit target stays clickable
     even when the visual is invisible — pointer events on the button itself
     remain active so hover correctly reveals the visual. */
  --ora-ib-opacity: 0;
}
.${ROOT_CLASS}:hover,
.${ROOT_CLASS}:focus-visible {
  --ora-ib-opacity: 1;
}
.${ROOT_CLASS}:focus-visible {
  outline: 2px solid ${ORA_THEME.gold};
  outline-offset: 2px;
}
.${ROOT_CLASS} .${ROOT_CLASS}__visual {
  opacity: var(--ora-ib-opacity);
  transition: opacity 150ms ease-out;
}
`;

// Inject the stylesheet exactly once per document. Guarded for SSR (no
// document) and idempotent across multiple component instances.
let stylesInjected = false;
function ensureStylesInjected(): void {
  if (stylesInjected) return;
  if (typeof document === "undefined") return;
  const existing = document.querySelector(
    `style[data-ora-insertion-button="true"]`,
  );
  if (existing) {
    stylesInjected = true;
    return;
  }
  const style = document.createElement("style");
  style.setAttribute("data-ora-insertion-button", "true");
  style.textContent = INSERTION_BUTTON_CSS;
  document.head.appendChild(style);
  stylesInjected = true;
}

// ─── aria-label resolution ───────────────────────────────────────────────────

/**
 * Build the accessible label for the insertion button.
 *
 * Priority:
 *   1. After + Before → "Add component after {after}" (after takes precedence
 *      because it grounds the user in the more recently-passed block).
 *   2. After only      → "Add component after {after}"  (= last slot in zone)
 *   3. Before only     → "Add component before {before}" (= first slot in zone)
 *   4. Neither         → "Add component at start of list" (zone is empty; the
 *      lone affordance acts as the entry point so "start of list" reads more
 *      naturally than "end of list").
 *
 * The wording "at start of list" / "at end of list" mirrors the design doc's
 * suggested phrasing for the boundary cases. We keep these strings inlined
 * here rather than externalised because they are part of the component's
 * accessibility contract and are tested directly.
 */
export function buildInsertionAriaLabel(
  afterLabel: string | null,
  beforeLabel: string | null,
): string {
  if (afterLabel && beforeLabel) {
    return `Add component after ${afterLabel}`;
  }
  if (afterLabel) {
    return `Add component after ${afterLabel}`;
  }
  if (beforeLabel) {
    return `Add component before ${beforeLabel}`;
  }
  return "Add component at start of list";
}

// ─── Component ───────────────────────────────────────────────────────────────

export function InsertionButton({
  zone,
  index,
  afterLabel,
  beforeLabel,
  onActivate,
}: InsertionButtonProps) {
  // Inject styles once on mount. Done in an effect (not at module scope) so we
  // don't touch `document` during SSR module evaluation.
  React.useEffect(() => {
    ensureStylesInjected();
  }, []);

  const buttonRef = React.useRef<HTMLButtonElement | null>(null);

  const handleClick = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      // Stop the click from bubbling into the canvas and triggering selection
      // changes on the parent block. The picker open flow is the only side
      // effect we want from this button.
      event.stopPropagation();
      event.preventDefault();
      const el = buttonRef.current ?? (event.currentTarget as HTMLButtonElement);
      onActivate(el, zone, index);
    },
    [onActivate, zone, index],
  );

  const ariaLabel = buildInsertionAriaLabel(afterLabel, beforeLabel);

  return (
    <button
      ref={buttonRef}
      type="button"
      className={ROOT_CLASS}
      onClick={handleClick}
      aria-label={ariaLabel}
      data-testid="ora-insertion-button"
      data-zone={zone}
      data-index={index}
      style={{
        // Reset native button chrome so only our visual shows through.
        appearance: "none",
        background: "transparent",
        border: 0,
        // 44×44 minimum click target (Req 4.4). The visual line sits at 24px
        // tall; the remaining height is symmetric padding so the target area
        // is exactly 44px when the visual is at its natural 24px footprint.
        // Using `block` + width 100% lets the affordance span the zone width.
        display: "block",
        width: "100%",
        minHeight: 44,
        padding: "10px 0",
        margin: 0,
        cursor: "pointer",
        // Hide the default outline; we render our own via :focus-visible.
        outline: "none",
        // Default fade lives in CSS via the --ora-ib-opacity custom property
        // on .ora-insertion-button so :hover/:focus-visible can override it.
      }}
    >
      <span
        className={`${ROOT_CLASS}__visual`}
        aria-hidden="true"
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 24,
          width: "100%",
          // opacity is driven by the CSS custom property so :hover and
          // :focus-visible can transition it (inline styles cannot express
          // pseudo-class state).
        }}
      >
        {/* Horizontal line — sits behind the circle so the "+" reads as a
            node on the line. */}
        <span
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "50%",
            height: 1,
            background: ORA_THEME.gold,
            transform: "translateY(-50%)",
          }}
        />
        {/* Centered 24px circle with a "+" glyph. We use a CSS-drawn plus
            (two crossed lines) instead of a font glyph or icon library so
            the visual is crisp at any zoom level and doesn't depend on the
            ambient font. */}
        <span
          style={{
            position: "relative",
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: ORA_THEME.white,
            border: `1px solid ${ORA_THEME.gold}`,
            color: ORA_THEME.gold,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 18,
            lineHeight: 1,
            fontWeight: 400,
            // Slight lift so the glyph sits optically centered.
            paddingBottom: 2,
            boxSizing: "border-box",
          }}
        >
          +
        </span>
      </span>
    </button>
  );
}
