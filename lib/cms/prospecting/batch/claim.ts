/**
 * Agentic Prospecting Batch — cross-rep claim mechanism
 * (Design §Components #3 "Cross-rep claim mechanism"; Requirement 6.2).
 *
 * Two reps must never cold-approach the same investor / prospect. A claim
 * records that a candidate's identity is being worked by exactly one rep at a
 * time. Claims live in `prospecting_target_claims`, keyed on the SAME
 * privacy-safe `(match_kind, match_value)` identity space the opt-out store
 * (`lib/cms/prospecting/optout.ts`) and the party graph
 * (`lib/cms/tickets/crm/dedupe.ts`) already use — this module introduces NO new
 * identity concept (CC-Reuse, CC-Privacy):
 *
 *   - an **email** is matched as normalized plaintext (lower-cased + trimmed),
 *     stored under `match_kind = "email"`; and
 *   - a **phone** is matched only via its salted `phone_hash` (a raw phone
 *     number never reaches this table), stored under `match_kind = "phone_hash"`.
 *
 * The same normalization primitives the dedupe / party graph use are reused
 * directly here (`normalizePhoneToE164` + `computePhoneHash` from
 * `lib/cms/voice/identity.ts`), and an email is normalized lower-case + trimmed
 * exactly as the opt-out store and dedupe lookup do — the SAME identity concept,
 * not a new one.
 *
 * Claiming is an `INSERT ... ON CONFLICT (match_kind, match_value) DO NOTHING`
 * over the table's unique `(match_kind, match_value)` index (mirroring the
 * `enqueueJob` idempotency pattern in `lib/cms/jobs/index.ts`):
 *
 *   - the insert succeeds → THIS rep now holds the claim → `held`;
 *   - the insert conflicts and the existing claim is owned by THIS rep (e.g. an
 *     idempotent re-run) → `held` (the claim is already ours);
 *   - the insert conflicts and the existing claim is owned by a DIFFERENT rep →
 *     `claimed_by_other_rep`.
 *
 * Because the candidate may carry more than one identity key (email AND phone),
 * a claim is attempted for EVERY supplied key. The candidate proceeds only when
 * every key is held by this rep; if ANY key is held by a different rep the
 * candidate is `claimed_by_other_rep` (a single colliding identity is enough for
 * a cross-rep collision). Keys successfully inserted before a collision are
 * rolled back (released) so a rejected claim never strands a half-held identity.
 *
 * `releaseClaim` deletes the claim rows for a candidate's identities, called
 * when a Queued_Item is rejected or suppressed (Req 4.4) so a freed prospect
 * becomes claimable again.
 */

import { and, eq, or, type SQL } from "drizzle-orm";

import type { Database } from "../../db";
import { prospectingTargetClaims } from "../../schema";
import {
  computePhoneHash,
  normalizePhoneToE164,
} from "../../voice/identity";

// ── Public contract ──────────────────────────────────────────────────────────

/**
 * The raw identity of a candidate to claim. Mirrors the fields a discovered
 * `ProviderResult` carries; at least one should be present (an empty identity
 * cannot be claimed and is treated as trivially `held`).
 *
 *   - `email` — normalized (lower-cased + trimmed) before matching against
 *     `match_kind = "email"`.
 *   - `phone` — a raw phone, normalized to E.164 then salted-hashed before
 *     matching against `match_kind = "phone_hash"`. The raw number is used
 *     transiently here only and is NEVER persisted (CC-Privacy).
 */
export interface ClaimIdentity {
  email?: string;
  phone?: string;
}

/** Who is claiming, and the bookkeeping linkage for the claim rows. */
export interface ClaimContext {
  /** The claiming rep (Batch_Run owner) — recorded as `owner_rep` (Req 6.2). */
  ownerRep: string;
  /** The Batch_Run the claim belongs to (cascade-deleted with the run). */
  batchRunId?: string;
  /** The Queued_Item the claim is bound to (cascade-deleted with the item). */
  queueItemId?: string;
}

/** The kind discriminator of a claim match value (the shared identity space). */
type ClaimMatchKind = "email" | "phone_hash";

/** A normalized `(match_kind, match_value)` pair ready for an exact claim. */
interface ClaimMatch {
  matchKind: ClaimMatchKind;
  matchValue: string;
}

/**
 * The outcome of a {@link claimTarget} attempt.
 *
 *   - `held` — every supplied identity key is now claimed by THIS rep (a fresh
 *     claim, or an idempotent re-claim of our own prior claim). The candidate
 *     may proceed.
 *   - `claimed_by_other_rep` — at least one identity key is already claimed by a
 *     DIFFERENT rep; the candidate is excluded from cold outreach (Req 6.2). The
 *     conflicting `owner_rep` is reported for the activity log.
 *   - `no_identity` — the candidate carried no usable identity key, so no claim
 *     could be recorded.
 */
export type ClaimResult =
  | { kind: "held"; keys: ClaimMatch[] }
  | { kind: "claimed_by_other_rep"; ownerRep: string }
  | { kind: "no_identity" };

/**
 * Attempt to claim a candidate's identity for a rep (Req 6.2).
 *
 * For every identity key the candidate carries, inserts a
 * `prospecting_target_claims` row with `ON CONFLICT (match_kind, match_value)
 * DO NOTHING`. A fresh insert means this rep now holds that key; a conflict is
 * resolved by reading the existing row's `owner_rep`:
 *
 *   - same rep → the key is already ours (idempotent re-run) → keep going;
 *   - different rep → `claimed_by_other_rep`, and any keys this call freshly
 *     inserted are released so no identity is left half-claimed.
 *
 * Returns `held` only when ALL supplied keys are held by this rep.
 */
export async function claimTarget(
  db: Database,
  identity: ClaimIdentity,
  ctx: ClaimContext
): Promise<ClaimResult> {
  const matches = toMatches(identity);
  if (matches.length === 0) return { kind: "no_identity" };

  // Keys this call freshly inserted — released on a cross-rep collision so a
  // rejected claim never strands a half-held identity.
  const freshlyInserted: ClaimMatch[] = [];

  for (const m of matches) {
    const inserted = await db
      .insert(prospectingTargetClaims)
      .values({
        matchKind: m.matchKind,
        matchValue: m.matchValue,
        ownerRep: ctx.ownerRep,
        batchRunId: ctx.batchRunId,
        queueItemId: ctx.queueItemId,
      })
      .onConflictDoNothing({
        target: [
          prospectingTargetClaims.matchKind,
          prospectingTargetClaims.matchValue,
        ],
      })
      .returning({ id: prospectingTargetClaims.id });

    if (inserted.length > 0) {
      // Fresh insert — this rep now holds the key.
      freshlyInserted.push(m);
      continue;
    }

    // Conflict — inspect the existing claim's owner.
    const [existing] = await db
      .select({ ownerRep: prospectingTargetClaims.ownerRep })
      .from(prospectingTargetClaims)
      .where(
        and(
          eq(prospectingTargetClaims.matchKind, m.matchKind),
          eq(prospectingTargetClaims.matchValue, m.matchValue)
        )
      )
      .limit(1);

    // Defensive: the row may have been released between the insert and this
    // read. Treat a vanished claim as freshly claimable on the next pass.
    if (existing === undefined) {
      const retried = await db
        .insert(prospectingTargetClaims)
        .values({
          matchKind: m.matchKind,
          matchValue: m.matchValue,
          ownerRep: ctx.ownerRep,
          batchRunId: ctx.batchRunId,
          queueItemId: ctx.queueItemId,
        })
        .onConflictDoNothing({
          target: [
            prospectingTargetClaims.matchKind,
            prospectingTargetClaims.matchValue,
          ],
        })
        .returning({ id: prospectingTargetClaims.id });
      if (retried.length > 0) {
        freshlyInserted.push(m);
        continue;
      }
      // Re-conflict — fall through to owner inspection below by re-reading.
      const [reread] = await db
        .select({ ownerRep: prospectingTargetClaims.ownerRep })
        .from(prospectingTargetClaims)
        .where(
          and(
            eq(prospectingTargetClaims.matchKind, m.matchKind),
            eq(prospectingTargetClaims.matchValue, m.matchValue)
          )
        )
        .limit(1);
      if (reread !== undefined && reread.ownerRep !== ctx.ownerRep) {
        await releaseMatches(db, freshlyInserted);
        return { kind: "claimed_by_other_rep", ownerRep: reread.ownerRep };
      }
      // Owned by us (or still gone) — treat as held.
      continue;
    }

    if (existing.ownerRep !== ctx.ownerRep) {
      // A different rep holds this identity — release what we just took and
      // report the collision (Req 6.2).
      await releaseMatches(db, freshlyInserted);
      return { kind: "claimed_by_other_rep", ownerRep: existing.ownerRep };
    }

    // Already ours (idempotent re-run) — the claim is held.
  }

  return { kind: "held", keys: matches };
}

/**
 * Release the claim(s) for a candidate's identities (Req 4.4).
 *
 * Deletes the `prospecting_target_claims` rows for every supplied identity key,
 * so a rejected / suppressed prospect becomes claimable again. Idempotent:
 * releasing an identity that is not claimed is a no-op; with no usable identity
 * key it does nothing (it never clears the whole table).
 */
export async function releaseClaim(
  db: Database,
  identity: ClaimIdentity
): Promise<void> {
  await releaseMatches(db, toMatches(identity));
}

// ── Private helpers ────────────────────────────────────────────────────────────

/**
 * Normalize a candidate identity into the `(match_kind, match_value)` pairs
 * stored in `prospecting_target_claims`, reusing the SAME primitives the dedupe
 * / party graph use. Blank or unnormalizable values are dropped.
 *
 *   - email → `normalizeEmail` (lower-cased + trimmed) under `"email"`;
 *   - phone → `normalizePhoneToE164` then `computePhoneHash` (salted) under
 *     `"phone_hash"` — the raw number is never stored (CC-Privacy).
 */
function toMatches(identity: ClaimIdentity): ClaimMatch[] {
  const matches: ClaimMatch[] = [];

  if (identity.email !== undefined) {
    const email = normalizeEmail(identity.email);
    if (email.length > 0) {
      matches.push({ matchKind: "email", matchValue: email });
    }
  }

  if (identity.phone !== undefined) {
    try {
      const e164 = normalizePhoneToE164(identity.phone);
      matches.push({ matchKind: "phone_hash", matchValue: computePhoneHash(e164) });
    } catch {
      // An unnormalizable phone yields no phone_hash key — never a raw number.
    }
  }

  return matches;
}

/**
 * Normalize an email for matching: lower-cased with surrounding whitespace
 * removed — identical to the opt-out store (`lib/cms/prospecting/optout.ts`) and
 * dedupe lookup (`lib/cms/tickets/crm/dedupe.ts`), so the email match space is
 * shared, not redefined.
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Delete the claim rows for the supplied `(match_kind, match_value)` pairs. */
async function releaseMatches(
  db: Database,
  matches: ClaimMatch[]
): Promise<void> {
  if (matches.length === 0) return;
  await db.delete(prospectingTargetClaims).where(matchesWhere(matches));
}

/** Build a WHERE clause matching any of the supplied `(kind, value)` pairs. */
function matchesWhere(matches: ClaimMatch[]): SQL | undefined {
  const conditions = matches.map((m) =>
    and(
      eq(prospectingTargetClaims.matchKind, m.matchKind),
      eq(prospectingTargetClaims.matchValue, m.matchValue)
    )
  );

  return conditions.length === 1 ? conditions[0] : or(...conditions);
}
