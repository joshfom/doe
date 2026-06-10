"use client";

/**
 * ConfigurationSheet — slide-in right sheet that wraps the Slice 1
 * `ConfigurationPanel`.
 *
 * Spec: custom-branded-page-builder — task 15.3
 * _Requirements: 8.3, 8.4, 18.3_
 *
 * Design constraints:
 *   - **Reuse**, don't fork. The sheet is a chrome-around-it container;
 *     the actual fields come from the same `ConfigurationPanel` the
 *     admin builder uses (Req 8.4, code-reuse invariant).
 *   - **Focus trap.** Tab/Shift+Tab cycles through focusable descendants
 *     only — opening the sheet auto-focuses its first focusable child,
 *     closing returns focus to the trigger (Req 18.3).
 *   - **ESC closes**, body scroll is locked while open. Mirrors
 *     `RegisterInterestDialog`'s conventions for visual consistency.
 *
 * The sheet renders inside a portal so it overlays the live page rather
 * than being clipped by any ancestor `overflow:hidden`.
 */

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ConfigurationPanel } from "@/lib/page-builder/builder-shell/configuration-panel/ConfigurationPanel";

interface ConfigurationSheetProps {
  open: boolean;
  onClose: () => void;
  /** Called when the user requests to close — e.g. ESC, X button, backdrop. */
  pageSlug?: string;
}

const FOCUSABLE_SELECTORS =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ConfigurationSheet({
  open,
  onClose,
  pageSlug,
}: ConfigurationSheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Open lifecycle: capture the trigger element, lock scroll, attach
  // ESC + focus-trap handlers, focus the first focusable descendant.
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !sheetRef.current) return;
      const focusables = sheetRef.current.querySelectorAll<HTMLElement>(
        FOCUSABLE_SELECTORS,
      );
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);

    // Focus first focusable inside the sheet on next frame so portal
    // contents are mounted.
    const id = window.requestAnimationFrame(() => {
      const first = sheetRef.current?.querySelector<HTMLElement>(
        FOCUSABLE_SELECTORS,
      );
      first?.focus();
    });

    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
      window.cancelAnimationFrame(id);
      previousFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          data-inline-editor-ui=""
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            zIndex: 9999,
          }}
          onClick={onClose}
        >
          <motion.aside
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="Block configuration"
            data-testid="inline-config-sheet"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              width: 380,
              maxWidth: "100vw",
              background: "#FFFFFF",
              boxShadow: "-8px 0 24px rgba(0,0,0,0.12)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <header
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 16px",
                borderBottom: "1px solid #E5E5E5",
              }}
            >
              <strong style={{ fontSize: 14 }}>Configure block</strong>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close configuration sheet"
                style={{
                  background: "transparent",
                  border: "none",
                  fontSize: 18,
                  cursor: "pointer",
                  padding: 4,
                }}
              >
                ✕
              </button>
            </header>
            <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
              <ConfigurationPanel pageSlug={pageSlug} />
            </div>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
