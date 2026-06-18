'use client';

// ── Current-user resolution for the chat-first hero (Part B) ─────────────────
//
// The agent-first hero greets the signed-in user by first name ("Hey {firstName}
// 👋"). The app exposes the authenticated user through the same enhanced session
// endpoint the panel layout already uses — `GET /api/auth/session` → `{ data:
// SessionData }` (see `lib/cms/api/auth.ts` and `lib/types/session.ts`). That
// payload carries a full `name` but no discrete `firstName`, so we derive the
// first token here.
//
// Robustness (no crash while loading, never blocks the surface): the hook starts
// in a `loading` state with `firstName` undefined, and any failure (network,
// 401, malformed body) simply leaves `firstName` undefined. The hero falls back
// to a friendly generic ("Hey there 👋") whenever `firstName` is absent.

import { useEffect, useRef, useState } from 'react';
import type { SessionData } from '@/lib/types/session';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

export interface CurrentUser {
  /** First token of the session `name`, or undefined if unknown/loading. */
  firstName?: string;
  /** Full display name from the session, if available. */
  name?: string;
  /** True while the session request is in flight. */
  loading: boolean;
}

/** Derive a friendly first name from a full display name. */
function deriveFirstName(name: string | undefined | null): string | undefined {
  if (typeof name !== 'string') return undefined;
  const first = name.trim().split(/\s+/)[0];
  return first.length > 0 ? first : undefined;
}

/**
 * Resolve the signed-in user for greeting purposes. Best-effort and
 * non-blocking: failures leave `firstName` undefined so the caller can fall back
 * to a generic greeting.
 */
export function useCurrentUser(): CurrentUser {
  const [user, setUser] = useState<CurrentUser>({ loading: true });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let cancelled = false;
    fetch(`${API_BASE_URL}/api/auth/session`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error('not authenticated');
        const json = (await res.json()) as { data?: SessionData } | null;
        const data = json?.data;
        if (cancelled || !mounted.current) return;
        setUser({
          name: data?.name,
          firstName: deriveFirstName(data?.name),
          loading: false,
        });
      })
      .catch(() => {
        if (cancelled || !mounted.current) return;
        // Non-blocking: leave firstName undefined so the hero greets generically.
        setUser({ loading: false });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return user;
}
