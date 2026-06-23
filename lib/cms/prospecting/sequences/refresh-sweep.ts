/**
 * Scheduled-refresh sweep — pure workflow (design §Components #2 "Scheduled-
 * refresh sweep (pure workflow + worker)"; §Architecture "Refresh sweep tick
 * (idempotent per interval)"; Requirements 4.1, 4.2, 4.3, 4.5, 4.6, 10.3).
 *
 * This is the long-lived sibling of `lib/cms/agents/workflows/lead-nudge.ts`'s
 * `runNudgeSweep`: the pure, timer-free body of one refresh tick. The cadence —
 * how often this is called — is owned by the container-only worker
 * (`workers/sequence-refresh.ts`); this function does exactly one pass and is
 * safe to run concurrently / across replicas because every effect it performs is
 * idempotent per scheduled slot.
 *
 * One pass:
 *
 *   1. SELECT every `live` Sequence whose `next_refresh_at` has elapsed
 *      (`status = 'live' AND next_refresh_at <= now`). A `draft` / `paused` /
 *      `archived` Sequence is never selected, so it never gets a Refresh_Run
 *      (Req 4.6).
 *   2. For each due Sequence, read `slot = next_refresh_at` — the *scheduled*
 *      instant, not wall-clock `now`. The slot is the bucket the whole tick keys
 *      off, which is what makes two ticks observing the same un-advanced
 *      `next_refresh_at` collapse onto one Refresh_Run.
 *   3. Insert a linked `prospecting_batch_runs` row keyed by the deterministic
 *      `seq:{id}:refresh:{slot.toISOString()}` rerun key with `ON CONFLICT
 *      (rerun_key) DO NOTHING` (Req 4.2, 4.3, CC-Idem). A second tick for the
 *      same slot derives the same key, so the unique `rerun_key` index collapses
 *      it to a no-op.
 *   4. `enqueueJob(db, "prospecting_batch", { batchRunId }, rerunKey)` — the job
 *      spine's `ON CONFLICT (job_key) DO NOTHING` bounds it to one job per slot
 *      (Req 4.3). Always called (even when the run row already existed) so a tick
 *      that crashed between insert and enqueue is self-healing.
 *   5. Atomically advance the clock with a conditional UPDATE
 *      `SET next_refresh_at = now + interval WHERE id = :id AND status = 'live'
 *      AND next_refresh_at = :slot` (Req 4.5). Only the first tick to advance the
 *      slot wins; a Sequence paused/archived between the SELECT and the UPDATE is
 *      not rescheduled (the `status = 'live'` predicate fails), honouring Req 4.6
 *      under a race.
 *
 * The returned `enqueued` counts only Refresh_Runs that were *newly* created by
 * this pass (a fresh `prospecting_batch_runs` insert) — idempotent no-ops for a
 * slot already enqueued are excluded.
 */

import { and, eq, lte, sql } from "drizzle-orm";

import type { Database } from "../../db";
import { prospectingBatchRuns, prospectingSequences } from "../../schema";
import { enqueueJob } from "../../jobs";
import type { BatchSubject } from "../batch/rerun-key";

/** The result of one {@link runSequenceRefreshSweep} pass. */
export interface RefreshSweepResult {
  /** Sequences observed due (`live` with an elapsed `next_refresh_at`). */
  due: number;
  /** Refresh_Runs newly enqueued by this pass (excludes idempotent no-ops). */
  enqueued: number;
}

/**
 * Derive the deterministic rerun / job key for a Sequence's scheduled slot. Two
 * ticks that observe the same un-advanced `next_refresh_at` derive the SAME key,
 * so the `prospecting_batch_runs.rerun_key` UNIQUE and the `jobs.job_key` UNIQUE
 * each collapse the second enqueue to a no-op (Req 4.3, CC-Idem).
 */
export function refreshRerunKey(sequenceId: string, slot: Date): string {
  return `seq:${sequenceId}:refresh:${slot.toISOString()}`;
}

/**
 * Run one refresh sweep pass. Pure of any timer — the worker owns the cadence.
 * Selects `live` Sequences whose `next_refresh_at` has elapsed, enqueues a linked
 * Refresh_Run per due Sequence keyed idempotently by its scheduled slot, and
 * atomically advances `next_refresh_at`. Idempotent per slot and safe under
 * concurrent ticks / replicas.
 */
export async function runSequenceRefreshSweep(
  db: Database,
  now: Date = new Date()
): Promise<RefreshSweepResult> {
  // ── Select due Sequences (Req 4.1, 4.6) ─────────────────────────────────────
  // `next_refresh_at <= now` excludes NULLs in SQL, so a draft/archived Sequence
  // (which carries a null slot) is never selected; the explicit `status = 'live'`
  // predicate additionally excludes a paused Sequence.
  const due = await db
    .select({
      id: prospectingSequences.id,
      ownerRep: prospectingSequences.ownerRep,
      subject: prospectingSequences.subject,
      targetCount: prospectingSequences.targetCount,
      nextRefreshAt: prospectingSequences.nextRefreshAt,
      refreshIntervalMinutes: prospectingSequences.refreshIntervalMinutes,
    })
    .from(prospectingSequences)
    .where(
      and(
        eq(prospectingSequences.status, "live"),
        lte(prospectingSequences.nextRefreshAt, now)
      )
    );

  let enqueued = 0;

  for (const seq of due) {
    // `next_refresh_at` is non-null here (the `lte` predicate matched it).
    const slot = seq.nextRefreshAt as Date;
    const rerunKey = refreshRerunKey(seq.id, slot);
    const subject = seq.subject as BatchSubject;
    const clusterId = subject.clusterId ?? null;

    // ── Insert the linked Refresh_Run, idempotent per slot (Req 4.2, 4.3) ─────
    const inserted = await db
      .insert(prospectingBatchRuns)
      .values({
        ownerRep: seq.ownerRep,
        sequenceId: seq.id,
        subject,
        clusterId,
        targetCount: seq.targetCount,
        status: "running",
        rerunKey,
      })
      .onConflictDoNothing({ target: prospectingBatchRuns.rerunKey })
      .returning({ id: prospectingBatchRuns.id });

    let batchRunId = inserted[0]?.id;
    if (batchRunId) {
      // A fresh run row — this slot was newly enqueued by this pass.
      enqueued += 1;
    } else {
      // Conflict: an equivalent Refresh_Run already exists for this slot — reuse
      // its id so the enqueue below is keyed to the same run (idempotent re-run).
      const [existing] = await db
        .select({ id: prospectingBatchRuns.id })
        .from(prospectingBatchRuns)
        .where(eq(prospectingBatchRuns.rerunKey, rerunKey))
        .limit(1);
      batchRunId = existing?.id;
    }

    // ── Enqueue the durable job keyed by the slot rerun key (Req 4.3) ─────────
    // Always enqueued (even on an existing run row): `enqueueJob` is `ON CONFLICT
    // (job_key) DO NOTHING`, so a tick that crashed between the run insert and the
    // enqueue is self-healing without ever producing a second job for the slot.
    if (batchRunId) {
      await enqueueJob(db, "prospecting_batch", { batchRunId }, rerunKey);
    }

    // ── Atomically advance the clock to the next slot (Req 4.5, 4.6) ──────────
    // The `next_refresh_at = :slot` predicate means only the first tick to
    // advance this slot wins; the `status = 'live'` predicate means a Sequence
    // paused/archived between the SELECT and here is NOT rescheduled.
    const interval = seq.refreshIntervalMinutes ?? 1440;
    const nextSlot = new Date(now.getTime() + interval * 60_000);
    await db
      .update(prospectingSequences)
      .set({ nextRefreshAt: nextSlot, updatedAt: now })
      .where(
        and(
          eq(prospectingSequences.id, seq.id),
          eq(prospectingSequences.status, "live"),
          eq(prospectingSequences.nextRefreshAt, slot)
        )
      );
  }

  return { due: due.length, enqueued };
}
