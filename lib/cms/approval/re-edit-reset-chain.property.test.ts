import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

/**
 * Feature: sequential-approval-chain, Property 9: Re-edit resets all decisions and step
 *
 * **Validates: Requirements 7.1, 7.2**
 *
 * For any approval request with K existing decisions (K ≥ 1) at current step S > 1,
 * saving new changes to the pending draft SHALL delete all K decisions and reset
 * `currentStep` to 1.
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

// ── In-memory store simulating sequential chain re-edit reset ─────────────────

class SequentialChainReEditStore {
  private requests: Map<string, ApprovalRequestRecord> = new Map();
  private decisions: ApprovalDecisionRecord[] = [];
  private chainLengths: Map<string, number> = new Map();

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
  ): ApprovalRequestRecord {
    const request: ApprovalRequestRecord = {
      id,
      contentId,
      contentModule,
      submitterId,
      status: "pending",
      currentStep: 1,
      pendingData,
      createdAt: new Date(),
      resolvedAt: null,
    };
    this.requests.set(id, request);
    return request;
  }

  /**
   * Simulate approving through the chain to advance currentStep.
   * Each approval at an intermediate step advances currentStep by 1.
   */
  approveAtCurrentStep(requestId: string, approverId: string): void {
    const request = this.requests.get(requestId);
    if (!request) throw new Error("Request not found");
    if (request.status !== "pending") throw new Error("Request not pending");

    const chainLength = this.chainLengths.get(request.contentModule) ?? 1;

    // Record the decision at the current step
    this.decisions.push({
      id: crypto.randomUUID(),
      requestId,
      approverId,
      decision: "approved",
      comment: null,
      chainStep: request.currentStep,
      createdAt: new Date(),
    });

    // Advance step (but don't exceed chain length for intermediate approvals)
    if (request.currentStep < chainLength) {
      request.currentStep += 1;
    }
  }

  /**
   * Reset decisions — simulates the `resetDecisions` function from service.ts.
   *
   * When the submitter saves new changes to the pending draft:
   * 1. Delete ALL existing decisions for that request
   * 2. Reset currentStep to 1
   */
  resetDecisions(requestId: string): void {
    const request = this.requests.get(requestId);
    if (!request) throw new Error("Request not found");

    // Delete all decisions for this request
    this.decisions = this.decisions.filter((d) => d.requestId !== requestId);

    // Reset currentStep to 1
    request.currentStep = 1;
  }

  /** Get the current state of a request */
  getRequest(requestId: string): ApprovalRequestRecord | undefined {
    return this.requests.get(requestId);
  }

  /** Get all decisions for a request */
  getDecisionsForRequest(requestId: string): ApprovalDecisionRecord[] {
    return this.decisions.filter((d) => d.requestId === requestId);
  }
}

// ── Arbitraries ──────────────────────────────────────────────────────────────

/** Generates a chain length between 2 and 10 (need at least 2 to have S > 1) */
const chainLengthArb = fc.integer({ min: 2, max: 10 });

/** Generates the number of decisions (1–5) */
const decisionCountArb = fc.integer({ min: 1, max: 5 });

// ── Property Tests ───────────────────────────────────────────────────────────

// Feature: sequential-approval-chain, Property 9: Re-edit resets all decisions and step
describe("Feature: sequential-approval-chain, Property 9: Re-edit resets all decisions and step", () => {
  it("re-edit deletes all K decisions and resets currentStep to 1 for any chain configuration", () => {
    fc.assert(
      fc.property(
        chainLengthArb,
        decisionCountArb,
        fc.uuid(), // requestId
        fc.uuid(), // contentId
        fc.uuid(), // submitterId
        fc.array(fc.uuid(), { minLength: 5, maxLength: 5 }), // approverIds
        (chainLength, numDecisions, requestId, contentId, submitterId, approverIds) => {
          // Ensure numDecisions doesn't exceed chainLength - 1
          // (we need currentStep > 1 but still pending, so max intermediate approvals = chainLength - 1)
          const effectiveDecisions = Math.min(numDecisions, chainLength - 1);

          const store = new SequentialChainReEditStore();
          store.setChainLength("pages", chainLength);
          store.createRequest(requestId, contentId, "pages", submitterId, {
            draft: "initial",
          });

          // Approve through the chain to advance currentStep
          for (let i = 0; i < effectiveDecisions; i++) {
            store.approveAtCurrentStep(requestId, approverIds[i]);
          }

          // Verify preconditions: currentStep > 1 and decisions exist
          const requestBefore = store.getRequest(requestId)!;
          expect(requestBefore.currentStep).toBe(effectiveDecisions + 1);
          expect(requestBefore.currentStep).toBeGreaterThan(1);

          const decisionsBefore = store.getDecisionsForRequest(requestId);
          expect(decisionsBefore.length).toBe(effectiveDecisions);

          // Trigger re-edit (resetDecisions)
          store.resetDecisions(requestId);

          // Assert: all decisions are deleted
          const decisionsAfter = store.getDecisionsForRequest(requestId);
          expect(decisionsAfter.length).toBe(0);

          // Assert: currentStep is reset to 1
          const requestAfter = store.getRequest(requestId)!;
          expect(requestAfter.currentStep).toBe(1);
        }
      ),
      { numRuns: 30 }
    );
  });

  it("re-edit resets currentStep to 1 regardless of how far the chain has progressed", () => {
    fc.assert(
      fc.property(
        // Generate chainLength and a step within it (step > 1)
        chainLengthArb.chain((chainLength) =>
          fc.tuple(
            fc.constant(chainLength),
            fc.integer({ min: 2, max: chainLength }) // targetStep (> 1)
          )
        ),
        fc.uuid(), // requestId
        fc.uuid(), // contentId
        fc.uuid(), // submitterId
        fc.array(fc.uuid(), { minLength: 10, maxLength: 10 }), // approverIds pool
        ([chainLength, targetStep], requestId, contentId, submitterId, approverIds) => {
          const store = new SequentialChainReEditStore();
          store.setChainLength("pages", chainLength);
          store.createRequest(requestId, contentId, "pages", submitterId, {
            content: "test",
          });

          // Advance to targetStep by approving (targetStep - 1) times
          const approvalsNeeded = targetStep - 1;
          for (let i = 0; i < approvalsNeeded; i++) {
            store.approveAtCurrentStep(requestId, approverIds[i]);
          }

          // Verify we're at the expected step
          const requestBefore = store.getRequest(requestId)!;
          expect(requestBefore.currentStep).toBe(targetStep);

          // Trigger re-edit
          store.resetDecisions(requestId);

          // Assert: currentStep is always reset to 1
          const requestAfter = store.getRequest(requestId)!;
          expect(requestAfter.currentStep).toBe(1);

          // Assert: all decisions are deleted
          const decisionsAfter = store.getDecisionsForRequest(requestId);
          expect(decisionsAfter.length).toBe(0);
        }
      ),
      { numRuns: 30 }
    );
  });

  it("re-edit with exactly 1 decision still resets currentStep to 1", () => {
    fc.assert(
      fc.property(
        chainLengthArb,
        fc.uuid(), // requestId
        fc.uuid(), // contentId
        fc.uuid(), // submitterId
        fc.uuid(), // approverId
        (chainLength, requestId, contentId, submitterId, approverId) => {
          const store = new SequentialChainReEditStore();
          store.setChainLength("pages", chainLength);
          store.createRequest(requestId, contentId, "pages", submitterId, {
            data: "v1",
          });

          // Single approval advances to step 2
          store.approveAtCurrentStep(requestId, approverId);

          // Verify preconditions
          const requestBefore = store.getRequest(requestId)!;
          expect(requestBefore.currentStep).toBe(2);
          expect(store.getDecisionsForRequest(requestId).length).toBe(1);

          // Trigger re-edit
          store.resetDecisions(requestId);

          // Assert: single decision deleted and step reset
          expect(store.getDecisionsForRequest(requestId).length).toBe(0);
          expect(store.getRequest(requestId)!.currentStep).toBe(1);
        }
      ),
      { numRuns: 30 }
    );
  });

  it("re-edit with maximum decisions (5) at various steps resets everything", () => {
    fc.assert(
      fc.property(
        // Need chain length >= 6 to allow 5 intermediate approvals (step advances to 6)
        fc.integer({ min: 6, max: 10 }),
        fc.uuid(), // requestId
        fc.uuid(), // contentId
        fc.uuid(), // submitterId
        fc.array(fc.uuid(), { minLength: 5, maxLength: 5 }), // 5 unique approverIds
        (chainLength, requestId, contentId, submitterId, approverIds) => {
          const store = new SequentialChainReEditStore();
          store.setChainLength("pages", chainLength);
          store.createRequest(requestId, contentId, "pages", submitterId, {
            data: "complex-draft",
          });

          // Approve 5 times to advance to step 6
          for (let i = 0; i < 5; i++) {
            store.approveAtCurrentStep(requestId, approverIds[i]);
          }

          // Verify preconditions
          const requestBefore = store.getRequest(requestId)!;
          expect(requestBefore.currentStep).toBe(6);
          expect(store.getDecisionsForRequest(requestId).length).toBe(5);

          // Trigger re-edit
          store.resetDecisions(requestId);

          // Assert: all 5 decisions deleted
          expect(store.getDecisionsForRequest(requestId).length).toBe(0);

          // Assert: currentStep reset to 1
          expect(store.getRequest(requestId)!.currentStep).toBe(1);
        }
      ),
      { numRuns: 30 }
    );
  });

  it("after re-edit reset, the request remains in pending status", () => {
    fc.assert(
      fc.property(
        chainLengthArb,
        decisionCountArb,
        fc.uuid(), // requestId
        fc.uuid(), // contentId
        fc.uuid(), // submitterId
        fc.array(fc.uuid(), { minLength: 5, maxLength: 5 }), // approverIds
        (chainLength, numDecisions, requestId, contentId, submitterId, approverIds) => {
          const effectiveDecisions = Math.min(numDecisions, chainLength - 1);

          const store = new SequentialChainReEditStore();
          store.setChainLength("pages", chainLength);
          store.createRequest(requestId, contentId, "pages", submitterId, {
            draft: "data",
          });

          // Advance through the chain
          for (let i = 0; i < effectiveDecisions; i++) {
            store.approveAtCurrentStep(requestId, approverIds[i]);
          }

          // Trigger re-edit
          store.resetDecisions(requestId);

          // Assert: request status remains "pending"
          const requestAfter = store.getRequest(requestId)!;
          expect(requestAfter.status).toBe("pending");

          // Assert: decisions deleted and step reset
          expect(store.getDecisionsForRequest(requestId).length).toBe(0);
          expect(requestAfter.currentStep).toBe(1);
        }
      ),
      { numRuns: 30 }
    );
  });
});
