/**
 * Lead Engine (S3) — Lead_Intake: the durable, parsed-or-queued spine.
 *
 * Lead_Intake is the entry stage of the Lead_Engine. It durably records every
 * {@link InboundLead} into the `inbound_leads` ledger BEFORE any parsing is
 * attempted, so no inbound lead is ever dropped (P-NoDrop). Every recorded row
 * sits in exactly one Intake_Status — `received | parsed | queued | failed` —
 * and the four writers below are the ONLY code that mutates that column.
 *
 * Privacy (CC-Privacy / Req 13.1): a phone is persisted only as a salted
 * `phone_hash`, computed by reusing the voice surface's
 * {@link normalizePhoneToE164} + {@link computePhoneHash} helpers. The
 * transient `raw_phone` copy used to populate the Salesforce-bound outbox is
 * retained here and purged ≤24h later by `lib/cms/leads/phone.ts` (task 7.1).
 *
 * Design references: §Components #2 (Lead_Intake — durable, parsed-or-queued).
 * Requirements: 3.1 (record `received` before parsing), 3.4 (`parsed` on
 * success), 3.5 (`queued`, retain for retry ≤5 attempts), 3.6 (`failed` after
 * the retries are exhausted), 3.7 (exactly one status per row, never
 * discarded).
 */

import { eq, sql } from "drizzle-orm";

import type { Database } from "../db";
import type { DoeEventType } from "../realtime/events";
import { publishEvent } from "../realtime/events";
import { inboundLeads } from "../schema";
import { computePhoneHash, normalizePhoneToE164 } from "../voice/identity";
import type { InboundLead } from "./inbound";

// ── Intake status state machine ──────────────────────────────────────────────

/** The processing state of a recorded Inbound_Lead (Req 3.7). */
export type IntakeStatus = "received" | "parsed" | "queued" | "failed";

/**
 * The maximum number of parse retry attempts a queued Inbound_Lead is given
 * before it is moved to `failed` (Req 3.5, 3.6). The retry-cap decision is made
 * by the Parse_Agent / intake workflow (tasks 5.2, 5.6), which calls
 * {@link markFailed} once {@link markQueued} has driven `attempts` to this cap.
 */
export const MAX_PARSE_ATTEMPTS = 5;

// ── recordInbound — durable capture before parsing (Req 3.1, 3.2, 3.3) ───────

/** The acknowledgment returned by {@link recordInbound}. */
export interface RecordInboundResult {
  /** The `inbound_leads.id` of the (new or pre-existing) row. */
  id: string;
  /** `true` when an existing row was acknowledged rather than a new insert. */
  deduped: boolean;
}

/**
 * Durably record an Inbound_Lead before any parsing is attempted (Req 3.1),
 * idempotent by `idempotencyKey` (Req 3.2, 3.3).
 *
 * The row is inserted with status `received` and `attempts` 0. Insertion uses
 * `ON CONFLICT (idempotency_key) DO NOTHING`, so at most one row ever exists
 * per idempotency key:
 *
 *   - On a fresh insert, a `lead.ingested` event is published and
 *     `{ id, deduped: false }` is returned.
 *   - On a conflict, the existing row is looked up and acknowledged with
 *     `{ id, deduped: true }`; no second event is published.
 *
 * The phone (when present) is normalized to E.164 and stored only as a salted
 * `phone_hash`; the raw value is kept transiently in `raw_phone` solely to
 * populate the Salesforce-bound outbox payload and is purged ≤24h later
 * (CC-Privacy, Req 13.1).
 *
 * @param db   Drizzle database (or transaction) handle.
 * @param lead The canonical Inbound_Lead to record.
 */
export async function recordInbound(
  db: Database,
  lead: InboundLead
): Promise<RecordInboundResult> {
  const phoneHash = lead.phone
    ? computePhoneHash(normalizePhoneToE164(lead.phone))
    : null;

  const inserted = await db
    .insert(inboundLeads)
    .values({
      source: lead.source,
      idempotencyKey: lead.idempotencyKey,
      name: lead.name ?? null,
      email: lead.email ?? null,
      phoneHash, // salted hash only — never raw (Req 13.1)
      content: lead.content,
      rawPayload: lead.rawPayload as object,
      attribution: lead.attribution ?? null,
      structured: null,
      status: "received", // recorded before any parsing (Req 3.1)
      attempts: 0,
      rawPhone: lead.phone ?? null, // transient SF-ingress copy; purged ≤24h (Req 13)
    })
    .onConflictDoNothing({ target: inboundLeads.idempotencyKey }) // at most one per key (Req 3.3)
    .returning({ id: inboundLeads.id });

  if (inserted.length > 0) {
    const id = inserted[0].id;
    // TODO(task 6.6): `lead.ingested` is added to the DoeEventType union in
    // `lib/cms/realtime/events.ts` by task 6.6. Until then, cast to satisfy the
    // strongly-typed publishEvent — `events.type` is plain text, so this is
    // safe at runtime and requires no migration.
    //
    // The payload carries the fields a leads dashboard needs to render a new
    // row WITHOUT a follow-up fetch (CC-Privacy: NEVER the raw phone — only the
    // fields already exposed by the `leads:read` read API). `status` is always
    // `received` here, the state a freshly recorded lead is in (Req 3.1).
    await publishEvent(db, {
      type: "lead.ingested" as DoeEventType,
      payload: {
        id,
        source: lead.source,
        status: "received",
        name: lead.name ?? null,
        email: lead.email ?? null,
        capturedAt: lead.capturedAt,
      },
    });
    return { id, deduped: false };
  }

  // Conflict: acknowledge the existing row referencing the same key (Req 3.3).
  const [existing] = await db
    .select({ id: inboundLeads.id })
    .from(inboundLeads)
    .where(eq(inboundLeads.idempotencyKey, lead.idempotencyKey))
    .limit(1);

  return { id: existing.id, deduped: true };
}

// ── Status writers — the ONLY mutators of inbound_leads.status ───────────────

/**
 * Mark a recorded Inbound_Lead as successfully parsed (Req 3.4).
 *
 * @param db Drizzle database (or transaction) handle.
 * @param id The `inbound_leads.id` to transition.
 */
export async function markParsed(db: Database, id: string): Promise<void> {
  await db
    .update(inboundLeads)
    .set({ status: "parsed", updatedAt: new Date() })
    .where(eq(inboundLeads.id, id));
}

/**
 * Queue a recorded Inbound_Lead for retry, incrementing its attempt count and
 * retaining it in durable storage (Req 3.5). The row is retained for up to
 * {@link MAX_PARSE_ATTEMPTS} retry attempts; once that cap is reached the
 * caller transitions the row to `failed` via {@link markFailed} (Req 3.6).
 *
 * @param db Drizzle database (or transaction) handle.
 * @param id The `inbound_leads.id` to transition.
 * @returns The row's `attempts` value after the increment, so the caller can
 *   enforce the retry cap.
 */
export async function markQueued(
  db: Database,
  id: string
): Promise<{ attempts: number }> {
  const [updated] = await db
    .update(inboundLeads)
    .set({
      status: "queued",
      attempts: sql`${inboundLeads.attempts} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(inboundLeads.id, id))
    .returning({ attempts: inboundLeads.attempts });

  return { attempts: updated?.attempts ?? 0 };
}

/**
 * Mark a recorded Inbound_Lead as failed after its retries are exhausted
 * (Req 3.6). The row is retained in durable storage with the last error stored
 * for human review — it is never discarded (Req 3.7).
 *
 * @param db    Drizzle database (or transaction) handle.
 * @param id    The `inbound_leads.id` to transition.
 * @param error A human-readable description of the failure.
 */
export async function markFailed(
  db: Database,
  id: string,
  error: string
): Promise<void> {
  await db
    .update(inboundLeads)
    .set({ status: "failed", lastError: error, updatedAt: new Date() })
    .where(eq(inboundLeads.id, id));
}
