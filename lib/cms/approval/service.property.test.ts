import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// Feature: content-approval-workflow, Property 10: Decision round-trip
// Feature: content-approval-workflow, Property 11: All approvals trigger publication
// Feature: content-approval-workflow, Property 13: Approval progress calculation

// ── Types ────────────────────────────────────────────────────────────────────

interface ApprovalRequestRecord {
  id: string;
  contentId: string;
  contentModule: string;
  submitterId: string;
  status: "pending" | "approved" | "rejected";
  createdAt: Date;
  resolvedAt: Date | null;
}

interface ApprovalDecisionRecord {
  id: string;
  requestId: string;
  approverId: string;
  decision: "approved" | "rejected";
  comment: string | null;
  createdAt: Date;
}

// ── In-memory store simulating decision submission and retrieval ─────────────

class ApprovalServiceStore {
  private requests: Map<string, ApprovalRequestRecord> = new Map();
  private decisions: ApprovalDecisionRecord[] = [];
  private assignedApprovers: Map<string, string[]> = new Map();
  private contentStatuses: Map<string, string> = new Map();

  /** Seed a pending approval request with assigned approvers */
  addPendingRequest(id: string, contentId: string, contentModule: string, submitterId: string, approverIds?: string[]): void {
    this.requests.set(id, {
      id,
      contentId,
      contentModule,
      submitterId,
      status: "pending",
      createdAt: new Date(),
      resolvedAt: null,
    });
    if (approverIds) {
      this.assignedApprovers.set(id, approverIds);
    }
    this.contentStatuses.set(contentId, "pending_review");
  }

  /**
   * Submit a decision for a pending approval request.
   * Mirrors the core logic from service.ts submitDecision:
   * - If rejected → immediately resolve, revert content to draft
   * - If approved and all approvers approved → publish content, resolve request
   */
  submitDecision(
    approvalRequestId: string,
    approverId: string,
    decision: "approved" | "rejected",
    comment?: string
  ): ApprovalDecisionRecord {
    const request = this.requests.get(approvalRequestId);
    if (!request) {
      throw new Error("Approval request not found");
    }
    if (request.status !== "pending") {
      throw new Error("Approval request is not pending");
    }

    const record: ApprovalDecisionRecord = {
      id: crypto.randomUUID(),
      requestId: approvalRequestId,
      approverId,
      decision,
      comment: comment ?? null,
      createdAt: new Date(),
    };
    this.decisions.push(record);

    if (decision === "rejected") {
      request.status = "rejected";
      request.resolvedAt = new Date();
      this.contentStatuses.set(request.contentId, "draft");
    } else {
      // Check if all assigned approvers have approved
      const approvers = this.assignedApprovers.get(approvalRequestId) ?? [];
      const approvedDecisions = this.decisions.filter(
        (d) => d.requestId === approvalRequestId && d.decision === "approved"
      );
      if (approvers.length > 0 && approvedDecisions.length >= approvers.length) {
        request.status = "approved";
        request.resolvedAt = new Date();
        this.contentStatuses.set(request.contentId, "published");
      }
    }

    return record;
  }

  /** Read back a decision by its ID */
  getDecision(decisionId: string): ApprovalDecisionRecord | undefined {
    return this.decisions.find((d) => d.id === decisionId);
  }

  /** Get the current request record */
  getRequest(requestId: string): ApprovalRequestRecord | undefined {
    return this.requests.get(requestId);
  }

  /** Get the current content status */
  getContentStatus(contentId: string): string | undefined {
    return this.contentStatuses.get(contentId);
  }

  /** Get approval progress: count of approved decisions vs total assigned approvers */
  getApprovalProgress(requestId: string): { approved: number; total: number; decisions: ApprovalDecisionRecord[] } {
    const approvers = this.assignedApprovers.get(requestId) ?? [];
    const requestDecisions = this.decisions.filter((d) => d.requestId === requestId);
    const approved = requestDecisions.filter((d) => d.decision === "approved").length;
    return { approved, total: approvers.length, decisions: requestDecisions };
  }
}

// ── Shared arbitraries ───────────────────────────────────────────────────────

const uuidArb = fc.uuid();
const decisionValueArb = fc.constantFrom<"approved" | "rejected">("approved", "rejected");
const optionalCommentArb = fc.option(
  fc.string({ minLength: 1, maxLength: 500 }).filter((s) => s.trim().length > 0),
  { nil: undefined }
);

// ─────────────────────────────────────────────────────────────────────────────
// Property 10: Decision round-trip
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 5.1, 5.2, 5.5**
 *
 * Property 10: Decision round-trip
 *
 * For any valid approver, pending approval request, decision value
 * ("approved" or "rejected"), and optional comment string, submitting
 * the decision and reading it back should return the same approver ID,
 * decision value, comment, and a non-null timestamp.
 */
// Feature: content-approval-workflow, Property 10: Decision round-trip
describe("Feature: content-approval-workflow, Property 10: Decision round-trip", () => {
  it("submitting a decision and reading it back preserves approver ID, decision, comment, and has a non-null timestamp", () => {
    fc.assert(
      fc.property(
        uuidArb, // approvalRequestId
        uuidArb, // contentId
        uuidArb, // submitterId
        uuidArb, // approverId
        decisionValueArb,
        optionalCommentArb,
        (approvalRequestId, contentId, submitterId, approverId, decision, comment) => {
          const store = new ApprovalServiceStore();

          // Seed a pending approval request
          store.addPendingRequest(approvalRequestId, contentId, "blog", submitterId);

          // Submit the decision
          const created = store.submitDecision(approvalRequestId, approverId, decision, comment);

          // Read it back
          const readBack = store.getDecision(created.id);

          // Must exist
          expect(readBack).toBeDefined();

          // Same approver ID
          expect(readBack!.approverId).toBe(approverId);

          // Same decision value
          expect(readBack!.decision).toBe(decision);

          // Same comment (undefined input → null stored)
          expect(readBack!.comment).toBe(comment ?? null);

          // Non-null timestamp
          expect(readBack!.createdAt).not.toBeNull();
          expect(readBack!.createdAt).toBeInstanceOf(Date);
        }
      ),
      { numRuns: 100 }
    );
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Property 11: All approvals trigger publication
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 5.3**
 *
 * Property 11: All approvals trigger publication
 *
 * For any approval request with N assigned approvers (N ≥ 1), when all N
 * approvers submit "approved" decisions, the content status should change
 * from "pending_review" to "published" and the request status should change
 * to "approved".
 */
// Feature: content-approval-workflow, Property 11: All approvals trigger publication
describe("Feature: content-approval-workflow, Property 11: All approvals trigger publication", () => {
  it("when all N approvers approve, content becomes published and request becomes approved", () => {
    fc.assert(
      fc.property(
        uuidArb, // approvalRequestId
        uuidArb, // contentId
        uuidArb, // submitterId
        fc.constantFrom("pages", "blog", "news", "construction_updates"), // contentModule
        fc.integer({ min: 1, max: 5 }).chain((n) =>
          fc.tuple(
            fc.constant(n),
            fc.uniqueArray(fc.uuid(), { minLength: n, maxLength: n })
          )
        ),
        (approvalRequestId, contentId, submitterId, contentModule, [n, approverIds]) => {
          const store = new ApprovalServiceStore();

          // Create a pending request with N assigned approvers
          store.addPendingRequest(approvalRequestId, contentId, contentModule, submitterId, approverIds);

          // Verify initial state
          expect(store.getContentStatus(contentId)).toBe("pending_review");
          expect(store.getRequest(approvalRequestId)!.status).toBe("pending");

          // Submit "approved" from each approver
          for (let i = 0; i < n; i++) {
            store.submitDecision(approvalRequestId, approverIds[i], "approved");

            if (i < n - 1) {
              // Before the last approval, request should still be pending
              expect(store.getRequest(approvalRequestId)!.status).toBe("pending");
              expect(store.getContentStatus(contentId)).toBe("pending_review");
            }
          }

          // After all approvals: content is published, request is approved
          expect(store.getContentStatus(contentId)).toBe("published");
          const finalRequest = store.getRequest(approvalRequestId)!;
          expect(finalRequest.status).toBe("approved");
          expect(finalRequest.resolvedAt).not.toBeNull();
          expect(finalRequest.resolvedAt).toBeInstanceOf(Date);
        }
      ),
      { numRuns: 100 }
    );
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Property 12: Any rejection triggers draft revert
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 5.4**
 *
 * Property 12: Any rejection triggers draft revert
 *
 * For any approval request with N assigned approvers (N ≥ 1), when any single
 * approver submits a "rejected" decision, the content status should change
 * from "pending_review" to "draft" and the request status should change to
 * "rejected", regardless of other approvers' decisions.
 */
// Feature: content-approval-workflow, Property 12: Any rejection triggers draft revert
describe("Feature: content-approval-workflow, Property 12: Any rejection triggers draft revert", () => {
  it("any single rejection reverts content to draft and request to rejected, regardless of prior approvals", () => {
    fc.assert(
      fc.property(
        uuidArb, // approvalRequestId
        uuidArb, // contentId
        uuidArb, // submitterId
        fc.constantFrom("pages", "blog", "news", "construction_updates"), // contentModule
        fc.integer({ min: 1, max: 5 }).chain((n) =>
          fc.tuple(
            fc.constant(n),
            fc.uniqueArray(fc.uuid(), { minLength: n, maxLength: n }),
            fc.integer({ min: 0, max: n - 1 }) // index of the rejecting approver
          )
        ),
        (approvalRequestId, contentId, submitterId, contentModule, [n, approverIds, rejectIndex]) => {
          const store = new ApprovalServiceStore();

          // Create a pending request with N assigned approvers
          store.addPendingRequest(approvalRequestId, contentId, contentModule, submitterId, approverIds);

          // Verify initial state
          expect(store.getContentStatus(contentId)).toBe("pending_review");
          expect(store.getRequest(approvalRequestId)!.status).toBe("pending");

          // Submit "approved" decisions from approvers before the rejecting one
          for (let i = 0; i < rejectIndex; i++) {
            store.submitDecision(approvalRequestId, approverIds[i], "approved");
          }

          // Submit "rejected" from the chosen approver
          store.submitDecision(approvalRequestId, approverIds[rejectIndex], "rejected");

          // After rejection: content is draft, request is rejected
          expect(store.getContentStatus(contentId)).toBe("draft");
          const finalRequest = store.getRequest(approvalRequestId)!;
          expect(finalRequest.status).toBe("rejected");
          expect(finalRequest.resolvedAt).not.toBeNull();
          expect(finalRequest.resolvedAt).toBeInstanceOf(Date);
        }
      ),
      { numRuns: 100 }
    );
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Property 13: Approval progress calculation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 5.6, 6.4**
 *
 * Property 13: Approval progress calculation
 *
 * For any approval request with N total assigned approvers and M submitted
 * "approved" decisions (0 ≤ M ≤ N), the progress should report exactly
 * M approved out of N total.
 */
// Feature: content-approval-workflow, Property 13: Approval progress calculation
describe("Feature: content-approval-workflow, Property 13: Approval progress calculation", () => {
  it("progress reports exactly M approved out of N total approvers", () => {
    fc.assert(
      fc.property(
        uuidArb, // approvalRequestId
        uuidArb, // contentId
        uuidArb, // submitterId
        fc.constantFrom("pages", "blog", "news", "construction_updates"), // contentModule
        fc.integer({ min: 1, max: 5 }).chain((n) =>
          fc.tuple(
            fc.constant(n),
            fc.uniqueArray(fc.uuid(), { minLength: n, maxLength: n }),
            fc.integer({ min: 0, max: n }) // M approvals to submit
          )
        ),
        (approvalRequestId, contentId, submitterId, contentModule, [n, approverIds, m]) => {
          const store = new ApprovalServiceStore();

          // Create a pending request with N assigned approvers
          store.addPendingRequest(approvalRequestId, contentId, contentModule, submitterId, approverIds);

          // Submit "approved" from the first M approvers
          for (let i = 0; i < m; i++) {
            store.submitDecision(approvalRequestId, approverIds[i], "approved");
          }

          // Get approval progress
          const progress = store.getApprovalProgress(approvalRequestId);

          // Assert: progress.approved === M and progress.total === N
          expect(progress.approved).toBe(m);
          expect(progress.total).toBe(n);
        }
      ),
      { numRuns: 100 }
    );
  });
});
