"use client";

/**
 * PreviewStage — virtual-width + `zoom` preview container for the Live_Editor.
 *
 * Spec: live-page-editor — Task 4.1.
 * _Requirements: 3.1, 5.3, 5.4_
 *
 * This mirrors the builder's `BuilderShell.CanvasViewport` technique
 * (`lib/page-builder/builder-shell/BuilderShell.tsx`): it reads the active
 * breakpoint from `useBreakpoint()`, looks up the breakpoint's virtual
 * viewport width, renders an inner stage at that "true" width, and visually
 * scales it to the available pane using the legacy `zoom` CSS property.
 *
 * Why `zoom` and not `transform: scale`:
 *   `zoom` scales layout dimensions — including hit-testing — without
 *   creating a new containing block for `position: fixed` descendants. That
 *   keeps the floating Editor_UI overlays (toolbar, sheets, selection
 *   overlay, save bar) anchored to the viewport and preserves click
 *   targeting inside the scaled preview. `transform: scale` would establish
 *   a containing block, breaking both.
 *
 * Breakpoint → virtual width mapping (Req 5.4) — note these differ from the
 * structured builder's `CanvasViewport` values (which use tablet:1024 /
 * mobile:640). The live editor mirrors true device widths so the preview is
 * faithful to production:
 *
 *   desktop → 1440px
 *   tablet  →  834px
 *   mobile  →  390px
 *
 * At desktop, when the available pane is at least 1440px wide the scale
 * clamps to 1 and the stage occupies 100% width with no reserved chrome
 * (Req 3.1). The `transition: width 200ms ease` keeps every resize well
 * within the 500ms budget (Req 5.3).
 */

import React from "react";
import { type Breakpoint, useBreakpoint } from "@/lib/page-builder/breakpoint-context";

/**
 * Virtual viewport width (in CSS px) the inner stage renders at for each
 * breakpoint. The live editor uses true device widths (desktop:1440 /
 * tablet:834 / mobile:390) rather than the structured builder's pane-fit
 * values.
 */
export const PREVIEW_VIRTUAL_WIDTHS: Record<Breakpoint, number> = {
  desktop: 1440,
  tablet: 834,
  mobile: 390,
};

export interface PreviewStageProps {
  children: React.ReactNode;
}

/**
 * PreviewStage — renders `children` at the active breakpoint's virtual width
 * and zooms the stage to fit the available width.
 *
 * Lives inside a `<BreakpointProvider>` (mounted by `LiveEditorShell`) so it
 * can read the active breakpoint via `useBreakpoint()` without prop-drilling.
 */
export function PreviewStage({ children }: PreviewStageProps): React.ReactElement {
  const { activeBreakpoint } = useBreakpoint();
  const virtualWidth = PREVIEW_VIRTUAL_WIDTHS[activeBreakpoint] ?? PREVIEW_VIRTUAL_WIDTHS.desktop;

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = React.useState(1);

  // Recompute the zoom factor whenever the container resizes. We render the
  // inner stage at the breakpoint's "true" viewport width and zoom it down to
  // fit the available pane, so typography and spacing stay realistic. The
  // scale never exceeds 1 — desktop at full width renders 1:1 (Req 3.1).
  React.useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const update = () => {
      const available = node.clientWidth;
      if (available <= 0) return;
      const next = Math.min(1, available / virtualWidth);
      setScale(next);
    };
    update();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (ro) ro.observe(node);
    if (typeof window !== "undefined") {
      window.addEventListener("resize", update);
    }
    return () => {
      if (ro) ro.disconnect();
      if (typeof window !== "undefined") {
        window.removeEventListener("resize", update);
      }
    };
  }, [virtualWidth]);

  return (
    <div
      ref={containerRef}
      data-testid="live-preview-stage"
      data-breakpoint={activeBreakpoint}
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        // Center the scaled stage horizontally so tablet/mobile previews sit
        // in the middle of the full-bleed shell rather than hugging the edge.
        alignItems: "center",
        overflow: "hidden",
      }}
    >
      <div
        data-testid="live-preview-stage-inner"
        style={{
          // Render at the breakpoint's real width so typography/spacing look
          // correct, then zoom to fit. `zoom` (not `transform: scale`) keeps
          // `position: fixed` overlays anchored to the viewport and preserves
          // hit-testing inside the scaled preview.
          width: virtualWidth,
          ...({ zoom: scale } as React.CSSProperties),
          flex: 1,
          minHeight: 0,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          transition: "width 200ms ease",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default PreviewStage;
