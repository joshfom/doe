/**
 * DOE Voice Surface — mirror-only prefetch ("ring-time lookup").
 *
 * {@link buildCallContext} assembles the prefetched {@link CallContext} that is
 * handed to the Voice_Agent as LiveKit job metadata at dispatch. It is the hot
 * path that lets DOE recognise a caller the moment the phone rings, so the
 * conversation never re-asks for details the caller already provided.
 *
 * CRITICAL ISOLATION (Requirement 3.5 / Property 4 / design §12): the context is
 * built from LOCAL MIRROR TABLES ONLY (`parties`, `leads_mirror`, `reps`,
 * `ai_appointments`). This module NEVER imports or invokes the SalesforceAdapter
 * and issues no Salesforce call. The `leads_mirror` table is precisely the local
 * cache that exists so the voice loop never blocks on Salesforce.
 *
 * LATENCY (Requirement 15.3 / NFR-3): the lookup must complete within 300ms at
 * p95. To honour that budget the work is done as a single indexed join for the
 * one-to-one data (party + lead mirror + assigned rep) plus one indexed lookup
 * for the one-to-many open appointments, the two issued concurrently so the
 * effective cost is a single round-trip rather than N sequential queries.
 *
 * KNOWN vs UNKNOWN (Requirements 3.4, 3.10 / FR-S5):
 *   - Known caller  → {@link buildCallContext} resolves the party row and maps
 *                     its mirror data into a `known === true` context.
 *   - Unknown caller → {@link buildUnknownCallContext} produces a
 *                     `known === false` context carrying the form-linked
 *                     identities so the in-call lead is attributed to the web
 *                     form source. {@link buildCallContext} also falls back to
 *                     this shape when no party row matches the supplied id.
 *
 * Design references: §7.3 (signature), §12 (CallContext contract).
 * Requirements: 3.4 (single mirror join), 3.5 (never call Salesforce),
 * 3.10 (unknown caller → known=false with form identities).
 */

import { and, eq } from "drizzle-orm";

import type { Database } from "../db";
import {
  aiAppointments,
  aiConversations,
  leadsMirror,
  parties,
  reps,
} from "../schema";
import {
  callContextSchema,
  type CallContext,
  type FormIdentities,
  type Language,
} from "./contracts";

/** Maximum length of the `lastInteraction` summary surfaced to the agent. */
const LAST_INTERACTION_MAX = 200;

export interface BuildCallContextOptions {
  /**
   * Form-supplied identities (email / phone / name / source) from the pre-call
   * form. Carried into the `known === false` fallback context when no party row
   * matches the supplied `partyId`, so an unknown caller's lead is attributed
   * to the web form source (Req 3.10 / FR-S5).
   */
  formIdentities?: FormIdentities;
}

/**
 * Build a {@link CallContext} for a caller from MIRROR DATA ONLY.
 *
 * Resolves the party identified by `partyId` via a single indexed join over
 * `parties` + `leads_mirror` + the assigned `reps` row, plus a concurrent
 * indexed lookup of the caller's open appointments (joined through
 * `ai_conversations.party_id`). No Salesforce call is ever issued (Req 3.5).
 *
 * When a party row exists, the returned context has `known === true` and is
 * populated from the lead mirror. When no party row matches the supplied id,
 * the context falls back to the unknown-caller shape (`known === false`)
 * carrying any `options.formIdentities` so the lead is attributed to the web
 * form source (Req 3.10).
 *
 * @param db        Drizzle database handle (mirror tables only are read).
 * @param partyId   The resolved party id (see `resolveParty`).
 * @param options   Optional form identities used for the unknown-caller fallback.
 */
export async function buildCallContext(
  db: Database,
  partyId: string,
  options: BuildCallContextOptions = {}
): Promise<CallContext> {
  // One-to-one data: party + lead mirror + assigned rep, in a single join.
  const partyRowPromise = db
    .select({
      partyId: parties.id,
      name: parties.name,
      language: parties.language,
      tier: leadsMirror.tier,
      projectInterest: leadsMirror.projectInterest,
      unitInterest: leadsMirror.unitInterest,
      budgetBand: leadsMirror.budgetBand,
      source: leadsMirror.source,
      lastInteractionSummary: leadsMirror.lastInteractionSummary,
      repId: reps.id,
      repName: reps.name,
      repCapacity: reps.capacity,
      repOpenHotCount: reps.openHotCount,
    })
    .from(parties)
    .leftJoin(leadsMirror, eq(leadsMirror.partyId, parties.id))
    .leftJoin(reps, eq(reps.id, leadsMirror.assignedRepId))
    .where(eq(parties.id, partyId))
    .limit(1);

  // One-to-many data: the caller's open (confirmed) appointments, linked to the
  // party through the conversation that booked them. Issued concurrently with
  // the main join so the effective cost stays a single round-trip (NFR-3).
  const appointmentsPromise = db
    .select({
      scheduledDate: aiAppointments.scheduledDate,
      scheduledTime: aiAppointments.scheduledTime,
      project: aiAppointments.project,
    })
    .from(aiAppointments)
    .innerJoin(
      aiConversations,
      eq(aiAppointments.conversationId, aiConversations.id)
    )
    .where(
      and(
        eq(aiConversations.partyId, partyId),
        eq(aiAppointments.status, "confirmed")
      )
    );

  const [partyRows, appointmentRows] = await Promise.all([
    partyRowPromise,
    appointmentsPromise,
  ]);

  const row = partyRows[0];

  // No matching party → fall back to the unknown-caller context (Req 3.10).
  if (!row) {
    return buildUnknownCallContext(options.formIdentities, partyId);
  }

  const language: Language = row.language === "ar" ? "ar" : "en";

  const lastInteraction = row.lastInteractionSummary
    ? row.lastInteractionSummary.slice(0, LAST_INTERACTION_MAX)
    : undefined;

  // Rep availability is derived from capacity vs current open HOT load.
  const assignedRep =
    row.repId && row.repName
      ? {
          id: row.repId,
          name: row.repName,
          available: (row.repOpenHotCount ?? 0) < (row.repCapacity ?? 0),
        }
      : undefined;

  const openAppointments = appointmentRows.map((appt) => ({
    when: `${appt.scheduledDate} ${appt.scheduledTime}`.trim(),
    project: appt.project ?? row.projectInterest ?? "",
  }));

  const context: CallContext = {
    partyId: row.partyId,
    known: true,
    name: row.name ?? undefined,
    language,
    tier: row.tier ?? undefined,
    projectInterest: row.projectInterest ?? undefined,
    unitInterest: row.unitInterest ?? undefined,
    budgetBand: row.budgetBand ?? undefined,
    lastInteraction,
    assignedRep,
    source: row.source ?? undefined,
    openAppointments: openAppointments.length > 0 ? openAppointments : undefined,
  };

  // Validate against the single source of truth before handing off.
  return callContextSchema.parse(context);
}

/**
 * Build a `known === false` {@link CallContext} for an unknown caller.
 *
 * Used when no existing party matches the caller (Req 3.10 / FR-S5). Carries the
 * form-linked identities so the in-call lead is attributed to the web form
 * source, and the agent never asks for details (e.g. the phone number) the
 * caller already supplied. Issues no database or Salesforce call.
 *
 * @param formIdentities Identities captured on the pre-call form.
 * @param partyId        The freshly-created party id, if one was provisioned.
 */
export function buildUnknownCallContext(
  formIdentities?: FormIdentities,
  partyId = ""
): CallContext {
  // Language preference is unknown for a brand-new caller; default to "en".
  const context: CallContext = {
    partyId,
    known: false,
    language: "en",
    name: formIdentities?.name,
    source: formIdentities?.source,
    formIdentities,
  };

  return callContextSchema.parse(context);
}
