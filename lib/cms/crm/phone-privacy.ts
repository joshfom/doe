/**
 * Phone privacy guards for the Salesforce integration (Design §6; Requirements
 * 7.1–7.6, 14.6, 14.7).
 *
 * The platform's privacy invariant (roadmap P9 / CC-Privacy) is that a phone
 * number is stored only as a salted `phone_hash` in `party_identities`, and
 * NEVER appears raw in `events`, `audit_log`, `crm_sync_log`, or note content.
 * A raw phone is permitted in exactly one place: the Salesforce-bound outbox
 * payload sent to the system of record — and even there it must not linger past
 * 24h of confirmed delivery.
 *
 * This module provides the two enforcement primitives:
 *
 *   1. {@link assertNoRawPhone} — a write guard that callers into the protected
 *      stores (`party_identities`, event payloads, audit, sync ledger, note
 *      content) invoke before persisting. It throws {@link RawPhoneError} when a
 *      raw phone-shaped string is detected anywhere in the value (recursively),
 *      so the caller can reject the write and record a privacy-violation
 *      indication without persisting (Req 7.5, 14.7).
 *
 *   2. {@link purgeDeliveredOutboxPhones} — a self-contained sweep that clears
 *      raw phone field(s) from `sf_outbox` payloads whose delivery was confirmed
 *      (`status = 'sent'`) more than 24h ago, keyed off `updatedAt` (Req 7.6).
 *
 * The guard deliberately does NOT reject salted hashes: a `phone_hash` is a long
 * hex digest with no run of formatting/separator-delimited dialable digits, so
 * it passes (Req 7.1 stores only the hash).
 */

import { and, eq, lt } from "drizzle-orm";

import type { Database } from "@/lib/cms/db";
import { sfOutbox } from "@/lib/cms/schema";

// ── Privacy violation error ───────────────────────────────────────────────────

/**
 * Thrown by {@link assertNoRawPhone} when a raw phone-shaped string is found in
 * a value bound for a protected store. Callers catch this to reject the write
 * and record a privacy-violation indication (Req 7.5, 14.7).
 */
export class RawPhoneError extends Error {
  /** Discriminant so callers can branch without `instanceof` across bundles. */
  readonly code = "raw_phone_violation" as const;

  /**
   * Dotted path to the offending value within the inspected object
   * (e.g. `contact.phone`, `payload[2].mobile`), or `<root>` for a bare string.
   */
  readonly path: string;

  /** The phone-shaped substring that triggered the rejection (for logging). */
  readonly match: string;

  constructor(path: string, match: string) {
    super(
      `Raw phone-shaped value detected at "${path}" — refusing to persist to a protected store (privacy violation).`
    );
    this.name = "RawPhoneError";
    this.path = path;
    this.match = match;
  }
}

// ── Phone-shaped detection heuristic ──────────────────────────────────────────

/**
 * Heuristic for a "raw phone-shaped" substring.
 *
 * Goal: catch plaintext dialable numbers (E.164 and common formats) WITHOUT
 * rejecting ordinary identifiers, UUIDs, or salted hashes.
 *
 * Definition used here — a phone-shaped run is:
 *   - an optional leading `+` (international form), then
 *   - a sequence of digit groups separated only by phone-style separators
 *     (space, dash, dot, or parentheses), where
 *   - the total count of dialable DIGITS in the run is between 7 and 15.
 *
 * Rationale for the bounds:
 *   - **≥ 7 digits**: the shortest dialable subscriber numbers are ~7 digits;
 *     requiring a 7+ run avoids flagging short numeric fields (ages, counts,
 *     quantities, 4–6 digit codes).
 *   - **≤ 15 digits**: E.164 caps the dialable length at 15. A run longer than
 *     15 contiguous digits is not a phone number — it is an id, timestamp, or
 *     a hash, so it is NOT flagged.
 *
 * Why hashes/UUIDs pass — the letter-adjacency rule:
 *   - A real raw phone number in content/payload is delimited by whitespace,
 *     punctuation, or a string boundary — NEVER by an adjacent ASCII letter. A
 *     digit run that touches an ASCII letter (a–z / A–Z) on EITHER side is part
 *     of an identifier, hash, or token, not a phone number, so it is NOT
 *     flagged. A salted SHA-256 `phone_hash` is 64 hex chars; any 7–15 digit
 *     sub-run inside it is bounded by a hex letter (a–f) on at least one side
 *     (and if it sits at the very start/end of the digest, the inner side is
 *     still a hex letter), so the whole class of hashes passes. UUIDs are
 *     likewise letter-bounded on their hex groups.
 *
 * The regex matches a candidate run, after which {@link findPhoneShaped} counts
 * the bare digits to apply the 7–15 bound precisely (the regex alone cannot
 * count digits across separators) and applies the letter-adjacency rule.
 */
const PHONE_CANDIDATE_RE =
  /\+?\d(?:[\d\s().-]{5,18})\d/g;

/** A 16+ digit contiguous run — too long to be an E.164 phone (id/hash/timestamp). */
const LONG_DIGIT_RUN_RE = /\d{16,}/;

/** Count only the dialable digits in a candidate run. */
function digitCount(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 48 && c <= 57) n++;
  }
  return n;
}

/**
 * Whether `value` contains a raw phone-shaped substring. Exported so callers and
 * tests can probe a string without throwing.
 *
 * A string is phone-shaped when it contains a `+`/separator-delimited run whose
 * dialable digit count is in `[7, 15]`, AND that run is not part of a longer
 * 16+ contiguous digit sequence (which would be an id/hash/timestamp).
 */
export function isPhoneShaped(value: string): boolean {
  return findPhoneShaped(value) !== null;
}

/**
 * Return the first phone-shaped substring in `value`, or `null` if none.
 * Used by the guard to surface the offending match in {@link RawPhoneError}.
 */
export function findPhoneShaped(value: string): string | null {
  // Reset lastIndex — the regex is /g and stateful across calls.
  PHONE_CANDIDATE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PHONE_CANDIDATE_RE.exec(value)) !== null) {
    const candidate = m[0];
    const digits = digitCount(candidate);
    if (digits < 7 || digits > 15) continue;

    const start = m.index;
    const end = start + candidate.length;

    // Letter-adjacency rule: a genuine raw phone is delimited by whitespace,
    // phone-style punctuation, or a string boundary — never by an adjacent
    // ASCII letter. A digit run that belongs to an identifier/hash/UUID touches
    // an ASCII letter (a–z / A–Z) somewhere on its token boundary.
    //
    // To classify correctly we expand past the matched candidate over the
    // "numeric-token" separators that appear INSIDE identifiers and UUIDs —
    // dashes and dots — but NOT whitespace (a space is a hard word boundary in
    // free text, so expanding over it would wrongly swallow neighbouring words).
    // We then look at the single character bounding that expanded token on each
    // side: if EITHER is an ASCII letter, the run is part of a hex digest or a
    // UUID (e.g. `…e07dbf33a…`, or a UUID's `…-1234-5678-aa…` whose dash-joined
    // groups always reach a hex letter), so it is NOT a phone — skip it.
    let lo = start;
    while (lo > 0 && isNumericTokenChar(value.charCodeAt(lo - 1))) lo--;
    let hi = end;
    while (hi < value.length && isNumericTokenChar(value.charCodeAt(hi))) hi++;
    if (lo > 0 && isAsciiLetter(value.charCodeAt(lo - 1))) continue;
    if (hi < value.length && isAsciiLetter(value.charCodeAt(hi))) continue;

    // Reject candidates that are actually a slice of a much longer digit run
    // (ids, hashes, timestamps). Inspect the surrounding context: if the
    // candidate sits inside a 16+ contiguous-digit sequence, skip it.
    // Expand left/right over contiguous digits to measure the true run length.
    let left = start;
    while (left > 0 && isDigit(value.charCodeAt(left - 1))) left--;
    let right = end;
    while (right < value.length && isDigit(value.charCodeAt(right))) right++;
    const contiguous = value.slice(left, right);
    if (LONG_DIGIT_RUN_RE.test(contiguous)) continue;

    return candidate;
  }
  return null;
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

/** Whether `code` is an ASCII letter (a–z or A–Z). */
function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/**
 * Whether `code` is a "numeric-token" character — a digit, dash, or dot. These
 * are the separators that appear INSIDE identifiers, version strings, and UUID
 * hex groups (`a4dc9d33-3488-…`), so we expand over them to find a token's true
 * boundaries. Whitespace, `+`, and parentheses are deliberately excluded: in
 * free text a space is a hard word boundary, so expanding over it would wrongly
 * merge a phone with adjacent prose words.
 */
function isNumericTokenChar(code: number): boolean {
  return isDigit(code) || code === 45 /* - */ || code === 46 /* . */;
}

// ── The write guard ───────────────────────────────────────────────────────────

/**
 * Reject any value bound for a protected store that contains a raw phone-shaped
 * string. Walks strings, arrays, and plain objects recursively; numbers, the
 * key names of objects, and non-string leaves are ignored (a raw phone reaching
 * a protected store always arrives as a string or nested within one).
 *
 * Callers — the `party_identities`, event-payload, audit, sync-ledger, and note
 * content writers — invoke this BEFORE persisting. On a violation it throws
 * {@link RawPhoneError}; the caller must then reject the write, NOT persist, and
 * record a privacy-violation indication (Req 7.5, 14.7).
 *
 * @throws {RawPhoneError} when a raw phone-shaped substring is detected.
 */
export function assertNoRawPhone(value: unknown): void {
  walk(value, "<root>", new Set());
}

function walk(value: unknown, path: string, seen: Set<object>): void {
  if (value === null || value === undefined) return;

  if (typeof value === "string") {
    const match = findPhoneShaped(value);
    if (match !== null) throw new RawPhoneError(path, match);
    return;
  }

  // Numbers/booleans/bigint/symbol cannot carry separator-formatted phones; a
  // bare numeric phone would have been a string in any JSON/DB payload. (A
  // JS number large enough to be a phone also loses leading `+`/zeros, so it is
  // not a "raw phone" in the regulated sense.)
  if (typeof value !== "object") return;

  // Guard against cycles.
  if (seen.has(value as object)) return;
  seen.add(value as object);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      walk(value[i], `${path}[${i}]`, seen);
    }
    return;
  }

  // Date / RegExp / other non-plain objects: nothing string-like to inspect.
  if (value instanceof Date || value instanceof RegExp) return;

  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    walk(v, path === "<root>" ? k : `${path}.${k}`, seen);
  }
}

// ── Delivered-outbox phone purge ──────────────────────────────────────────────

/** Field keys in an outbox payload that may carry a raw phone number. */
const PHONE_FIELD_KEYS = ["phone", "mobile", "mobilePhone", "phoneNumber", "homePhone", "otherPhone"];

/** 24 hours in milliseconds — the retention bound for raw phone post-delivery (Req 7.6). */
const PURGE_AFTER_MS = 24 * 60 * 60 * 1000;

/** Result of a purge sweep, for logging/observability. */
export interface PurgeResult {
  /** Number of `sf_outbox` rows whose payload was scrubbed of phone field(s). */
  purged: number;
  /** Number of eligible delivered rows inspected. */
  scanned: number;
}

/**
 * Clear raw phone field(s) from delivered `sf_outbox` payloads older than 24h.
 *
 * Selects rows with `status = 'sent'` whose `updatedAt` (the delivery
 * confirmation timestamp set by the drainer) is more than 24h before `now`, and
 * removes only the known phone field(s) from each JSON payload — every other
 * field is left intact (Req 7.6). Idempotent: a row already scrubbed has no
 * phone field to remove and is skipped, so re-running the sweep is a no-op.
 *
 * This is a self-contained sweep that queries `sf_outbox` directly; it does not
 * touch the drainer.
 *
 * @param db  Drizzle database handle.
 * @param now Override for the current time (tests); defaults to `new Date()`.
 */
export async function purgeDeliveredOutboxPhones(
  db: Database,
  now: Date = new Date()
): Promise<PurgeResult> {
  const cutoff = new Date(now.getTime() - PURGE_AFTER_MS);

  const rows = await db
    .select({ id: sfOutbox.id, payload: sfOutbox.payload })
    .from(sfOutbox)
    .where(and(eq(sfOutbox.status, "sent"), lt(sfOutbox.updatedAt, cutoff)));

  let purged = 0;
  for (const row of rows) {
    const scrubbed = stripPhoneFields(row.payload);
    if (scrubbed === null) continue; // nothing to remove — already clean

    await db
      .update(sfOutbox)
      .set({ payload: scrubbed })
      .where(eq(sfOutbox.id, row.id));
    purged++;
  }

  return { purged, scanned: rows.length };
}

/**
 * Return a deep-cloned payload with any phone field(s) removed, or `null` when
 * the payload carried no phone field (so the caller can skip the write).
 *
 * Removes the keys in {@link PHONE_FIELD_KEYS} wherever they appear in the
 * object tree (top-level or nested, e.g. `contact.phone`), leaving all other
 * fields untouched.
 */
function stripPhoneFields(payload: unknown): unknown | null {
  let removed = false;

  const clone = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(clone);
    if (value !== null && typeof value === "object" && !(value instanceof Date)) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (PHONE_FIELD_KEYS.includes(k)) {
          removed = true;
          continue; // drop the phone field
        }
        out[k] = clone(v);
      }
      return out;
    }
    return value;
  };

  const result = clone(payload);
  return removed ? result : null;
}
