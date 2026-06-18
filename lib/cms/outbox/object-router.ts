/**
 * Object_Router — replace the outbox Case shim with first-class object routing
 * (design §3; Requirements 4, 5, 13).
 *
 * The legacy `buildCaseInput` mapped EVERY `OutboxKind` onto a Salesforce Case.
 * This router instead switches on the kind and the originating DOE entity carried
 * in the payload, and drives the first-class {@link SalesforceObjectClient}:
 *
 *   - `lead_upsert` → Salesforce **Lead** (+ associated Contact / Opportunity as
 *     applicable) (Req 4.1, 4.9, 4.11).
 *   - `task`        → Salesforce **Task** (from a Lead_Task — a Ticket linked to a
 *     Lead via `tickets.lead_party_id`) (Req 4.2, 4.12).
 *   - `event`       → Salesforce **Event** (a scheduled Lead activity) (Req 4.3, 4.13).
 *   - any other kind → {@link UnknownOutboxKindError}; the router NEVER falls back
 *     to a Case or any default object (Req 4.7, 4.10).
 *
 * Idempotency (Req 5.3, 5.4, 4.8): before writing, the router reconciles against
 * an existing Salesforce id — preferring the outbox row's own `sfId`, else the
 * Party's mirrored `leads_mirror.sf_lead_id` — so a retry of the same `jobKey`
 * UPDATES the prior Salesforce record rather than creating a duplicate. When a
 * brand-new Lead is created for a payload carrying a `partyId`, the new SF id is
 * mirrored back via {@link linkSfLeadId}.
 *
 * Entity separation (Req 4.14): only a Ticket with a non-null `lead_party_id`
 * (a Lead_Task) is ever enqueued as a `task`, and only a Lead originates a
 * `lead_upsert`. An Internal_Ticket (no Lead link) therefore never reaches the
 * Lead path here — the router only creates a Salesforce Lead for `lead_upsert`,
 * so an Internal_Ticket is never routed as a Lead.
 */

import { eq } from "drizzle-orm";

import type { Database } from "@/lib/cms/db";
import { leadsMirror } from "@/lib/cms/schema";
import { linkSfLeadId } from "../tickets/crm/dedupe";
import type { SalesforceObjectClient } from "../tickets/crm/salesforce-objects";
import type { OutboxKind } from "./index";

// ── Typed errors ─────────────────────────────────────────────────────────────

/**
 * Raised when the drainer hands the router an outbox row whose `kind` is not one
 * of `lead_upsert`, `task`, or `event`. The router surfaces the unrecognized
 * kind and does NOT route the payload onto a Case or any default object
 * (Req 4.7, 4.10).
 */
export class UnknownOutboxKindError extends Error {
  readonly kind: string;
  constructor(kind: string) {
    super(`Unknown outbox kind: ${kind}`);
    this.name = "UnknownOutboxKindError";
    this.kind = kind;
  }
}

// ── Router input ─────────────────────────────────────────────────────────────

/** The slice of an `sf_outbox` row the router needs to route a delivery. */
export interface OutboxRow {
  kind: OutboxKind;
  payload: unknown;
  /** The Salesforce id captured by a prior successful (or partial) attempt. */
  sfId: string | null;
}

// ── Field key catalogues (DOE field keys mapped by SF_OBJECT_CONFIG) ──────────
//
// Each list is the set of DOE field keys the SalesforceObjectClient knows how to
// map for that object. The router pulls ONLY these keys from the payload so an
// unrelated payload property never reaches `mapFields` (which would raise an
// SfConfigError for an unmapped key).

const LEAD_FIELD_KEYS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "company",
  "status",
  "projectInterest",
  "source",
] as const;

const CONTACT_FIELD_KEYS = ["firstName", "lastName", "email", "phone"] as const;

const OPPORTUNITY_FIELD_KEYS = ["name", "stage", "closeDate", "amount"] as const;

const TASK_FIELD_KEYS = [
  "subject",
  "description",
  "status",
  "whoId",
  "ownerId",
] as const;

const EVENT_FIELD_KEYS = [
  "subject",
  "startDateTime",
  "endDateTime",
  "whoId",
] as const;

// ── Public entry point ───────────────────────────────────────────────────────

/**
 * Route one outbox row to its correct Salesforce sObject and return the
 * created-or-updated Salesforce id (stored by the drainer as `sf_outbox.sf_id`).
 *
 * Reconciles against an existing Salesforce id BEFORE writing so retries update
 * rather than duplicate (Req 4.8, 5.4). NEVER falls back to a Case (Req 4.7);
 * an unrecognized kind raises {@link UnknownOutboxKindError} (Req 4.10).
 */
export async function routeOutbox(
  db: Database,
  sf: SalesforceObjectClient,
  row: OutboxRow
): Promise<string> {
  const payload = (row.payload ?? {}) as Record<string, unknown>;

  switch (row.kind) {
    case "lead_upsert":
      return upsertLead(db, sf, payload, row.sfId); // → Lead (+Contact/Opportunity)
    case "task":
      return upsertTask(sf, payload, row.sfId); // ← Lead_Task → Task
    case "event":
      return upsertEvent(sf, payload, row.sfId); // ← scheduled Lead activity → Event
    default:
      // No Case fallback, no default object (Req 4.7, 4.10).
      throw new UnknownOutboxKindError(String(row.kind));
  }
}

// ── lead_upsert → Lead (+ Contact / Opportunity) ─────────────────────────────

/**
 * Create or update a Salesforce Lead from a `lead_upsert` payload, then create
 * or update the associated Contact and Opportunity as applicable (Req 4.1, 4.9,
 * 4.11). Reconciles against the row's `sfId` or the Party's mirrored
 * `sf_lead_id` so a retry updates the existing Lead (Req 4.8, 5.4).
 */
async function upsertLead(
  db: Database,
  sf: SalesforceObjectClient,
  payload: Record<string, unknown>,
  sfId: string | null
): Promise<string> {
  const partyId = typeof payload.partyId === "string" ? payload.partyId : null;

  // Reconcile: prefer the row's own sfId, else the Party's mirrored sf_lead_id.
  const existing = sfId ?? (partyId ? await sfLeadIdForParty(db, partyId) : null);

  const leadFields = pick(payload, LEAD_FIELD_KEYS);

  let leadId: string;
  if (existing) {
    // Update the prior Salesforce Lead rather than creating a duplicate (Req 4.8).
    await sf.updateObject("Lead", existing, leadFields);
    leadId = existing;
  } else {
    leadId = await sf.createObject("Lead", leadFields);
    // Mirror the freshly created SF id back onto the Party (Req 2.8 linkage).
    if (partyId) {
      await linkSfLeadId(db, partyId, leadId);
    }
  }

  // Create/update the associated Contact and Opportunity as applicable.
  await maybeUpsertContact(sf, payload);
  await maybeUpsertOpportunity(sf, payload);

  return leadId;
}

/**
 * Create or update the associated Salesforce Contact when the payload carries
 * contact details that require one (Req 4.9). The contact is signalled by a
 * nested `contact` object; an existing `contactSfId` reconciles the write to an
 * update rather than a duplicate.
 */
async function maybeUpsertContact(
  sf: SalesforceObjectClient,
  payload: Record<string, unknown>
): Promise<void> {
  const contact = asRecord(payload.contact);
  if (!contact) return;

  const fields = pick(contact, CONTACT_FIELD_KEYS);
  const contactSfId =
    typeof payload.contactSfId === "string" ? payload.contactSfId : null;

  if (contactSfId) {
    await sf.updateObject("Contact", contactSfId, fields);
  } else {
    await sf.createObject("Contact", fields);
  }
}

/**
 * Create or update the associated Salesforce Opportunity when the payload
 * carries one (Req 4.11). Signalled by a nested `opportunity` object; an
 * existing `opportunitySfId` reconciles the write to an update.
 */
async function maybeUpsertOpportunity(
  sf: SalesforceObjectClient,
  payload: Record<string, unknown>
): Promise<void> {
  const opportunity = asRecord(payload.opportunity);
  if (!opportunity) return;

  const fields = pick(opportunity, OPPORTUNITY_FIELD_KEYS);
  const opportunitySfId =
    typeof payload.opportunitySfId === "string" ? payload.opportunitySfId : null;

  if (opportunitySfId) {
    await sf.updateObject("Opportunity", opportunitySfId, fields);
  } else {
    await sf.createObject("Opportunity", fields);
  }
}

// ── task → Task ──────────────────────────────────────────────────────────────

/**
 * Create or update a Salesforce Task from a `task` payload originating from a
 * Lead_Task (Req 4.2, 4.12). Reconciles against the row's `sfId` so a retry
 * updates the existing Task rather than duplicating it (Req 5.4).
 */
async function upsertTask(
  sf: SalesforceObjectClient,
  payload: Record<string, unknown>,
  sfId: string | null
): Promise<string> {
  const fields = pick(payload, TASK_FIELD_KEYS);
  if (sfId) {
    await sf.updateObject("Task", sfId, fields);
    return sfId;
  }
  return sf.createObject("Task", fields);
}

// ── event → Event ────────────────────────────────────────────────────────────

/**
 * Create or update a Salesforce Event from an `event` payload originating from a
 * scheduled Lead activity (Req 4.3, 4.13). Reconciles against the row's `sfId`
 * so a retry updates the existing Event rather than duplicating it (Req 5.4).
 */
async function upsertEvent(
  sf: SalesforceObjectClient,
  payload: Record<string, unknown>,
  sfId: string | null
): Promise<string> {
  const fields = pick(payload, EVENT_FIELD_KEYS);
  if (sfId) {
    await sf.updateObject("Event", sfId, fields);
    return sfId;
  }
  return sf.createObject("Event", fields);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Return the Salesforce Lead id linked to a Party via its `leads_mirror` row, or
 * `null` when the Party has no mirror row or no linked `sf_lead_id`.
 *
 * Queries `leads_mirror` directly (rather than reaching into dedupe's private
 * helper) so the router reconciles against the canonical local Lead holder
 * without coupling to dedupe's internals (Req 4.8, 5.4).
 */
async function sfLeadIdForParty(
  db: Database,
  partyId: string
): Promise<string | null> {
  const [row] = await db
    .select({ sfLeadId: leadsMirror.sfLeadId })
    .from(leadsMirror)
    .where(eq(leadsMirror.partyId, partyId))
    .limit(1);

  return row?.sfLeadId ?? null;
}

/**
 * Project the given DOE field keys out of a payload object, keeping only keys
 * whose value is defined. The result feeds the {@link SalesforceObjectClient},
 * whose `mapFields` translates DOE keys → Salesforce field API names; restricting
 * to the known catalogue avoids handing it an unmapped key.
 */
function pick(
  source: Record<string, unknown>,
  keys: readonly string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

/** Narrow an unknown payload property to a plain object, or `null` otherwise. */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}
