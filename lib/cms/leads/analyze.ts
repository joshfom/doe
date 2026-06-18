/**
 * Lead Engine (S3) — synchronous lead-analysis pipeline (the "Run analysis"
 * action behind the Console button).
 *
 * The canonical pipeline is a set of container-tier Mastra agents (Parse →
 * Distribution → Enrichment, lead-engine tasks 5.2–5.6) orchestrated by a
 * workflow. Those agents are not yet wired, so every recorded lead sat at
 * `received` forever — the Console showed "Parse agent has not yet processed
 * this lead" indefinitely. This module gives the Console an immediate,
 * on-demand path that performs the same observable work synchronously:
 *
 *   1. PARSE      — deterministically extract {@link StructuredLeadFields} from
 *                   the lead's free-text content + attribution (no model
 *                   gateway, so it runs on the request path) and persist them on
 *                   the `inbound_leads.structured` ledger column.
 *   2. RESOLVE    — `record_inbound_lead` resolves the contact identity against
 *                   the party graph + any linked Salesforce Lead (reusing the S2
 *                   `resolveLeadByMatchKeys`), then creates/attaches the DOE Lead
 *                   (`leads_mirror`) — this is the "lead mirror" check.
 *   3. QUALIFY    — `update_qualification` writes the parsed budget/unit facts
 *                   onto the mirror.
 *   4. SCORE      — `score_lead` tiers the lead (HOT/WARM/NURTURE) from those
 *                   facts.
 *   5. ROUTE      — `assign_lead_owner` selects + records the owning rep.
 *   6. SYNC       — enqueue a `lead_upsert` to the Salesforce outbox so the
 *                   findings flow back to Salesforce (idempotent by jobKey).
 *
 * Every mutation flows through the audited {@link dispatchTool} (Zod → RBAC →
 * OTP → audit → execute) under the lead-distribution agent identity — agents and
 * this orchestrator never touch the DB for those steps (CC-Audit, Req 12). The
 * only direct ledger writes are the intake-status transitions and the
 * `structured` column, which the Lead_Intake module owns.
 *
 * On a resolution conflict/error the lead is queued (never dropped, P-NoDrop)
 * with the reason retained, exactly as the canonical workflow would.
 */

import { eq } from "drizzle-orm";

import type { Database } from "../db";
import { inboundLeads } from "../schema";
import { enqueueOutbox } from "../outbox";
import { dispatchTool } from "../ai/tools/dispatch";
import { LEAD_DISTRIBUTION_AGENT_ACTOR } from "../ai/tools/lead-capabilities";
import { markParsed, markQueued } from "./intake";
import {
  extractStructuredFields,
  type StructuredLeadFields,
} from "./structured";

// ── Result shape ─────────────────────────────────────────────────────────────

/** The outcome of an {@link analyzeInboundLead} run, returned to the Console. */
export interface AnalyzeResult {
  ok: boolean;
  /** The terminal intake status the lead landed in. */
  status: "parsed" | "queued";
  /** The structured fields extracted by the parse step. */
  structured: StructuredLeadFields;
  /** The resolution outcome from `record_inbound_lead`. */
  resolution: "match" | "new" | "conflict" | "error";
  /** The resolved Lead's Party id, when one was created/attached. */
  partyId: string | null;
  /** The assigned owning rep id, when routing succeeded. */
  repId: string | null;
  /** The Salesforce outbox row id when a sync was enqueued. */
  sfOutboxId: string | null;
  /** A human-readable note (e.g. the conflict/error reason) for the Console. */
  note?: string;
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

/**
 * Run the synchronous analysis pipeline for one recorded inbound lead. Safe to
 * re-run (the "Re-analyze" button): resolution is idempotent (stable dedupe +
 * upsert by party), qualification/score upsert by party, and owner assignment
 * is a no-op when the owner is unchanged.
 *
 * @param db The Drizzle database handle.
 * @param id The `inbound_leads.id` to analyze.
 * @returns The {@link AnalyzeResult}, or `null` when no such lead exists.
 */
export async function analyzeInboundLead(
  db: Database,
  id: string
): Promise<AnalyzeResult | null> {
  const [row] = await db
    .select({
      id: inboundLeads.id,
      name: inboundLeads.name,
      email: inboundLeads.email,
      rawPhone: inboundLeads.rawPhone,
      content: inboundLeads.content,
      source: inboundLeads.source,
      attribution: inboundLeads.attribution,
    })
    .from(inboundLeads)
    .where(eq(inboundLeads.id, id))
    .limit(1);

  if (!row) return null;

  const ctx = { actor: LEAD_DISTRIBUTION_AGENT_ACTOR } as const;
  const attribution = (row.attribution as Record<string, string> | null) ?? null;

  // 1. PARSE — deterministic structured-field extraction (Req 4.1, 4.2). Persist
  //    onto the ledger's `structured` column (intake bookkeeping, not personal
  //    data); the status transition is applied at the end.
  const structured = extractStructuredFields(row.content, {
    name: row.name,
    attribution,
  });
  await db
    .update(inboundLeads)
    .set({ structured, updatedAt: new Date() })
    .where(eq(inboundLeads.id, id));

  // 2. RESOLVE — dedupe against the party graph + Salesforce link, create/attach
  //    the DOE Lead (the "lead mirror"). Flows through the audited dispatcher.
  const resolved = await dispatchTool(
    db,
    "record_inbound_lead",
    {
      inboundId: id,
      email: row.email ?? undefined,
      phone: row.rawPhone ?? undefined,
    },
    ctx
  );

  if (!resolved.ok) {
    await markQueued(db, id);
    return {
      ok: false,
      status: "queued",
      structured,
      resolution: "error",
      partyId: null,
      repId: null,
      sfOutboxId: null,
      note: resolved.error.message,
    };
  }

  const { resolution, partyId } = resolved.result as {
    resolution: "match" | "new" | "conflict" | "error";
    partyId: string | null;
  };

  // A conflict/error attaches no Party — queue for human resolution, never drop.
  if (!partyId) {
    await markQueued(db, id);
    return {
      ok: false,
      status: "queued",
      structured,
      resolution,
      partyId: null,
      repId: null,
      sfOutboxId: null,
      note:
        resolution === "conflict"
          ? "Identity matched more than one existing lead — queued for human resolution."
          : "Could not resolve the lead's contact identity — queued for retry.",
    };
  }

  // 3. QUALIFY — persist the parsed budget/unit facts onto the mirror.
  if (structured.budgetBand || structured.unitInterest) {
    await dispatchTool(
      db,
      "update_qualification",
      {
        partyId,
        budgetBand: structured.budgetBand,
        unitType: structured.unitInterest,
      },
      ctx
    );
  }

  // 4. SCORE — tier the lead from the mirror's qualification signals.
  await dispatchTool(db, "score_lead", { partyId }, ctx);

  // 5. ROUTE — select + record the owning rep (idempotent; no-op if unchanged).
  const routed = await dispatchTool(db, "assign_lead_owner", { partyId }, ctx);
  const repId =
    routed.ok && routed.result
      ? ((routed.result as { repId: string | null }).repId ?? null)
      : null;

  // 6. SYNC — push the findings to Salesforce via the outbox (idempotent).
  const sfOutboxId = await enqueueSalesforceSync(db, {
    inboundId: id,
    name: row.name,
    email: row.email,
    source: row.source,
    partyId,
    structured,
    attribution,
  });

  await markParsed(db, id);

  return {
    ok: true,
    status: "parsed",
    structured,
    resolution,
    partyId,
    repId,
    sfOutboxId,
  };
}

// ── Salesforce sync ───────────────────────────────────────────────────────────

/**
 * Enqueue a `lead_upsert` to the Salesforce outbox carrying the analysis
 * findings, idempotent by a per-lead jobKey (so analyze + the manual "Sync to
 * Salesforce" button converge on one row). Mirrors the payload the manual sync
 * route builds.
 */
async function enqueueSalesforceSync(
  db: Database,
  args: {
    inboundId: string;
    name: string | null;
    email: string | null;
    source: string;
    partyId: string;
    structured: StructuredLeadFields;
    attribution: Record<string, string> | null;
  }
): Promise<string | null> {
  const nameParts = (args.name ?? "").trim().split(/\s+/).filter(Boolean);
  const firstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(" ") : nameParts[0] ?? "";
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "";

  const payload: Record<string, unknown> = {
    partyId: args.partyId,
    firstName,
    lastName,
    email: args.email ?? undefined,
    company: "Unknown",
    status: "Open - Not Contacted",
    source: args.source,
    projectInterest:
      args.structured.projectInterest ?? args.attribution?.utm_campaign ?? undefined,
    budgetBand: args.structured.budgetBand ?? undefined,
  };

  try {
    return await enqueueOutbox(
      db,
      "lead_upsert",
      payload,
      `lead:${args.inboundId}:manual-sync`
    );
  } catch {
    // A sync-enqueue failure must not fail the whole analysis — the lead is
    // already parsed/resolved/scored. The Console's manual "Sync to Salesforce"
    // button remains available as a retry.
    return null;
  }
}
