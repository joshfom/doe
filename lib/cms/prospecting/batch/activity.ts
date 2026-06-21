/**
 * Agentic Prospecting Batch — Agent_Activity_Log persistence + event mirroring
 * (design §Components #7 "Activity log + events"; Requirements 3.2, 3.3, 3.4).
 *
 * Every decision point the Batch_Run reaches for a candidate
 * (`discovered → crm_checked → scored → eligibility → drafted`, or a terminal
 * `skipped` / `warm_path`) is recorded twice, for two different audiences:
 *
 *   1. **Persisted** as one `prospecting_batch_activity` row via
 *      {@link appendActivity}, so the rep can re-read the full, ordered history
 *      of a completed run on demand (Req 3.2, 3.5). Rows carry a monotonic
 *      per-run `seq` so retrieval is deterministically ordered even when two
 *      rows share an `at` timestamp.
 *   2. **Mirrored** as a `prospecting.batch.*` / `prospecting.queue.*` event via
 *      {@link publishBatch}, so the same decisions stream live to the initiating
 *      rep over the existing SSE bus (Req 3.1).
 *
 * PRIVACY INVARIANT (CC-Privacy, Req 3.4 / 10.4): an activity row and an event
 * payload reference a prospect by an INTERNAL identifier only (a `target_id`,
 * draft id, counts, a fit score, a skip reason) and MUST NEVER carry a raw phone
 * number. The bus itself does not scrub payloads (see `realtime/events.ts`), so
 * this module enforces the invariant defensively: {@link appendActivity} and
 * {@link publishBatch} both run {@link assertPrivacySafe} over the payload and
 * throw before persisting / publishing if a phone-like sequence is detected. A
 * phone reaches the system only as a salted `phone_hash` (see
 * `lib/cms/prospecting/batch/claim.ts`).
 */

import { and, asc, eq, max } from "drizzle-orm";

import type { Database } from "../../db";
import { publishEvent, type DoeEventType } from "../../realtime/events";
import {
  prospectingBatchActivity,
  type ProspectingBatchActivity,
} from "../../schema";

// ── Decision-point taxonomy ──────────────────────────────────────────────────

/**
 * The decision point an activity row records (Req 3.2). One value per step of
 * the per-candidate pipeline:
 *
 *   - `discovered`   — a candidate was returned by `prospect_search`;
 *   - `crm_checked`  — the Salesforce existence pre-check ran for the candidate;
 *   - `scored`       — a deterministic Fit_Score was computed;
 *   - `eligibility`  — the candidate was classified Cold-eligible;
 *   - `drafted`      — a grounded Outreach_Draft was produced + queued;
 *   - `skipped`      — the candidate was excluded (with a {@link SkipReason});
 *   - `warm_path`    — the candidate was routed to the Warm_Path (already known
 *                      to Salesforce / a local party) instead of cold outreach.
 */
export type ActivityAction =
  | "discovered"
  | "crm_checked"
  | "scored"
  | "eligibility"
  | "drafted"
  | "skipped"
  | "warm_path";

/**
 * The reason a candidate was skipped (Req 3.3). Mirrors the eligibility
 * pipeline's skip taxonomy (design §Components #3): a skipped activity row
 * SHALL carry one of these as its `reason`.
 *
 *   - `opted_out`            — the prospect is in Opt-out / do-not-contact state;
 *   - `missing_lawful_basis` — no recorded lawful basis for cold contact;
 *   - `claimed_by_other_rep` — the identity is claimed by a different rep;
 *   - `already_in_salesforce`— the CRM_Check found the prospect (cold-skip);
 *   - `cap_reached`          — the rep's or cluster's Send_Cap is exhausted.
 */
export type SkipReason =
  | "opted_out"
  | "missing_lawful_basis"
  | "claimed_by_other_rep"
  | "already_in_salesforce"
  | "cap_reached";

/**
 * The batch / queue lifecycle event types this module mirrors decisions onto. A
 * strict subset of {@link DoeEventType} (the `prospecting.batch.*` /
 * `prospecting.queue.*` family), so a value here is always a valid bus event
 * type.
 */
export type BatchEventType = Extract<
  DoeEventType,
  | "prospecting.batch.started"
  | "prospecting.batch.progress"
  | "prospecting.batch.candidate.skipped"
  | "prospecting.batch.completed"
  | "prospecting.queue.item.queued"
  | "prospecting.queue.item.approved"
  | "prospecting.queue.item.rejected"
  | "prospecting.queue.item.sent"
>;

/**
 * A privacy-safe activity / event payload: a plain JSON object of internal ids,
 * counts, scores, and reasons. It MUST NOT contain a raw phone number — the
 * invariant is enforced by {@link assertPrivacySafe} at every call site here.
 */
export type ActivityPayload = Record<string, unknown>;

// ── appendActivity — persist one Agent_Activity_Log row ──────────────────────

/** Input to {@link appendActivity}: one decision point to persist. */
export interface AppendActivityInput {
  /** The Batch_Run the entry belongs to. */
  batchRunId: string;
  /** The decision point this row records (Req 3.2). */
  action: ActivityAction;
  /**
   * The decision / skip reason (Req 3.3). For `action === "skipped"` this SHOULD
   * be a {@link SkipReason}; for other actions it is an optional free-form note.
   */
  reason?: SkipReason | string | null;
  /**
   * The internal id of the candidate the entry concerns — never a raw phone
   * (Req 3.4). `null` for run-level entries that concern no single candidate.
   */
  targetId?: string | null;
  /** Privacy-safe structured detail (counts, fit score, ids). */
  payload?: ActivityPayload | null;
}

/**
 * Append one privacy-safe `prospecting_batch_activity` row for a decision point
 * (Req 3.2, 3.3, 3.4).
 *
 * The row's `seq` is assigned **monotonically per run**: it is
 * `COALESCE(MAX(seq), 0) + 1` over the existing rows for the same
 * `batch_run_id`. The read-then-insert runs inside a transaction so the
 * computed `seq` and the insert are atomic with respect to other writers; the
 * Batch_Run handler appends sequentially, so each decision point gets the next
 * integer in order (`1, 2, 3, …`) and reads back in that exact order.
 *
 * The `payload` (and `reason`) are checked by {@link assertPrivacySafe} before
 * the insert; a phone-like sequence throws rather than being persisted
 * (CC-Privacy, Req 3.4).
 *
 * @returns the inserted activity row (including its assigned `seq`).
 */
export async function appendActivity(
  db: Database,
  input: AppendActivityInput
): Promise<ProspectingBatchActivity> {
  const payload = input.payload ?? null;
  // Defensive privacy gate: never persist a raw phone number (Req 3.4).
  assertPrivacySafe(payload);
  if (input.reason != null) assertPrivacySafe(input.reason);

  return await db.transaction(async (tx) => {
    // Monotonic per-run sequence: next integer after the current max for this
    // run (1 for the first row). Not globally unique — scoped to the run.
    const [agg] = await tx
      .select({ maxSeq: max(prospectingBatchActivity.seq) })
      .from(prospectingBatchActivity)
      .where(eq(prospectingBatchActivity.batchRunId, input.batchRunId));

    const nextSeq = (agg?.maxSeq ?? 0) + 1;

    const [row] = await tx
      .insert(prospectingBatchActivity)
      .values({
        batchRunId: input.batchRunId,
        seq: nextSeq,
        action: input.action,
        reason: input.reason ?? null,
        targetId: input.targetId ?? null,
        payload,
      })
      .returning();

    return row;
  });
}

/**
 * Read a Batch_Run's persisted Agent_Activity_Log in monotonic `seq` order
 * (Req 3.2, 3.5). The ordering is deterministic regardless of `at` ties.
 */
export async function readActivity(
  db: Database,
  batchRunId: string
): Promise<ProspectingBatchActivity[]> {
  return await db
    .select()
    .from(prospectingBatchActivity)
    .where(eq(prospectingBatchActivity.batchRunId, batchRunId))
    .orderBy(asc(prospectingBatchActivity.seq));
}

// ── publishBatch — mirror a decision onto the SSE bus ────────────────────────

/**
 * Mirror a Batch_Run decision as a `prospecting.batch.*` / `prospecting.queue.*`
 * event for the live progress stream (Req 3.1).
 *
 * The published payload always carries the `batchRunId` (so subscribers can
 * scope the event to a run) merged with any `extra` privacy-safe detail (a
 * `targetId`, a `queued` count, a `skipReason`, …). The merged payload is run
 * through {@link assertPrivacySafe} before publishing, so a raw phone number can
 * never leave on a batch event (CC-Privacy, Req 3.4 / 10.4).
 *
 * @param run   the Batch_Run the event concerns (only its `id` is read).
 * @param extra optional privacy-safe payload detail merged onto `{ batchRunId }`.
 */
export async function publishBatch(
  db: Database,
  type: BatchEventType,
  run: { id: string },
  extra?: ActivityPayload
): Promise<void> {
  const payload: ActivityPayload = { batchRunId: run.id, ...(extra ?? {}) };
  assertPrivacySafe(payload);
  await publishEvent(db, { type, payload });
}

// ── Privacy guard ─────────────────────────────────────────────────────────────

/**
 * A phone-like sequence, in two safe branches:
 *
 *   1. `\+\d[\d\s().-]{5,}\d` — an international / E.164 number: a leading `+`
 *      then digits, optionally grouped by spaces / dashes / parens / dots. The
 *      mandatory leading `+` makes this branch immune to every internal id
 *      (UUIDs, ISO timestamps, `period_bucket`s, fit scores, counts, and salted
 *      hashes never contain a `+`).
 *   2. `(?<![\w-])\d{7,}(?![\w-])` — a bare run of 7+ digits that stands alone
 *      as its own token (a national number like `0501234567`). The
 *      lookbehind / lookahead require the run NOT to be embedded in a larger
 *      word- or hyphen-joined token, so it never fires on a UUID segment
 *      (`…-446655440000`), an ISO date (`2026-01-15`), or a digit run sitting
 *      inside a hex hash — each of those is adjacent to a hyphen or hex letter.
 *
 * Together these catch a leaked raw phone while leaving the privacy-safe
 * internal identifiers a batch payload legitimately carries untouched.
 */
const PHONE_LIKE = /\+\d[\d\s().-]{5,}\d|(?<![\w-])\d{7,}(?![\w-])/;

/**
 * Recursively assert a value carries no raw phone number (CC-Privacy, Req 3.4).
 *
 * Walks strings, arrays, and plain objects, throwing on the first phone-like
 * string found. Numbers, booleans, `null`, and `undefined` are inert. This is a
 * defensive backstop: callers are expected to hand privacy-safe payloads
 * (internal ids, salted `phone_hash`, counts), and this guard turns an
 * accidental raw phone into a loud failure at the persistence / publish
 * boundary rather than a silent privacy leak.
 */
export function assertPrivacySafe(value: unknown): void {
  if (typeof value === "string") {
    if (PHONE_LIKE.test(value)) {
      throw new Error(
        "prospecting batch activity payload must not contain a raw phone number (CC-Privacy, Req 3.4)"
      );
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const v of value) assertPrivacySafe(v);
    return;
  }

  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      assertPrivacySafe(v);
    }
  }
}
