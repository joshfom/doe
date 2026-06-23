import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  applyTransition,
  type SequenceAction,
  type SequenceStatus,
} from "./lifecycle";

/**
 * Property test for the Sequence lifecycle state machine (task 2.2, NOT
 * optional).
 *
 * **Feature: prospecting-sequences, Property 1: Lifecycle transition validity**
 *
 * *For any* Sequence_Status and *any* requested lifecycle action, the
 * transition is permitted **if and only if** it is one of
 * `draft→publish→live`, `live→pause→paused`, `paused→resume→live`, or
 * `{draft,live,paused}→archive→archived`; a permitted action moves the Sequence
 * to exactly that next status, and a non-permitted action is rejected with a
 * validation error leaving the Sequence's status unchanged. At all times a
 * Sequence holds exactly one status of `draft`, `live`, `paused`, or
 * `archived`.
 *
 * **Validates: Requirements 1.1, 1.3, 1.4, 1.5, 1.6, 1.7**
 *
 * `applyTransition` (`lib/cms/prospecting/sequences/lifecycle.ts`) is a pure,
 * side-effect-free function: it returns `{ ok: true, next }` for an allowed
 * transition or `{ ok: false, code: "illegal_transition" }` otherwise. This
 * property pins all four guarantees over random status + lifecycle-action
 * streams:
 *
 *   (a) **Permitted iff an allowed edge** — the transition is accepted exactly
 *       when `(current, action)` is one of the four documented edges, computed
 *       here from an INDEPENDENT reference table so the property is meaningful
 *       (Req 1.3–1.7).
 *   (b) **Lands on the expected next status** — a permitted action returns
 *       exactly the documented target status (Req 1.3–1.6).
 *   (c) **Illegal rejected, status unchanged** — a non-permitted action is
 *       rejected with `illegal_transition` and the caller's status is left
 *       unchanged (Req 1.7).
 *   (d) **Closed status domain** — applying a stream of actions never produces
 *       a status outside `{draft, live, paused, archived}` (Req 1.1).
 *
 * Baseline for this non-optional property is 100 iterations.
 */

const NUM_RUNS = 100;

const STATUSES: readonly SequenceStatus[] = [
  "draft",
  "live",
  "paused",
  "archived",
];

const ACTIONS: readonly SequenceAction[] = [
  "publish",
  "pause",
  "resume",
  "archive",
];

/**
 * Independent reference table of the allowed transitions (design §1, Req
 * 1.3–1.7). Deliberately re-declared here rather than imported so the property
 * checks `applyTransition` against an external source of truth, not itself.
 *
 *   draft   --publish--> live
 *   live    --pause-->   paused
 *   paused  --resume-->  live
 *   {draft,live,paused} --archive--> archived
 *   archived: terminal
 */
const EXPECTED: Record<
  SequenceStatus,
  Partial<Record<SequenceAction, SequenceStatus>>
> = {
  draft: { publish: "live", archive: "archived" },
  live: { pause: "paused", archive: "archived" },
  paused: { resume: "live", archive: "archived" },
  archived: {},
};

const statusArb = fc.constantFrom(...STATUSES);
const actionArb = fc.constantFrom(...ACTIONS);

describe("Feature: prospecting-sequences, Property 1: Lifecycle transition validity", () => {
  it(
    "permits a transition iff it is an allowed edge, lands on the expected status, rejects illegal actions leaving status unchanged, and keeps status within the closed domain",
    () => {
      fc.assert(
        fc.property(
          statusArb,
          actionArb,
          (current: SequenceStatus, action: SequenceAction) => {
            const expectedNext = EXPECTED[current][action];
            const result = applyTransition(current, action);

            if (expectedNext !== undefined) {
              // (a) permitted iff an allowed edge + (b) lands on expected status.
              expect(result.ok).toBe(true);
              if (result.ok) {
                expect(result.next).toBe(expectedNext);
                // (d) the resulting status is always within the closed domain.
                expect(STATUSES).toContain(result.next);
              }
            } else {
              // (a) not an allowed edge ⇒ rejected, and
              // (c) rejected with `illegal_transition`, caller status unchanged.
              expect(result.ok).toBe(false);
              if (!result.ok) {
                expect(result.code).toBe("illegal_transition");
              }
              // The function is pure and returns no new status on rejection;
              // the caller therefore retains `current`, which stays in-domain.
              expect(STATUSES).toContain(current);
            }
          }
        ),
        { numRuns: NUM_RUNS }
      );
    }
  );

  it(
    "keeps status within the closed domain across an arbitrary stream of actions",
    () => {
      fc.assert(
        fc.property(
          statusArb,
          fc.array(actionArb, { minLength: 1, maxLength: 20 }),
          (start: SequenceStatus, actions: SequenceAction[]) => {
            let status = start;
            for (const action of actions) {
              const result = applyTransition(status, action);
              if (result.ok) {
                // A permitted action advances to exactly the documented target.
                expect(result.next).toBe(EXPECTED[status][action]);
                status = result.next;
              } else {
                // An illegal action leaves the status unchanged (Req 1.7).
                expect(result.code).toBe("illegal_transition");
              }
              // (d) Closed domain holds after every step (Req 1.1).
              expect(STATUSES).toContain(status);
            }

            // `archived` is terminal: once reached, no action escapes it.
            if (status === "archived") {
              for (const action of ACTIONS) {
                expect(applyTransition(status, action).ok).toBe(false);
              }
            }
          }
        ),
        { numRuns: NUM_RUNS }
      );
    }
  );
});
