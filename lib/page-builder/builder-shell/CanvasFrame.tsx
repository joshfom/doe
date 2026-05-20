import React from "react";
import { ORA_FRAME_PADDING, ORA_THEME } from "./inspector/tokens";

export interface CanvasFrameProps {
  children: React.ReactNode;
}

/**
 * Responsive horizontal padding for the canvas frame.
 * At widths ≥ 440px (320 + 2×60), padding is the full 60px.
 * Between 352px and 440px, padding scales linearly.
 * At widths ≤ 352px (320 + 2×16), padding is clamped at 16px minimum.
 */
const FRAME_PADDING_CSS = `0 clamp(16px, calc((100% - 320px) / 2), ${ORA_FRAME_PADDING}px)`;

export function CanvasFrame({ children }: CanvasFrameProps) {
  return (
    <div
      style={{
        height: "100%",
        padding: FRAME_PADDING_CSS,
        background: ORA_THEME.cream,
        overflow: "auto",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
          border: `1px solid ${ORA_THEME.border}`,
          background: ORA_THEME.white,
          width: "100%",
        }}
      >
        {children}
      </div>
    </div>
  );
}
