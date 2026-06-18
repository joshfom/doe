'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldAlert, Radio, RadioTower } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import type { SessionData } from '@/lib/types/session';
import { useConsoleStream } from './useConsoleStream';
import { ConsoleAura } from './ConsoleAura';
import {
  TranscriptPane,
  DecisionsPane,
  ActionsPane,
  OutboxPane,
  JobRunsPane,
} from './panes';

// ── Demo Console (Act 2) ──────────────────────────────────────────────────────
// A read-only second screen that makes every voice decision and action visible
// in real time. It reuses the panel's Better Auth session + RBAC (gated on the
// `voice:console` permission, mirroring the server-side guard on
// `GET /api/realtime/events`) and renders five live panes driven by one shared
// EventSource. (Design §7.6; Req 7.6)
//
// COMPOSITION SEAMS for sibling tasks — keep these intact:
//   • Task 15.2 (latency HUD): mount inside `<HudSlot>` in the header, consuming
//     the shared `events` array (turn.appended latency). Do NOT open a second
//     EventSource — read from `useConsoleStream`.
//   • Task 15.3 (reset control): mount inside `<ResetSlot>` in the header; wire
//     it to `POST /api/demo/reset`.
// Both slots are dedicated containers below so the two tasks can plug in without
// touching the pane grid or each other.

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

function hasConsoleAccess(session: SessionData): boolean {
  const roles = session.roles ?? [];
  const permissions = session.permissions ?? [];
  return (
    roles.includes('super_admin') ||
    permissions.includes('*:*') ||
    permissions.includes('voice:console') ||
    permissions.includes('voice:*')
  );
}

export default function VoiceConsolePage() {
  const router = useRouter();
  const [authLoading, setAuthLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/api/auth/session`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error('Not authenticated');
        const json = await res.json();
        if (!json?.data?.userId) throw new Error('Not authenticated');
        return json.data as SessionData;
      })
      .then((data) => {
        if (cancelled) return;
        if (!hasConsoleAccess(data)) {
          setUnauthorized(true);
          setAuthLoading(false);
          return;
        }
        setAuthLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        const next = encodeURIComponent('/ora-panel/voice-console');
        router.replace(`/ora-panel/login?next=${next}`);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Only open the stream once authorized, so an unauthorized user never
  // establishes the SSE connection.
  const ready = !authLoading && !unauthorized;
  const { events, status } = useConsoleStream(ready);

  if (authLoading) {
    return (
      <div className="flex h-[calc(100vh-4rem)] flex-col">
        {/* Header */}
        <div className="mb-4 space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        {/* Pane grid */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3">
          <Skeleton className="rounded-lg lg:row-span-2" />
          <Skeleton className="rounded-lg" />
          <Skeleton className="rounded-lg" />
          <Skeleton className="rounded-lg" />
          <Skeleton className="rounded-lg" />
        </div>
      </div>
    );
  }

  if (unauthorized) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
        <ShieldAlert className="h-8 w-8 text-ora-error" />
        <p className="text-sm text-ora-charcoal">
          You do not have permission to view the Demo Console.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ora-charcoal">Demo Console</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-ora-charcoal-light">
            <ConnectionBadge status={status} />
            Live voice decisions and actions
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Live voice Aura — pulses with the conversation (event-driven). */}
          <ConsoleAura events={events} />
          {/* ── Slot: latency HUD (task 15.2) ──────────────────────────────
              Mount a <LatencyHud events={events} /> here. */}
          <HudSlot />
          {/* ── Slot: reset control (task 15.3) ────────────────────────────
              Mount a reset button wired to POST /api/demo/reset here. */}
          <ResetSlot />
        </div>
      </div>

      {/* Pane grid */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Transcript spans the full height of the left column on large screens */}
        <div className="flex min-h-0 flex-col lg:row-span-2">
          <TranscriptPane events={events} />
        </div>
        <div className="flex min-h-0 flex-col">
          <ActionsPane events={events} />
        </div>
        <div className="flex min-h-0 flex-col">
          <DecisionsPane events={events} />
        </div>
        <div className="flex min-h-0 flex-col">
          <OutboxPane events={events} />
        </div>
        <div className="flex min-h-0 flex-col">
          <JobRunsPane events={events} />
        </div>
      </div>
    </div>
  );
}

// ── Composition slots ─────────────────────────────────────────────────────────
// Intentionally empty placeholders so tasks 15.2 and 15.3 have a stable,
// collision-free mount point. They render nothing until those tasks fill them.

function HudSlot() {
  return <div data-slot="latency-hud" className="contents" />;
}

function ResetSlot() {
  return <div data-slot="reset-control" className="contents" />;
}

// ── Connection badge ──────────────────────────────────────────────────────────

function ConnectionBadge({ status }: { status: 'connecting' | 'open' | 'closed' }) {
  if (status === 'open') {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-600">
        <RadioTower className="h-3.5 w-3.5 stroke-[1.5]" />
        <span className="text-xs font-medium">Connected</span>
        <span aria-hidden>·</span>
      </span>
    );
  }
  const label = status === 'connecting' ? 'Connecting…' : 'Disconnected';
  const className = status === 'connecting' ? 'text-amber-600' : 'text-ora-muted';
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <Radio className="h-3.5 w-3.5 stroke-[1.5]" />
      <span className="text-xs font-medium">{label}</span>
      <span aria-hidden>·</span>
    </span>
  );
}
