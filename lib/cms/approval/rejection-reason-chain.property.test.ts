import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

/**
 * Feature: sequential-approval-chain, Property 8: Rejection reason validation
 *
 * **Validates: Requirements 5.5**
 *
 * For any string composed entirely of whitespace (including empty string),
 * submitting a rejection SHALL be rejected with a 400 error. For any non-empty,
 * non-whitespace string, the rejection SHALL be accepted and the comment stored
 * verbatim.
 */

// ── Types ────────────────────────────────────────────────────────────────────

interface ApprovalRequestRecord {
  id: string;
  contentId: string;
  contentModule: string;
  submitterId: string;
  status: "pending" | "approved" | "rejected";
  currentStep: number;
  pendingData: unknown;
  createdAt: Date;
  resolvedAt: Date | null;
}

interface ApprovalDecisionRecord {
  id: string;
  requestId: string;
  approverId: string;
  decision: "approved" | "rejected";
  comment: string | null;
  chainStep: number;
  createdAt: Date;
}

// ── In-memory store simulating sequential chain with rejection reason validation ──

class SequentialChainRejectionReasonStore {
  private requests: Map<string, ApprovalRequestRecord> = new Map();
  private decisions: ApprovalDecisionRecord[] = [];
  private chainLengths: Map<string, number> = new Map();
  private pageStatuses: Map<string, string> = new Map();

  /** Configure the chain length for a content module */
  setChainLength(contentModule: string, length: number): void {
    this.chainLengths.set(contentModule, length);
  }

  /** Create a new approval request with currentStep = 1 */
  createRequest(
    id: string,
    contentId: string,
    contentModule: string,
    submitterId: string,
    pendingData: unknown
  ): void {
    this.requests.set(id, {
      id,
      contentId,
      contentModule,
      submitterId,
      status: "pending",
      currentStep: 1,
      pendingData,
      createdAt: new Date(),
      resolvedAt: null,
    });
    this.pageStatuses.set(contentId, "pending_review");
  }

  /** Advance the request to a specific step (simulates prior approvals) */
  advanceToStep(requestId: string, targetStep: number): void {
    const request = this.requests.get(requestId);
    if (!request) throw new Error("Request not found");
    request.currentStep = targetStep;
  }

  /**
   * Submit a rejection decision with reason validation.
   *
   * Mirrors the API route + service logic:
   * - Validates that the reason is non-empty and not whitespace-only (400 error)
   * - On valid rejection: stores the reason verbatim as the decision comment,
   *   records chainStep, sets status to "rejected", clears pendingData,
   *   reverts page to "draft"
   */
  submitRejection(
    requestId: string,
    approverId: string,
    comment: string
  ): { success: boolean; status: number; error?: string } {
    // Validate rejection reason: must be non-empty and not whitespace-only
    if (!comment || comment.trim().length === 0) {
      return {
        success: false,
        status: 400,
        error: "Rejection reason is required",
      };
    }

    const request = this.requests.get(requestId);
    if (!request) {
      return { success: false, status: 404, error: "Request not found" };
    }
    if (request.status !== "pending") {
      return { success: false, status: 409, error: "Request already resolved" };
    }

    // Record the rejection decision with chainStep = currentStep
    this.decisions.push({
      id: crypto.randomUUID(),
      requestId,
      approverId,
      decision: "rejected",
      comment, // stored verbatim
      chainStep: request.currentStep,
      createdAt: new Date(),
    });

    // Cascading rejection: terminate immediately
    request.status = "rejected";
    request.resolvedAt = new Date();
    request.pendingData = null;

    // Revert page to draft
    this.pageStatuses.set(request.contentId, "draft");

    return { success: true, status: 200 };
  }

  /** Get the current state of a request */
  getRequest(requestId: string): ApprovalRequestRecord | undefined {
    return this.requests.get(requestId);
  }

  /** Get all decisions for a request */
  getDecisionsForRequest(requestId: string): ApprovalDecisionRecord[] {
    return this.decisions.filter((d) => d.requestId === requestId);
  }

  /** Get page status */
  getPageStatus(contentId: string): string | undefined {
    return this.pageStatuses.get(contentId);
  }
}

// ── Arbitraries ──────────────────────────────────────────────────────────────

/** Generates whitespace-only strings (including empty string) */
const whitespaceOnlyArb = fc.oneof(
  fc.constant(""),
  fc.constant(" "),
  fc.constant("  "),
  fc.constant("\t"),
  fc.constant("\n"),
  fc.constant("\r"),
  fc.constant("\r\n"),
  fc.constant("  \t\n  "),
  fc.constant("\t\t\t"),
  fc.constant("   \n   \t   "),
  fc.constant("\f"),
  fc.constant("\v"),
  fc.stringMatching(/^[ \t\n\r]{1,20}$/)
);

/** Generates a non-empty, non-whitespace rejection reason string */
const validReasonArb = fc
  .string({ minLength: 1, maxLength: 500 })
  .filter((s) => s.trim().length > 0);

// ── Property Tests ───────────────────────────────────────────────────────────

// Feature: sequential-approval-chain, Property 8: Rejection reason validation
describe("Feature: sequential-approval-chain, Property 8: Rejection reason validation", () => {
  it("whitespace-only strings (including empty) are rejected with 400 at any chain step", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }), // chainLength
        fc.integer({ min: 1, max: 10 }).chain((chainLength) =>
          fc.integer({ min: 1, max: chainLength }) // currentStep (1 to chainLength)
        ),
        fc.uuid(), // requestId
        fc.uuid(), // contentId
        fc.uuid(), // submitterId
        fc.uuid(), // approverId
        whitespaceOnlyArb, // whitespace-only reason
        (chainLength, currentStep, requestId, contentId, submitterId, approverId, whitespaceReason) => {
          const store = new SequentialChainRejectionReasonStore();
          store.setChainLength("pages", chainLength);
          store.createRequest(requestId, contentId, "pages", submitterId, { draft: true });
          store.advanceToStep(requestId, currentStep);

          // Attempt rejection with whitespace-only reason
          const result = store.submitRejection(requestId, approverId, whitespaceReason);

          // Assert: rejected with 400
          expect(result.success).toBe(false);
          expect(result.status).toBe(400);
          expect(result.error).toBe("Rejection reason is required");

          // Assert: request remains pending and unchanged
          const request = store.getRequest(requestId)!;
          expect(request.status).toBe("pending");
          expect(request.currentStep).toBe(currentStep);
          expect(request.pendingData).not.toBeNull();
          expect(request.resolvedAt).toBeNull();

          // Assert: no decisions were recorded
          const decisions = store.getDecisionsForRequest(requestId);
          expect(decisions.length).toBe(0);

          // Assert: page status unchanged
          expect(store.getPageStatus(contentId)).toBe("pending_review");
        }
      ),
      { numRuns: 30 }
    );
  });

  it("valid non-whitespace strings are accepted and stored verbatim at any chain step", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }), // chainLength
        fc.integer({ min: 1, max: 10 }).chain((chainLength) =>
          fc.integer({ min: 1, max: chainLength }) // currentStep
        ),
        fc.uuid(), // requestId
        fc.uuid(), // contentId
        fc.uuid(), // submitterId
        fc.uuid(), // approverId
        validReasonArb, // valid reason
        (chainLength, currentStep, requestId, contentId, submitterId, approverId, reason) => {
          const store = new SequentialChainRejectionReasonStore();
          store.setChainLength("pages", chainLength);
          store.createRequest(requestId, contentId, "pages", submitterId, { draft: true });
          store.advanceToStep(requestId, currentStep);

          // Submit rejection with valid reason
          const result = store.submitRejection(requestId, approverId, reason);

          // Assert: accepted
          expect(result.success).toBe(true);
          expect(result.status).toBe(200);

          // Assert: request is now rejected
          const request = store.getRequest(requestId)!;
          expect(request.status).toBe("rejected");
          expect(request.pendingData).toBeNull();
          expect(request.resolvedAt).not.toBeNull();

          // Assert: decision recorded with comment stored verbatim
          const decisions = store.getDecisionsForRequest(requestId);
          expect(decisions.length).toBe(1);
          expect(decisions[0].decision).toBe("rejected");
          expect(decisions[0].comment).toBe(reason); // verbatim, not trimmed
          expect(decisions[0].chainStep).toBe(currentStep);

          // Assert: page reverted to draft
          expect(store.getPageStatus(contentId)).toBe("draft");
        }
      ),
      { numRuns: 30 }
    );
  });

  it("reasons with leading/trailing whitespace but non-whitespace content are accepted and stored verbatim", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }), // chainLength
        fc.uuid(), // requestId
        fc.uuid(), // contentId
        fc.uuid(), // submitterId
        fc.uuid(), // approverId
        validReasonArb, // core reason (non-whitespace content)
        fc.stringMatching(/^[ \t\n]{1,5}$/), // leading whitespace
        fc.stringMatching(/^[ \t\n]{1,5}$/), // trailing whitespace
        (chainLength, requestId, contentId, submitterId, approverId, coreReason, leadingWs, trailingWs) => {
          const store = new SequentialChainRejectionReasonStore();
          store.setChainLength("pages", chainLength);
          store.createRequest(requestId, contentId, "pages", submitterId, { content: "test" });

          const reasonWithWhitespace = leadingWs + coreReason + trailingWs;

          // Submit rejection
          const result = store.submitRejection(requestId, approverId, reasonWithWhitespace);

          // Assert: accepted because it contains non-whitespace content
          expect(result.success).toBe(true);
          expect(result.status).toBe(200);

          // Assert: stored VERBATIM (including the leading/trailing whitespace)
          const decisions = store.getDecisionsForRequest(requestId);
          expect(decisions.length).toBe(1);
          expect(decisions[0].comment).toBe(reasonWithWhitespace);
          // Verify it's exactly the same string — not trimmed
          expect(decisions[0].comment).toStrictEqual(reasonWithWhitespace);
        }
      ),
      { numRuns: 30 }
    );
  });

  it("the chainStep on the decision matches the currentStep at rejection time", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }).chain((chainLength) =>
          fc.tuple(
            fc.constant(chainLength),
            fc.integer({ min: 1, max: chainLength }) // step at which to reject
          )
        ),
        fc.uuid(), // requestId
        fc.uuid(), // contentId
        fc.uuid(), // submitterId
        fc.uuid(), // approverId
        validReasonArb, // valid reason
        ([chainLength, rejectAtStep], requestId, contentId, submitterId, approverId, reason) => {
          const store = new SequentialChainRejectionReasonStore();
          store.setChainLength("pages", chainLength);
          store.createRequest(requestId, contentId, "pages", submitterId, { draft: true });
          store.advanceToStep(requestId, rejectAtStep);

          // Submit rejection at the specified step
          const result = store.submitRejection(requestId, approverId, reason);

          // Assert: accepted
          expect(result.success).toBe(true);

          // Assert: chainStep on the decision matches the step at rejection time
          const decisions = store.getDecisionsForRequest(requestId);
          expect(decisions.length).toBe(1);
          expect(decisions[0].chainStep).toBe(rejectAtStep);
        }
      ),
      { numRuns: 30 }
    );
  });
});
