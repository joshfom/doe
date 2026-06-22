/**
 * DOE Voice Surface — phone normalization, salted hashing, and party identity
 * resolution.
 *
 * This module augments the existing identity machinery in
 * {@link file://../ai/identity.ts} with the new `parties` / `party_identities`
 * graph (design §6 mapping, §9.3). The voice session service uses it to turn a
 * caller's pre-call form (E.164 phone + email + optional name) into a resolved
 * `partyId` at "ring time":
 *
 *   1. Normalise the phone to E.164 (UAE / +971 default region).
 *   2. Compute a salted SHA-256 `phone_hash` from `PHONE_HASH_SALT`.
 *   3. Upsert a party — match on `phone_hash` first, else email, else create.
 *   4. Idempotently link the supplied identities into `party_identities`.
 *
 * PRIVACY (Requirement 14.5 / Property 9): `party_identities` stores ONLY the
 * salted `phone_hash` for a phone — never the raw E.164 number. The raw number
 * is never persisted outside demo persona rows. Email is stored as-is (it is
 * not a regulated phone number) but normalised to lower-case for matching.
 *
 * Design references: §6 mapping (Party upsert + identity link reuses
 * `resolveIdentityByPhone/Email/Session`), §9.3 (schema).
 * Requirements: 3.2 (normalise + hash), 3.3 (upsert + link), 14.5 (privacy).
 */

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";

import type { Database } from "../db";
import { parties, partyIdentities } from "../schema";
import { resolveIdentityByEmail } from "../ai/identity";
import type { Language } from "./contracts";

// ── Phone normalization ───────────────────────────────────────────────────────

/** Default country dialing code applied to local numbers (UAE / +971). */
export const DEFAULT_COUNTRY_CODE = "971";

export interface NormalizePhoneOptions {
  /**
   * Country dialing code (digits only, no `+`) applied to a local/national
   * number that carries no explicit country code. Defaults to UAE (`971`).
   */
  defaultCountryCode?: string;
}

/**
 * Normalise a free-form phone string to E.164 (`+` followed by 8–15 digits).
 *
 * Behaviour:
 *   - Strips spaces, dashes, parentheses, and dots.
 *   - A leading `+` (or `00` international prefix) is treated as an explicit
 *     country code and kept verbatim.
 *   - A leading `0` is a national trunk prefix: it is dropped and the default
 *     country code is prepended.
 *   - Bare digits with no `+`/`0` prefix are assumed local and get the default
 *     country code prepended.
 *
 * @throws if the input contains no usable digits or the result is not a
 *   plausible E.164 number (8–15 digits).
 */
export function normalizePhoneToE164(
  input: string,
  options: NormalizePhoneOptions = {}
): string {
  const defaultCountryCode = options.defaultCountryCode ?? DEFAULT_COUNTRY_CODE;

  const trimmed = (input ?? "").trim();
  if (trimmed.length === 0) {
    throw new Error("Cannot normalise an empty phone number");
  }

  // Detect an explicit international prefix before stripping punctuation.
  const hasPlus = trimmed.startsWith("+");
  const compact = trimmed.replace(/[^\d+]/g, "");
  // Digits only (drops any embedded `+`).
  let digits = compact.replace(/\D/g, "");

  if (digits.length === 0) {
    throw new Error(`Phone number has no digits: "${input}"`);
  }

  let e164Digits: string;
  if (hasPlus) {
    // Already an explicit country code, e.g. "+971 50 …".
    e164Digits = digits;
  } else if (digits.startsWith("00")) {
    // International access code form, e.g. "0097150…".
    e164Digits = digits.slice(2);
  } else if (digits.startsWith("0")) {
    // National trunk prefix, e.g. "050…" → strip the 0 and add country code.
    e164Digits = `${defaultCountryCode}${digits.replace(/^0+/, "")}`;
  } else if (digits.startsWith(defaultCountryCode)) {
    // Bare digits that already include the country code, e.g. "97150…".
    e164Digits = digits;
  } else {
    // Bare local number with no country code, e.g. "50…".
    e164Digits = `${defaultCountryCode}${digits}`;
  }

  if (e164Digits.length < 8 || e164Digits.length > 15) {
    throw new Error(
      `Normalised phone "${input}" is not a valid E.164 number (got +${e164Digits})`
    );
  }

  return `+${e164Digits}`;
}

// ── Salted phone hashing ───────────────────────────────────────────────────────

/**
 * Read the phone-hash salt from the environment.
 *
 * `PHONE_HASH_SALT` MUST be set in every environment that resolves callers; it
 * is the secret that makes the stored `phone_hash` values non-reversible. There
 * is intentionally no default — a missing salt is a configuration error.
 *
 * @throws if `PHONE_HASH_SALT` is unset or empty.
 */
export function getPhoneHashSalt(): string {
  const salt = process.env.PHONE_HASH_SALT;
  if (!salt || salt.trim().length === 0) {
    throw new Error(
      "PHONE_HASH_SALT is not set. It must be configured to hash caller phone numbers."
    );
  }
  return salt;
}

/**
 * Compute the salted SHA-256 `phone_hash` for a normalised E.164 number.
 *
 * The hash input is `${salt}:${e164}`, matching the convention used by the
 * realtime event-bus property test. The salt defaults to `PHONE_HASH_SALT`
 * (via {@link getPhoneHashSalt}) but may be supplied explicitly for tests.
 *
 * @param e164 A normalised E.164 phone number (see {@link normalizePhoneToE164}).
 * @param salt Optional explicit salt; defaults to the `PHONE_HASH_SALT` env var.
 */
export function computePhoneHash(e164: string, salt: string = getPhoneHashSalt()): string {
  return createHash("sha256").update(`${salt}:${e164}`).digest("hex");
}

// ── Party identity resolution ──────────────────────────────────────────────────

/** Normalise an email for consistent identity matching/storage. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface ResolvePartyInput {
  /**
   * Normalised E.164 phone number (will be hashed, never stored raw). Optional:
   * a staff "talk to your twin" connect has no phone, so resolution falls back
   * to email-only matching and no `phone_hash` identity is linked.
   */
  e164?: string;
  /** Caller email (matched/stored lower-cased). */
  email: string;
  /** Optional caller name; set on a newly-created party. */
  name?: string;
  /** Caller language; defaults to "en" on a newly-created party. */
  language?: Language;
  /** Whether the caller gave timestamped consent (stamps `parties.consentAt`). */
  consent?: boolean;
  /** Marks created rows as demo-scoped (Property 10 reset safety). */
  demo?: boolean;
  /** Optional explicit salt for the phone hash (tests); defaults to env. */
  salt?: string;
}

export interface ResolvePartyResult {
  /** The resolved (matched or freshly created) party id. */
  partyId: string;
  /** True when an existing party matched on phone_hash or email. */
  known: boolean;
  /**
   * The salted phone hash that was matched/linked, or `null` for an email-only
   * (staff, no-phone) resolution where no phone identity exists.
   */
  phoneHash: string | null;
}

/**
 * Look up a single party id by an identity (kind + value) pair.
 */
async function findPartyIdByIdentity(
  db: Database,
  kind: "phone_hash" | "email",
  value: string
): Promise<string | null> {
  const [row] = await db
    .select({ partyId: partyIdentities.partyId })
    .from(partyIdentities)
    .where(and(eq(partyIdentities.kind, kind), eq(partyIdentities.value, value)))
    .limit(1);
  return row?.partyId ?? null;
}

/**
 * Idempotently ensure a `party_identities` row exists for `(partyId, kind,
 * value)`. Does nothing when the mapping already exists, so re-resolving the
 * same caller never duplicates identity rows.
 */
async function linkIdentity(
  db: Database,
  partyId: string,
  kind: "phone_hash" | "email",
  value: string
): Promise<void> {
  const [existing] = await db
    .select({ id: partyIdentities.id })
    .from(partyIdentities)
    .where(
      and(
        eq(partyIdentities.partyId, partyId),
        eq(partyIdentities.kind, kind),
        eq(partyIdentities.value, value)
      )
    )
    .limit(1);

  if (existing) return;

  await db.insert(partyIdentities).values({ partyId, kind, value });
}

/**
 * Resolve (or create) the party for a caller and link their identities.
 *
 * Resolution order (design §6 mapping, Requirement 3.3):
 *   1. Match an existing party by salted `phone_hash`.
 *   2. Else match by email.
 *   3. Else create a new party (soft-linking to an existing `aiClients` /
 *      `aiTenants` record by email when one exists — reusing
 *      `resolveIdentityByEmail` from `lib/cms/ai/identity.ts`).
 *
 * The supplied phone (as `phone_hash`) and email are then linked idempotently
 * into `party_identities`. The raw phone is never persisted (Requirement 14.5).
 */
export async function resolveParty(
  db: Database,
  input: ResolvePartyInput
): Promise<ResolvePartyResult> {
  // A staff connect has no phone — resolve by email only and link no phone_hash.
  const phoneHash = input.e164 ? computePhoneHash(input.e164, input.salt) : null;
  const email = normalizeEmail(input.email);

  // 1) Match on phone_hash (when a phone was supplied), 2) else email.
  let partyId = phoneHash
    ? await findPartyIdByIdentity(db, "phone_hash", phoneHash)
    : null;
  let known = partyId !== null;

  if (!partyId) {
    partyId = await findPartyIdByIdentity(db, "email", email);
    known = partyId !== null;
  }

  // 3) Else create a new party, soft-linking to an existing client/tenant by
  //    email when one is found (reuse of the existing identity machinery).
  if (!partyId) {
    let clientId: string | undefined;
    let tenantId: string | undefined;
    try {
      const identity = await resolveIdentityByEmail(db, email);
      if (identity.type === "client") clientId = identity.clientId;
      else if (identity.type === "tenant") tenantId = identity.tenantId;
    } catch {
      // Soft link only — a lookup failure must never block party creation.
    }

    const [created] = await db
      .insert(parties)
      .values({
        type: "person",
        name: input.name,
        language: input.language ?? "en",
        clientId,
        tenantId,
        consentAt: input.consent ? new Date() : undefined,
        demo: input.demo ?? false,
      })
      .returning({ id: parties.id });

    partyId = created.id;
    known = false;
  }

  // Link both identities idempotently (covers the case where a party matched on
  // one identity but the other is newly supplied). The phone_hash is only
  // linked when a phone was supplied (a staff connect links email only).
  if (phoneHash) {
    await linkIdentity(db, partyId, "phone_hash", phoneHash);
  }
  await linkIdentity(db, partyId, "email", email);

  return { partyId, known, phoneHash };
}
