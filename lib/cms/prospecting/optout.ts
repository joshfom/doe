/**
 * Prospecting Workspace (S7) — opt-out / do-not-contact store (Design §Components
 * #7; Requirement 7.3).
 *
 * Before any outreach is sent, `send_outreach` consults this store and refuses to
 * send to an opted-out Target (Req 7.3). Opt-outs are matched on the same
 * privacy-preserving identity space the party graph uses (CC-Privacy):
 *
 *   - an **email** is matched as normalized plaintext (lower-cased + trimmed),
 *     stored under `match_kind = "email"`; and
 *   - a **phone** is matched only via its salted `phone_hash`, stored under
 *     `match_kind = "phone_hash"` — a raw phone never reaches this table.
 *
 * The `prospect_optouts` table carries a unique index on `(match_kind,
 * match_value)`, so recording an opt-out is idempotent and matching is an exact
 * lookup. `recordOptout` upserts; `removeOptout` deletes; `isOptedOut` returns
 * true when ANY supplied key matches a stored opt-out.
 *
 * NOTE on the key names: the design signature names the email key `emailHash`
 * for symmetry with `phoneHash`, but an email opt-out is stored as a NORMALIZED
 * EMAIL (not a hash) under `match_kind = "email"`; this module normalizes the
 * supplied email before matching. The phone key is an already-computed
 * `phone_hash` (see `computePhoneHash` in `voice/identity.ts`).
 */

import { and, eq, or, type SQL } from "drizzle-orm";

import type { Database } from "../db";
import { prospectOptouts } from "../schema";

// ── Public contract ──────────────────────────────────────────────────────────

/**
 * The identity keys an opt-out is matched on. At least one should be supplied;
 * an empty set matches nothing.
 *
 *   - `emailHash` — an email address; normalized (lower-cased + trimmed) before
 *     matching against `match_kind = "email"`.
 *   - `phoneHash` — a salted phone hash, matched against `match_kind =
 *     "phone_hash"`.
 */
export interface OptoutKeys {
  emailHash?: string;
  phoneHash?: string;
}

/** The kind discriminator of a stored opt-out match value. */
type OptoutMatchKind = "email" | "phone_hash";

/** A normalized `(match_kind, match_value)` pair ready for an exact lookup. */
interface OptoutMatch {
  matchKind: OptoutMatchKind;
  matchValue: string;
}

/**
 * Return true when ANY supplied key matches a stored opt-out (Req 7.3).
 *
 * Read-only and idempotent: the same keys over unchanged data return the same
 * answer every time. An empty / fully-blank key set matches nothing and returns
 * false (no opt-out can be asserted without an identity to match on).
 */
export async function isOptedOut(
  db: Database,
  keys: OptoutKeys
): Promise<boolean> {
  const matches = toMatches(keys);
  if (matches.length === 0) return false;

  const [row] = await db
    .select({ id: prospectOptouts.id })
    .from(prospectOptouts)
    .where(matchesWhere(matches))
    .limit(1);

  return row !== undefined;
}

/**
 * Record an opt-out for every supplied key, idempotently (Req 7.3).
 *
 * Upserts by the `(match_kind, match_value)` unique index, so recording the same
 * opt-out twice adds no duplicate row; a later call refreshes the stored
 * `reason` when one is supplied.
 */
export async function recordOptout(
  db: Database,
  keys: OptoutKeys,
  reason?: string
): Promise<void> {
  const matches = toMatches(keys);
  if (matches.length === 0) return;

  for (const m of matches) {
    const insert = db
      .insert(prospectOptouts)
      .values({ matchKind: m.matchKind, matchValue: m.matchValue, reason });

    if (reason !== undefined) {
      // A new reason was supplied — refresh it on an existing row.
      await insert.onConflictDoUpdate({
        target: [prospectOptouts.matchKind, prospectOptouts.matchValue],
        set: { reason },
      });
    } else {
      // No reason supplied — keep any existing row (and its reason) untouched.
      await insert.onConflictDoNothing({
        target: [prospectOptouts.matchKind, prospectOptouts.matchValue],
      });
    }
  }
}

/**
 * Remove the opt-out(s) for every supplied key.
 *
 * Idempotent: removing an opt-out that does not exist is a no-op. With no
 * supplied keys this does nothing (it never clears the whole table).
 */
export async function removeOptout(
  db: Database,
  keys: OptoutKeys
): Promise<void> {
  const matches = toMatches(keys);
  if (matches.length === 0) return;

  await db.delete(prospectOptouts).where(matchesWhere(matches));
}

// ── Private helpers ────────────────────────────────────────────────────────────

/**
 * Normalize the supplied keys into the `(match_kind, match_value)` pairs stored
 * in `prospect_optouts`. Blank values are dropped. An email is normalized to
 * lower-case + trimmed; a phone hash is used verbatim.
 */
function toMatches(keys: OptoutKeys): OptoutMatch[] {
  const matches: OptoutMatch[] = [];

  if (keys.emailHash !== undefined) {
    const email = normalizeEmail(keys.emailHash);
    if (email.length > 0) matches.push({ matchKind: "email", matchValue: email });
  }

  if (keys.phoneHash !== undefined) {
    const hash = keys.phoneHash.trim();
    if (hash.length > 0)
      matches.push({ matchKind: "phone_hash", matchValue: hash });
  }

  return matches;
}

/** Build a WHERE clause matching any of the supplied `(kind, value)` pairs. */
function matchesWhere(matches: OptoutMatch[]): SQL | undefined {
  const conditions = matches.map((m) =>
    and(
      eq(prospectOptouts.matchKind, m.matchKind),
      eq(prospectOptouts.matchValue, m.matchValue)
    )
  );

  return conditions.length === 1 ? conditions[0] : or(...conditions);
}

/** Normalize an email for matching: lower-cased with surrounding whitespace removed. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
