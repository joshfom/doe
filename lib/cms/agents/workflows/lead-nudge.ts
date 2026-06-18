import { isNull, lte, or } from "drizzle-orm";
import type { Database } from "@/lib/cms/db";
import { leadsMirror } from "@/lib/cms/schema";
import { publishEvent } from "@/lib/cms/realtime/events";
import { enqueueJob } from "@/lib/cms/jobs";
import {
  DEFAULT_NUDGE_POLICY,
  isStale,
  nudgeJobKey,
  type NudgePolicy,
} from "@/lib/cms/leads/nudge";

// ── Nudge sweep workflow (Lead Engine S3) — Design §Components #7; Req 10.1–10.4
//
// The scheduled STALE-LEAD SWEEP. One sweep == one scan of `leads_mirror` for
// stale Leads. For each stale OWNED Lead it enqueues exactly one `lead_nudge`
// job (idempotent by `nudgeJobKey`); the `lead_nudge` HANDLER (task 6.2) then
// performs the single owner notification + any Salesforce side effect. For each
// stale UNOWNED Lead it emits a privacy-safe indication and enqueues nothing.
//
// CONTAINER-ONLY: this runs on the worker tier via `workers/lead-nudge.ts`
// (task 7.4) on a fixed interval (default 15 min, Req 10.1), NEVER on Next.js
// serverless (Req 16.3). The interval itself is owned by the worker, not here —
// this module is a single idempotent pass that the worker calls each tick.
//
// ─────────────────────────────────────────────────────────────────────────────
// DESIGN DECISION — who emits `lead.nudged`, and why the sweep does NOT.
// ─────────────────────────────────────────────────────────────────────────────
// Design §Components #7 splits the responsibility cleanly: the SWEEP *enqueues*
// `lead_nudge` jobs; the HANDLER *delivers* the nudge and emits `lead.nudged`
// "on successful DELIVERY". The handler also derives its per-lead rate cap from
// `done` `lead_nudge` jobs sharing the `nudge:{type}:{partyId}:` jobKey prefix
// (see `countDeliveredInWindow` in `lib/cms/jobs/lead-nudge.ts`) — it counts
// JOBS, not events.
//
// Given that split, this sweep deliberately does NOT emit `lead.nudged` at
// enqueue time. Reasons, in order of weight:
//   1. Preferring the design's wording (as the task instructs): `lead.nudged`
//      denotes a *delivered* nudge and is owned by the handler. Emitting it here
//      too would make a single nudge occasion produce two `lead.nudged` events
//      (one "scheduled", one "delivered"), conflating two distinct meanings on
//      the Console and in any downstream `lead.nudged` consumer.
//   2. The "a nudge was enqueued/scheduled" signal already exists: `enqueueJob`
//      publishes a `job.queued` event for every fresh insert (and is silent on a
//      duplicate enqueue), which is exactly the sweep-level scheduling signal.
//   3. The rate cap is unaffected either way — it counts `done` jobs, never
//      events — so this choice is safe for the guardrail regardless.
// Net: the sweep schedules (→ `job.queued` via `enqueueJob`); the handler
// delivers (→ `lead.nudged`). `lead.nudged` keeps a single, precise meaning.
//
// The one event the sweep DOES own is the unowned-stale-lead indication
// (Req 10.4): a stale Lead with no owner gets no notification and no job, only a
// recorded indication. We surface it as `lead.nudge.suppressed` with the reason
// `unowned_stale`, matching the handler's existing `no_owner` suppression
// convention (the union carries no distinct unowned-stale type, and the design
// adds none). The payload carries only identifiers — never a raw phone (Req 13).

/** The outcome of one sweep pass — counts only, for the worker's logs/metrics. */
export interface NudgeSweepResult {
  /** Stale Leads found this pass (owned + unowned). */
  stale: number;
  /** Stale owned Leads for which a `lead_nudge` job was enqueued. */
  enqueued: number;
  /** Stale unowned Leads for which an unowned-stale indication was recorded. */
  unowned: number;
}

/** Options for one sweep pass; all default to the production policy + wall clock. */
export interface NudgeSweepOptions {
  /** Reference time of the sweep (defaults to `new Date()`). Pins the occasion bucket. */
  now?: Date;
  /** The active nudge policy (defaults to {@link DEFAULT_NUDGE_POLICY}). */
  policy?: NudgePolicy;
  /** The nudge type tag (defaults to `"stale"`); part of the occasion identity. */
  type?: string;
}

/**
 * Run one stale-lead sweep pass.
 *
 * Selects stale Leads from `leads_mirror` (staleness decided by the pure
 * {@link isStale} policy, Req 10.2), then:
 *   - for each stale Lead WITH an owner (`assigned_rep_id` not null): enqueues
 *     exactly one `lead_nudge` job keyed by {@link nudgeJobKey} (lead × type ×
 *     window bucket). The unique `jobKey` makes duplicate enqueues for the same
 *     occasion collapse (Req 11.1) — re-running the sweep within the same window
 *     never schedules a second job for the same Lead. Delivery + `lead.nudged`
 *     are the handler's job (see the design decision above);
 *   - for each stale Lead WITHOUT an owner: emits no notification, enqueues no
 *     job, and records a privacy-safe `lead.nudge.suppressed` (`unowned_stale`)
 *     indication to the SSE bus (Req 10.4). No raw phone in the payload (Req 13).
 *
 * All effects key off a single `now`, so every occasion in one pass shares the
 * same window bucket and the pass is idempotent within that window.
 *
 * @param db   Drizzle database (or transaction) handle.
 * @param opts Sweep options (clock, policy, nudge type).
 * @returns Counts of stale / enqueued / unowned Leads observed this pass.
 */
export async function runNudgeSweep(
  db: Database,
  opts: NudgeSweepOptions = {}
): Promise<NudgeSweepResult> {
  const now = opts.now ?? new Date();
  const policy = opts.policy ?? DEFAULT_NUDGE_POLICY;
  const type = opts.type ?? "stale";

  // Coarse SQL pre-filter: fetch a SUPERSET of the stale Leads, then let the
  // pure `isStale` policy make the exact decision (it owns the guardrail in
  // Req 11.5 that a fresh interaction always wins). A Lead can only be stale if
  // it has no last interaction, its last interaction predates the threshold, or
  // its SLA has passed — so this WHERE never excludes a genuinely stale Lead.
  const threshold = new Date(now.getTime() - policy.stalenessMs);
  const candidates = await db
    .select({
      partyId: leadsMirror.partyId,
      assignedRepId: leadsMirror.assignedRepId,
      lastInteractionAt: leadsMirror.lastInteractionAt,
      slaDueAt: leadsMirror.slaDueAt,
    })
    .from(leadsMirror)
    .where(
      or(
        isNull(leadsMirror.lastInteractionAt),
        lte(leadsMirror.lastInteractionAt, threshold),
        // `slaDueAt` present and passed — the SLA path of staleness (Req 10.2).
        lte(leadsMirror.slaDueAt, now)
      )
    );

  const result: NudgeSweepResult = { stale: 0, enqueued: 0, unowned: 0 };

  for (const lead of candidates) {
    const stale = isStale(
      now,
      { lastInteractionAt: lead.lastInteractionAt, slaDueAt: lead.slaDueAt },
      policy
    );
    if (!stale) continue;
    result.stale += 1;

    if (lead.assignedRepId) {
      // Owned stale Lead → enqueue exactly one nudge job for this occasion.
      // `enqueueJob` is ON CONFLICT (job_key) DO NOTHING, so a duplicate enqueue
      // within the same window bucket collapses to the existing job (Req 11.1)
      // and emits no extra `job.queued`. Delivery + `lead.nudged` happen in the
      // handler (see the design decision above).
      const jobKey = nudgeJobKey(lead.partyId, type, now, policy);
      await enqueueJob(db, "lead_nudge", { partyId: lead.partyId, type }, jobKey);
      result.enqueued += 1;
    } else {
      // Unowned stale Lead → no notification, no job; record the indication only
      // (Req 10.4). Payload is identifiers-only — never a raw phone (Req 13).
      await publishEvent(db, {
        type: "lead.nudge.suppressed",
        payload: { partyId: lead.partyId, type, reason: "unowned_stale" },
      });
      result.unowned += 1;
    }
  }

  return result;
}
