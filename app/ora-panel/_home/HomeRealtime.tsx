'use client';

// ── Home_Surface live updates (S5, task 12; Req 13.1, 13.6) ──────────────────
//
// ONE shared `EventSource` to `GET /api/realtime/events` for the whole
// Home_Surface, mirroring the Demo Console's single-stream pattern
// (`voice-console/useConsoleStream.ts`). The provider fans each received event
// out to region subscribers through a ref-held registry, so a published event
// updates ONLY the affected region (Briefing vs Home_Chat) — each region
// subscribes a handler that updates its own local state, and unaffected regions
// do not re-render (Req 13.1). The browser `EventSource` auto-reconnects on a
// dropped connection; `onerror` reflects the transient state and the replayed
// backlog refreshes the affected regions without a full page reload (Req 13.6).
//
// The server event surface (`lib/cms/realtime/events.ts`) imports Drizzle, so it
// must not enter the client bundle; we mirror the wire shape here as a
// client-safe contract (same approach as the Console's `types.ts`).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

/** Connection state of the shared Home_Surface stream. */
export type HomeStreamStatus = 'connecting' | 'open' | 'closed';

/**
 * A single event as delivered over SSE (`data: ${JSON.stringify(event)}`).
 * Client-safe mirror of `DoeEvent` in `lib/cms/realtime/events.ts` — keep the
 * shape in sync; `type` is left as a broad `string` so a new server event type
 * never breaks the client build.
 */
export interface HomeEvent {
  id: string;
  type: string;
  payload: unknown;
  at: string;
}

type HomeEventHandler = (event: HomeEvent) => void;

interface HomeRealtimeValue {
  /** Subscribe a region handler; returns an unsubscribe fn. */
  subscribe: (handler: HomeEventHandler) => () => void;
  /** Current shared connection state. */
  status: HomeStreamStatus;
}

const HomeRealtimeContext = createContext<HomeRealtimeValue | null>(null);

/**
 * Opens the single shared SSE connection for the Home_Surface and provides a
 * ref-based subscription registry to its descendants. Subscribing/unsubscribing
 * does not re-render consumers (the registry lives in a ref), so each region
 * controls its own re-render on the events it cares about.
 */
export function HomeRealtimeProvider({ children }: { children: ReactNode }) {
  const handlers = useRef<Set<HomeEventHandler>>(new Set());
  const seenIds = useRef<Set<string>>(new Set());
  const [status, setStatus] = useState<HomeStreamStatus>('connecting');

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      return;
    }

    const source = new EventSource(`${API_BASE_URL}/api/realtime/events`, {
      withCredentials: true,
    });

    source.onopen = () => setStatus('open');

    source.onmessage = (message: MessageEvent<string>) => {
      let event: HomeEvent;
      try {
        event = JSON.parse(message.data) as HomeEvent;
      } catch {
        // Heartbeat comments never reach onmessage; ignore anything unparseable.
        return;
      }
      // Dedupe across the replay→live boundary (a reconnect replays backlog).
      if (!event?.id || seenIds.current.has(event.id)) return;
      seenIds.current.add(event.id);
      for (const handler of handlers.current) {
        try {
          handler(event);
        } catch {
          // A misbehaving region handler must not break the fan-out.
        }
      }
    };

    source.onerror = () => {
      // EventSource auto-reconnects (Req 13.6); reflect the transient drop.
      setStatus(
        source.readyState === EventSource.CLOSED ? 'closed' : 'connecting'
      );
    };

    return () => {
      source.close();
      setStatus('closed');
    };
  }, []);

  const subscribe = useCallback((handler: HomeEventHandler) => {
    handlers.current.add(handler);
    return () => {
      handlers.current.delete(handler);
    };
  }, []);

  return (
    <HomeRealtimeContext.Provider value={{ subscribe, status }}>
      {children}
    </HomeRealtimeContext.Provider>
  );
}

/**
 * Subscribe a region handler to the shared Home_Surface stream for the lifetime
 * of the calling component. The handler should narrow on `event.type` and update
 * only its own region's state, so unaffected regions never re-render (Req 13.1).
 * A stable handler (memoized by the caller) avoids needless re-subscription.
 */
export function useHomeEvents(handler: HomeEventHandler): HomeStreamStatus {
  const ctx = useContext(HomeRealtimeContext);
  if (!ctx) {
    throw new Error('useHomeEvents must be used within a HomeRealtimeProvider');
  }
  const { subscribe, status } = ctx;
  useEffect(() => subscribe(handler), [subscribe, handler]);
  return status;
}

/** Read just the shared connection status (no event subscription). */
export function useHomeStreamStatus(): HomeStreamStatus {
  const ctx = useContext(HomeRealtimeContext);
  if (!ctx) {
    throw new Error(
      'useHomeStreamStatus must be used within a HomeRealtimeProvider'
    );
  }
  return ctx.status;
}
