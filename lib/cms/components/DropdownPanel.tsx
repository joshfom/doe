"use client";

import { useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import type { MenuItemTree } from "@/lib/cms/types";

interface DropdownPanelProps {
  items: MenuItemTree[];
  onClose: () => void;
}

/**
 * Simple dropdown panel — renders child items as a vertical list.
 * Supports keyboard navigation (Escape, ArrowDown, ArrowUp),
 * viewport overflow prevention, and Framer Motion animations.
 *
 * Requirements: 6.1, 6.3, 6.4, 6.5, 6.6, 6.7
 */
export function DropdownPanel({ items, onClose }: DropdownPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Viewport overflow prevention: adjust horizontal position if panel
  // overflows the right edge of the viewport.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const viewportWidth = window.innerWidth;

    if (rect.right > viewportWidth) {
      const overflow = rect.right - viewportWidth;
      el.style.transform = `translateX(-${overflow + 8}px)`;
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
      {/* Transparent wrapper: positioned at top-full of the <li>, provides
          a hover bridge between the nav item and the glass panel so the
          dropdown doesn't overlap the nav bar. */}
      <div
        className="absolute top-full left-0 z-50 pt-4"
        onKeyDown={handleKeyDown}
      >
        <motion.div
          ref={panelRef}
          role="menu"
          aria-label="Dropdown menu"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
          className="min-w-[220px] rounded-xl border border-white/10 bg-ora-charcoal/90 backdrop-blur-xl shadow-ora-lg overflow-hidden"
        >
          <ul role="none" className="p-1.5">
            {items.map((child) => (
              <li key={child.id} role="none">
                <Link
                  href={child.url}
                  role="menuitem"
                  tabIndex={0}
                  className="nav-item-label block px-4 py-2.5 text-[13px] uppercase tracking-widest font-normal text-white/80 hover:font-bold hover:text-white transition-all duration-150 focus-visible:ring-2 focus-visible:ring-ora-gold focus-visible:outline-none"
                  data-text={child.label}
                  onClick={onClose}
                >
                  {child.label}
                </Link>
              </li>
            ))}
          </ul>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
