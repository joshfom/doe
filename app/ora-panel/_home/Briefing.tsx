'use client';

// ── Briefing region (S5, task 12; Req 1.2, 1.6, 2, 3, 11.4, 13.1) ────────────
//
// Requests `GET /api/home/briefing` for the current Briefing_Window scoped to
// the signed-in user (the route resolves the window from the user's local time;
// we pass the browser's `tzOffset` so it resolves in the USER's local time, Req
// 1.2). It then renders the served Briefing's regions (greeting / recap / stack
// / figures / invitation) from the `Briefing` shape in
// `lib/cms/agents/home/types.ts`.
//
// In the chat-first redesign (Part B) the Briefing is SECONDARY — it is rendered
// inside the collapsible `BriefingPanel` rail, so it never dominates the chat.
// Its data/failure behavior is unchanged from the original two-column home:
//
//   • TIMEOUT (no response within 5s) → DEGRADE the whole surface (Req 11.4).
//     The fetch is raced against a 5s AbortController; an abort calls
//     `onDegrade()` so the page swaps in the Classic_Panel content.
//   • FAILURE / EMPTY (the route answers `{ ok:false, reason }`, or the request
//     errors for a non-timeout reason) → show a NON-BLOCKING "briefing
//     unavailable" indication WITHOUT degrading and WITHOUT blocking Home_Chat
//     (Req 1.6). The chat region is mounted by the page independently.
//
// Live updates (Req 13.1): the component subscribes to the shared Home_Surface
// stream and re-requests the Briefing when a Stack-affecting mutation event for
// the user arrives, so only this region refreshes — the chat region is
// untouched. A dropped/replayed connection refreshes it the same way (Req 13.6).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useHomeEvents, type HomeEvent } from './HomeRealtime';
import type {
  Briefing as BriefingShape,
  StackItem,
  BriefingFigure,
} from '@/lib/cms/agents/home/types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

/** Briefing-request timeout: 5s → degrade (Req 11.4). */
const BRIEFING_TIMEOUT_MS = 5000;

/**
 * Stack-affecting realtime event types that should refresh the Briefing region
 * (mirrors the server-side `STACK_MUTATION_EVENT_TYPES` in
 * `lib/cms/api/routes/home.ts`). A mutation of one of these re-requests the
 * Briefing so the region reflects the change within ~2s (Req 13.1, 5.5).
 */
const STACK_REFRESH_EVENT_TYPES = new Set<string>([
  'lead.routed',
  'lead.unrouted',
  'lead.resolved',
  'lead.conflict',
  'lead.enriched',
  'lead.nudged',
]);

type BriefingServeResult =
  | { ok: true; briefing: BriefingShape; cached: boolean }
  | { ok: false; reason: 'window_unresolved' | 'assembly_failed' };

type FetchState =
  | { phase: 'loading' }
  | { phase: 'ready'; briefing: BriefingShape }
  | { phase: 'unavailable' };

export interface BriefingProps {
  /**
   * Called when the Briefing request does not complete within the 5s timeout,
   * so the surface enters Degraded_Mode (Req 11.4). A timeout is the only path
   * that degrades; an `{ ok:false }` answer or a non-timeout error is handled
   * inline as "unavailable" (Req 1.6).
   */
  onDegrade?: () => void;
}

export function Briefing({ onDegrade }: BriefingProps) {
  const [state, setState] = useState<FetchState>({ phase: 'loading' });
  const mounted = useRef(true);
  // Bump to force a re-request (live update / retry).
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let cancelled = false;
    let timedOut = false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, BRIEFING_TIMEOUT_MS);

    // Resolve the window in the user's local time: minutes to ADD to UTC.
    const tzOffset = -new Date().getTimezoneOffset();
    const url = `${API_BASE_URL}/api/home/briefing?tzOffset=${tzOffset}`;

    setState({ phase: 'loading' });
    fetch(url, { credentials: 'include', signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          // A non-2xx (auth/5xx) is a non-timeout failure → unavailable (Req 1.6).
          if (!cancelled && mounted.current) setState({ phase: 'unavailable' });
          return;
        }
        const json = (await res.json()) as { data?: BriefingServeResult } | null;
        const served = json?.data;
        if (cancelled || !mounted.current) return;
        if (served && served.ok) {
          setState({ phase: 'ready', briefing: served.briefing });
        } else {
          // window_unresolved / assembly_failed → non-blocking unavailable.
          setState({ phase: 'unavailable' });
        }
      })
      .catch(() => {
        if (cancelled || !mounted.current) return;
        if (timedOut) {
          // No response within 5s → degrade the surface (Req 11.4).
          onDegrade?.();
        } else {
          // Non-timeout network error → unavailable, chat not blocked (Req 1.6).
          setState({ phase: 'unavailable' });
        }
      })
      .finally(() => clearTimeout(timer));

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [nonce, onDegrade]);

  // Live updates: refresh ONLY this region on a Stack-affecting mutation.
  const onEvent = useCallback((event: HomeEvent) => {
    if (STACK_REFRESH_EVENT_TYPES.has(event.type)) {
      setNonce((n) => n + 1);
    }
  }, []);
  useHomeEvents(onEvent);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  if (state.phase === 'loading') {
    return (
      <div aria-label="Briefing" className="p-1">
        <div className="h-5 w-32 animate-pulse rounded bg-ora-sand/60" />
        <div className="mt-4 space-y-2">
          <div className="h-4 w-3/4 animate-pulse rounded bg-ora-sand/40" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-ora-sand/40" />
        </div>
      </div>
    );
  }

  if (state.phase === 'unavailable') {
    return (
      <div aria-label="Briefing" role="status" className="p-1">
        <p className="text-sm text-ora-charcoal-light">
          Your briefing is unavailable right now. You can still chat as usual.
        </p>
        <button
          type="button"
          onClick={retry}
          className="mt-3 inline-flex h-8 items-center rounded bg-ora-charcoal px-3 text-xs font-medium text-white transition-colors hover:bg-ora-charcoal/90"
        >
          Retry
        </button>
      </div>
    );
  }

  return <BriefingContent briefing={state.briefing} />;
}

// ── Presentational rendering of the served Briefing shape ─────────────────────

function BriefingContent({ briefing }: { briefing: BriefingShape }) {
  const stackUnavailable =
    !Array.isArray(briefing.stack) &&
    (briefing.stack as { unavailable?: boolean })?.unavailable === true;
  const stackItems: StackItem[] = Array.isArray(briefing.stack)
    ? briefing.stack
    : [];

  return (
    <div aria-label="Briefing" className="p-1">
      <header>
        <p className="text-xs uppercase tracking-wide text-ora-muted">
          {windowLabel(briefing.window)}
        </p>
        <h2 className="mt-1 text-base font-semibold text-ora-charcoal">
          {briefing.greeting}
        </h2>
      </header>

      {briefing.figures.length > 0 && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {briefing.figures.map((figure, i) => (
            <Figure key={`${figure.metricId}:${figure.scopeId}:${figure.period}:${i}`} figure={figure} />
          ))}
        </div>
      )}

      {briefing.recap && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-ora-charcoal">Yesterday</h3>
          <StackList
            label="Completed"
            items={briefing.recap.completed}
            emptyText="Nothing completed."
          />
          <StackList
            label="Outstanding"
            items={briefing.recap.outstanding}
            emptyText="Nothing outstanding."
          />
        </div>
      )}

      <div className="mt-6">
        <h3 className="text-sm font-semibold text-ora-charcoal">Today&apos;s stack</h3>
        {stackUnavailable ? (
          <p role="status" className="mt-2 text-sm text-ora-charcoal-light">
            Your stack is unavailable right now.
          </p>
        ) : (
          <StackList items={stackItems} emptyText="Nothing on your stack." />
        )}
      </div>

      {briefing.invitesAdd && (
        <p className="mt-6 text-sm text-ora-charcoal-light">
          Want to add anything to today&apos;s stack? Ask in the chat.
        </p>
      )}
    </div>
  );
}

function Figure({ figure }: { figure: BriefingFigure }) {
  return (
    <div className="border border-ora-sand/60 p-3">
      <span className="block text-xs text-ora-muted">{figure.metricId}</span>
      <span className="mt-1 block text-lg font-semibold text-ora-charcoal">
        {figure.available ? figure.value : 'Unavailable'}
      </span>
      <span className="mt-0.5 block text-[10px] text-ora-muted">
        {figure.scopeId} · {figure.period}
      </span>
    </div>
  );
}

function StackList({
  label,
  items,
  emptyText,
}: {
  label?: string;
  items: StackItem[];
  emptyText: string;
}) {
  return (
    <div className="mt-2">
      {label && (
        <p className="text-xs font-medium uppercase tracking-wide text-ora-muted">
          {label}
        </p>
      )}
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-ora-charcoal-light">{emptyText}</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between text-sm text-ora-charcoal"
            >
              <span className={item.status === 'done' ? 'line-through text-ora-muted' : ''}>
                {item.title}
              </span>
              {item.dueAt && (
                <span className="ml-3 shrink-0 text-xs text-ora-muted">
                  {item.dueAt}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function windowLabel(window: BriefingShape['window']): string {
  switch (window) {
    case 'morning':
      return 'Morning briefing';
    case 'midday':
      return 'Midday check-in';
    case 'evening':
      return 'Evening wrap-up';
    default:
      return 'Briefing';
  }
}

export default Briefing;
