import { eq } from "drizzle-orm";
import type { Database } from "@/lib/cms/db";
import { leadsMirror, parties, reps } from "@/lib/cms/schema";
import {
  type ChannelAdapter,
  defaultChannelAdapter,
} from "./channel-adapter";
import type { JobContext, JobHandler } from "./index";

// ── send_whatsapp_brief (T4) — Design §11; Requirements 9.7 ───────────────────
//
// When a `send_whatsapp_brief` job runs, the runner composes a concise rep
// brief from the lead mirror + party profile and sends it through the
// `ChannelAdapter` interface (./channel-adapter). The job code depends ONLY on
// `ChannelAdapter`, so swapping the WhatsApp provider (or the whole transport)
// needs no change here — only a different adapter instance (Req 9.7 / FR-T4).
//
// The matching tool (`send_whatsapp_brief` in the tool registry) merely
// `enqueueJob`s this kind; the heavy compose-and-send work happens off the
// voice loop on the job-runner worker tier.
//
// CONTAINER-ONLY: runs on the job-runner worker tier (Req 12.6).
//
// PRIVACY (Req 14.5): the brief describes the lead by qualification facts
// (name, tier, project, budget, last interaction) — never the lead's raw phone.
// The recipient address is the REP's own phone, supplied by the adapter call
// and not written to the event bus or audit log.
//
// Idempotency (Property 7 / Req 9.3): the job spine (`runJob`) guarantees
// at-most-once execution per `jobKey`, so the external WhatsApp send happens at
// most once per brief even across a manual re-run of a failed job.

/** Payload carried on a `send_whatsapp_brief` job. */
export interface SendWhatsappBriefPayload {
  /** The rep to brief (recipient of the WhatsApp message). */
  repId: string;
  /** The lead the brief is about. */
  partyId: string;
}

/** The lead facts the brief is composed from. */
export interface RepBriefFacts {
  repName: string;
  leadName: string | null;
  tier: string | null;
  projectInterest: string | null;
  unitInterest: string | null;
  budgetBand: string | null;
  lastInteractionSummary: string | null;
}

/**
 * Compose the human-readable rep brief. Pure and deterministic so it is
 * unit-testable without a database or network. Omits any field that is absent
 * and never includes a raw phone number (Req 14.5).
 */
export function composeRepBrief(facts: RepBriefFacts): string {
  const lead = facts.leadName?.trim() || "a new lead";
  const lines: string[] = [`Hi ${facts.repName}, new lead brief: ${lead}.`];

  const details: string[] = [];
  if (facts.tier) details.push(`Tier ${facts.tier}`);
  if (facts.projectInterest) details.push(`project ${facts.projectInterest}`);
  if (facts.unitInterest) details.push(`unit ${facts.unitInterest}`);
  if (facts.budgetBand) details.push(`budget ${facts.budgetBand}`);
  if (details.length > 0) lines.push(`${details.join(" · ")}.`);

  if (facts.lastInteractionSummary) {
    lines.push(`Last contact: ${facts.lastInteractionSummary}`);
  }

  lines.push("Please follow up.");
  return lines.join("\n");
}

function parsePayload(payload: unknown): SendWhatsappBriefPayload {
  const p = (payload ?? {}) as Record<string, unknown>;
  const repId = typeof p.repId === "string" ? p.repId : undefined;
  const partyId = typeof p.partyId === "string" ? p.partyId : undefined;
  if (!repId) {
    throw new Error("send_whatsapp_brief: payload.repId is required");
  }
  if (!partyId) {
    throw new Error("send_whatsapp_brief: payload.partyId is required");
  }
  return { repId, partyId };
}

/**
 * Build a {@link JobHandler} for `send_whatsapp_brief`, injecting the
 * {@link ChannelAdapter} (defaults to the env-resolved WhatsApp adapter). Tests
 * pass a fake adapter to run the full compose-and-send flow offline and assert
 * at-most-once delivery.
 */
export function createSendWhatsappBriefHandler(
  adapter: ChannelAdapter = defaultChannelAdapter()
): JobHandler {
  return async (db: Database, payload: unknown, _ctx: JobContext) => {
    const { repId, partyId } = parsePayload(payload);

    // Load the rep (recipient) and the lead facts in one read each.
    const [rep] = await db
      .select({ name: reps.name, phone: reps.phone })
      .from(reps)
      .where(eq(reps.id, repId))
      .limit(1);

    if (!rep) {
      throw new Error(`send_whatsapp_brief: rep ${repId} not found`);
    }
    if (!rep.phone) {
      throw new Error(`send_whatsapp_brief: rep ${repId} has no contact number`);
    }

    const [lead] = await db
      .select({
        leadName: parties.name,
        tier: leadsMirror.tier,
        projectInterest: leadsMirror.projectInterest,
        unitInterest: leadsMirror.unitInterest,
        budgetBand: leadsMirror.budgetBand,
        lastInteractionSummary: leadsMirror.lastInteractionSummary,
      })
      .from(parties)
      .leftJoin(leadsMirror, eq(leadsMirror.partyId, parties.id))
      .where(eq(parties.id, partyId))
      .limit(1);

    if (!lead) {
      throw new Error(`send_whatsapp_brief: party ${partyId} not found`);
    }

    const body = composeRepBrief({
      repName: rep.name,
      leadName: lead.leadName ?? null,
      tier: lead.tier ?? null,
      projectInterest: lead.projectInterest ?? null,
      unitInterest: lead.unitInterest ?? null,
      budgetBand: lead.budgetBand ?? null,
      lastInteractionSummary: lead.lastInteractionSummary ?? null,
    });

    // Send through the provider-agnostic ChannelAdapter (Req 9.7). The job code
    // never references a concrete provider — swapping providers means injecting
    // a different adapter, with no change here.
    await adapter.send({ to: rep.phone, body });
  };
}

/** Default handler instance wired to the env-resolved channel adapter. */
export const sendWhatsappBriefHandler: JobHandler =
  createSendWhatsappBriefHandler();
