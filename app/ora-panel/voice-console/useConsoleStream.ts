'use client';

import { useEffect, useRef, useState } from 'react';
import type { DoeEvent, StreamStatus } from './types';

// ── Demo Console SSE hook ─────────────────────────────────────────────────────
// Opens a single `EventSource` against `GET /api/realtime/events` (the durable
// stream served by the Bun mount) and accumulates the ordered event log. The
// browser `EventSource` sends the Better Auth session cookie with
// `withCredentials`, and the route enforces `voice:console` server-side
// (Req 7.1, 14.6). The stream already replays recent backlog then goes live
// with no gap (Property 12), so the Console simply appends what it receives.
//
// This hook is the SINGLE source of console events. Sibling features (the
// latency HUD, task 15.2; the reset control, task 15.3) should consume the
// `events` array returned here rather than opening a second EventSource, so the
// whole page shares one connection. (Design §7.6)

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

/** Cap the in-memory log so a long-running demo can't grow unbounded. */
const MAX_EVENTS = 1_000;

export interface ConsoleStream {
  /** All received events in arrival (chronological) order. */
  events: DoeEvent[];
  /** Current EventSource connection state. */
  status: StreamStatus;
}

/**
 * Subscribe to the realtime event bus for the lifetime of the component.
 *
 * @param enabled When false (e.g. before auth resolves), no connection opens.
 */
export function useConsoleStream(enabled: boolean = true): ConsoleStream {
  const [events, setEvents] = useState<DoeEvent[]>([]);
  const [status, setStatus] = useState<StreamStatus>('connecting');
  // Dedupe by id across the replay→live boundary defensively (the server
  // already dedupes, but a reconnect replays backlog again).
  const seenIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;

    const source = new EventSource(`${API_BASE_URL}/api/realtime/events`, {
      withCredentials: true,
    });

    source.onopen = () => setStatus('open');

    source.onmessage = (message: MessageEvent<string>) => {
      let event: DoeEvent;
      try {
        event = JSON.parse(message.data) as DoeEvent;
      } catch {
        // Heartbeat comments (": heartbeat") never reach onmessage; anything
        // unparseable is ignored rather than crashing the pane.
        return;
      }
      if (!event?.id || seenIds.current.has(event.id)) return;
      seenIds.current.add(event.id);
      setEvents((prev) => {
        const next = prev.length >= MAX_EVENTS ? prev.slice(prev.length - MAX_EVENTS + 1) : prev;
        return [...next, event];
      });
    };

    source.onerror = () => {
      // EventSource auto-reconnects; reflect the transient drop in the UI.
      setStatus(source.readyState === EventSource.CLOSED ? 'closed' : 'connecting');
    };

    return () => {
      source.close();
      setStatus('closed');
    };
  }, [enabled]);

  return { events, status };
}
