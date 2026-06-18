'use client';

// ── Lead-engine dashboard: realtime + cached lead list ───────────────────────
//
// `useLeadsRealtime` is the single hook a leads dashboard mounts to get a
// live-updating list of inbound leads. It combines the two pieces the codebase
// already provides:
//
//   1. TanStack Query owns the DATA — it fetches `GET /api/leads/inbound`,
//      caches it under `['leads','inbound', status]`, and handles retries +
//      dedupe. The dashboard renders from `leads` and never manages its own
//      fetch state.
//   2. ONE `EventSource` to `GET /api/realtime/leads` (the `leads:read`-gated
//      SSE stream) provides FRESHNESS. Each `lead.*` event nudges the cache:
//        - `lead.ingested` is patched directly onto the list (instant new row,
//          no refetch) using the enriched event payload, then
//        - every `lead.*` event also invalidates the query so the row is
//          reconciled with the server's canonical record (covers parsed /
//          resolved / routed status changes the payload can't fully describe).
//
// This is the recommended pattern over polling (the SSE stream makes it
// unnecessary) and over optimistic updates (inbound leads originate server-side,
// so the client has nothing to be optimistic about — it reacts to a push).
//
// The server event surface (`lib/cms/realtime/events.ts`) imports Drizzle, so it
// must not enter the client bundle; the wire shapes below are a client-safe
// mirror, the same approach the Demo Console (`voice-console/types.ts`) and the
// Home_Surface (`_home/HomeRealtime.tsx`) use.

import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

/** Intake status of a recorded inbound lead (mirrors `IntakeStatus`). */
export type LeadStatus = 'received' | 'parsed' | 'queued' | 'failed';

/** One inbound lead row as returned by `GET /api/leads/inbound`. */
export interface InboundLeadRow {
  id: string;
  source: string;
  status: LeadStatus;
  name: string | null;
  email: string | null;
  phoneHash: string | null;
  content: string;
  attribution: Record<string, string> | null;
  structured: unknown;
  partyId: string | null;
  attempts: number;
  lastError: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

/** Response shape of `GET /api/leads/inbound`. */
interface InboundLeadsResponse {
  count: number;
  leads: InboundLeadRow[];
}

/** A single event as delivered over the leads SSE stream. */
interface LeadEvent {
  id: string;
  type: string;
  payload: unknown;
  at: string;
}

/** Connection state of the leads SSE stream. */
export type LeadsStreamStatus = 'connecting' | 'open' | 'closed';

export interface UseLeadsRealtimeOptions {
  /** Filter the list to a single intake status (omit for all). */
  status?: LeadStatus;
  /** Max rows to fetch (server clamps to 1–200). Defaults to 50. */
  limit?: number;
  /** When false, neither the query nor the stream activate (e.g. pre-auth). */
  enabled?: boolean;
}

export interface UseLeadsRealtimeResult {
  /** The current list of inbound leads, newest first. */
  leads: InboundLeadRow[];
  /** True during the initial fetch. */
  isLoading: boolean;
  /** Fetch error, if any. */
  error: Error | null;
  /** Live SSE connection state. */
  streamStatus: LeadsStreamStatus;
  /** Force a refetch (rarely needed — the stream keeps the list fresh). */
  refetch: () => void;
}

/** Narrow the enriched `lead.ingested` payload into a partial row. */
function ingestedRowFromPayload(payload: unknown): InboundLeadRow | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.id !== 'string' || typeof p.source !== 'string') return null;
  const now = new Date().toISOString();
  return {
    id: p.id,
    source: p.source,
    status: (typeof p.status === 'string' ? p.status : 'received') as LeadStatus,
    name: typeof p.name === 'string' ? p.name : null,
    email: typeof p.email === 'string' ? p.email : null,
    phoneHash: null,
    content: '',
    attribution: null,
    structured: null,
    partyId: null,
    attempts: 0,
    lastError: null,
    idempotencyKey: '',
    createdAt: typeof p.capturedAt === 'string' ? p.capturedAt : now,
    updatedAt: now,
  };
}

/**
 * Live-updating inbound-lead list backed by TanStack Query + the leads SSE
 * stream. Mount once per dashboard view.
 */
export function useLeadsRealtime(
  options: UseLeadsRealtimeOptions = {}
): UseLeadsRealtimeResult {
  const { status, limit = 50, enabled = true } = options;
  const queryClient = useQueryClient();
  const queryKey = ['leads', 'inbound', status ?? 'all', limit] as const;
  const streamStatusRef = useRef<LeadsStreamStatus>('connecting');

  const query = useQuery({
    queryKey,
    enabled,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (status) params.set('status', status);
      const res = await fetch(`${API_BASE_URL}/api/leads/inbound?${params.toString()}`, {
        credentials: 'include',
        signal,
      });
      if (!res.ok) {
        throw new Error(`Failed to load leads (${res.status})`);
      }
      return (await res.json()) as InboundLeadsResponse;
    },
  });

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;

    const seenIds = new Set<string>();
    const source = new EventSource(`${API_BASE_URL}/api/realtime/leads`, {
      withCredentials: true,
    });

    source.onopen = () => {
      streamStatusRef.current = 'open';
    };

    source.onmessage = (message: MessageEvent<string>) => {
      let event: LeadEvent;
      try {
        event = JSON.parse(message.data) as LeadEvent;
      } catch {
        // Heartbeat comments never reach onmessage; ignore anything unparseable.
        return;
      }
      if (!event?.id || !event.type?.startsWith('lead.')) return;
      // Dedupe across the replay→live boundary (a reconnect replays backlog).
      if (seenIds.has(event.id)) return;
      seenIds.add(event.id);

      // Patch a newly ingested lead straight onto the cached list for an instant
      // row, skipping it if it (or its filter) doesn't apply to this view.
      if (event.type === 'lead.ingested') {
        const row = ingestedRowFromPayload(event.payload);
        if (row && (!status || row.status === status)) {
          queryClient.setQueryData<InboundLeadsResponse>(queryKey, (prev) => {
            if (!prev) return prev;
            if (prev.leads.some((l) => l.id === row.id)) return prev; // already present
            const leads = [row, ...prev.leads].slice(0, limit);
            return { count: leads.length, leads };
          });
        }
      }

      // Always reconcile with the server's canonical record: status transitions
      // (parsed / resolved / routed / failed) and fields the payload can't carry
      // are picked up by the refetch.
      queryClient.invalidateQueries({ queryKey });
    };

    source.onerror = () => {
      // EventSource auto-reconnects; reflect the transient drop.
      streamStatusRef.current =
        source.readyState === EventSource.CLOSED ? 'closed' : 'connecting';
    };

    return () => {
      source.close();
      streamStatusRef.current = 'closed';
    };
    // queryKey is derived from status+limit; re-subscribe when they change.
  }, [enabled, status, limit, queryClient]);

  return {
    leads: query.data?.leads ?? [],
    isLoading: query.isLoading,
    error: (query.error as Error) ?? null,
    streamStatus: streamStatusRef.current,
    refetch: () => {
      void query.refetch();
    },
  };
}
