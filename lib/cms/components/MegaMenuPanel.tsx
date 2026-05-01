"use client";

import { useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import type { MenuItemTree } from "@/lib/cms/types";

interface MegaMenuPanelProps {
  items: MenuItemTree[];
  columns: number;
  onClose: () => void;
}

/**
 * Mega menu panel — renders children in a multi-column grid.
 * Each direct child is a section header with nested children below.
 * Supports keyboard navigation (Escape, ArrowDown, ArrowUp),
 * viewport overflow prevention, and Framer Motion animations.
 *
 * Requirements: 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 4.1, 4.2
 */
export function MegaMenuPanel({ items, columns, onClose }: MegaMenuPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const cols = Math.min(Math.max(columns, 2), 4);
  const gridClass =
    cols === 2
      ? "grid-cols-2"
      : cols === 3
        ? "grid-cols-3"
        : "grid-cols-4";

  // Viewport overflow prevention: adjust horizontal position if panel
  // overflows the right or left edge of the viewport.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const viewportWidth = window.innerWidth;

    if (rect.right > viewportWidth) {
      const overflow = rect.right - viewportWidth;
      el.style.transform = `translateX(calc(-50% - ${overflow + 8}px))`;
    } else if (rect.left < 0) {
      const overflow = Math.abs(rect.left);
      el.style.transform = `translateX(calc(-50% + ${overflow + 8}px))`;
    }
  }, []);

  // Keyboard navigation handler
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const el = panelRef.current;
      if (!el) return;

      const focusable = Array.from(
        el.querySelectorAll<HTMLElement>('a, button, [tabindex="0"]')
      );
      const currentIndex = focusable.indexOf(
        document.activeElement as HTMLElement
      );

      switch (e.key) {
        case "Escape":
          e.preventDefault();
          onClose();
          break;

        case "ArrowDown": {
          e.preventDefault();
          const next =
            currentIndex < focusable.length - 1 ? currentIndex + 1 : 0;
          focusable[next]?.focus();
          break;
        }

        case "ArrowUp": {
          e.preventDefault();
          const prev =
            currentIndex > 0 ? currentIndex - 1 : focusable.length - 1;
          focusable[prev]?.focus();
          break;
        }
      }
    },
    [onClose]
  );

  return (
    <AnimatePresence>
      <motion.div
        ref={panelRef}
        role="menu"
        aria-label="Mega menu"
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.15 }}
        onKeyDown={handleKeyDown}
        className="absolute top-full left-1/2 z-50 -translate-x-1/2 min-w-[400px] border border-ora-sand/60 bg-ora-white/95 backdrop-blur-md shadow-ora-md p-6"
      >
        <div className={`grid ${gridClass} gap-6`}>
          {items.map((section) => (
            <div key={section.id} role="none">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-ora-muted">
                {section.label}
              </h3>
              <ul role="group" aria-label={section.label} className="space-y-1">
                {section.children.map((child) => (
                  <li key={child.id} role="none">
                    <Link
                      href={child.url}
                      role="menuitem"
                      tabIndex={0}
                      className="block py-1 text-sm text-ora-charcoal-light hover:text-ora-charcoal transition-colors focus-visible:ring-2 focus-visible:ring-ora-gold focus-visible:ring-offset-2 focus-visible:outline-none"
                      onClick={onClose}
                    >
                      {child.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
