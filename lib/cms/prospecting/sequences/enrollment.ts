/**
 * Sequence-scoped enrollment ledger (design §Components #3 "Refresh_Run
 * extension — enrollment ledger"; §Data Models "new table
 * `prospecting_sequence_enrollments`"; Requirements 5.1, 5.2, 11.1, 11.3, 11.4).
 *
 * A Refresh_Run is the existing Batch_Run loop with two gated additions when
 * `run.sequenceId` is set: **sequence-wide** dedupe (a prospect already enrolled
 * in any prior refresh of this Sequence is skipped) and **enrollment-cap**
 * counting. This module owns the durable side of both:
 *
 *   - {@link loadSequenceEnrollments} rebuilds the `seenKeys` set the batch loop
 *     uses to dedupe — but from the WHOLE Sequence's ledger rather than one run's
 *     queue (so a candidate enrolled by ANY prior refresh is skipped, Req 5.1,
 *     5.2). The keys are reconstructed in the SAME identity space as `run.ts`'s
 *     `candidateKey` (provider ref / normalized email / salted phone hash) so a
 *     membership test against `candidateKey(candidate)` is exact.
 *   - {@link periodBucket} derives the cap period key (`2026-01` for monthly,
 *     `2026-01-15` for daily, `2026-W03` for weekly) — the bucket the cap counts
 *     within, so a new period simply starts a new bucket whose consumed count is
 *     zero with no scheduled reset job (Req 11.3), mirroring
 *     `prospecting_send_counters`.
 *   - {@link enrollmentRemaining} reads the consumed enrollment count for the
 *     current bucket against the Sequence's `enrollment_cap` (Req 11.1).
 *   - {@link insertEnrollment} writes one ledger row with `ON CONFLICT
 *     (sequence_id, match_kind, match_value) DO NOTHING`. The row's existence IS
 *     both the enrollment-at-most-once guarantee and the cap counter, so a
 *     retried refresh is idempotent and the period count increments exactly once
 *     per enrollment (Req 5.3, 11.4).
 *
 * IDENTITY SPACE (CC-Privacy): the `(match_kind, match_value)` pair reuses the
 * SAME privacy-safe identity the opt-out store, the cross-rep claim, and the
 * batch's `candidateKey` already use — a normalized email under `"email"`, a
 * salted `phone_hash` under `"phone_hash"` (a raw phone never reaches this
 * table), or a provider ref under `"ref"`. The phone is hashed with the same
 * `normalizePhoneToE164` + `computePhoneHash` primitives the claim mechanism
 * uses, so the hash is identical to the one stored on the Target.
 */

import { and, eq, sql } from "drizzle-orm";

import type { Database } from "../../db";
import {
  prospectingSequenceEnrollments,
  type ProspectingSequence,
} from "../../schema";
import type { ProviderResult } from "../providers";
import { computePhoneHash, normalizePhoneToE164 } from "../../voice/identity";

// ── Identity space (shared with candidateKey / claims / opt-out) ──────────────

/** The privacy-safe identity discriminator stored on a ledger row. */
export type EnrollmentMatchKind = "email" | "phone_hash" | "ref";

/** A normalized `(match_kind, match_value)` identity for one prospect. */
export interface EnrollmentIdentity {
  matchKind: EnrollmentMatchKind;
  matchValue: string;
}

/**
 * Derive the privacy-safe ledger identity for a discovered candidate, mirroring
 * `run.ts`'s `candidateKey` precedence so the dedupe space is shared, not
 * redefined:
 *
 *   1. a provider `sourceRef` → `"ref"`, value `"{sourceProvider}:{sourceRef}"`
 *      (so {@link seenKeyOf} reconstructs `ref:{sourceProvider}:{sourceRef}`,
 *      byte-identical to `candidateKey`);
 *   2. else a normalized (lower-cased + trimmed) `email` → `"email"`;
 *   3. else a `phone` normalized to E.164 then salted-hashed → `"phone_hash"`
 *      (the raw number is used transiently only and is NEVER persisted).
 *
 * Returns `null` when the candidate carries no usable privacy-safe identity (it
 * cannot be enrolled in the ledger and falls back to the per-run dedupe).
 */
export function enrollmentIdentity(
  candidate: Pick<
    ProviderResult,
    "sourceProvider" | "sourceRef" | "email" | "phone"
  >
): EnrollmentIdentity | null {
  if (candidate.sourceRef) {
    return {
      matchKind: "ref",
      matchValue: `${candidate.sourceProvider}:${candidate.sourceRef}`,
    };
  }

  if (candidate.email) {
    const email = candidate.email.trim().toLowerCase();
    if (email.length > 0) {
      return { matchKind: "email", matchValue: email };
    }
  }

  if (candidate.phone) {
    try {
      const e164 = normalizePhoneToE164(candidate.phone);
      return { matchKind: "phone_hash", matchValue: computePhoneHash(e164) };
    } catch {
      // An unnormalizable phone yields no phone_hash key — never a raw number.
    }
  }

  return null;
}

/**
 * Reconstruct the `candidateKey`-compatible dedupe string for a ledger identity.
 * For `"ref"` and `"email"` the result is byte-identical to `run.ts`'s
 * `candidateKey` (so a `seenKeys.has(candidateKey(candidate))` test is exact);
 * a `"phone_hash"` identity yields a `phone_hash:`-prefixed key.
 */
export function seenKeyOf(identity: EnrollmentIdentity): string {
  return `${identity.matchKind === "phone_hash" ? "phone_hash" : identity.matchKind}:${identity.matchValue}`;
}

// ── Sequence-wide dedupe set (Req 5.1, 5.2) ───────────────────────────────────

/**
 * Build the `seenKeys` set for a whole Sequence from its enrollment ledger.
 *
 * Every prospect enrolled by ANY prior Refresh_Run of the Sequence contributes
 * one key, reconstructed in the SAME identity space as `run.ts`'s `candidateKey`
 * (see {@link seenKeyOf}). The refresh loop tests `seenKeys.has(candidateKey(c))`
 * to skip an already-enrolled candidate, so no duplicate Enrollment / Queued_Item
 * is created across refreshes (Req 5.1, 5.2).
 */
export async function loadSequenceEnrollments(
  db: Database,
  sequenceId: string
): Promise<Set<string>> {
  const rows = await db
    .select({
      matchKind: prospectingSequenceEnrollments.matchKind,
      matchValue: prospectingSequenceEnrollments.matchValue,
    })
    .from(prospectingSequenceEnrollments)
    .where(eq(prospectingSequenceEnrollments.sequenceId, sequenceId));

  const seenKeys = new Set<string>();
  for (const r of rows) {
    seenKeys.add(
      seenKeyOf({ matchKind: r.matchKind, matchValue: r.matchValue })
    );
  }
  return seenKeys;
}

// ── Cap period bucket (Req 11.3) ──────────────────────────────────────────────

/** The cap reset period of a Sequence (`prospecting_sequences.enrollment_period`). */
export type EnrollmentPeriod = "day" | "week" | "month";

/**
 * Derive the cap period key (`period_bucket`) for an instant. A new period is
 * simply a new bucket whose consumed count starts at zero, so the cap "resets"
 * with no scheduled reset job (Req 11.3):
 *
 *   - `"day"`   → `YYYY-MM-DD` (e.g. `2026-01-15`)
 *   - `"week"`  → `YYYY-Www`   ISO-8601 week date (e.g. `2026-W03`)
 *   - `"month"` → `YYYY-MM`    (e.g. `2026-01`)
 *
 * All derivations are UTC so the bucket is stable regardless of server timezone.
 */
export function periodBucket(period: EnrollmentPeriod, now: Date): string {
  const year = now.getUTCFullYear();
  const month = `${now.getUTCMonth() + 1}`.padStart(2, "0");

  if (period === "month") {
    return `${year}-${month}`;
  }

  if (period === "day") {
    const day = `${now.getUTCDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  // ISO-8601 week date: the week-numbering year and week can differ from the
  // calendar year near year boundaries, so both come from the same calculation.
  const { isoYear, isoWeek } = isoWeekParts(now);
  return `${isoYear}-W${`${isoWeek}`.padStart(2, "0")}`;
}

/**
 * Compute the ISO-8601 week-numbering year and week number for an instant (UTC).
 * Week 1 is the week containing the first Thursday of the year; weeks start on
 * Monday. Both values are returned together because the week-numbering year can
 * differ from the calendar year for the first/last days of a year.
 */
function isoWeekParts(now: Date): { isoYear: number; isoWeek: number } {
  // Shift to the Thursday of the current ISO week (Mon=0 … Sun=6).
  const date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const dayIdx = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayIdx + 3);

  const isoYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayIdx = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayIdx + 3);

  const isoWeek =
    1 +
    Math.round(
      (date.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000)
    );

  return { isoYear, isoWeek };
}

// ── Enrollment cap budget (Req 11.1, 11.4) ────────────────────────────────────

/** The consumed count of enrollments for a Sequence within one period bucket. */
export async function enrollmentConsumed(
  db: Database,
  sequenceId: string,
  bucket: string
): Promise<number> {
  const [row] = await db
    .select({ consumed: sql<number>`count(*)::int` })
    .from(prospectingSequenceEnrollments)
    .where(
      and(
        eq(prospectingSequenceEnrollments.sequenceId, sequenceId),
        eq(prospectingSequenceEnrollments.periodBucket, bucket)
      )
    );
  return row?.consumed ?? 0;
}

/**
 * Enrollments still allowed for a Sequence in the current period bucket:
 * `enrollment_cap - consumed` floored at 0, or `null` (unbounded) when the
 * Sequence has no `enrollment_cap` configured (Req 11.1). When the cap is
 * exhausted this returns `0`, the signal the refresh loop uses to stop enrolling
 * and record a `cap_reached` Activity_Log entry (Req 11.2).
 */
export async function enrollmentRemaining(
  db: Database,
  sequence: Pick<ProspectingSequence, "id" | "enrollmentCap">,
  bucket: string
): Promise<number | null> {
  if (sequence.enrollmentCap === null || sequence.enrollmentCap === undefined) {
    return null; // No cap configured → unbounded.
  }
  const consumed = await enrollmentConsumed(db, sequence.id, bucket);
  return Math.max(0, sequence.enrollmentCap - consumed);
}

// ── Enrollment write (Req 5.1, 5.3, 11.4) ─────────────────────────────────────

/** The fields needed to record one enrollment ledger row. */
export interface InsertEnrollmentInput {
  sequenceId: string;
  matchKind: EnrollmentMatchKind;
  matchValue: string;
  targetId: string;
  batchRunId: string;
  periodBucket: string;
}

/**
 * Record one enrollment with `INSERT ... ON CONFLICT (sequence_id, match_kind,
 * match_value) DO NOTHING` over the table's unique identity index.
 *
 * The row's existence IS the enrollment-at-most-once guarantee AND the cap
 * counter: a fresh insert enrolls the prospect (and increments the period count
 * by exactly one); a conflict means the prospect is already enrolled in this
 * Sequence, so a retried refresh is idempotent and the count is never
 * double-incremented (Req 5.1, 5.3, 11.4).
 *
 * @returns `{ inserted: true }` when this call enrolled a new prospect, or
 *   `{ inserted: false }` when the prospect was already enrolled.
 */
export async function insertEnrollment(
  db: Database,
  input: InsertEnrollmentInput
): Promise<{ inserted: boolean }> {
  const inserted = await db
    .insert(prospectingSequenceEnrollments)
    .values({
      sequenceId: input.sequenceId,
      matchKind: input.matchKind,
      matchValue: input.matchValue,
      targetId: input.targetId,
      batchRunId: input.batchRunId,
      periodBucket: input.periodBucket,
    })
    .onConflictDoNothing({
      target: [
        prospectingSequenceEnrollments.sequenceId,
        prospectingSequenceEnrollments.matchKind,
        prospectingSequenceEnrollments.matchValue,
      ],
    })
    .returning({ id: prospectingSequenceEnrollments.id });

  return { inserted: inserted.length > 0 };
}
