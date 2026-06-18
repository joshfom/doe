import { and, eq, gte, like } from "drizzle-orm";
import type { Database } from "@/lib/cms/db";
import { jobs, leadsMirror, parties, reps } from "@/lib/cms/schema";
import { publishEvent } from "@/lib/cms/realtime/events";
import { enqueueOutbox } from "@/lib/cms/outbox";
import {
  DEFAULT_NUDGE_POLICY,
  isStale,
  type NudgePolicy,
} from "@/lib/cms/leads/nudge";
import {
  type ChannelAdapter,
  defaultChannelAdapter,
} from "./channel-adapter";
import type { JobContext, JobHandler } from "./index";

// ── lead_nudge (Lead Engine S3) — Design §Components #7; Req 10.3–10.5, 11.2–11.5
//
// One `lead_nudge` job == one proactive owner notification for one stale Lead
// occasion. The Nudge sweep (`workflows/lead-nudge.ts`, task 6.3) selects stale
// leads with an owner and enqueues one job per lead keyed by `nudgeJobKey`
// (lead × type × window bucket). THIS handler performs the single notification
// and any Salesforce-bound side effect.
//
// CONTAINER-ONLY: registered + run on the worker tier (`workers/lead-nudge.ts`,
// task 7.4), never on Next.js serverless (Req 16.3).
//
// The four behaviours the requirements pin on this handler:
//
//   • NOTIFY (Req 10.3) — message the Lead_Owner through the provider-agnostic
//     `ChannelAdapter`, describing the lead by QUALIFICATION FACTS only.
//
//   • PRIVACY (Req 10.4/10.6, 13) — NO raw phone number appears in the
//     notification metadata, the SSE event payload, or the audit/job-failure
//     record. The owner's own phone is read from `reps.phone` and handed only to
//     the adapter; the lead's phone is never read here (we hold only its hash).
//
//   • SUPPRESS (Req 11.3/11.5) — emit no nudge, publish `lead.nudge.suppressed`,
//     when EITHER the per-lead rate cap for the rolling window is reached OR the
//     lead has a logged interaction newer than the staleness threshold (a fresh
//     interaction always wins, reusing `isStale`).
//
//   • IDEMPOTENCY (Req 11.2 / Property 8) — the job spine's at-most-once claim
//     bounds the external nudge to one per `jobKey`: once this handler succeeds
//     the job is `done` and a re-run short-circuits. Any Salesforce side effect
//     is enqueued with a DETERMINISTIC `jobKey` so `enqueueOutbox`'s
//     `ON CONFLICT DO NOTHING` collapses retries to a single outbox row.
//
//   • FAILURE (Req 10.5) — on `ChannelAdapter` delivery failure record a
//     privacy-safe delivery-failure indication (no raw phone) and leave the lead
//     eligible for the notification on the next run rather than marking it
//     permanently failed. We throw a sanitized error: the job spine flips the
//     row to `failed` (re-runnable) and the failed row is NOT counted toward the
//     rate cap, so a failed send never consumes the lead's nudge budget.

/** Payload carried on a `lead_nudge` job. */
export interface LeadNudgePayload {
  /** The Lead (party) to nudge its owner about. */
  partyId: string;
  /** The nudge type (e.g. `"stale"`); part of the occasion identity. */
  type?: string;
}

function parsePayload(payload: unknown): { partyId: string; type: string } {
  const p = (payload ?? {}) as Record<string, unknown>;
  const partyId = typeof p.partyId === "string" ? p.partyId : undefined;
  if (!partyId) {
    throw new Error("lead_nudge: payload.partyId is required");
  }
  const type = typeof p.type === "string" && p.type.length > 0 ? p.type : "stale";
  return { partyId, type };
}

/**
 * The qualification facts the owner notification is composed from. Deliberately
 * carries NO phone number (the lead's phone exists only as a hash, Req 13.1).
 */
export interface NudgeFacts {
  repName: string;
  leadName: string | null;
  tier: string | null;
  projectInterest: string | null;
  unitInterest: string | null;
  budgetBand: string | null;
  lastInteractionSummary: string | null;
}

/**
 * Compose the human-readable owner nudge. Pure and deterministic so it is
 * unit-testable without a database or network. Describes the lead by
 * qualification facts and NEVER includes a raw phone number (Req 10.4/10.6).
 */
export function composeNudge(facts: NudgeFacts): string {
  const lead = facts.leadName?.trim() || "a lead";
  const lines: string[] = [
    `Hi ${facts.repName}, follow-up needed on ${lead}.`,
  ];

  const details: string[] = [];
  if (facts.tier) details.push(`Tier ${facts.tier}`);
  if (facts.projectInterest) details.push(`project ${facts.projectInterest}`);
  if (facts.unitInterest) details.push(`unit ${facts.unitInterest}`);
  if (facts.budgetBand) details.push(`budget ${facts.budgetBand}`);
  if (details.length > 0) lines.push(`${details.join(" · ")}.`);

  if (facts.lastInteractionSummary) {
    lines.push(`Last contact: ${facts.lastInteractionSummary}`);
  }

  lines.push("This lead has gone quiet — please reach out.");
  return lines.join("\n");
}

/**
 * Count how many nudge occasions for this lead+type have already been DELIVERED
 * within the rolling window (Req 11.3). A delivered nudge is a `lead_nudge` job
 * that reached `done`; the current job is `executing` (not `done`) and so is
 * excluded, and a `failed` delivery is never counted — a failed send must not
 * consume the lead's nudge budget. Occasions share the `nudge:{type}:{partyId}:`
 * jobKey prefix (see `nudgeJobKey`), which is what we match on.
 */
async function countDeliveredInWindow(
  db: Database,
  partyId: string,
  type: string,
  now: Date,
  policy: NudgePolicy
): Promise<number> {
  const windowStart = new Date(now.getTime() - policy.windowMs);
  const rows = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.kind, "lead_nudge"),
        eq(jobs.status, "done"),
        like(jobs.jobKey, `nudge:${type}:${partyId}:%`),
        gte(jobs.updatedAt, windowStart)
      )
    );
  return rows.length;
}

/**
 * Build a {@link JobHandler} for `lead_nudge`, injecting the
 * {@link ChannelAdapter} (defaults to the env-resolved adapter) and the active
 * {@link NudgePolicy}. Tests pass a fake adapter (and a counting one) to drive
 * the full suppress/notify/failure flow offline.
 */
export function createLeadNudgeHandler(
  adapter: ChannelAdapter = defaultChannelAdapter(),
  policy: NudgePolicy = DEFAULT_NUDGE_POLICY
): JobHandler {
  return async (db: Database, payload: unknown, ctx: JobContext) => {
    const { partyId, type } = parsePayload(payload);
    const now = new Date();

    // Load the lead facts + its current owner in one read (qualification facts
    // only; the lead's phone is never selected — it exists only as a hash).
    const [lead] = await db
      .select({
        leadName: parties.name,
        tier: leadsMirror.tier,
        projectInterest: leadsMirror.projectInterest,
        unitInterest: leadsMirror.unitInterest,
        budgetBand: leadsMirror.budgetBand,
        lastInteractionSummary: leadsMirror.lastInteractionSummary,
        lastInteractionAt: leadsMirror.lastInteractionAt,
        slaDueAt: leadsMirror.slaDueAt,
        assignedRepId: leadsMirror.assignedRepId,
      })
      .from(parties)
      .leftJoin(leadsMirror, eq(leadsMirror.partyId, parties.id))
      .where(eq(parties.id, partyId))
      .limit(1);

    if (!lead) {
      throw new Error(`lead_nudge: party ${partyId} not found`);
    }

    // No owner → nothing to notify. The unowned-stale path is the sweep's job
    // (Req 10.4 companion); here we record a suppression and stop. No raw phone.
    if (!lead.assignedRepId) {
      await publishEvent(db, {
        type: "lead.nudge.suppressed",
        payload: { partyId, type, reason: "no_owner" },
      });
      return;
    }

    // SUPPRESS — fresh interaction (Req 11.5). `isStale` encodes the guardrail:
    // a logged interaction newer than the staleness threshold means not stale.
    const stale = isStale(
      now,
      { lastInteractionAt: lead.lastInteractionAt, slaDueAt: lead.slaDueAt },
      policy
    );
    if (!stale) {
      await publishEvent(db, {
        type: "lead.nudge.suppressed",
        payload: { partyId, type, reason: "fresh_interaction" },
      });
      return;
    }

    // SUPPRESS — per-lead rate cap for the rolling window (Req 11.3).
    const delivered = await countDeliveredInWindow(db, partyId, type, now, policy);
    if (delivered >= policy.maxPerWindow) {
      await publishEvent(db, {
        type: "lead.nudge.suppressed",
        payload: { partyId, type, reason: "rate_capped" },
      });
      return;
    }

    // Load the owner (recipient). Their phone goes ONLY to the adapter.
    const [rep] = await db
      .select({ name: reps.name, phone: reps.phone })
      .from(reps)
      .where(eq(reps.id, lead.assignedRepId))
      .limit(1);

    if (!rep) {
      throw new Error(`lead_nudge: owner rep ${lead.assignedRepId} not found`);
    }
    if (!rep.phone) {
      throw new Error(
        `lead_nudge: owner rep ${lead.assignedRepId} has no contact number`
      );
    }

    const body = composeNudge({
      repName: rep.name,
      leadName: lead.leadName ?? null,
      tier: lead.tier ?? null,
      projectInterest: lead.projectInterest ?? null,
      unitInterest: lead.unitInterest ?? null,
      budgetBand: lead.budgetBand ?? null,
      lastInteractionSummary: lead.lastInteractionSummary ?? null,
    });

    // NOTIFY (Req 10.3) through the provider-agnostic ChannelAdapter. On
    // failure (Req 10.5) record a privacy-safe delivery-failure indication and
    // re-throw a SANITIZED error: the job spine flips the row to `failed`
    // (re-runnable, not counted toward the rate cap), leaving the lead eligible
    // on the next run. We never surface the adapter's raw error text, which
    // could in principle carry the recipient address.
    try {
      await adapter.send({ to: rep.phone, body });
    } catch {
      throw new Error(
        `lead_nudge: ChannelAdapter delivery failed for lead ${partyId} (provider=${adapter.provider})`
      );
    }

    // Salesforce-bound side effect (Req 10.5 / CC-Idem): enqueue a follow-up
    // Task with a DETERMINISTIC jobKey derived from the nudge occasion. A retry
    // with the same occasion collapses to a single outbox row
    // (ON CONFLICT DO NOTHING). No raw phone in the payload.
    await enqueueOutbox(
      db,
      "task",
      {
        kind: "lead_nudge_followup",
        partyId,
        repId: lead.assignedRepId,
        summary: body,
      },
      `${ctx.jobKey}:sf-task`
    );

    // Record the delivered nudge (privacy-safe: qualification context only, no
    // raw phone). This is what `countDeliveredInWindow` reads back for the cap.
    await publishEvent(db, {
      type: "lead.nudged",
      payload: { partyId, type, repId: lead.assignedRepId },
    });
  };
}

/** Default handler instance wired to the env-resolved channel adapter. */
export const leadNudgeHandler: JobHandler = createLeadNudgeHandler();
