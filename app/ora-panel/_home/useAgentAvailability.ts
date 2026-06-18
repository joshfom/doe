'use client';

// ── Agent_Availability_Check hook (S5, task 12; Req 11.1, 11.2, 11.3, 11.6) ──
//
// The Home_Surface probes whether the Home_Agent / Mastra_Runtime is responsive
// and decides whether to enter Degraded_Mode. This hook performs the *I/O* —
// firing `GET /api/home/health`, racing it against a configurable timeout
// (default 5s), and measuring the client-observed round-trip latency — then
// applies the PURE decision `isDegraded(probe, timeoutMs)` from
// `lib/cms/agents/home/degrade.ts` (task 2.1) to the probe it gathered.
//
//   • Probe reports unavailable (or the request throws / is unreachable) →
//     degraded (Req 11.2). A thrown/aborted probe yields no usable result, so we
//     pass a `null` probe to `isDegraded`, which fail-closes to degraded.
//   • Probe does not answer within the timeout (the fetch is aborted at 5s, or
//     the measured round-trip exceeds it) → degraded (Req 11.3).
//   • Probe is available and answered within the timeout → not degraded.
//
// Recovery (Req 11.6) is "on the next Home_Surface load": the hook re-probes on
// mount, so when the agent is healthy again the surface restores the agent-first
// experience. A `refresh()` is also exposed for an explicit re-check.
//
// The pure decision module (`degrade.ts`) carries no server-only imports, so it
// is safe to import into this client module.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isDegraded,
  DEFAULT_AGENT_PROBE_TIMEOUT_MS,
  type AvailabilityProbe,
} from '@/lib/cms/agents/home/degrade';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

export interface AgentAvailability {
  /** True when the surface must fall back to the Classic_Panel (Degraded_Mode). */
  degraded: boolean;
  /** True while the initial probe is in flight (before the first decision). */
  loading: boolean;
  /** The last probe result, or null if the check produced no usable result. */
  probe: AvailabilityProbe | null;
  /** Re-run the Agent_Availability_Check (used for an explicit re-check). */
  refresh: () => void;
}

/**
 * Probe the Home_Agent's availability and decide Degraded_Mode.
 *
 * @param timeoutMs configurable check timeout in ms (defaults to 5000, Req 11.1).
 */
export function useAgentAvailability(
  timeoutMs: number = DEFAULT_AGENT_PROBE_TIMEOUT_MS
): AgentAvailability {
  const [loading, setLoading] = useState(true);
  const [degraded, setDegraded] = useState(false);
  const [probe, setProbe] = useState<AvailabilityProbe | null>(null);
  // Bump to force a re-probe (refresh / next load).
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // Guard against state updates after unmount.
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
    const controller = new AbortController();
    // Abort the probe at the timeout so a hung runtime cannot keep the surface
    // "loading" forever — an aborted probe is treated as unavailable (Req 11.3).
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const start =
      typeof performance !== 'undefined' ? performance.now() : Date.now();

    const finish = (next: AvailabilityProbe | null) => {
      if (cancelled || !mounted.current) return;
      setProbe(next);
      setDegraded(isDegraded(next, timeoutMs));
      setLoading(false);
    };

    setLoading(true);
    fetch(`${API_BASE_URL}/api/home/health`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        const now =
          typeof performance !== 'undefined' ? performance.now() : Date.now();
        const latencyMs = Math.max(0, now - start);
        if (!res.ok) {
          // A non-2xx health response means the runtime is not ready (Req 11.2).
          finish({ available: false, latencyMs });
          return;
        }
        // `GET /home/health` returns the bare AvailabilityProbe shape.
        const body = (await res.json()) as Partial<AvailabilityProbe> | null;
        const available = body?.available === true;
        // Use the client-observed round-trip so a slow check counts against the
        // timeout exactly as Req 11.3 requires.
        finish({ available, latencyMs });
      })
      .catch(() => {
        // Aborted (timeout) or network failure → no usable probe → degraded.
        finish(null);
      })
      .finally(() => {
        clearTimeout(timer);
      });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [timeoutMs, nonce]);

  return { degraded, loading, probe, refresh };
}
