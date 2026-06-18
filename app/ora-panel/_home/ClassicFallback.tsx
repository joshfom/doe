'use client';

// ── Classic_Panel fallback content (S5, task 12; Req 11.2, 11.4, 12.x) ───────
//
// When the Home_Surface enters Degraded_Mode (the Agent_Availability_Check
// reports unavailable / times out, or a Briefing request times out), the
// content region renders the EXISTING classic dashboard content instead of the
// agent-first experience (Req 11.2, 11.4). The shell sidebar — the Classic_Panel
// navigation, RBAC-filtered in `app/ora-panel/layout.tsx` — is structurally
// always present because the Home_Surface lives INSIDE `OraPanelLayout`, so the
// degraded surface offers exactly the navigation the classic panel offers today
// (Req 11.5, 12.2, 12.3) with the same permission checks (Req 11.7).
//
// We reuse the extracted classic dashboard component
// (`app/ora-panel/_components/ClassicDashboard.tsx`) rather than the page itself
// — `/ora-panel`'s page now renders THIS agent-first surface, so importing the
// page would recurse. A short note tells the user why they are seeing the
// classic view.

import { ClassicDashboard } from '../_components/ClassicDashboard';

export function ClassicFallback() {
  return (
    <div>
      <div
        role="status"
        className="mb-6 border border-ora-sand bg-ora-cream-light px-4 py-3 text-sm text-ora-charcoal-light"
      >
        The agent-first home is unavailable right now, so you&apos;re viewing the
        classic dashboard. Use the sidebar to navigate as usual — it&apos;ll
        return automatically once the assistant is back.
      </div>
      <ClassicDashboard />
    </div>
  );
}

export default ClassicFallback;
