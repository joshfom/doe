"use client";

/**
 * PropertySection — collapsible group inside the ConfigurationPanel.
 *
 * Spec: custom-branded-page-builder — Requirement 3.4
 *
 * A header (label + chevron) toggles an animated body. Open/closed state is
 * persisted per block type via `useSectionOpen()` from `section-store.ts`,
 * keyed as `${blockType}:${sectionId}` so opening e.g. `Background Settings`
 * on one `Section` block keeps it open on the next `Section` the editor
 * selects (Requirement 3.4).
 *
 * Visual language follows the existing Inspector (see `../inspector/Inspector.tsx`):
 * cream-light header background, uppercase bold label, subtle border, muted
 * chevron that rotates 180° on expand. Colors and borders come from
 * `../inspector/tokens.ts`.
 *
 * Accessibility:
 *   - Header is a native `<button type="button">` so Enter/Space toggle it
 *     for free.
 *   - `aria-expanded` reflects open/closed state.
 *   - `aria-controls` points at the body `id` so screen readers announce
 *     when the panel shows or hides.
 *   - Chevron is `aria-hidden` — state is already announced via aria-expanded.
 *
 * Animation uses framer-motion (already a workspace dependency, see
 * `lib/cms/components/RegisterInterestDialog.tsx` for the equivalent
 * dialog-level pattern). We animate height + opacity with `AnimatePresence`
 * so the body unmounts when collapsed — keeping focus management simple
 * (collapsed fields cannot receive tab focus).
 */

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { ORA_THEME } from "../inspector/tokens";
import { useSectionOpen } from "./section-store";

export interface PropertySectionProps {
  /**
   * Block type owning the section, e.g. `"Section"`, `"Heading"`. Combined
   * with `sectionId` to build the section-store key so state persists per
   * block type across selection changes.
   */
  blockType: string;
  /** Stable id for the section within a block type, e.g. `"background-settings"`. */
  sectionId: string;
  /** Human-readable header label, e.g. `"Background Settings"`. */
  label: string;
  /** Initial open state on first render before the user has interacted. */
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function PropertySection({
  blockType,
  sectionId,
  label,
  defaultOpen = false,
  children,
}: PropertySectionProps) {
  const [isOpen, setOpen] = useSectionOpen(blockType, sectionId, defaultOpen);
  const bodyId = React.useId();

  return (
    <section style={sectionStyle} data-testid="ora-property-section">
      <button
        type="button"
        onClick={() => setOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-controls={bodyId}
        style={headerStyle}
      >
        <span>{label}</span>
        <ChevronDown
          aria-hidden
          size={14}
          strokeWidth={1.5}
          style={{
            color: ORA_THEME.muted,
            transition: "transform 200ms ease",
            transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)",
          }}
        />
      </button>
      <AnimatePresence initial={false}>
        {isOpen ? (
          <motion.div
            id={bodyId}
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            style={{ overflow: "hidden" }}
          >
            <div style={bodyStyle}>{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}

const sectionStyle: React.CSSProperties = {
  borderBottom: `1px solid ${ORA_THEME.border}`,
};

const headerStyle: React.CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 12px",
  background: ORA_THEME.creamLight,
  border: "none",
  borderRadius: 0,
  cursor: "pointer",
  fontSize: 11,
  fontWeight: 700,
  color: ORA_THEME.charcoal,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const bodyStyle: React.CSSProperties = {
  padding: 12,
};
