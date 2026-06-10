"use client";

/**
 * InheritedIndicator — small label rendered adjacent to a breakpoint-aware
 * field control when the displayed value comes from `responsiveDefaults` or
 * wider-tier inheritance rather than an explicit slot value.
 *
 * Spec: default-responsive-component-defaults — task 6.1
 * _Requirements: 6.2, 6.3, 6.5_
 *
 * Behaviour
 * ---------
 *  - Renders "default" when the value originates from `responsiveDefaults`.
 *  - Renders "from {tier}" (e.g. "from desktop") when the value originates
 *    from wider-tier inheritance.
 *  - The parent component is responsible for not rendering this component
 *    when the source is "explicit" (the props type enforces this by only
 *    accepting "default" | "inherited").
 */

import React from "react";
import type { Breakpoint } from "../breakpoints";
import { ORA_THEME } from "./inspector/tokens";

export interface InheritedIndicatorProps {
  /** The source of the resolved value. */
  source: "default" | "inherited";
  /** The wider breakpoint tier the value was inherited from (only relevant when source is "inherited"). */
  inheritedFrom?: Breakpoint;
}

/**
 * Renders a small label next to a field control:
 * - "default" when value comes from responsiveDefaults
 * - "from desktop" / "from tablet" when value comes from wider-tier inheritance
 */
export function InheritedIndicator({
  source,
  inheritedFrom,
}: InheritedIndicatorProps): React.ReactElement {
  const label =
    source === "default"
      ? "default"
      : `from ${inheritedFrom ?? "unknown"}`;

  return (
    <span
      data-testid="ora-inherited-indicator"
      style={{
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: "0.04em",
        color: ORA_THEME.muted,
        textTransform: "lowercase",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}
