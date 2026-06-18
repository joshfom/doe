/**
 * Lead Engine (S3) — Nudge policy: pure stale-lead selection + guardrail rules.
 *
 * This module is the PURE, testable core of the Nudge_Workflow. It holds no
 * Drizzle, no DB access, and no Mastra agents — it only decides, from plain
 * values, whether a Lead is stale and what idempotency key a nudge occasion
 * carries. The scheduled workflow (`lib/cms/agents/workflows/lead-nudge.ts`)
 * and the `lead_nudge` job handler orchestrate the effects; they call these
 * functions to make the decisions.
 *
 * The 15-minute sweep cadence (Req 10.1) is owned by the worker
 * (`workers/lead-nudge.ts`), NOT this module: a `windowMs` here is the rolling
 * rate-limit / occasion window, not the sweep interval.
 *
 * Design references: §Components #7 (Nudge_Workflow — proactive follow-up with
 * guardrails).
 * Requirements: 10.2 (stale = last interaction older than threshold OR SLA
 * passed with no later interaction), 11.1 (jobKey unique per lead × type ×
 * window bucket — the nudge occasion), 11.3 (default at most 1 nudge per lead
 * per rolling 24h window), 11.5 (a fresh interaction suppresses any stale-lead
 * nudge).
 */

// ── Nudge policy ─────────────────────────────────────────────────────────────

/**
 * The tunable nudge policy. All durations are in milliseconds.
 *
 * - `stalenessMs` — how old a lead's last interaction may be before the lead is
 *   considered stale (Req 10.2, 11.5).
 * - `maxPerWindow` — the maximum number of nudges a single lead may receive
 *   within one `windowMs` rolling window (Req 11.3).
 * - `windowMs` — the rolling rate-limit / occasion window, also the bucket size
 *   used to derive the per-occasion `jobKey` (Req 11.1, 11.3).
 */
export interface NudgePolicy {
  stalenessMs: number;
  maxPerWindow: number;
  windowMs: number;
}

/**
 * The default nudge policy (Req 10.2, 11.3): 24h staleness threshold, at most
 * one nudge per lead per rolling 24h window.
 *
 * The 15-minute sweep cadence (Req 10.1) is intentionally absent here — it is
 * handled by the worker, not this policy.
 */
export const DEFAULT_NUDGE_POLICY: NudgePolicy = {
  stalenessMs: 24 * 3600_000,
  maxPerWindow: 1,
  windowMs: 24 * 3600_000,
};

// ── Stale-lead classification ────────────────────────────────────────────────

/** The `leads_mirror` timing fields the stale-lead decision reads (Req 10.2). */
export interface NudgeMirror {
  /** When the most recent interaction was logged, or `null` if none. */
  lastInteractionAt: Date | null;
  /** When the SLA is/was due, or `null` if no SLA is set. */
  slaDueAt: Date | null;
}

/**
 * Decide whether a Lead is stale and therefore eligible for a stale-lead nudge.
 *
 * A Lead is stale when EITHER:
 *   - its last interaction is older than the staleness threshold
 *     (`now - lastInteractionAt > stalenessMs`), OR
 *   - its `slaDueAt` has passed (`slaDueAt <= now`) with no interaction logged
 *     after that time.
 *
 * A fresh interaction always wins: WHILE a Lead has a logged interaction newer
 * than the staleness threshold, it is NOT stale (Req 11.5) — this guardrail
 * takes precedence over the SLA path, so a lead that was just touched is never
 * nudged.
 *
 * @param now    The reference time of the sweep.
 * @param mirror The Lead's `leads_mirror` timing fields.
 * @param policy The active {@link NudgePolicy}.
 * @returns `true` when the Lead is stale and eligible for a stale-lead nudge.
 */
export function isStale(
  now: Date,
  mirror: NudgeMirror,
  policy: NudgePolicy
): boolean {
  const nowMs = now.getTime();
  const lastMs = mirror.lastInteractionAt?.getTime() ?? null;

  // Guardrail (Req 11.5): a fresh interaction (newer than the threshold)
  // suppresses any stale-lead nudge, regardless of the SLA path.
  if (lastMs !== null && nowMs - lastMs <= policy.stalenessMs) {
    return false;
  }

  // Condition A (Req 10.2): last interaction older than the staleness threshold.
  // Past the guardrail above, any non-null last interaction is already older
  // than the threshold; spelled out here to mirror the requirement directly.
  const staleByInteraction =
    lastMs !== null && nowMs - lastMs > policy.stalenessMs;

  // Condition B (Req 10.2): SLA has passed with no interaction logged after it.
  const slaMs = mirror.slaDueAt?.getTime() ?? null;
  const slaPassedWithoutFollowup =
    slaMs !== null && slaMs <= nowMs && (lastMs === null || lastMs <= slaMs);

  return staleByInteraction || slaPassedWithoutFollowup;
}

// ── Nudge occasion idempotency key ───────────────────────────────────────────

/**
 * Build the idempotency `jobKey` for a nudge occasion — unique per combination
 * of Lead, nudge type, and rolling-window bucket (Req 11.1).
 *
 * The window bucket is `floor(now / windowMs)`, so every nudge for the same
 * lead and type within one window collapses onto a single key; a retry with
 * that key produces at most one external nudge side effect (Req 11.2), and the
 * bucket advancing is what permits the next occasion.
 *
 * @param partyId The Lead's `party_id`.
 * @param type    The nudge type (e.g. `"stale"`).
 * @param now     The reference time of the sweep.
 * @param policy  The active {@link NudgePolicy}.
 * @returns A deterministic `jobKey` of the form `nudge:{type}:{partyId}:{bucket}`.
 */
export function nudgeJobKey(
  partyId: string,
  type: string,
  now: Date,
  policy: NudgePolicy
): string {
  const bucket = Math.floor(now.getTime() / policy.windowMs);
  return `nudge:${type}:${partyId}:${bucket}`;
}
