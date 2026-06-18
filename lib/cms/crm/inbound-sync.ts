/**
 * Inbound_Sync — polling Salesforce → DOE leads mirror (design §4; Requirements 6, 12).
 *
 * The chosen Inbound_Strategy is **polling** (design §4 Decision Document): a
 * container-tier worker runs SOQL `Lead WHERE LastModifiedDate > :cursor` on an
 * interval, advancing a stored cursor. This module owns the pure, testable core
 * of one poll tick; the long-lived loop that holds the cursor and sleeps lives
 * in `workers/sf-inbound-sync.ts` (task 5.2).
 *
 * `pollOnce` is deliberately conservative and idempotent (Req 6.5): re-processing
 * the same Salesforce change leaves `leads_mirror` field-for-field identical to
 * processing it once, because every write is an upsert keyed by `party_id`.
 *
 *   - **Throttle (Req 6.6).** When the org's API quota window is at or above 80%,
 *     the tick is skipped entirely — the cursor is returned unchanged and nothing
 *     is read, so usage never reaches 100%.
 *   - **Read failure (Req 6.7).** If the SOQL read itself fails, the failure is
 *     recorded in the Sync_Ledger (`inbound`/`failed`) and the previously mirrored
 *     state is left untouched.
 *   - **Dedupe conflict (Req 6.4).** If a Lead resolves to two or more existing
 *     Parties, the failure is recorded (`inbound`/`failed`, `externalRefId = Lead.Id`),
 *     no `leads_mirror` row is created, and the mirrored state is left unchanged.
 *   - **Resolve / create + upsert (Req 6.2, 6.3).** Otherwise the Party is resolved
 *     (or created via Dedupe), its `sf_lead_id` identity + `leads_mirror.sf_lead_id`
 *     are linked, and the mirror row is upserted from the Lead's fields.
 *   - **Cursor advance (Req 6.8).** The returned cursor is the maximum
 *     `LastModifiedDate` of the Leads successfully processed this tick.
 *
 * `leads_mirror` is the hot-path source for lead reads, so a lead lookup is
 * answerable without a synchronous Salesforce call (Req 6.9).
 *
 * Object/field API names are read from {@link SF_OBJECT_CONFIG} (env-overridable),
 * so sandbox/production field differences are absorbed in configuration rather
 * than hard-coded here (Req 1.8, 12.4).
 */

import type { Database } from "../db";
import { SF_OBJECT_CONFIG } from "../tickets/crm/sf-config";
import type { SalesforceObjectClient } from "../tickets/crm/salesforce-objects";
import {
  linkSfLeadId,
  resolveLeadByMatchKeys,
  upsertLead,
  type LeadMirrorFields,
  type MatchInput,
  type MatchKey,
} from "../tickets/crm/dedupe";
// NOTE: `./sync-ledger` is implemented concurrently by task 6.2. This module is
// written against its published contract; until 6.2 lands the import will not
// resolve (expected — re-verify after 6.2).
import { recordSync } from "./sync-ledger";

// ── Injected dependencies ────────────────────────────────────────────────────

/**
 * A Salesforce record returned by a SOQL query over the Lead object. Standard
 * fields (`Id`, `LastModifiedDate`) are always present; the remaining fields are
 * keyed by their Salesforce API names (resolved through {@link SF_OBJECT_CONFIG}),
 * so the shape varies between sandbox and production orgs.
 */
export interface SfLeadRecord {
  /** The Salesforce record id. */
  Id: string;
  /** ISO-8601 last-modified timestamp from Salesforce. */
  LastModifiedDate: string;
  [field: string]: unknown;
}

/**
 * Runs the SOQL query that drives the poll. Injected so tests can supply changed
 * Leads without a live org, and production wires it to the SF transport.
 */
export interface SoqlRunner {
  /**
   * Return the Leads whose `LastModifiedDate` is strictly greater than `cursor`,
   * ordered ascending by `LastModifiedDate`.
   */
  leadsModifiedSince(cursor: Date): Promise<SfLeadRecord[]>;
}

/** Reports the current fraction of the Salesforce API quota window in use. */
export interface QuotaGauge {
  /** Current API quota usage as a fraction in `[0, 1]`. */
  usedFraction(): number;
}

/** Dependencies for one poll tick. */
export interface PollDeps {
  db: Database;
  sf: SalesforceObjectClient;
  query: SoqlRunner;
  quota: QuotaGauge;
}

/** The result of one poll tick. */
export interface PollResult {
  /** The cursor to use for the next tick (max processed `LastModifiedDate`). */
  next: Date;
  /** The number of changed Leads read this tick (0 when throttled or read failed). */
  processed: number;
}

/** Quota usage at or above this fraction throttles the tick (Req 6.6). */
const QUOTA_THROTTLE_THRESHOLD = 0.8;

// ── One poll tick ────────────────────────────────────────────────────────────

/**
 * Execute one poll tick. Idempotent: re-processing the same change yields the
 * same `leads_mirror` state (Req 6.5).
 */
export async function pollOnce(
  deps: PollDeps,
  cursor: Date
): Promise<PollResult> {
  // Throttle: at/above 80% of the API quota window, skip the tick entirely so
  // usage never reaches 100% (Req 6.6). Cursor unchanged, nothing read.
  if (deps.quota.usedFraction() >= QUOTA_THROTTLE_THRESHOLD) {
    return { next: cursor, processed: 0 };
  }

  // Read the changed Leads. A read failure is recorded (inbound/failed) and the
  // mirrored state is left unchanged (Req 6.7).
  let changed: SfLeadRecord[];
  try {
    changed = await deps.query.leadsModifiedSince(cursor);
  } catch (error) {
    await recordSync(deps.db, {
      direction: "inbound",
      action: "lead",
      status: "failed",
      errorMessage: errorMessage(error),
    });
    return { next: cursor, processed: 0 };
  }

  let next = cursor;

  for (const lead of changed) {
    const modifiedAt = parseModifiedDate(lead.LastModifiedDate);
    const resolved = await resolveLeadByMatchKeys(deps.db, fromSfLead(lead));

    // A dedupe conflict (distinct keys → different Parties) is recorded and the
    // mirror is left unchanged (Req 6.4). The cursor is NOT advanced past this
    // Lead, so it stays pending resolution.
    if (resolved.kind === "conflict") {
      await recordSync(deps.db, {
        direction: "inbound",
        action: "lead",
        status: "failed",
        externalRefId: lead.Id,
        errorMessage: `dedupe conflict: ${resolved.candidatePartyIds.join(", ")}`,
      });
      continue;
    }

    // A malformed Lead (no usable match keys, invalid phone/email) cannot be
    // mirrored safely; record the failure and leave the mirror unchanged.
    if (resolved.kind === "error") {
      await recordSync(deps.db, {
        direction: "inbound",
        action: "lead",
        status: "failed",
        externalRefId: lead.Id,
        errorMessage: resolved.message,
      });
      continue;
    }

    // Resolve the existing Party, or create one via Dedupe when new (Req 6.3).
    const partyId =
      resolved.kind === "match"
        ? resolved.partyId
        : await createPartyFromSfLead(deps.db, lead);

    // Link the sf_lead_id identity + leads_mirror.sf_lead_id (Req 6.3), then
    // upsert the mirror row from the Lead's fields, keyed by party (Req 6.2).
    await linkSfLeadId(deps.db, partyId, lead.Id);
    await upsertLeadsMirror(deps.db, partyId, mapSfLeadToMirror(lead));

    await recordSync(deps.db, {
      direction: "inbound",
      action: "lead",
      status: "success",
      externalRefId: lead.Id,
    });

    // Advance the cursor to the max processed LastModifiedDate (Req 6.8).
    if (modifiedAt > next) {
      next = modifiedAt;
    }
  }

  return { next, processed: changed.length };
}

// ── Salesforce Lead → DOE mapping ────────────────────────────────────────────

/** The configured Salesforce field API names for the Lead object. */
const LEAD_FIELDS = SF_OBJECT_CONFIG.Lead.fields;

/**
 * Build the dedupe {@link MatchInput} from a Salesforce Lead: its email and phone
 * (read via the configured field names) plus its Salesforce id as a direct
 * `sf_lead_id` match key.
 */
function fromSfLead(lead: SfLeadRecord): MatchInput {
  const input: MatchInput = { sfLeadId: lead.Id };

  const email = readString(lead, LEAD_FIELDS.email);
  if (email) input.email = email;

  const phone = readString(lead, LEAD_FIELDS.phone);
  if (phone) input.phone = phone;

  return input;
}

/**
 * Create a new Party for a Salesforce Lead that resolved to no existing Party
 * (Req 6.3). The Party's contact identities (email / phone) are linked
 * idempotently; the `sf_lead_id` linkage and the mirror fields are applied by the
 * caller via {@link linkSfLeadId} / {@link upsertLeadsMirror}.
 */
async function createPartyFromSfLead(
  db: Database,
  lead: SfLeadRecord
): Promise<string> {
  const { partyId } = await upsertLead(db, {
    party: { type: "person", name: displayName(lead) },
    identities: contactIdentities(lead),
  });
  return partyId;
}

/**
 * The exact-match identities carried by a Salesforce Lead, used when creating a
 * new Party. Phone is intentionally NOT linked here: `linkIdentities` stores the
 * value verbatim, and a phone may only ever be persisted as a salted hash
 * (CC-Privacy) — phone matching happens through the hashed key inside
 * `resolveLeadByMatchKeys`, never by storing a raw phone identity.
 */
function contactIdentities(lead: SfLeadRecord): MatchKey[] {
  const keys: MatchKey[] = [];
  const email = readString(lead, LEAD_FIELDS.email);
  if (email) keys.push({ kind: "email", value: email.trim().toLowerCase() });
  return keys;
}

/**
 * Map a Salesforce Lead onto the mirrored `leads_mirror` fields (Req 6.2),
 * reading each Salesforce field by its configured API name. `sf_lead_id` is
 * excluded here — it is applied through {@link linkSfLeadId} so the identity row
 * and the mirror column stay in lock-step.
 */
function mapSfLeadToMirror(lead: SfLeadRecord): LeadMirrorFields {
  const fields: LeadMirrorFields = {};

  const stage = readString(lead, LEAD_FIELDS.status);
  if (stage) fields.stage = stage;

  const projectInterest = readString(lead, LEAD_FIELDS.projectInterest);
  if (projectInterest) fields.projectInterest = projectInterest;

  const source = readString(lead, LEAD_FIELDS.source);
  if (source) fields.source = source;

  return fields;
}

/** Compose a display name from the Lead's first / last name fields. */
function displayName(lead: SfLeadRecord): string | undefined {
  const first = readString(lead, LEAD_FIELDS.firstName);
  const last = readString(lead, LEAD_FIELDS.lastName);
  const name = [first, last].filter(Boolean).join(" ").trim();
  return name.length > 0 ? name : undefined;
}

// ── Mirror upsert ────────────────────────────────────────────────────────────

/**
 * Upsert the `leads_mirror` row for a Party from mapped Lead fields, keyed by the
 * `party_id` primary key (Req 6.2). Idempotent: re-applying the same fields
 * leaves the row field-for-field identical (Req 6.5).
 *
 * Implemented on top of {@link upsertLead} so the mirror upsert path is shared
 * with the Object_Router and dedupe link helpers, keeping one canonical writer
 * for the local Lead holder.
 */
async function upsertLeadsMirror(
  db: Database,
  partyId: string,
  mirror: LeadMirrorFields
): Promise<void> {
  await upsertLead(db, { partyId, mirror });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Read a string-valued field from a Salesforce record, or `undefined`. */
function readString(
  record: SfLeadRecord,
  field: string | undefined
): string | undefined {
  if (!field) return undefined;
  const value = record[field];
  if (typeof value === "string" && value.length > 0) return value;
  return undefined;
}

/**
 * Parse a Salesforce `LastModifiedDate` into a `Date`. An unparseable value
 * falls back to the epoch so it never advances the cursor.
 */
function parseModifiedDate(value: string): Date {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

/** Extract a human-readable message from an unknown thrown value. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
