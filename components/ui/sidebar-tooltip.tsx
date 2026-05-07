'use client';

import { type ReactNode, useRef, useState } from 'react';

interface SidebarTooltipProps {
  label: string;
  show: boolean;
  children: ReactNode;
  side?: 'right' | 'left' | 'top' | 'bottom';
}

/**
 * Sidebar tooltip that uses fixed positioning to avoid clipping by overflow containers.
 * Only renders when sidebar is collapsed.
 */
export function SidebarTooltip({
  label,
  show,
  children,
  side = 'right',
}: SidebarTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  if (!show) return <>{children}</>;

  const handleMouseEnter = () => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      switch (side) {
        case 'left':
          setPos({
            top: rect.top + rect.height / 2,
            left: rect.left - 8,
          });
          break;
        case 'top':
          setPos({
            top: rect.top - 8,
            left: rect.left + rect.width / 2,
          });
          break;
        case 'bottom':
          setPos({
            top: rect.bottom + 8,
            left: rect.left + rect.width / 2,
          });
          break;
        case 'right':
        default:
          setPos({
            top: rect.top + rect.height / 2,
            left: rect.right + 8,
          });
          break;
      }
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
      onFocusCapture={handleMouseEnter}
      onBlurCapture={handleMouseLeave}
      className="relative"
    >
      {children}
      {pos && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-9999 whitespace-nowrap border border-ora-sand bg-ora-white px-2.5 py-1.5 text-[11px] text-ora-charcoal animate-in fade-in duration-150"
          style={{
            top: pos.top,
            left: pos.left,
            transform:
              side === 'left'
                ? 'translate(-100%, -50%)'
                : side === 'top'
                  ? 'translate(-50%, -100%)'
                  : side === 'bottom'
                    ? 'translateX(-50%)'
                    : 'translateY(-50%)',
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}
