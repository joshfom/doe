import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  isValidTransition,
  VALID_TRANSITIONS,
  getTransitionSideEffects,
} from "./lifecycle";
import type { TicketStatus } from "../types";

// Feature: support-ticketing-system, Property 2: Status transition validity

// ── Shared arbitraries ───────────────────────────────────────────────────────

/** All valid ticket statuses. */
const ALL_STATUSES: TicketStatus[] = [
  "open",
  "assigned",
  "in_progress",
  "resolved",
  "closed",
];

/** Generates a random TicketStatus value. */
const arbTicketStatus = fc.constantFrom<TicketStatus>(...ALL_STATUSES);

/**
 * The exhaustive set of valid (from, to) status transition pairs,
 * as defined in Requirements 2.1.
 */
const VALID_TRANSITION_SET: ReadonlySet<string> = new Set([
  "open->assigned",
  "open->in_progress",
  "assigned->in_progress",
  "in_progress->resolved",
  "resolved->closed",
  "resolved->in_progress",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Property 2: Status transition validity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 2.1, 2.2**
 *
 * Property 2: Status transition validity
 *
 * For any pair of ticket statuses (from, to), `isValidTransition(from, to)`
 * should return true if and only if the pair is in the set
 * {(open, assigned), (open, in_progress), (assigned, in_progress),
 * (in_progress, resolved), (resolved, closed), (resolved, in_progress)}.
 * All other pairs should return false.
 */
// Feature: support-ticketing-system, Property 2: Status transition validity
describe("Feature: support-ticketing-system, Property 2: Status transition validity", () => {
  it("isValidTransition returns true iff the (from, to) pair is in the valid transition set", () => {
    fc.assert(
      fc.property(arbTicketStatus, arbTicketStatus, (from, to) => {
        const key = `${from}->${to}`;
        const expected = VALID_TRANSITION_SET.has(key);
        const actual = isValidTransition(from, to);

        expect(actual).toBe(expected);
      }),
      { numRuns: 20 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 3: Status transition side effects
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates a valid (from, to) transition pair from the VALID_TRANSITIONS map.
 */
const arbValidTransition: fc.Arbitrary<{ from: TicketStatus; to: TicketStatus }> =
  fc.constantFrom(
    ...Object.entries(VALID_TRANSITIONS).flatMap(([from, tos]) =>
      (tos as TicketStatus[]).map((to) => ({
        from: from as TicketStatus,
        to,
      }))
    )
  );

/** Generates a UUID-like string for use as an assignee ID. */
const arbUuid = fc.uuid();

/**
 * **Validates: Requirements 2.3, 2.4, 2.5, 2.6**
 *
 * Property 3: Status transition side effects
 *
 * For any valid status transition on a ticket:
 * - If the new status is "assigned", the ticket's assignee_id must be non-null
 *   after the transition.
 * - If the new status is "resolved", the ticket's resolved_at must be set to a
 *   non-null timestamp.
 * - If the new status is "closed", the ticket's closed_at must be set to a
 *   non-null timestamp.
 * - If the transition is from "resolved" to "in_progress" (reopen), the
 *   ticket's resolved_at must be cleared to null.
 */
// Feature: support-ticketing-system, Property 3: Status transition side effects
describe("Feature: support-ticketing-system, Property 3: Status transition side effects", () => {
  it("assigned transition requires and sets assigneeId (Req 2.3)", () => {
    fc.assert(
      fc.property(arbUuid, (assigneeId) => {
        // Every path that leads to "assigned" is: open -> assigned
        const fields = getTransitionSideEffects("open", "assigned", assigneeId);
        expect(fields.assigneeId).toBe(assigneeId);
        expect(fields.assigneeId).not.toBeNull();
        expect(fields.assigneeId).not.toBeUndefined();
      }),
      { numRuns: 20 }
    );
  });

  it("assigned transition throws when assigneeId is missing (Req 2.3)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(undefined, undefined),
        () => {
          expect(() =>
            getTransitionSideEffects("open", "assigned", undefined)
          ).toThrow("Assignee is required for status 'assigned'");
        }
      ),
      { numRuns: 20 }
    );
  });

  it("resolved transition sets resolved_at to a non-null timestamp (Req 2.4)", () => {
    fc.assert(
      fc.property(arbUuid, (_seed) => {
        // The only path to "resolved" is: in_progress -> resolved
        const fields = getTransitionSideEffects("in_progress", "resolved");
        expect(fields.resolvedAt).toBeInstanceOf(Date);
        expect(fields.resolvedAt).not.toBeNull();
      }),
      { numRuns: 20 }
    );
  });

  it("closed transition sets closed_at to a non-null timestamp (Req 2.5)", () => {
    fc.assert(
      fc.property(arbUuid, (_seed) => {
        // The only path to "closed" is: resolved -> closed
        const fields = getTransitionSideEffects("resolved", "closed");
        expect(fields.closedAt).toBeInstanceOf(Date);
        expect(fields.closedAt).not.toBeNull();
      }),
      { numRuns: 20 }
    );
  });

  it("reopen (resolved -> in_progress) clears resolved_at to null (Req 2.6)", () => {
    fc.assert(
      fc.property(arbUuid, (_seed) => {
        const fields = getTransitionSideEffects("resolved", "in_progress");
        expect(fields.resolvedAt).toBeNull();
      }),
      { numRuns: 20 }
    );
  });

  it("for any valid transition, the correct side effects are applied", () => {
    fc.assert(
      fc.property(arbValidTransition, arbUuid, ({ from, to }, assigneeId) => {
        // For transitions to "assigned", always provide an assigneeId
        const aid = to === "assigned" ? assigneeId : undefined;
        const fields = getTransitionSideEffects(from, to, aid);

        // Status is always set
        expect(fields.status).toBe(to);

        // Req 2.3: assigned → assigneeId must be non-null
        if (to === "assigned") {
          expect(fields.assigneeId).toBe(assigneeId);
          expect(fields.assigneeId).not.toBeNull();
        }

        // Req 2.4: resolved → resolved_at must be a non-null Date
        if (to === "resolved") {
          expect(fields.resolvedAt).toBeInstanceOf(Date);
        }

        // Req 2.5: closed → closed_at must be a non-null Date
        if (to === "closed") {
          expect(fields.closedAt).toBeInstanceOf(Date);
        }

        // Req 2.6: resolved → in_progress (reopen) → resolved_at must be null
        if (from === "resolved" && to === "in_progress") {
          expect(fields.resolvedAt).toBeNull();
        }
      }),
      { numRuns: 20 }
    );
  });
});
