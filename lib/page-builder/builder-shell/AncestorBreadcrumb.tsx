import React, { useRef, useEffect, useState } from "react";
import type { AncestorSegment, PuckSelector } from "./page-tree";

export interface AncestorBreadcrumbProps {
  /** Segments from page root to the currently selected block. */
  segments: AncestorSegment[];
  /** When true, include the selected block itself as the final segment. */
  includeSelf?: boolean;
  /** Truncate with leading "…" when the container is narrower than `min` px. */
  truncateBelowWidthPx?: number;
  /** Called when a segment is activated. `null` means "clear selection". */
  onSelect: (selector: PuckSelector | null, id: string | null) => void;
}

/**
 * AncestorBreadcrumb — renders a navigable breadcrumb trail from the page
 * root to the currently selected block's ancestors (or including itself).
 *
 * Used in both the ConfigurationPanel header and the StatusBar.
 */
export function AncestorBreadcrumb({
  segments,
  includeSelf = false,
  truncateBelowWidthPx,
  onSelect,
}: AncestorBreadcrumbProps) {
  const containerRef = useRef<HTMLElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  // Determine which segments to display based on includeSelf.
  // When includeSelf is false, all provided segments are ancestors only.
  // When includeSelf is true, the last segment is the selected block itself.
  const displaySegments = includeSelf ? segments : segments;

  // Observe container width for truncation.
  useEffect(() => {
    if (truncateBelowWidthPx == null || !containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        setIsTruncated(width < truncateBelowWidthPx);
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [truncateBelowWidthPx]);

  // Apply truncation: keep first and last two segments, collapse middle to "…".
  const visibleSegments = isTruncated
    ? truncateSegments(displaySegments)
    : displaySegments;

  if (visibleSegments.length === 0) return null;

  return (
    <nav ref={containerRef} aria-label="Ancestor breadcrumb">
      <ol
        style={{
          display: "flex",
          alignItems: "center",
          listStyle: "none",
          margin: 0,
          padding: 0,
          gap: 0,
          flexWrap: "nowrap",
          overflow: "hidden",
        }}
      >
        {visibleSegments.map((segment, idx) => {
          const isLast = idx === visibleSegments.length - 1;
          const isEllipsis = segment.id === "__ellipsis__";

          return (
            <React.Fragment key={segment.id ?? `segment-${idx}`}>
              {idx > 0 && (
                <li aria-hidden="true" style={{ display: "flex", alignItems: "center" }}>
                  <span aria-hidden="true" style={{ margin: "0 4px", userSelect: "none" }}>
                    ›
                  </span>
                </li>
              )}
              <li style={{ display: "flex", alignItems: "center", whiteSpace: "nowrap" }}>
                {isEllipsis ? (
                  <span style={{ margin: "0 2px" }}>…</span>
                ) : (
                  <button
                    type="button"
                    aria-current={isLast ? "true" : undefined}
                    onClick={
                      isLast
                        ? undefined
                        : () => onSelect(segment.selector, segment.id)
                    }
                    disabled={isLast}
                    style={{
                      background: "none",
                      border: "none",
                      padding: "2px 4px",
                      cursor: isLast ? "default" : "pointer",
                      opacity: isLast ? 0.7 : 1,
                      fontSize: "inherit",
                      fontFamily: "inherit",
                      textDecoration: isLast ? "none" : "none",
                    }}
                  >
                    {segment.label}
                  </button>
                )}
              </li>
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Collapse middle segments to a single "…" placeholder, keeping the first
 * and last two segments visible.
 */
function truncateSegments(segments: AncestorSegment[]): AncestorSegment[] {
  if (segments.length <= 3) return segments;

  const first = segments[0];
  const lastTwo = segments.slice(-2);
  const ellipsis: AncestorSegment = {
    id: "__ellipsis__",
    label: "…",
    selector: null,
  };

  return [first, ellipsis, ...lastTwo];
}
