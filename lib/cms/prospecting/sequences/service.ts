/**
 * Sequence service — owner-scoped persistence helpers (design §Components #1
 * "Lifecycle state machine", #4 "Bridge routes"; §Data Models; Decisions 1, 3;
 * Requirements 1.2, 2.5, 2.7, 2.9, 10.1, 10.3).
 *
 * The owner-scoped bridge routes in `lib/cms/api/routes/prospecting.ts` delegate
 * their persistence to this module so the create / edit / lifecycle rules live in
 * one tested place rather than being duplicated inline per route handler. Every
 * helper:
 *
 *   - touches the DB only through the existing Drizzle `db` (CC-Reuse) — there are
 *     no provider calls and no long work here; this is the serverless request
 *     path;
 *   - returns a discriminated `{ ok }` result so a route can map a validation
 *     failure to a `400` / `409` without throwing;
 *   - keeps the authoritative `status` and the legacy `mode` column in sync
 *     (`mode = status === "live" ? "live" : "draft"`) for backward-compatible
 *     reads, while `status` remains the source of truth (design §4).
 *
 * Validation mirrors the lifecycle module's pure guards: a non-empty name (Req
 * 2.5, 2.9) and a resolvable Subject (Req 1.8, 2.8, 10.4 via
 * {@link hasResolvableSubject}). The Refresh_Frequency is clamped to the
 * **60-minute minimum** (Decision 1, Req 2.7); cap / period defaults match the
 * additive schema (`enrollment_cap = 200`, `enrollment_period = "month"`,
 * `refresh_interval_minutes = 1440`).
 */

import { and, eq } from "drizzle-orm";

import type { Database } from "../../db";
import {
  prospectingSequences,
  type ProspectingSequence,
} from "../../schema";
import type { BatchSubject } from "../batch/rerun-key";
import {
  applyTransition,
  hasResolvableSubject,
  type SequenceAction,
  type SequenceStatus,
} from "./lifecycle";

// ── Defaults & bounds (Decision 1; §Data Models) ─────────────────────────────

/** The minimum Refresh_Frequency, in minutes (Decision 1, Req 2.7). */
export const MIN_REFRESH_INTERVAL_MINUTES = 60;
/** Default Refresh_Frequency (Daily) when none is supplied. */
export const DEFAULT_REFRESH_INTERVAL_MINUTES = 1440;
/** Default Enrollment_Cap per period (Req 11.1). */
export const DEFAULT_ENROLLMENT_CAP = 200;
/** Default Enrollment_Cap period (Req 11.3). */
export const DEFAULT_ENROLLMENT_PERIOD: "day" | "week" | "month" = "month";
/** Default per-refresh batch size (repurposed `target_count`). */
export const DEFAULT_TARGET_COUNT = 10;
/** Upper bound on the per-refresh batch size (mirrors the existing route). */
const MAX_TARGET_COUNT = 500;

/**
 * Clamp a requested Refresh_Frequency to the supported space: an integer of at
 * least {@link MIN_REFRESH_INTERVAL_MINUTES} minutes, defaulting to
 * {@link DEFAULT_REFRESH_INTERVAL_MINUTES} when the input is absent or not a
 * positive number (Decision 1, Req 2.7).
 */
export function clampRefreshInterval(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return DEFAULT_REFRESH_INTERVAL_MINUTES;
  }
  return Math.max(MIN_REFRESH_INTERVAL_MINUTES, Math.floor(n));
}

/**
 * Clamp a requested per-refresh batch size to `1..MAX_TARGET_COUNT`, defaulting
 * to {@link DEFAULT_TARGET_COUNT} when absent or out of range. The campaign is
 * open-ended; this only bounds one Refresh_Run's size (§Data Models).
 */
function clampTargetCount(value: unknown): number {
  const n = Number(value);
  if (Number.isInteger(n) && n > 0 && n <= MAX_TARGET_COUNT) return n;
  return DEFAULT_TARGET_COUNT;
}

/** Keep the legacy `mode` column in sync with the authoritative `status`. */
function modeForStatus(status: SequenceStatus): "draft" | "live" {
  return status === "live" ? "live" : "draft";
}

/**
 * Normalize a raw, partial subject payload into a {@link BatchSubject},
 * inferring `kind` (own-catalog `cluster` vs `icp`) and dropping absent optional
 * fields. The resulting subject is validated by {@link hasResolvableSubject}.
 */
export function normalizeSubject(raw: Partial<BatchSubject> | undefined): BatchSubject {
  const subject = raw ?? {};
  const hasCluster = Boolean(subject.clusterId);
  const hasProject = Boolean(subject.projectId);
  return {
    kind: subject.kind ?? (hasCluster || hasProject ? "cluster" : "icp"),
    ...(subject.clusterId ? { clusterId: subject.clusterId } : {}),
    ...(subject.projectId ? { projectId: subject.projectId } : {}),
    ...(subject.communityId ? { communityId: subject.communityId } : {}),
    ...(subject.briefId ? { briefId: subject.briefId } : {}),
    ...(subject.icpFilter ? { icpFilter: subject.icpFilter } : {}),
  };
}

// ── createDraftSequence (Req 1.2, 2.5, 2.7, 2.9) ─────────────────────────────

/** The raw payload accepted when creating a Sequence. */
export interface CreateDraftSequenceInput {
  /** The owning rep — every Sequence is owner-scoped (CC-Ownership). */
  ownerRep: string;
  name?: unknown;
  description?: unknown;
  subject?: Partial<BatchSubject>;
  /** Per-refresh batch size (repurposed `target_count`). */
  targetCount?: unknown;
  /** Refresh_Frequency in minutes; clamped to the 60-minute minimum. */
  refreshIntervalMinutes?: unknown;
  enrollmentCap?: unknown;
  enrollmentPeriod?: unknown;
}

/** The outcome of {@link createDraftSequence}. */
export type CreateDraftSequenceResult =
  | { ok: true; sequence: ProspectingSequence }
  | { ok: false; code: "invalid_name" | "invalid_subject" };

/**
 * Persist a new Sequence in `status = "draft"` (Req 1.2). Rejects an empty /
 * whitespace-only name (`invalid_name`, Req 2.5, 2.9) and a Subject that does
 * not resolve to a filter (`invalid_subject`, Req 2.8). On a rejected validation
 * NO row is created. The Refresh_Frequency is clamped to the 60-minute minimum
 * (Req 2.7) and the cap / period defaults are applied.
 */
export async function createDraftSequence(
  db: Database,
  input: CreateDraftSequenceInput
): Promise<CreateDraftSequenceResult> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) {
    return { ok: false, code: "invalid_name" };
  }

  const subject = normalizeSubject(input.subject);
  if (!hasResolvableSubject(subject)) {
    return { ok: false, code: "invalid_subject" };
  }

  const enrollmentPeriod =
    input.enrollmentPeriod === "day" ||
    input.enrollmentPeriod === "week" ||
    input.enrollmentPeriod === "month"
      ? input.enrollmentPeriod
      : DEFAULT_ENROLLMENT_PERIOD;

  // An explicit positive integer cap is honoured; `null` means unbounded; any
  // other (absent / invalid) input falls back to the default (Req 11.1).
  let enrollmentCap: number | null = DEFAULT_ENROLLMENT_CAP;
  if (input.enrollmentCap === null) {
    enrollmentCap = null;
  } else if (input.enrollmentCap !== undefined) {
    const c = Number(input.enrollmentCap);
    if (Number.isInteger(c) && c > 0) enrollmentCap = c;
  }

  const [sequence] = await db
    .insert(prospectingSequences)
    .values({
      ownerRep: input.ownerRep,
      name,
      description:
        typeof input.description === "string"
          ? input.description.trim() || null
          : null,
      subject,
      targetCount: clampTargetCount(input.targetCount),
      mode: "draft",
      status: "draft",
      refreshIntervalMinutes: clampRefreshInterval(input.refreshIntervalMinutes),
      enrollmentCap,
      enrollmentPeriod,
      // A draft is not scheduled — next_refresh_at is set on publish (§Data Models).
      nextRefreshAt: null,
    })
    .returning();

  return { ok: true, sequence };
}

// ── updateSequenceConfig (Req 10.1, 10.3, 10.4) ──────────────────────────────

/** The raw edit payload accepted when updating a Sequence's configuration. */
export interface UpdateSequenceConfigInput {
  name?: unknown;
  description?: unknown;
  subject?: Partial<BatchSubject>;
  targetCount?: unknown;
  refreshIntervalMinutes?: unknown;
  enrollmentCap?: unknown;
  enrollmentPeriod?: unknown;
}

/** The outcome of {@link updateSequenceConfig}. */
export type UpdateSequenceConfigResult =
  | { ok: true; sequence: ProspectingSequence }
  | { ok: false; code: "invalid_subject" };

/**
 * Persist an edit to an already-owned Sequence's configuration (the route has
 * already fetched it owner-scoped). The updated config applies to the next
 * Refresh_Run; existing Enrolled_Prospects and their pending Queued_Items are
 * untouched (Req 10.1, 10.2).
 *
 * If the edit would leave NO resolvable Subject the edit is rejected with
 * `invalid_subject` and the prior configuration is retained (Req 10.4). When the
 * Refresh_Frequency changes on a `live` Sequence, `next_refresh_at` is recomputed
 * from the updated cadence (Req 10.3). The legacy `mode` column is kept in sync
 * with the (unchanged) authoritative `status`.
 */
export async function updateSequenceConfig(
  db: Database,
  sequence: ProspectingSequence,
  input: UpdateSequenceConfigInput,
  now: Date = new Date()
): Promise<UpdateSequenceConfigResult> {
  const status: SequenceStatus = (sequence.status ?? "draft") as SequenceStatus;
  const updates: Partial<typeof prospectingSequences.$inferInsert> = {
    updatedAt: now,
    // Keep the legacy toggle in sync with the authoritative status on every edit.
    mode: modeForStatus(status),
  };

  if (typeof input.name === "string" && input.name.trim()) {
    updates.name = input.name.trim();
  }

  if (typeof input.description === "string") {
    updates.description = input.description.trim() || null;
  }

  // A subject edit must still resolve to a filter, else reject and retain the
  // prior config (Req 10.4).
  if (input.subject !== undefined) {
    const subject = normalizeSubject(input.subject);
    if (!hasResolvableSubject(subject)) {
      return { ok: false, code: "invalid_subject" };
    }
    updates.subject = subject;
  }

  if (input.targetCount !== undefined) {
    updates.targetCount = clampTargetCount(input.targetCount);
  }

  if (input.enrollmentPeriod === "day" || input.enrollmentPeriod === "week" || input.enrollmentPeriod === "month") {
    updates.enrollmentPeriod = input.enrollmentPeriod;
  }

  if (input.enrollmentCap === null) {
    updates.enrollmentCap = null;
  } else if (input.enrollmentCap !== undefined) {
    const c = Number(input.enrollmentCap);
    if (Number.isInteger(c) && c > 0) updates.enrollmentCap = c;
  }

  // A cadence edit recomputes the next scheduled refresh from the updated
  // interval (Req 10.3). Only a `live` Sequence is actively scheduled, so the
  // recompute is meaningful there; a draft/paused/archived Sequence keeps a null
  // next_refresh_at (publish/resume sets it).
  if (input.refreshIntervalMinutes !== undefined) {
    const interval = clampRefreshInterval(input.refreshIntervalMinutes);
    updates.refreshIntervalMinutes = interval;
    if (status === "live") {
      updates.nextRefreshAt = new Date(now.getTime() + interval * 60_000);
    }
  }

  const [updated] = await db
    .update(prospectingSequences)
    .set(updates)
    .where(eq(prospectingSequences.id, sequence.id))
    .returning();

  return { ok: true, sequence: updated };
}

// ── transitionSequence (Req 1.3–1.8, 4.5, 4.6) ───────────────────────────────

/** The outcome of {@link transitionSequence}. */
export type TransitionSequenceResult =
  | { ok: true; sequence: ProspectingSequence }
  | { ok: false; code: "illegal_transition" | "invalid_subject" };

/**
 * Apply a lifecycle action to an already-owned Sequence, delegating the legality
 * decision to the pure {@link applyTransition} (Req 1.3–1.7). An illegal action
 * leaves the row unchanged and returns `illegal_transition` (Req 1.7).
 *
 * Side effects of a permitted transition:
 *   - **publish / resume** (→ `live`): `next_refresh_at = now` so the sweep picks
 *     the Sequence up on its next poll (Req 1.3, 1.5, 4.5). Publishing also
 *     re-checks the Subject — an unresolvable Subject keeps the Sequence `draft`
 *     and returns `invalid_subject` (Req 1.8).
 *   - **archive** (→ `archived`): `archived_at = now` and `next_refresh_at = null`
 *     so no further Refresh_Run is scheduled (Req 1.6, 4.6).
 *   - **pause** (→ `paused`): leaves the inbox usable; the sweep already gates on
 *     `status = "live"` so no new Refresh_Run starts while paused (Req 1.4, 4.6).
 *
 * The legacy `mode` column is kept in sync with the new `status`.
 */
export async function transitionSequence(
  db: Database,
  sequence: ProspectingSequence,
  action: SequenceAction,
  now: Date = new Date()
): Promise<TransitionSequenceResult> {
  const current: SequenceStatus = (sequence.status ?? "draft") as SequenceStatus;
  const result = applyTransition(current, action);
  if (!result.ok) {
    return { ok: false, code: "illegal_transition" };
  }
  const next = result.next;

  // Publish re-validates the Subject; an unresolvable Subject keeps it `draft`.
  if (action === "publish") {
    const subject = sequence.subject as BatchSubject;
    if (!hasResolvableSubject(subject)) {
      return { ok: false, code: "invalid_subject" };
    }
  }

  const updates: Partial<typeof prospectingSequences.$inferInsert> = {
    status: next,
    mode: modeForStatus(next),
    updatedAt: now,
  };

  if (next === "live") {
    // Publish / resume → schedule the next refresh for the next sweep poll.
    updates.nextRefreshAt = now;
  } else if (next === "archived") {
    updates.archivedAt = now;
    updates.nextRefreshAt = null;
  }

  const [updated] = await db
    .update(prospectingSequences)
    .set(updates)
    .where(eq(prospectingSequences.id, sequence.id))
    .returning();

  return { ok: true, sequence: updated };
}

/**
 * Fetch a Sequence owner-scoped (CC-Ownership). Returns `null` for a non-owned or
 * non-existent id so the caller can answer `404` without disclosing the row
 * (Req 13.2). A convenience for the lifecycle / edit routes.
 */
export async function loadOwnedSequence(
  db: Database,
  id: string,
  ownerRep: string
): Promise<ProspectingSequence | null> {
  const [seq] = await db
    .select()
    .from(prospectingSequences)
    .where(
      and(
        eq(prospectingSequences.id, id),
        eq(prospectingSequences.ownerRep, ownerRep)
      )
    )
    .limit(1);
  return seq ?? null;
}
