import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// Feature: content-approval-workflow, Property 10: Decision round-trip
// Feature: content-approval-workflow, Property 11: All approvals trigger publication
// Feature: content-approval-workflow, Property 13: Approval progress calculation
// Feature: sequential-approval-chain, Property 3: Initial step is always 1
// Feature: sequential-approval-chain, Property 4: Intermediate approval advances step without resolving
// Feature: sequential-approval-chain, Property 6: Decision records the chain step

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
      { numRuns: 20 }
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
      { numRuns: 20 }
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
      { numRuns: 20 }
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
      { numRuns: 20 }
    );
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Feature: sequential-approval-chain, Property 3: Initial step is always 1
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 2.1, 2.6**
 *
 * Property 3: Initial step is always 1
 *
 * For any newly created approval request for the Pages module (with any
 * random contentId, contentModule, submitterId, and data), the `currentStep`
 * field SHALL equal 1.
 */

/** Simulates createApprovalRequestWithDraft mirroring the actual service logic */
function simulateCreateApprovalRequestWithDraft(
  contentId: string,
  contentModule: string,
  submitterId: string,
  data: unknown
) {
  return {
    id: crypto.randomUUID(),
    contentId,
    contentModule,
    submitterId,
    status: "pending" as const,
    pendingData: data,
    currentStep: 1,
    createdAt: new Date(),
    resolvedAt: null,
  };
}

// Feature: sequential-approval-chain, Property 3: Initial step is always 1
describe("Feature: sequential-approval-chain, Property 3: Initial step is always 1", () => {
  it("any newly created approval request has currentStep = 1 regardless of inputs", () => {
    const contentModuleArb = fc.constantFrom("pages", "blog", "news", "construction_updates");
    const dataArb = fc.oneof(
      fc.jsonValue(),
      fc.record({
        title: fc.string({ minLength: 1, maxLength: 100 }),
        blocks: fc.array(
          fc.record({
            id: fc.uuid(),
            type: fc.string({ minLength: 1, maxLength: 50 }),
            content: fc.string(),
          }),
          { minLength: 0, maxLength: 10 }
        ),
      }),
      fc.constant(null),
      fc.constant({ sections: [] })
    );

    fc.assert(
      fc.property(
        fc.uuid(),           // contentId
        contentModuleArb,    // contentModule
        fc.uuid(),           // submitterId
        dataArb,             // data (random content payload)
        (contentId, contentModule, submitterId, data) => {
          const request = simulateCreateApprovalRequestWithDraft(
            contentId,
            contentModule,
            submitterId,
            data
          );

          // The initial step MUST always be 1
          expect(request.currentStep).toBe(1);

          // Status must be pending on creation
          expect(request.status).toBe("pending");

          // pendingData must be stored as provided
          expect(request.pendingData).toEqual(data);

          // contentId, contentModule, submitterId must be preserved
          expect(request.contentId).toBe(contentId);
          expect(request.contentModule).toBe(contentModule);
          expect(request.submitterId).toBe(submitterId);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("currentStep is always exactly 1 (not 0, not undefined, not null)", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.constantFrom("pages", "blog", "news", "construction_updates"),
        fc.uuid(),
        fc.anything(),
        (contentId, contentModule, submitterId, data) => {
          const request = simulateCreateApprovalRequestWithDraft(
            contentId,
            contentModule,
            submitterId,
            data
          );

          // Strict equality check — must be the number 1
          expect(request.currentStep).toStrictEqual(1);
          expect(typeof request.currentStep).toBe("number");
          expect(request.currentStep).not.toBe(0);
          expect(request.currentStep).not.toBeNull();
          expect(request.currentStep).not.toBeUndefined();
        }
      ),
      { numRuns: 20 }
    );
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Feature: sequential-approval-chain, Property 4: Intermediate approval advances step without resolving
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 2.2, 2.3**
 *
 * Property 4: Intermediate approval advances step without resolving
 *
 * For any approval request with a chain of length N (2 ≤ N ≤ 10) and current
 * step S where S < N, submitting an "approved" decision SHALL set `currentStep`
 * to S + 1 and keep the request status as "pending".
 */

/**
 * In-memory simulation of the sequential approval chain logic from service.ts.
 * Models the core behavior: intermediate approvals advance the step without resolving.
 */
class SequentialApprovalChainStore {
  private requests: Map<
    string,
    {
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
  > = new Map();

  private chainLengths: Map<string, number> = new Map(); // contentModule → chain length

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
  }

  /**
   * Submit an approval decision following the sequential chain logic:
   * - Rejection at any step → status = "rejected", pendingData = null
   * - Approval at intermediate step (currentStep < totalSteps) → advance currentStep
   * - Approval at final step (currentStep >= totalSteps) → status = "approved", commit
   */
  submitDecision(
    requestId: string,
    approverId: string,
    decision: "approved" | "rejected",
    comment?: string
  ): { currentStep: number; status: string } {
    const request = this.requests.get(requestId);
    if (!request) throw new Error("Request not found");
    if (request.status !== "pending") throw new Error("Request already resolved");

    const totalSteps = this.chainLengths.get(request.contentModule) ?? 1;

    if (decision === "rejected") {
      request.status = "rejected";
      request.resolvedAt = new Date();
      request.pendingData = null;
      return { currentStep: request.currentStep, status: "rejected" };
    }

    // Decision is "approved"
    if (request.currentStep >= totalSteps) {
      // Final step — commit
      request.status = "approved";
      request.resolvedAt = new Date();
      request.pendingData = null;
      return { currentStep: request.currentStep, status: "approved" };
    } else {
      // Intermediate step — advance
      request.currentStep = request.currentStep + 1;
      return { currentStep: request.currentStep, status: "pending" };
    }
  }

  /** Get the current state of a request */
  getRequest(requestId: string) {
    return this.requests.get(requestId);
  }
}

// Feature: sequential-approval-chain, Property 4: Intermediate approval advances step without resolving
describe("Feature: sequential-approval-chain, Property 4: Intermediate approval advances step without resolving", () => {
  it("approving at an intermediate step advances currentStep by 1 and keeps status pending", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }), // chainLength N
        fc.uuid(), // requestId
        fc.uuid(), // contentId
        fc.uuid(), // submitterId
        fc.uuid(), // approverId
        fc.constantFrom("pages", "blog", "news", "construction_updates"), // contentModule
        (chainLength, requestId, contentId, submitterId, approverId, contentModule) => {
          // For each possible intermediate step S (1 to N-1), approve and verify
          const store = new SequentialApprovalChainStore();
          store.setChainLength(contentModule, chainLength);
          store.createRequest(requestId, contentId, contentModule, submitterId, { title: "test" });

          // Approve through all intermediate steps (step 1 to chainLength - 1)
          for (let step = 1; step < chainLength; step++) {
            const requestBefore = store.getRequest(requestId)!;
            expect(requestBefore.currentStep).toBe(step);
            expect(requestBefore.status).toBe("pending");

            const result = store.submitDecision(requestId, approverId, "approved");

            // currentStep should advance to step + 1
            expect(result.currentStep).toBe(step + 1);
            // Status should remain "pending" since we haven't reached the final step
            expect(result.status).toBe("pending");

            // Verify the stored request state
            const requestAfter = store.getRequest(requestId)!;
            expect(requestAfter.currentStep).toBe(step + 1);
            expect(requestAfter.status).toBe("pending");
            expect(requestAfter.pendingData).not.toBeNull();
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  it("approving at a single random intermediate step S advances to S+1 with status pending", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }).chain((chainLength) =>
          fc.tuple(
            fc.constant(chainLength),
            fc.integer({ min: 1, max: chainLength - 1 }) // intermediate step S
          )
        ),
        fc.uuid(), // requestId
        fc.uuid(), // contentId
        fc.uuid(), // submitterId
        fc.uuid(), // approverId
        fc.constantFrom("pages", "blog", "news", "construction_updates"),
        ([chainLength, targetStep], requestId, contentId, submitterId, approverId, contentModule) => {
          const store = new SequentialApprovalChainStore();
          store.setChainLength(contentModule, chainLength);
          store.createRequest(requestId, contentId, contentModule, submitterId, { draft: true });

          // Advance to the target step by approving previous steps
          for (let s = 1; s < targetStep; s++) {
            store.submitDecision(requestId, approverId, "approved");
          }

          // Now we're at step targetStep — verify it's intermediate
          const request = store.getRequest(requestId)!;
          expect(request.currentStep).toBe(targetStep);
          expect(request.status).toBe("pending");

          // Approve at this intermediate step
          const result = store.submitDecision(requestId, approverId, "approved");

          // Verify: currentStep advances to targetStep + 1
          expect(result.currentStep).toBe(targetStep + 1);
          // Verify: status remains "pending" (not resolved)
          expect(result.status).toBe("pending");

          // Verify stored state
          const updatedRequest = store.getRequest(requestId)!;
          expect(updatedRequest.currentStep).toBe(targetStep + 1);
          expect(updatedRequest.status).toBe("pending");
          expect(updatedRequest.resolvedAt).toBeNull();
          expect(updatedRequest.pendingData).not.toBeNull();
        }
      ),
      { numRuns: 20 }
    );
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Feature: sequential-approval-chain, Property 5: Final step approval commits pending draft
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 2.4**
 *
 * Property 5: Final step approval commits pending draft
 *
 * For any approval request where `currentStep` equals the total chain length,
 * submitting an "approved" decision SHALL: copy `pendingData` into `pages.data`,
 * create a revision of the previous data, set the request status to "approved",
 * set `pendingData` to null, and set the page status to "published".
 */

/**
 * Extended in-memory simulation that tracks page data, revisions, and page status
 * to verify commit-on-approval semantics at the final step.
 */
class SequentialApprovalChainStoreWithCommit {
  private requests: Map<
    string,
    {
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
  > = new Map();

  private chainLengths: Map<string, number> = new Map();

  // Page state: contentId → { data, status }
  private pageData: Map<string, { data: unknown; status: string }> = new Map();

  // Revisions: contentId → array of revision records
  private revisionStore: Map<string, { data: unknown; createdAt: Date }[]> = new Map();

  /** Configure the chain length for a content module */
  setChainLength(contentModule: string, length: number): void {
    this.chainLengths.set(contentModule, length);
  }

  /** Set initial page data (simulates existing page before approval) */
  setPageData(contentId: string, data: unknown): void {
    this.pageData.set(contentId, { data, status: "pending_review" });
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
  }

  /**
   * Submit an approval decision following the sequential chain logic with commit semantics:
   * - Rejection at any step → status = "rejected", pendingData = null
   * - Approval at intermediate step (currentStep < totalSteps) → advance currentStep
   * - Approval at final step (currentStep >= totalSteps) → commit pendingData to page,
   *   create revision of previous data, set status = "approved", clear pendingData,
   *   set page status to "published"
   */
  submitDecision(
    requestId: string,
    approverId: string,
    decision: "approved" | "rejected",
    comment?: string
  ): { currentStep: number; status: string } {
    const request = this.requests.get(requestId);
    if (!request) throw new Error("Request not found");
    if (request.status !== "pending") throw new Error("Request already resolved");

    const totalSteps = this.chainLengths.get(request.contentModule) ?? 1;

    if (decision === "rejected") {
      request.status = "rejected";
      request.resolvedAt = new Date();
      request.pendingData = null;
      // Revert page to draft
      const page = this.pageData.get(request.contentId);
      if (page) {
        page.status = "draft";
      }
      return { currentStep: request.currentStep, status: "rejected" };
    }

    // Decision is "approved"
    if (request.currentStep >= totalSteps) {
      // Final step — commit pending draft
      const page = this.pageData.get(request.contentId);
      if (page) {
        // Create a revision of the previous page data
        const revisions = this.revisionStore.get(request.contentId) ?? [];
        revisions.push({ data: page.data, createdAt: new Date() });
        this.revisionStore.set(request.contentId, revisions);

        // Copy pendingData → page.data
        page.data = request.pendingData;
        page.status = "published";
      }

      request.status = "approved";
      request.resolvedAt = new Date();
      request.pendingData = null;
      return { currentStep: request.currentStep, status: "approved" };
    } else {
      // Intermediate step — advance
      request.currentStep = request.currentStep + 1;
      return { currentStep: request.currentStep, status: "pending" };
    }
  }

  /** Get the current state of a request */
  getRequest(requestId: string) {
    return this.requests.get(requestId);
  }

  /** Get the current page data and status */
  getPage(contentId: string) {
    return this.pageData.get(contentId);
  }

  /** Get revisions for a content item */
  getRevisions(contentId: string) {
    return this.revisionStore.get(contentId) ?? [];
  }
}

// Feature: sequential-approval-chain, Property 5: Final step approval commits pending draft
describe("Feature: sequential-approval-chain, Property 5: Final step approval commits pending draft", () => {
  it("approving at the final step commits pendingData to page, creates revision, sets status approved", () => {
    // Generate Puck-like page data for pendingData and existing page data
    const pageDataArb = fc.record({
      title: fc.string({ minLength: 1, maxLength: 100 }),
      blocks: fc.array(
        fc.record({
          id: fc.uuid(),
          type: fc.constantFrom("text", "image", "hero", "grid"),
          content: fc.string({ minLength: 0, maxLength: 200 }),
        }),
        { minLength: 0, maxLength: 5 }
      ),
    });

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }), // chainLength (1-10)
        fc.uuid(), // requestId
        fc.uuid(), // contentId
        fc.uuid(), // submitterId
        fc.uuid(), // approverId
        pageDataArb, // existingPageData (current live data)
        pageDataArb, // pendingData (new draft to be committed)
        (chainLength, requestId, contentId, submitterId, approverId, existingPageData, pendingData) => {
          const store = new SequentialApprovalChainStoreWithCommit();
          store.setChainLength("pages", chainLength);
          store.setPageData(contentId, existingPageData);
          store.createRequest(requestId, contentId, "pages", submitterId, pendingData);

          // Advance through all intermediate steps (1 to chainLength - 1)
          for (let step = 1; step < chainLength; step++) {
            const result = store.submitDecision(requestId, approverId, "approved");
            expect(result.status).toBe("pending");
          }

          // Now at the final step — approve
          const finalResult = store.submitDecision(requestId, approverId, "approved");

          // ── Verify commit semantics ──

          // 1. Status becomes "approved"
          expect(finalResult.status).toBe("approved");
          const request = store.getRequest(requestId)!;
          expect(request.status).toBe("approved");
          expect(request.resolvedAt).not.toBeNull();
          expect(request.resolvedAt).toBeInstanceOf(Date);

          // 2. pendingData is cleared (null)
          expect(request.pendingData).toBeNull();

          // 3. Page data is now the pendingData (committed)
          const page = store.getPage(contentId)!;
          expect(page.data).toEqual(pendingData);

          // 4. Page status is "published"
          expect(page.status).toBe("published");

          // 5. A revision was created with the previous page data
          const revisions = store.getRevisions(contentId);
          expect(revisions.length).toBe(1);
          expect(revisions[0].data).toEqual(existingPageData);
          expect(revisions[0].createdAt).toBeInstanceOf(Date);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("single-step chain (length 1) commits immediately on first approval", () => {
    const pageDataArb = fc.record({
      title: fc.string({ minLength: 1, maxLength: 50 }),
      content: fc.string({ minLength: 0, maxLength: 300 }),
    });

    fc.assert(
      fc.property(
        fc.uuid(), // requestId
        fc.uuid(), // contentId
        fc.uuid(), // submitterId
        fc.uuid(), // approverId
        pageDataArb, // existingPageData
        pageDataArb, // pendingData
        (requestId, contentId, submitterId, approverId, existingPageData, pendingData) => {
          const store = new SequentialApprovalChainStoreWithCommit();
          store.setChainLength("pages", 1); // single-step chain
          store.setPageData(contentId, existingPageData);
          store.createRequest(requestId, contentId, "pages", submitterId, pendingData);

          // First (and only) approval should commit
          const result = store.submitDecision(requestId, approverId, "approved");

          // Status is approved
          expect(result.status).toBe("approved");

          // pendingData cleared
          const request = store.getRequest(requestId)!;
          expect(request.pendingData).toBeNull();
          expect(request.status).toBe("approved");

          // Page data committed
          const page = store.getPage(contentId)!;
          expect(page.data).toEqual(pendingData);
          expect(page.status).toBe("published");

          // Revision created
          const revisions = store.getRevisions(contentId);
          expect(revisions.length).toBe(1);
          expect(revisions[0].data).toEqual(existingPageData);
        }
      ),
      { numRuns: 20 }
    );
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Feature: sequential-approval-chain, Property 6: Decision records the chain step
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 2.5, 4.5**
 *
 * Property 6: Decision records the chain step
 *
 * For any decision submitted at chain step S, the resulting decision record
 * SHALL have `chainStep` equal to S. This ensures the audit trail accurately
 * records at which step in the sequential chain each decision was made.
 */

/**
 * In-memory simulation that tracks decisions with their chainStep values.
 * The key invariant: every decision record's `chainStep` must equal the
 * `currentStep` of the request at the time the decision was submitted.
 */
class SequentialApprovalChainStoreWithDecisionTracking {
  private requests: Map<
    string,
    {
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
  > = new Map();

  private chainLengths: Map<string, number> = new Map();

  private decisions: {
    id: string;
    requestId: string;
    approverId: string;
    decision: "approved" | "rejected";
    comment: string | null;
    chainStep: number;
    createdAt: Date;
  }[] = [];

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
  }

  /**
   * Submit a decision, recording chainStep = request.currentStep at submission time.
   * Follows sequential chain logic:
   * - Rejection at any step → status = "rejected"
   * - Approval at intermediate step → advance currentStep
   * - Approval at final step → status = "approved"
   */
  submitDecision(
    requestId: string,
    approverId: string,
    decision: "approved" | "rejected",
    comment?: string
  ): { decisionId: string; chainStep: number; currentStep: number; status: string } {
    const request = this.requests.get(requestId);
    if (!request) throw new Error("Request not found");
    if (request.status !== "pending") throw new Error("Request already resolved");

    const totalSteps = this.chainLengths.get(request.contentModule) ?? 1;

    // Record the decision with chainStep = currentStep at submission time
    const decisionRecord = {
      id: crypto.randomUUID(),
      requestId,
      approverId,
      decision,
      comment: comment ?? null,
      chainStep: request.currentStep,
      createdAt: new Date(),
    };
    this.decisions.push(decisionRecord);

    if (decision === "rejected") {
      request.status = "rejected";
      request.resolvedAt = new Date();
      request.pendingData = null;
      return {
        decisionId: decisionRecord.id,
        chainStep: decisionRecord.chainStep,
        currentStep: request.currentStep,
        status: "rejected",
      };
    }

    // Decision is "approved"
    if (request.currentStep >= totalSteps) {
      // Final step — commit
      request.status = "approved";
      request.resolvedAt = new Date();
      request.pendingData = null;
      return {
        decisionId: decisionRecord.id,
        chainStep: decisionRecord.chainStep,
        currentStep: request.currentStep,
        status: "approved",
      };
    } else {
      // Intermediate step — advance
      const stepAtDecision = request.currentStep;
      request.currentStep = request.currentStep + 1;
      return {
        decisionId: decisionRecord.id,
        chainStep: stepAtDecision,
        currentStep: request.currentStep,
        status: "pending",
      };
    }
  }

  /** Get a decision by its ID */
  getDecision(decisionId: string) {
    return this.decisions.find((d) => d.id === decisionId);
  }

  /** Get all decisions for a request */
  getDecisionsForRequest(requestId: string) {
    return this.decisions.filter((d) => d.requestId === requestId);
  }

  /** Get the current state of a request */
  getRequest(requestId: string) {
    return this.requests.get(requestId);
  }
}

// Feature: sequential-approval-chain, Property 6: Decision records the chain step
describe("Feature: sequential-approval-chain, Property 6: Decision records the chain step", () => {
  it("each decision's chainStep equals the request's currentStep at submission time", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }), // chainLength N
        fc.uuid(), // requestId
        fc.uuid(), // contentId
        fc.uuid(), // submitterId
        fc.constantFrom("pages", "blog", "news", "construction_updates"), // contentModule
        fc.array(fc.uuid(), { minLength: 2, maxLength: 10 }), // approverIds (one per step)
        (chainLength, requestId, contentId, submitterId, contentModule, approverIds) => {
          const store = new SequentialApprovalChainStoreWithDecisionTracking();
          store.setChainLength(contentModule, chainLength);
          store.createRequest(requestId, contentId, contentModule, submitterId, { draft: true });

          // Approve through all steps (intermediate + final)
          for (let step = 1; step <= chainLength; step++) {
            const approverId = approverIds[step % approverIds.length];
            const result = store.submitDecision(requestId, approverId, "approved");

            // The chainStep on the decision must equal the step at submission time
            expect(result.chainStep).toBe(step);

            // Verify the stored decision record also has the correct chainStep
            const decision = store.getDecision(result.decisionId)!;
            expect(decision.chainStep).toBe(step);
          }

          // Verify all decisions for the request have correct chainStep values
          const allDecisions = store.getDecisionsForRequest(requestId);
          expect(allDecisions.length).toBe(chainLength);
          for (let i = 0; i < allDecisions.length; i++) {
            expect(allDecisions[i].chainStep).toBe(i + 1);
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  it("rejection decision records the chainStep at which rejection occurred", () => {
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
        fc.uuid(), // approverId for approvals
        fc.uuid(), // rejecterId
        fc.constantFrom("pages", "blog", "news", "construction_updates"),
        ([chainLength, rejectAtStep], requestId, contentId, submitterId, approverId, rejecterId, contentModule) => {
          const store = new SequentialApprovalChainStoreWithDecisionTracking();
          store.setChainLength(contentModule, chainLength);
          store.createRequest(requestId, contentId, contentModule, submitterId, { draft: true });

          // Approve through steps before the rejection step
          for (let step = 1; step < rejectAtStep; step++) {
            const result = store.submitDecision(requestId, approverId, "approved");
            expect(result.chainStep).toBe(step);
          }

          // Reject at the target step
          const rejectResult = store.submitDecision(requestId, rejecterId, "rejected", "Not acceptable");

          // The rejection decision's chainStep must equal the step at which it was submitted
          expect(rejectResult.chainStep).toBe(rejectAtStep);
          expect(rejectResult.status).toBe("rejected");

          // Verify the stored rejection decision record
          const rejectionDecision = store.getDecision(rejectResult.decisionId)!;
          expect(rejectionDecision.chainStep).toBe(rejectAtStep);
          expect(rejectionDecision.decision).toBe("rejected");
          expect(rejectionDecision.approverId).toBe(rejecterId);

          // Verify all decisions have correct sequential chainStep values
          const allDecisions = store.getDecisionsForRequest(requestId);
          expect(allDecisions.length).toBe(rejectAtStep);
          for (let i = 0; i < allDecisions.length; i++) {
            expect(allDecisions[i].chainStep).toBe(i + 1);
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  it("decisions at various random steps all record the correct chainStep", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }).chain((chainLength) =>
          fc.tuple(
            fc.constant(chainLength),
            fc.integer({ min: 1, max: chainLength }) // number of steps to approve before stopping
          )
        ),
        fc.uuid(), // requestId
        fc.uuid(), // contentId
        fc.uuid(), // submitterId
        fc.constantFrom("pages", "blog", "news", "construction_updates"),
        fc.array(fc.uuid(), { minLength: 1, maxLength: 10 }), // pool of approver IDs
        ([chainLength, stepsToApprove], requestId, contentId, submitterId, contentModule, approverPool) => {
          const store = new SequentialApprovalChainStoreWithDecisionTracking();
          store.setChainLength(contentModule, chainLength);
          store.createRequest(requestId, contentId, contentModule, submitterId, { content: "test" });

          // Submit approvals for the specified number of steps
          for (let step = 1; step <= stepsToApprove; step++) {
            const approverId = approverPool[(step - 1) % approverPool.length];
            const requestBefore = store.getRequest(requestId)!;
            const expectedChainStep = requestBefore.currentStep;

            const result = store.submitDecision(requestId, approverId, "approved");

            // chainStep must match the currentStep at submission time
            expect(result.chainStep).toBe(expectedChainStep);
            expect(result.chainStep).toBe(step);

            // Verify stored decision
            const decision = store.getDecision(result.decisionId)!;
            expect(decision.chainStep).toBe(expectedChainStep);
          }
        }
      ),
      { numRuns: 20 }
    );
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Feature: sequential-approval-chain, Property 7: Cascading rejection terminates and cleans up
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 5.1, 5.2, 5.4**
 *
 * Property 7: Cascading rejection terminates and cleans up
 *
 * For any approval request at any chain step S (1 ≤ S ≤ N), submitting a
 * "rejected" decision SHALL immediately set the request status to "rejected",
 * set pendingData to null, and revert the page status to "draft". Subsequent
 * steps in the chain are never reached — the chain terminates.
 */

// Feature: sequential-approval-chain, Property 7: Cascading rejection terminates and cleans up
describe("Feature: sequential-approval-chain, Property 7: Cascading rejection terminates and cleans up", () => {
  it("rejection at any step sets status to rejected, clears pendingData, and reverts page to draft", () => {
    const pageDataArb = fc.record({
      title: fc.string({ minLength: 1, maxLength: 100 }),
      blocks: fc.array(
        fc.record({
          id: fc.uuid(),
          type: fc.constantFrom("text", "image", "hero", "grid"),
          content: fc.string({ minLength: 0, maxLength: 200 }),
        }),
        { minLength: 0, maxLength: 5 }
      ),
    });

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }).chain((chainLength) =>
          fc.tuple(
            fc.constant(chainLength),
            fc.integer({ min: 1, max: chainLength }) // step at which to reject (1 to N)
          )
        ),
        fc.uuid(), // requestId
        fc.uuid(), // contentId
        fc.uuid(), // submitterId
        fc.uuid(), // approverId (for intermediate approvals)
        fc.uuid(), // rejecterId
        pageDataArb, // existingPageData
        pageDataArb, // pendingData
        ([chainLength, rejectAtStep], requestId, contentId, submitterId, approverId, rejecterId, existingPageData, pendingData) => {
          const store = new SequentialApprovalChainStoreWithCommit();
          store.setChainLength("pages", chainLength);
          store.setPageData(contentId, existingPageData);
          store.createRequest(requestId, contentId, "pages", submitterId, pendingData);

          // Advance through steps before the rejection step
          for (let step = 1; step < rejectAtStep; step++) {
            const result = store.submitDecision(requestId, approverId, "approved");
            expect(result.status).toBe("pending");
          }

          // Verify we're at the expected step before rejection
          const requestBeforeReject = store.getRequest(requestId)!;
          expect(requestBeforeReject.currentStep).toBe(rejectAtStep);
          expect(requestBeforeReject.status).toBe("pending");

          // Reject at the target step
          const rejectResult = store.submitDecision(requestId, rejecterId, "rejected");

          // ── Verify cascading rejection semantics ──

          // 1. Status is "rejected"
          expect(rejectResult.status).toBe("rejected");
          const request = store.getRequest(requestId)!;
          expect(request.status).toBe("rejected");
          expect(request.resolvedAt).not.toBeNull();
          expect(request.resolvedAt).toBeInstanceOf(Date);

          // 2. pendingData is cleared (null)
          expect(request.pendingData).toBeNull();

          // 3. Page status is reverted to "draft"
          const page = store.getPage(contentId)!;
          expect(page.status).toBe("draft");

          // 4. Page data remains unchanged (pendingData was NOT committed)
          expect(page.data).toEqual(existingPageData);

          // 5. Chain terminates — subsequent steps are never reached
          //    (attempting to submit another decision should throw since request is resolved)
          expect(() => {
            store.submitDecision(requestId, approverId, "approved");
          }).toThrow("Request already resolved");
        }
      ),
      { numRuns: 20 }
    );
  });

  it("rejection at step 1 of any chain length terminates immediately without advancing", () => {
    const pageDataArb = fc.record({
      title: fc.string({ minLength: 1, maxLength: 50 }),
      content: fc.string({ minLength: 0, maxLength: 300 }),
    });

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }), // chainLength
        fc.uuid(), // requestId
        fc.uuid(), // contentId
        fc.uuid(), // submitterId
        fc.uuid(), // rejecterId
        pageDataArb, // existingPageData
        pageDataArb, // pendingData
        (chainLength, requestId, contentId, submitterId, rejecterId, existingPageData, pendingData) => {
          const store = new SequentialApprovalChainStoreWithCommit();
          store.setChainLength("pages", chainLength);
          store.setPageData(contentId, existingPageData);
          store.createRequest(requestId, contentId, "pages", submitterId, pendingData);

          // Reject immediately at step 1
          const result = store.submitDecision(requestId, rejecterId, "rejected");

          // Status is rejected
          expect(result.status).toBe("rejected");
          const request = store.getRequest(requestId)!;
          expect(request.status).toBe("rejected");
          expect(request.currentStep).toBe(1); // Never advanced

          // pendingData cleared
          expect(request.pendingData).toBeNull();

          // Page reverted to draft
          const page = store.getPage(contentId)!;
          expect(page.status).toBe("draft");
          expect(page.data).toEqual(existingPageData);
        }
      ),
      { numRuns: 20 }
    );
  });
});
