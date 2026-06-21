/**
 * Prospecting Workspace (S7) — Target raw-phone privacy guards (Requirement 9.2).
 *
 * The platform's phone-privacy invariant (roadmap P9 / CC-Privacy, Req 9.2) is
 * that a phone number lives only as a salted `phone_hash` and is permitted raw
 * in exactly one place: the Salesforce-bound outbox payload sent to the system
 * of record. A `targets` row keeps a `raw_phone` copy transiently — solely to
 * populate that outbound payload once the Target is promoted to a Lead — and it
 * must not linger past 24h of the promoted Lead being forwarded to the outbox.
 *
 * This module mirrors S2's `purgeDeliveredOutboxPhones`
 * (`lib/cms/crm/phone-privacy.ts`) and S3's `purgeInboundPhones`
 * (`lib/cms/leads/phone.ts`) — it reuses the same delivered-outbox signal
 * (`sf_outbox.status = 'sent'`, keyed off `updatedAt` past a 24h cutoff) — and
 * provides two primitives:
 *
 *   1. {@link purgeTargetPhones} — a self-contained sweep that clears
 *      `targets.raw_phone` for every Target whose promoted Lead's
 *      Salesforce-bound `lead_upsert` was confirmed delivered (`status = 'sent'`)
 *      more than 24h ago. A Target is linked to its outbox row by the `partyId`
 *      it was promoted to (set on `promote_target_to_lead`) and which the
 *      `lead_upsert` payload carries (Req 9.2 — raw phone leaves `targets` once
 *      it is no longer needed to populate the outbox).
 *
 *   2. {@link redactPhonesForEmit} — a pre-emit guard that replaces any raw
 *      phone-shaped value in an event or audit payload with its salted
 *      `phone_hash` before the payload reaches the SSE bus or the Audit_Log
 *      (Req 9.2). It reuses S2's phone-shaped detection
 *      ({@link findPhoneShaped}) and the voice surface's
 *      {@link normalizePhoneToE164} + {@link computePhoneHash} hashing — it
 *      reinvents neither.
 *
 * Design references: §Components #3 (Target + per-field provenance),
 * §Error Handling. Requirements: 9.2.
 */

import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";

import type { Database } from "../db";
import { findPhoneShaped } from "../crm/phone-privacy";
import { sfOutbox, targets } from "../schema";
import { computePhoneHash, normalizePhoneToE164 } from "../voice/identity";

// ── Delivered-outbox raw-phone purge (Req 9.2) ───────────────────────────────

/** 24 hours in milliseconds — the retention bound for raw phone post-forwarding. */
const PURGE_AFTER_MS = 24 * 60 * 60 * 1000;

/** Result of a purge sweep, for logging/observability. */
export interface TargetPhonePurgeResult {
  /** Number of `targets` rows whose `raw_phone` was cleared. */
  purged: number;
  /** Number of delivered `lead_upsert` outbox rows inspected. */
  scanned: number;
}

/**
 * Extract the originating DOE Party id from a Salesforce-bound `lead_upsert`
 * outbox payload, or `null` when the payload carries no Lead linkage.
 *
 * The `lead_upsert` payload carries the `partyId` of the Lead it forwards (see
 * `routeOutbox` reconciliation); this is the join key back to the `targets`
 * row(s) promoted to that Party which supplied the raw phone.
 */
function partyIdFromPayload(payload: unknown): string | null {
  if (payload === null || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>).partyId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Clear `targets.raw_phone` for every Target whose promoted Lead was forwarded
 * to the Salesforce-bound outbox more than 24h ago (Req 9.2).
 *
 * Mirrors S2's {@link purgeDeliveredOutboxPhones}: it selects the `lead_upsert`
 * outbox rows whose delivery was confirmed (`status = 'sent'`) and whose
 * `updatedAt` (the delivery-confirmation timestamp set by the drainer) is more
 * than 24h before `now`, resolves the Party id each forwarded payload carries,
 * and nulls `raw_phone` on the matching promoted `targets` rows. Only rows that
 * still hold a `raw_phone` are touched, so re-running the sweep is a no-op
 * (idempotent).
 *
 * This is a self-contained sweep that queries `sf_outbox` and `targets`
 * directly; it does not touch the drainer.
 *
 * @param db  Drizzle database (or transaction) handle.
 * @param now Override for the current time (tests); defaults to `new Date()`.
 */
export async function purgeTargetPhones(
  db: Database,
  now: Date = new Date()
): Promise<TargetPhonePurgeResult> {
  const cutoff = new Date(now.getTime() - PURGE_AFTER_MS);

  // The delivered Salesforce-bound Lead forwards older than the retention bound.
  const delivered = await db
    .select({ payload: sfOutbox.payload })
    .from(sfOutbox)
    .where(
      and(
        eq(sfOutbox.kind, "lead_upsert"),
        eq(sfOutbox.status, "sent"),
        lt(sfOutbox.updatedAt, cutoff)
      )
    );

  // The set of Party ids whose Lead has been forwarded ≥24h ago.
  const forwardedPartyIds = new Set<string>();
  for (const row of delivered) {
    const partyId = partyIdFromPayload(row.payload);
    if (partyId !== null) forwardedPartyIds.add(partyId);
  }

  if (forwardedPartyIds.size === 0) {
    return { purged: 0, scanned: delivered.length };
  }

  // Clear the transient raw phone wherever it still lingers for those Targets.
  // The `raw_phone IS NOT NULL` predicate keeps the sweep idempotent — an
  // already-purged row has nothing to clear and is left untouched.
  const cleared = await db
    .update(targets)
    .set({ rawPhone: null, updatedAt: now })
    .where(
      and(
        inArray(targets.partyId, [...forwardedPartyIds]),
        isNotNull(targets.rawPhone)
      )
    )
    .returning({ id: targets.id });

  return { purged: cleared.length, scanned: delivered.length };
}

// ── Pre-emit raw-phone guard (Req 9.2) ───────────────────────────────────────

/**
 * Replace one phone-shaped token with its salted `phone_hash` (Req 9.2).
 *
 * Reuses the voice surface's {@link normalizePhoneToE164} + {@link computePhoneHash}
 * so the emitted hash is identical to the one stored on the Target. If the token
 * cannot be normalised to a valid E.164 number, or no `PHONE_HASH_SALT` is
 * configured, it is replaced with a fixed marker so a raw number can never leak
 * even in a misconfigured environment.
 */
function hashPhoneToken(token: string): string {
  try {
    const e164 = normalizePhoneToE164(token);
    return `phone_hash:${computePhoneHash(e164)}`;
  } catch {
    return "[redacted-phone]";
  }
}

/**
 * Replace every raw phone-shaped substring in a string with its salted hash.
 *
 * Uses S2's {@link findPhoneShaped} to locate phone-shaped runs (it already
 * excludes ids, UUIDs, and salted hashes via its digit-count and
 * letter-adjacency rules). Scans left-to-right, replacing each match and
 * continuing past the replacement; because a `phone_hash:` token is bounded by
 * hex letters it is never re-detected, so the scan terminates.
 */
function redactPhonesInString(value: string): string {
  let result = "";
  let rest = value;
  for (;;) {
    const match = findPhoneShaped(rest);
    if (match === null) {
      result += rest;
      return result;
    }
    const idx = rest.indexOf(match);
    result += rest.slice(0, idx) + hashPhoneToken(match);
    rest = rest.slice(idx + match.length);
  }
}

/**
 * Pre-emit privacy guard: return a deep copy of `payload` in which every raw
 * phone-shaped value has been replaced by its salted `phone_hash`, ready to be
 * published to the SSE_Event_Bus or written to the Audit_Log (Req 9.2).
 *
 * Walks strings, arrays, and plain objects recursively; numbers, booleans, the
 * key names of objects, `Date`/`RegExp` instances, and other non-string leaves
 * are returned unchanged (a raw phone reaching a payload always arrives as a
 * string or nested within one). The input is never mutated. Pure and
 * recursive, so it is directly property-testable (Property 8's no-raw-phone
 * clause).
 *
 * @param payload The event/audit payload about to be emitted.
 * @returns A redacted deep copy with raw phones replaced by their hash.
 */
export function redactPhonesForEmit<T>(payload: T): T {
  return walk(payload, new WeakSet()) as T;
}

function walk(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") return redactPhonesInString(value);

  if (typeof value !== "object") return value;

  // Guard against cycles — a self-referential payload returns its own clone
  // node once and stops recursing.
  if (seen.has(value as object)) return value;
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((v) => walk(v, seen));
  }

  // Date / RegExp / other non-plain objects: nothing string-like to inspect.
  if (value instanceof Date || value instanceof RegExp) return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = walk(v, seen);
  }
  return out;
}
