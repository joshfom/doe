'use client';

// ── Agent-first Home_Surface (now at `/ora-panel`) ───────────────────────────
//
// `/ora-panel` IS the agent-first home (the old `/ora-panel/home` route was
// removed and consolidated here). It renders INSIDE `OraPanelLayout`
// (`app/ora-panel/layout.tsx`), so the RBAC-filtered hover sidebar — the
// Classic_Panel navigation — is structurally always present, in both the
// agent-first and the degraded views (Req 11.5, 12.2, 12.3, 12.4). The layout
// also resolves the session and redirects an unauthenticated visitor to
// `/ora-panel/login`, so this page never renders chat/briefing content before a
// session exists (Req 1.5). This is the post-login landing.
//
// PART B — chat-first redesign: the primary content is a conversational
// digital-twin landing (`HomeChat`). With no active conversation it shows a
// centered hero (greeting + suggested prompt cards + composer); once the user
// sends a turn it becomes a conversation view. The Briefing is SECONDARY — a
// collapsible rail (`BriefingPanel`) that never blocks chat (Req 1.6) and keeps
// its timeout → degrade behavior (Req 11.4).
//
// Degradation sources (both swap ONLY the content region; the sidebar stays):
//   • `useAgentAvailability()` — the health probe + pure `isDegraded` decision
//     (probe unavailable or check exceeds the 5s timeout → degraded; Req 11.1–11.3).
//   • a Briefing-request timeout (5s) — `BriefingPanel`/`Briefing` calls
//     `onDegrade` (Req 11.4).
// Recovery is automatic on the next load: the hook re-probes on mount (Req 11.6).
//
// Live updates run through one shared SSE connection (`HomeRealtimeProvider`),
// which fans events to whichever region they affect (Req 13.1, 13.6).
//
// [next-docs] This page is a Client Component (it needs state, effects, the
// EventSource, and fetch) per the Next.js 16 "Server and Client Components"
// guide. It adds a page only and does not touch `app/api/[...slugs]/route.ts`
// (its `runtime = "nodejs"` / `dynamic = "force-dynamic"` are preserved).

import { useState } from 'react';
import { useAgentAvailability } from './_home/useAgentAvailability';
import { useCurrentUser } from './_home/useCurrentUser';
import { HomeRealtimeProvider } from './_home/HomeRealtime';
import { BriefingPanel } from './_home/BriefingPanel';
import { HomeChat } from './_home/HomeChat';
import { ClassicFallback } from './_home/ClassicFallback';
import { Skeleton } from '@/components/ui/skeleton';

export default function OraPanelHomePage() {
  const { degraded, loading } = useAgentAvailability();
  const { firstName } = useCurrentUser();
  // A Briefing-request timeout degrades the surface too (Req 11.4).
  const [briefingDegraded, setBriefingDegraded] = useState(false);

  // Hold the agent-first regions back until the availability check resolves, so
  // we never flash chat/briefing and then swap to the classic view.
  if (loading) {
    return (
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Chat hero placeholder */}
        <div className="mx-auto flex min-w-0 flex-1 flex-col items-center gap-6 pt-[10vh]">
          <Skeleton className="h-9 w-72" />
          <Skeleton className="h-4 w-96 max-w-full" />
          {/* Suggested prompt cards */}
          <div className="mt-2 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))}
          </div>
          {/* Composer */}
          <Skeleton className="h-14 w-full max-w-2xl rounded-xl" />
        </div>
      </div>
    );
  }

  // Degraded_Mode: render the classic dashboard content. The sidebar
  // (Classic_Panel nav) remains present because it lives in OraPanelLayout.
  if (degraded || briefingDegraded) {
    return <ClassicFallback />;
  }

  return (
    <HomeRealtimeProvider>
      {/* Chat is the primary full-content area; the briefing is a secondary,
          collapsed-by-default rail beside it (below it on small screens). */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <HomeChat firstName={firstName} />
        </div>
        <BriefingPanel onDegrade={() => setBriefingDegraded(true)} />
      </div>
    </HomeRealtimeProvider>
  );
}
