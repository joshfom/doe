'use client';

// ── Secondary Briefing rail (Part B) ─────────────────────────────────────────
//
// In the chat-first redesign the Briefing is no longer the dominant left column.
// It is rendered here as a SECONDARY, collapsible panel — a right-hand rail on
// large screens, a card below the chat on small screens — collapsed by default
// so the conversational twin stays the primary full-content area. The chat is
// never blocked by the briefing: a toggle reveals it on demand, and the
// underlying `Briefing` keeps its non-blocking "unavailable" behavior (Req 1.6)
// and its timeout → degrade behavior (Req 11.4) via `onDegrade`.
//
// `Briefing` is ALWAYS mounted (its content is hidden, not unmounted, when the
// panel is collapsed) so it still fetches and can trigger the briefing-timeout
// degrade path even before the user expands the rail.

import { useState } from 'react';
import { CalendarClock, ChevronDown } from 'lucide-react';
import { Briefing } from './Briefing';

export interface BriefingPanelProps {
  /** Forwarded to `Briefing`: a briefing-request timeout degrades the surface. */
  onDegrade?: () => void;
  /** Whether the panel starts expanded (defaults to collapsed). */
  defaultOpen?: boolean;
}

export function BriefingPanel({ onDegrade, defaultOpen = false }: BriefingPanelProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <aside
      aria-label="Today's briefing"
      className="w-full lg:w-80 lg:shrink-0"
    >
      <div className="bg-ora-white border border-ora-sand/60">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-ora-cream-light"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-ora-charcoal">
            <CalendarClock className="h-4 w-4 stroke-[1.5] text-ora-gold" />
            Today&apos;s briefing
          </span>
          <ChevronDown
            className={`h-4 w-4 stroke-[1.5] text-ora-muted transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>

        {/* Briefing is always mounted so it fetches and can trigger the
            timeout → degrade path; its content is only hidden when collapsed. */}
        <div className={open ? 'border-t border-ora-sand/60 px-4 py-4' : 'hidden'}>
          <Briefing onDegrade={onDegrade} />
        </div>
      </div>
    </aside>
  );
}

export default BriefingPanel;
