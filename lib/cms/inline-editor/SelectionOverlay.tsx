"use client";

/**
 * SelectionOverlay — outline + announce-on-select for the inline editor.
 *
 * Spec: custom-branded-page-builder — tasks 15.2, 18.2
 * _Requirements: 8.3, 18.4_
 *
 * Renders an absolutely-positioned outline over the currently-selected
 * block element, plus an `aria-live="polite"` region that announces the
 * block label whenever selection changes (Req 18.4).
 *
 * Position is recomputed via rAF on `scroll` and `resize` so the outline
 * tracks the underlying element. We deliberately avoid `IntersectionObserver`
 * — the outline only exists while a block is actually selected, and a
 * single rAF callback is cheaper than wiring a global observer.
 */

import { useEffect, useRef, useState } from "react";

interface SelectionOverlayProps {
  /** Element bearing `data-puck-id`. `null` when no selection is active. */
  selectedEl: HTMLElement | null;
  /** Human-readable block label for screen-reader announcements. */
  selectedLabel: string | null;
  /** Click handler — invoked on the floating "Edit" affordance. */
  onEdit: () => void;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const HIDDEN_LIVE_REGION_STYLE: React.CSSProperties = {
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

export function SelectionOverlay({
  selectedEl,
  selectedLabel,
  onEdit,
}: SelectionOverlayProps) {
  const [rect, setRect] = useState<Rect | null>(null);
  const rafRef = useRef<number | null>(null);
  const [announcement, setAnnouncement] = useState("");

  // Recompute the outline rectangle from the element's position. Using
  // page-relative coordinates (scrollY/scrollX) keeps the overlay
  // anchored when the user scrolls.
  useEffect(() => {
    if (!selectedEl) {
      setRect(null);
      return;
    }

    const measure = () => {
      const r = selectedEl.getBoundingClientRect();
      setRect({
        top: r.top + window.scrollY,
        left: r.left + window.scrollX,
        width: r.width,
        height: r.height,
      });
    };

    const onChange = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", onChange, true);
    window.addEventListener("resize", onChange);
    return () => {
      window.removeEventListener("scroll", onChange, true);
      window.removeEventListener("resize", onChange);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [selectedEl]);

  // aria-live announcement — fires once per selection change.
  useEffect(() => {
    if (selectedLabel) {
      setAnnouncement(`${selectedLabel} selected`);
    } else {
      setAnnouncement("Selection cleared");
    }
  }, [selectedLabel]);

  return (
    <>
      {rect ? (
        <div
          data-inline-editor-ui=""
          data-testid="inline-selection-outline"
          style={{
            position: "absolute",
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            border: "2px solid #C9A961",
            pointerEvents: "none",
            zIndex: 9998,
            boxSizing: "border-box",
          }}
        >
          <button
            type="button"
            onClick={onEdit}
            data-inline-editor-ui=""
            style={{
              position: "absolute",
              top: -28,
              right: 0,
              background: "#C9A961",
              color: "#1A1A1A",
              border: "none",
              padding: "4px 10px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              pointerEvents: "auto",
            }}
          >
            Edit
          </button>
        </div>
      ) : null}
      <div
        role="status"
        aria-live="polite"
        data-testid="inline-selection-live-region"
        style={HIDDEN_LIVE_REGION_STYLE}
      >
        {announcement}
      </div>
    </>
  );
}
