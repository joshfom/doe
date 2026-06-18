/**
 * Dedupe — lead lookup against the DOE party graph (design §2; Requirements 2, 3).
 *
 * `resolveLeadByMatchKeys` answers "does this inbound contact already exist as a
 * Party (and Salesforce Lead)?" using ONLY exact identity matches, evaluated in
 * the order `phone_hash → email → sf_lead_id`. It is deliberately conservative:
 *
 *   - A phone is matched ONLY via its salted `phone_hash` (`computePhoneHash`),
 *     never against a raw number (Req 2.1, CC-Privacy).
 *   - Keys are evaluated in priority order and the FIRST key that resolves to a
 *     Party wins and short-circuits (Req 2.2).
 *   - When distinct keys resolve to two or more different Parties, the lookup
 *     reports a `conflict` and merges nothing — the candidates are surfaced for
 *     human resolution (Req 3.1, 3.4).
 *   - When nothing matches, the lookup reports `new` and creates NO Party as a
 *     side effect (Req 2.5). Party / `leads_mirror` creation is an explicit
 *     `upsertLead()` step the caller performs later (see task 3.2).
 *   - Empty input / invalid phone / invalid email each return a typed `error`
 *     result and attempt no match (Req 2.9, 2.10, 2.11).
 *
 * The lookup itself is read-only and idempotent: the same input over unchanged
 * data returns the same result every time (Req 2.6).
 *
 * The mutating link helpers (`linkIdentities`, `linkSfLeadId`, `upsertLead`)
 * are implemented separately in task 3.2 and append to this same module.
 */

import { and, eq } from "drizzle-orm";

import type { Database } from "../../db";
import { leadsMirror, parties, partyIdentities } from "../../schema";
import { computePhoneHash, normalizePhoneToE164 } from "../../voice/identity";

// ── Public contract ────────────────────────────────────────────────────────────

/** A set of Match_Keys to resolve a contact against the party graph. */
export interface MatchInput {
  /** Free-form phone; normalized to E.164 then hashed before matching. */
  phone?: string;
  /** Email; normalized to lower-case + trimmed before matching. */
  email?: string;
  /** A Salesforce Lead id to match directly against a linked identity. */
  sfLeadId?: string;
}

/** The kind discriminator of a Match_Key, in dedupe priority order. */
export type MatchKeyKind = "phone_hash" | "email" | "sf_lead_id";

/** A normalized Match_Key ready for an exact lookup against `party_identities`. */
export interface MatchKey {
  kind: MatchKeyKind;
  value: string;
}

/** The outcome of a dedupe lookup. */
export type DedupeResult =
  | { kind: "match"; partyId: string; sfLeadId: string | null }
  | { kind: "new" }
  | { kind: "conflict"; candidatePartyIds: string[] }
  | {
      kind: "error";
      code: "empty_input" | "invalid_phone" | "invalid_email";
      message: string;
    };

/**
 * Resolve a contact to an existing Party using ONLY exact identity matches,
 * evaluated `phone_hash → email → sf_lead_id` (Req 2.2). First match wins and
 * short-circuits. Conservative: never merges on name similarity, and distinct
 * keys resolving to different Parties yield a `conflict` (Req 3.1, 3.4).
 *
 * Read-only: creates no Party (Req 2.5) and is idempotent over unchanged data
 * (Req 2.6).
 */
export async function resolveLeadByMatchKeys(
  db: Database,
  input: MatchInput
): Promise<DedupeResult> {
  const keys: MatchKey[] = [];

  // phone → E.164 → salted hash (never the raw number — Req 2.1, CC-Privacy).
  if (input.phone !== undefined) {
    let e164: string;
    try {
      e164 = normalizePhoneToE164(input.phone);
    } catch {
      return {
        kind: "error",
        code: "invalid_phone",
        message: `phone input cannot be normalized to E.164: "${input.phone}"`,
      }; // Req 2.10 — no phone-based match attempted
    }
    keys.push({ kind: "phone_hash", value: computePhoneHash(e164) });
  }

  // email → normalized (lower-case + trimmed — Req 3.5).
  if (input.email !== undefined) {
    const normalized = normalizeEmail(input.email);
    if (!isEmail(normalized)) {
      return {
        kind: "error",
        code: "invalid_email",
        message: `email input is not a valid address: "${input.email}"`,
      }; // Req 2.11 — no email-based match attempted
    }
    keys.push({ kind: "email", value: normalized });
  }

  // sf_lead_id → matched verbatim.
  if (input.sfLeadId !== undefined) {
    keys.push({ kind: "sf_lead_id", value: input.sfLeadId });
  }

  if (keys.length === 0) {
    return {
      kind: "error",
      code: "empty_input",
      message: "no phone, email, or sfLeadId supplied",
    }; // Req 2.9 — do NOT report `new`
  }

  // Resolve every key → its Party (exact match on the (kind,value) index).
  const hits = await partiesForKeys(db, keys);

  // Distinct keys → two or more different Parties → conflict, no auto-merge.
  const distinct = new Set(
    [...hits.values()].filter((id): id is string => id !== null)
  );
  if (distinct.size >= 2) {
    return { kind: "conflict", candidatePartyIds: [...distinct] }; // Req 3.4
  }

  // First match wins, in priority order (Req 2.2).
  for (const key of keys) {
    const partyId = hits.get(keyId(key));
    if (partyId) {
      const sfLeadId = await sfLeadIdForParty(db, partyId); // Req 2.3 / 2.4
      return { kind: "match", partyId, sfLeadId };
    }
  }

  return { kind: "new" }; // Req 2.5 — no Party created here
}

// ── Private lookup helpers ──────────────────────────────────────────────────────

/** Stable map key for a Match_Key — `${kind}:${value}`. */
function keyId(key: MatchKey): string {
  return `${key.kind}:${key.value}`;
}

/** Normalize an email for matching: lower-cased with surrounding whitespace removed (Req 3.5). */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Validate a (already-normalized) email address. Conservative single-`@` check
 * with non-empty local part and a dotted domain — enough to reject obviously
 * malformed input without over-rejecting valid addresses.
 */
function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Resolve each Match_Key to its Party id via an exact `(kind, value)` lookup on
 * `party_identities`. Returns a Map keyed by {@link keyId}; an unmatched key maps
 * to `null`. Pure read — never mutates.
 */
async function partiesForKeys(
  db: Database,
  keys: MatchKey[]
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();

  for (const key of keys) {
    const [row] = await db
      .select({ partyId: partyIdentities.partyId })
      .from(partyIdentities)
      .where(
        and(
          eq(partyIdentities.kind, key.kind),
          eq(partyIdentities.value, key.value)
        )
      )
      .limit(1);

    result.set(keyId(key), row?.partyId ?? null);
  }

  return result;
}

/**
 * Return the Salesforce Lead id linked to a Party via its `leads_mirror` row, or
 * `null` when the Party has no mirror row or no linked `sf_lead_id` (Req 2.3, 2.4).
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

// ── Mutating link helpers (task 3.2) ─────────────────────────────────────────
//
// These are the WRITE counterparts to the read-only `resolveLeadByMatchKeys`
// lookup above. The lookup deliberately creates nothing; once a caller (the
// Object_Router or Inbound_Sync) has a `match`/`new` result, it performs the
// explicit linkage and Lead creation with the helpers below:
//
//   - `linkIdentities`  — attach a set of identities to a Party idempotently
//                         (Req 2.7). `party_identities` has only a NON-unique
//                         index on `(kind, value)`, so idempotency is enforced
//                         here by an existence check before insert (mirrors the
//                         existing `linkIdentity` helper in `voice/identity.ts`).
//   - `linkSfLeadId`    — record a known Salesforce Lead id as BOTH a
//                         `party_identities` row of kind `sf_lead_id` AND
//                         `leads_mirror.sf_lead_id` for that Party (Req 2.8).
//   - `upsertLead`      — the explicit Party / `leads_mirror` creation/update
//                         step the caller runs after a `new`/`match` result.

/**
 * Fields a caller may set on the `leads_mirror` row through {@link upsertLead}.
 * `partyId` is supplied separately (it is the mirror's primary key) and
 * `sfLeadId` is handled through {@link linkSfLeadId} so the identity row stays
 * in lock-step with the mirror.
 */
export type LeadMirrorFields = Partial<
  Omit<typeof leadsMirror.$inferInsert, "partyId" | "sfLeadId">
>;

/** Party fields applied only when {@link upsertLead} creates a NEW Party. */
export interface UpsertLeadPartyFields {
  type?: "person" | "org";
  name?: string;
  language?: "en" | "ar";
  /** Stamps `parties.consentAt` with the current time when true. */
  consent?: boolean;
  /** Marks the created Party as demo-scoped (reset safety). */
  demo?: boolean;
}

/** Input to {@link upsertLead}. */
export interface UpsertLeadInput {
  /**
   * When set, upsert against this existing Party (the caller had a `match`);
   * when omitted, a NEW Party is created (the caller had a `new`).
   */
  partyId?: string;
  /** Party column values applied only when a new Party is created. */
  party?: UpsertLeadPartyFields;
  /** Identities to link onto the Party idempotently (Req 2.7). */
  identities?: MatchKey[];
  /**
   * A known Salesforce Lead id; recorded on BOTH `party_identities` and
   * `leads_mirror.sf_lead_id` for the Party (Req 2.8).
   */
  sfLeadId?: string;
  /** Additional `leads_mirror` fields to upsert. */
  mirror?: LeadMirrorFields;
}

/** Result of {@link upsertLead}. */
export interface UpsertLeadResult {
  /** The Party id the Lead is keyed by (matched or freshly created). */
  partyId: string;
  /** True when a new Party row was created; false when an existing one matched. */
  created: boolean;
}

/**
 * Link a set of identities to a Party idempotently (Req 2.7).
 *
 * For each Match_Key, a `party_identities` row is inserted only when no row with
 * the same `(party_id, kind, value)` already exists, so re-resolving the same
 * contact adds NO duplicate Party_Identity row for an identity value already
 * linked to that Party. Safe to call repeatedly.
 */
export async function linkIdentities(
  db: Database,
  partyId: string,
  keys: MatchKey[]
): Promise<void> {
  for (const key of keys) {
    const [existing] = await db
      .select({ id: partyIdentities.id })
      .from(partyIdentities)
      .where(
        and(
          eq(partyIdentities.partyId, partyId),
          eq(partyIdentities.kind, key.kind),
          eq(partyIdentities.value, key.value)
        )
      )
      .limit(1);

    if (existing) continue; // already linked — no duplicate row (Req 2.7)

    await db
      .insert(partyIdentities)
      .values({ partyId, kind: key.kind, value: key.value });
  }
}

/**
 * Record a known Salesforce Lead id for a Party in BOTH places (Req 2.8):
 *
 *   1. a `party_identities` row of kind `sf_lead_id` (idempotently — reuses
 *      {@link linkIdentities}), and
 *   2. `leads_mirror.sf_lead_id` for that Party (upserting the mirror row,
 *      keyed by the `party_id` primary key).
 *
 * Idempotent: calling it again with the same id adds no duplicate identity row
 * and leaves the mirror's `sf_lead_id` unchanged.
 */
export async function linkSfLeadId(
  db: Database,
  partyId: string,
  sfLeadId: string
): Promise<void> {
  // 1) party_identities row of kind sf_lead_id (idempotent).
  await linkIdentities(db, partyId, [{ kind: "sf_lead_id", value: sfLeadId }]);

  // 2) leads_mirror.sf_lead_id — upsert keyed by the party_id PK.
  const updatedAt = new Date();
  await db
    .insert(leadsMirror)
    .values({ partyId, sfLeadId, updatedAt })
    .onConflictDoUpdate({
      target: leadsMirror.partyId,
      set: { sfLeadId, updatedAt },
    });
}

/**
 * Explicit Party / `leads_mirror` creation step the caller performs after a
 * `new`/`match` dedupe result.
 *
 *   - `match` (caller passes `partyId`): the existing Party is reused and its
 *     `leads_mirror` row is upserted.
 *   - `new` (no `partyId`): a new Party is created from `party`, then its
 *     `leads_mirror` row is created.
 *
 * Any supplied `identities` are linked idempotently (Req 2.7) and, when a
 * `sfLeadId` is given, it is recorded on both `party_identities` and
 * `leads_mirror` via {@link linkSfLeadId} (Req 2.8).
 */
export async function upsertLead(
  db: Database,
  input: UpsertLeadInput
): Promise<UpsertLeadResult> {
  let partyId = input.partyId;
  let created = false;

  // `new` → create the Party (the lookup never does this — Req 2.5).
  if (!partyId) {
    const [row] = await db
      .insert(parties)
      .values({
        type: input.party?.type ?? "person",
        name: input.party?.name,
        language: input.party?.language ?? "en",
        consentAt: input.party?.consent ? new Date() : undefined,
        demo: input.party?.demo ?? false,
      })
      .returning({ id: parties.id });

    partyId = row.id;
    created = true;
  }

  // Link the supplied identities idempotently (Req 2.7).
  if (input.identities && input.identities.length > 0) {
    await linkIdentities(db, partyId, input.identities);
  }

  // Upsert the leads_mirror row keyed by the party_id PK.
  const updatedAt = new Date();
  const mirrorSet: Partial<typeof leadsMirror.$inferInsert> = {
    ...input.mirror,
    updatedAt,
  };
  if (input.sfLeadId !== undefined) mirrorSet.sfLeadId = input.sfLeadId;

  await db
    .insert(leadsMirror)
    .values({ partyId, ...mirrorSet })
    .onConflictDoUpdate({ target: leadsMirror.partyId, set: mirrorSet });

  // Record the Salesforce Lead id on both stores (Req 2.8). The mirror upsert
  // above already set sf_lead_id; this also lays down the identity row.
  if (input.sfLeadId !== undefined) {
    await linkIdentities(db, partyId, [
      { kind: "sf_lead_id", value: input.sfLeadId },
    ]);
  }

  return { partyId, created };
}
