"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

interface SlideOverSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Width as a Tailwind class, defaults to "w-[60vw] max-w-3xl" */
  widthClass?: string;
}

/**
 * Slide-over sheet panel that enters from the right.
 * Provides a backdrop overlay and a close button.
 */
export function SlideOverSheet({
  open,
  onClose,
  title,
  children,
  widthClass = "w-[60vw] max-w-3xl",
}: SlideOverSheetProps) {
  // Trap body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px]"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.25 }}
            className={`fixed top-0 right-0 bottom-0 z-50 flex flex-col bg-ora-white shadow-ora-lg border-l border-ora-sand ${widthClass}`}
          >
            {/* Header */}
            {title && (
              <div className="flex items-center justify-between border-b border-ora-sand px-6 py-4 shrink-0">
                <h2 className="text-lg font-semibold text-ora-charcoal">
                  {title}
                </h2>
                <button
                  onClick={onClose}
                  className="flex h-8 w-8 items-center justify-center text-ora-charcoal-light hover:bg-ora-cream-light transition-colors"
                  aria-label="Close"
                >
                  <X className="h-4 w-4 stroke-[1.5]" />
                </button>
              </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
