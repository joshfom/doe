'use client';

import { type ReactNode, useRef, useState } from 'react';

interface SidebarTooltipProps {
  label: string;
  show: boolean;
  children: ReactNode;
}

/**
 * Sidebar tooltip that uses fixed positioning to avoid clipping by overflow containers.
 * Only renders when sidebar is collapsed.
 */
export function SidebarTooltip({ label, show, children }: SidebarTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  if (!show) return <>{children}</>;

  const handleMouseEnter = () => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPos({
        top: rect.top + rect.height / 2,
        left: rect.right + 8,
      });
    }
  };

  const handleMouseLeave = () => {
    setPos(null);
  };

  return (
    <div
      ref={ref}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="relative"
    >
      {children}
      {pos && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[9999] whitespace-nowrap rounded-md bg-ora-charcoal px-2.5 py-1.5 text-xs text-white shadow-lg animate-in fade-in duration-150"
          style={{ top: pos.top, left: pos.left, transform: 'translateY(-50%)' }}
        >
          {label}
          {/* Arrow */}
          <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-ora-charcoal" />
        </div>
      )}
    </div>
  );
}
