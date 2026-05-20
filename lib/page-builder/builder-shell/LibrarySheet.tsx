"use client";

/**
 * LibrarySheet — reusable slide-in sheet overlay for the Template Library
 * and Component Library panels.
 *
 * Spec: builder-template-component-library — task 3
 * Requirements: R7.1, R7.2, R7.3, R7.4, R7.5, R7.6, R7.7, R7.8
 *
 * Design constraints:
 *   - Portal to `document.body` so it overlays the entire builder shell.
 *   - Framer Motion slide-in/out from right edge (200ms tween).
 *   - Backdrop at rgba(0,0,0,0.5) with click-to-close.
 *   - Focus trap: Tab/Shift+Tab cycle within sheet only.
 *   - ESC closes, returns focus to trigger element.
 *   - Body scroll locked while open.
 *   - Close button: top-right (LTR) / top-left (RTL), 44×44px touch target.
 *   - role="dialog", aria-modal="true", aria-label from title prop.
 *   - Width: 85vw, max 90vw, height: 100vh.
 *   - Internal scroll for content overflow.
 *   - Inline styles using ORA_THEME tokens — no Tailwind, no external UI lib.
 */

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

export interface LibrarySheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Width as CSS value. Default: "85vw". Max: "90vw". */
  width?: string;
}

const FOCUSABLE_SELECTORS =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function LibrarySheet({
  open,
  onClose,
  title,
  children,
  width = "85vw",
}: LibrarySheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Open lifecycle: capture trigger element, lock scroll, attach
  // ESC + focus-trap handlers, focus first focusable descendant.
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
          data-testid="library-sheet-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 1100,
          }}
          onClick={onClose}
        >
          <motion.aside
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            data-testid="library-sheet"
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
              width,
              maxWidth: "90vw",
              height: "100vh",
              background: "#FFFFFF",
              boxShadow: "-8px 0 24px rgba(0,0,0,0.12)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <header
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0 16px",
                height: 56,
                minHeight: 56,
                borderBottom: "1px solid #E5E1DA",
                fontFamily: "system-ui, sans-serif",
              }}
            >
              <strong style={{ fontSize: 16, color: "#2C2C2C" }}>
                {title}
              </strong>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 44,
                  height: 44,
                  minWidth: 44,
                  minHeight: 44,
                  background: "transparent",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                  color: "#2C2C2C",
                }}
              >
                <X size={20} />
              </button>
            </header>

            {/* Scrollable content area */}
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                overflowX: "hidden",
              }}
            >
              {children}
            </div>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
