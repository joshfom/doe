"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, Minus } from "lucide-react";
import type { MenuItemTree } from "@/lib/cms/types";

interface MobileMenuOverlayProps {
  items: MenuItemTree[];
  ctaLabel: string;
  ctaUrl: string;
  open: boolean;
  onClose: () => void;
  onCtaClick: (e: React.MouseEvent) => void;
}

/**
 * Full-screen mobile menu overlay.
 * Full implementation in task 10.5.
 */
export function MobileMenuOverlay({
  items,
  ctaLabel,
  ctaUrl,
  open,
  onClose,
  onCtaClick,
}: MobileMenuOverlayProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "tween", duration: 0.25 }}
          className="fixed inset-0 top-16 z-40 flex flex-col bg-ora-white/95 backdrop-blur-md md:hidden overflow-y-auto"
        >
          <ul className="flex-1 px-4 py-4 space-y-1">
            {items.map((item) => (
              <MobileMenuItem
                key={item.id}
                item={item}
                expanded={expanded}
                toggle={toggle}
                onClose={onClose}
              />
            ))}
          </ul>

          {ctaLabel && (
            <div className="border-t border-ora-sand/60 p-4">
              <Link
                href={ctaUrl || "#"}
                onClick={(e) => {
                  onCtaClick(e);
                  onClose();
                }}
                className="flex h-12 w-full items-center justify-center bg-ora-gold text-ora-white text-sm hover:bg-ora-gold-dark transition-colors"
              >
                {ctaLabel}
              </Link>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function MobileMenuItem({
  item,
  expanded,
  toggle,
  onClose,
}: {
  item: MenuItemTree;
  expanded: Set<string>;
  toggle: (id: string) => void;
  onClose: () => void;
}) {
  const hasChildren = item.children.length > 0;
  const isExpanded = expanded.has(item.id);

  return (
    <li>
      <div className="flex items-center">
        <Link
          href={item.url}
          onClick={onClose}
          className="flex-1 py-3 text-sm text-ora-charcoal hover:text-ora-gold transition-colors"
        >
          {item.label}
        </Link>
        {hasChildren && (
          <button
            type="button"
            onClick={() => toggle(item.id)}
            className="flex h-10 w-10 items-center justify-center text-ora-charcoal-light"
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? (
              <Minus className="h-4 w-4 stroke-1" />
            ) : (
              <Plus className="h-4 w-4 stroke-1" />
            )}
          </button>
        )}
      </div>
      {hasChildren && isExpanded && (
        <ul className="ml-4 space-y-1 border-l border-ora-sand/40 pl-4">
          {item.children.map((child) => (
            <MobileMenuItem
              key={child.id}
              item={child}
              expanded={expanded}
              toggle={toggle}
              onClose={onClose}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
