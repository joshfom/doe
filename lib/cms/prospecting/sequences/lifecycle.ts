/**
 * Sequence lifecycle state machine (design §1 "Lifecycle state machine";
 * Requirements 1.1, 1.3–1.8).
 *
 * A pure, side-effect-free module that owns the allowed Sequence_Status
 * transitions and the publish-validation guard, so both the owner-scoped bridge
 * routes and the tests share one source of truth.
 *
 * A Sequence holds exactly one Sequence_Status at any time (Req 1.1):
 *
 *   draft   --publish--> live
 *   live    --pause-->   paused
 *   paused  --resume-->  live
 *   {draft,live,paused} --archive--> archived
 *   archived: terminal (no outgoing transitions)  [Open Question 6 decision]
 *
 * `hasResolvableSubject` mirrors the guard `resolveSubjectToFilter`
 * (`lib/cms/prospecting/batch/run.ts`) applies: a subject resolves to a filter
 * iff it carries an `icpFilter`, a `clusterId`, or a `projectId`. Publish (and
 * any save / edit) re-checks it (Req 1.8, 2.8, 10.4).
 */

import type { BatchSubject } from "../batch/rerun-key";

/** The lifecycle state of a Sequence — exactly one at any time (Req 1.1). */
export type SequenceStatus = "draft" | "live" | "paused" | "archived";

/** A requested lifecycle action on a Sequence (Req 1.3–1.6). */
export type SequenceAction = "publish" | "pause" | "resume" | "archive";

/**
 * Allowed transitions (Req 1.3–1.7):
 *   draft   --publish--> live
 *   live    --pause-->   paused
 *   paused  --resume-->  live
 *   {draft,live,paused} --archive--> archived
 *   archived: terminal (no outgoing transitions)  [Open Question 6 decision]
 */
const TRANSITIONS: Record<
  SequenceStatus,
  Partial<Record<SequenceAction, SequenceStatus>>
> = {
  draft: { publish: "live", archive: "archived" },
  live: { pause: "paused", archive: "archived" },
  paused: { resume: "live", archive: "archived" },
  archived: {},
};

/** The outcome of applying a lifecycle action to a Sequence_Status. */
export type TransitionResult =
  | { ok: true; next: SequenceStatus }
  | { ok: false; code: "illegal_transition" };

/**
 * Pure: returns the next status for an allowed transition, or an
 * `illegal_transition` error when the action is not permitted from `current`.
 *
 * A permitted action moves the Sequence to exactly the next status; a
 * non-permitted action leaves the caller's status unchanged (Req 1.7).
 */
export function applyTransition(
  current: SequenceStatus,
  action: SequenceAction
): TransitionResult {
  const next = TRANSITIONS[current][action];
  if (next === undefined) {
    return { ok: false, code: "illegal_transition" };
  }
  return { ok: true, next };
}

/**
 * Pure: a Sequence is publishable only when its Subject resolves to a filter
 * (Req 1.8, 2.8, 10.4) — true iff the subject carries an `icpFilter`, a
 * `clusterId`, or a `projectId`. Mirrors `resolveSubjectToFilter`'s guard in
 * `lib/cms/prospecting/batch/run.ts`.
 */
export function hasResolvableSubject(subject: BatchSubject): boolean {
  return Boolean(
    subject.icpFilter || subject.clusterId || subject.projectId
  );
}
