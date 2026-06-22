'use client';

// ── Panel top nav (full-width, glassmorphic) ──────────────────────────────────
// A fixed, full-width top bar for the admin panel. It sits to the right of the
// collapsed sidebar rail and spans to the viewport edge, so panel content can
// "skip" its height with a matching top padding on <main> (see layout.tsx).
//
// Left:  the current section title (derived from the active nav item).
// Right: the signed-in user menu + session-only persona toggle (PanelTopBar).
//
// The bar is glassmorphic — a translucent cream surface with a backdrop blur
// and a hairline bottom border — so the scrolling content shows through softly.

import { PanelTopBar } from './PanelTopBar';

/** Fixed height of the bar, in rem. Kept in sync with `main`'s top padding. */
export const PANEL_TOP_NAV_HEIGHT = '4rem';

export function PanelTopNav({
  title,
  userName,
}: {
  /** Current section label shown on the left. */
  title?: string | null;
  /** Signed-in user's display name for the right-hand menu. */
  userName?: string | null;
}) {
  return (
    <header
      className="fixed inset-x-0 left-16 top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-ora-sand/50 bg-ora-cream-light/60 px-5 backdrop-blur-md backdrop-saturate-150 sm:px-8"
      style={{ fontFamily: 'var(--font-poppins), Poppins, system-ui, sans-serif' }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="hidden text-[10px] font-bold uppercase tracking-[0.22em] text-ora-gold-dark sm:inline">
          ORA
        </span>
        <span className="hidden h-4 w-px bg-ora-sand/70 sm:inline-block" />
        <h1 className="truncate text-sm font-semibold text-ora-charcoal">
          {title?.trim() || 'Dashboard'}
        </h1>
      </div>

      <PanelTopBar userName={userName} />
    </header>
  );
}

export default PanelTopNav;
