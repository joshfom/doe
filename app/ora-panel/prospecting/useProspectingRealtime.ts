'use client';

// ── Prospecting Workspace: live updates (S7, task 8.4) ───────────────────────
//
// ONE shared `EventSource` to `GET /api/prospecting/events` — the
// `leads:read`-gated, prospecting/market-scoped SSE stream served by the bridge
// (`lib/cms/api/routes/prospecting.ts`). Mirrors the Lead Engine
// (`leads/useLeadsRealtime.ts`) and Home_Surface (`_home/HomeRealtime.tsx`)
// patterns: the browser `EventSource` auto-reconnects and replays backlog, and
// each event is deduped by id before the caller's handler runs. The handler
// narrows on `event.type` (a `prospecting.*` / `market.*` string) and refreshes
// only what it cares about, so the workspace reacts to each step of the flow as
// it completes.

import { useEffect, useRef, useState } from 'react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

export type ProspectingStreamStatus = 'connecting' | 'open' | 'closed';

/** A single event as delivered over the prospecting SSE stream. */
export interface ProspectingEvent {
  id: string;
  type: string;
  payload: unknown;
  at: string;
}

type Handler = (event: ProspectingEvent) => void;

/**
 * Subscribe to the prospecting/market SSE stream for the lifetime of the
 * calling component. `enabled` gates the connection (e.g. pre-auth). The
 * handler should be stable (memoized) to avoid needless re-subscription.
 */
export function useProspectingRealtime(
  handler: Handler,
  enabled = true
): ProspectingStreamStatus {
  const [status, setStatus] = useState<ProspectingStreamStatus>('connecting');
  const handlerRef = useRef<Handler>(handler);

  // Keep the latest handler in a ref so the stream effect (below) need not
  // re-subscribe when the caller passes a fresh closure each render.
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;

    const seen = new Set<string>();
    const source = new EventSource(`${API_BASE_URL}/api/prospecting/events`, {
      withCredentials: true,
    });

    source.onopen = () => setStatus('open');

    source.onmessage = (message: MessageEvent<string>) => {
      let event: ProspectingEvent;
      try {
        event = JSON.parse(message.data) as ProspectingEvent;
      } catch {
        return; // heartbeat comments never reach onmessage
      }
      if (!event?.id || seen.has(event.id)) return;
      seen.add(event.id);
      try {
        handlerRef.current(event);
      } catch {
        // a misbehaving handler must not break the stream
      }
    };

    source.onerror = () => {
      setStatus(source.readyState === EventSource.CLOSED ? 'closed' : 'connecting');
    };

    return () => {
      source.close();
      setStatus('closed');
    };
  }, [enabled]);

  return status;
}
