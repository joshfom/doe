import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

/**
 * Feature: sequential-approval-chain, Property 11: API chain progress response completeness
 *
 * **Validates: Requirements 8.2, 8.4**
 *
 * For any approval request at step S of N with D decisions recorded,
 * the `GET /approvals/content/:module/:contentId` response SHALL include
 * `currentStep` = S, `totalSteps` = N, a `chain` array of length N sorted
 * by position, and a `decisions` array of length D each containing a `chainStep` field.
 */

// ── Types ────────────────────────────────────────────────────────────────────

interface ChainApprover {
  userId: string;
  position: number;
  userName: string;
}

interface DecisionRecord {
  id: string;
  requestId: string;
  approverId: string;
  approverName: string;
  decision: "approved" | "rejected";
  comment: string | null;
  chainStep: number;
  createdAt: Date;
}

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

interface ApprovalProgressResponse {
  currentStep: number;
  totalSteps: number;
  chain: ChainApprover[];
  decisions: DecisionRecord[];
  status: "pending" | "approved" | "rejected" | "none";
}

// ── In-memory store simulating getApprovalProgress API response ──────────────

class ApprovalProgressStore {
  private requests: Map<string, ApprovalRequestRecord> = new Map();
  private decisions: DecisionRecord[] = [];
  private chainApprovers: Map<string, ChainApprover[]> = new Map(); // keyed by contentModule

  /** Configure the approval chain for a content module */
  setChain(contentModule: string, approvers: ChainApprover[]): void {
    this.chainApprovers.set(contentModule, approvers);
  }

  /** Create a new approval request */
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

  /** Set the current step directly (simulates advancing through approvals) */
  setCurrentStep(requestId: string, step: number): void {
    const request = this.requests.get(requestId);
    if (!request) throw new Error("Request not found");
    request.currentStep = step;
  }

  /** Record a decision at a specific chain step */
  addDecision(
    requestId: string,
    approverId: string,
    approverName: string,
    decision: "approved" | "rejected",
    chainStep: number,
    comment: string | null = null
  ): void {
    this.decisions.push({
      id: crypto.randomUUID(),
      requestId,
      approverId,
      approverName,
      decision,
      comment,
      chainStep,
      createdAt: new Date(),
    });
  }

  /**
   * Simulate GET /approvals/content/:module/:contentId
   *
   * This mirrors the logic in `getApprovalProgress` from service.ts:
   * - Fetches the latest request for the content
   * - Gets ordered approvers with positions
   * - Gets decisions with chainStep info
   * - Returns the complete progress response
   */
  getApprovalProgress(
    contentId: string,
    contentModule: string
  ): ApprovalProgressResponse {
    // Find the request for this content
    const request = Array.from(this.requests.values()).find(
      (r) => r.contentId === contentId && r.contentModule === contentModule
    );

    if (!request) {
      return { currentStep: 0, totalSteps: 0, chain: [], decisions: [], status: "none" };
    }

    // Get ordered approvers sorted by position
    const chain = (this.chainApprovers.get(contentModule) ?? [])
      .slice()
      .sort((a, b) => a.position - b.position);

    // Get decisions for this request
    const requestDecisions = this.decisions.filter(
      (d) => d.requestId === request.id
    );

    return {
      currentStep: request.currentStep,
      totalSteps: chain.length,
      chain,
      decisions: requestDecisions,
      status: request.status,
    };
  }
}

// ── Arbitraries ──────────────────────────────────────────────────────────────

/** Generate a chain of 1-10 approvers with contiguous 1-based positions */
const chainArb = fc
  .integer({ min: 1, max: 10 })
  .chain((chainLength) =>
    fc
      .array(
        fc.record({
          userId: fc.uuid(),
          userName: fc.string({ minLength: 1, maxLength: 20 }),
        }),
        { minLength: chainLength, maxLength: chainLength }
      )
      .map((approvers) =>
        approvers.map((a, idx) => ({
          userId: a.userId,
          userName: a.userName,
          position: idx + 1,
        }))
      )
  );

/** Generate a current step S within chain length N (1 <= S <= N) */
const currentStepArb = (chainLength: number) =>
  fc.integer({ min: 1, max: chainLength });

/** Generate D decisions (0 to N-1) at various steps */
const decisionsArb = (chainLength: number) =>
  fc
    .integer({ min: 0, max: Math.max(0, chainLength - 1) })
    .chain((numDecisions) =>
      fc.array(
        fc.record({
          approverId: fc.uuid(),
          approverName: fc.string({ minLength: 1, maxLength: 20 }),
          chainStep: fc.integer({ min: 1, max: chainLength }),
          decision: fc.constantFrom("approved" as const, "rejected" as const),
          comment: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
        }),
        { minLength: numDecisions, maxLength: numDecisions }
      )
    );

// ── Property Tests ───────────────────────────────────────────────────────────

// Feature: sequential-approval-chain, Property 11: API chain progress response completeness
describe("Feature: sequential-approval-chain, Property 11: API chain progress response completeness", () => {
  it("response includes currentStep = S, totalSteps = N, chain of length N sorted by position, and decisions of length D with chainStep fields", () => {
    fc.assert(
      fc.property(
        chainArb.chain((chain) => {
          const N = chain.length;
          return fc.tuple(
            fc.constant(chain),
            currentStepArb(N),
            decisionsArb(N)
          );
        }),
        fc.uuid(), // requestId
        fc.uuid(), // contentId
        fc.uuid(), // submitterId
        ([chain, currentStep, decisions], requestId, contentId, submitterId) => {
          const store = new ApprovalProgressStore();

          // Configure the chain
          store.setChain("pages", chain);

          // Create the request
          store.createRequest(requestId, contentId, "pages", submitterId, {
            draft: "test-data",
          });

          // Set the current step to S
          store.setCurrentStep(requestId, currentStep);

          // Record D decisions
          for (const d of decisions) {
            store.addDecision(
              requestId,
              d.approverId,
              d.approverName,
              d.decision,
              d.chainStep,
              d.comment
            );
          }

          // Call the API simulation
          const response = store.getApprovalProgress(contentId, "pages");

          // Verify: currentStep = S
          expect(response.currentStep).toBe(currentStep);

          // Verify: totalSteps = N
          expect(response.totalSteps).toBe(chain.length);

          // Verify: chain array has length N
          expect(response.chain.length).toBe(chain.length);

          // Verify: chain is sorted by position
          for (let i = 0; i < response.chain.length - 1; i++) {
            expect(response.chain[i].position).toBeLessThan(
              response.chain[i + 1].position
            );
          }

          // Verify: chain positions are contiguous 1-based
          for (let i = 0; i < response.chain.length; i++) {
            expect(response.chain[i].position).toBe(i + 1);
          }

          // Verify: decisions array has length D
          expect(response.decisions.length).toBe(decisions.length);

          // Verify: each decision contains a chainStep field
          for (const decision of response.decisions) {
            expect(decision).toHaveProperty("chainStep");
            expect(typeof decision.chainStep).toBe("number");
            expect(decision.chainStep).toBeGreaterThanOrEqual(1);
            expect(decision.chainStep).toBeLessThanOrEqual(chain.length);
          }
        }
      ),
      { numRuns: 30 }
    );
  });

  it("response chain entries each contain userId, userName, and position fields", () => {
    fc.assert(
      fc.property(
        chainArb,
        fc.uuid(), // requestId
        fc.uuid(), // contentId
        fc.uuid(), // submitterId
        (chain, requestId, contentId, submitterId) => {
          const store = new ApprovalProgressStore();
          store.setChain("pages", chain);
          store.createRequest(requestId, contentId, "pages", submitterId, {
            data: "test",
          });

          const response = store.getApprovalProgress(contentId, "pages");

          // Verify each chain entry has the required fields
          for (const entry of response.chain) {
            expect(entry).toHaveProperty("userId");
            expect(entry).toHaveProperty("userName");
            expect(entry).toHaveProperty("position");
            expect(typeof entry.userId).toBe("string");
            expect(typeof entry.userName).toBe("string");
            expect(typeof entry.position).toBe("number");
          }
        }
      ),
      { numRuns: 30 }
    );
  });

  it("response decisions each contain chainStep matching the step at which they were recorded", () => {
    fc.assert(
      fc.property(
        chainArb.chain((chain) => {
          const N = chain.length;
          return fc.tuple(
            fc.constant(chain),
            // Generate 1 to N-1 decisions with specific steps
            fc
              .integer({ min: 1, max: Math.max(1, N - 1) })
              .chain((numDecisions) =>
                fc.tuple(
                  fc.constant(numDecisions),
                  fc.array(fc.integer({ min: 1, max: N }), {
                    minLength: numDecisions,
                    maxLength: numDecisions,
                  })
                )
              )
          );
        }),
        fc.uuid(), // requestId
        fc.uuid(), // contentId
        fc.uuid(), // submitterId
        fc.array(fc.uuid(), { minLength: 10, maxLength: 10 }), // approverIds pool
        ([chain, [numDecisions, steps]], requestId, contentId, submitterId, approverIds) => {
          const store = new ApprovalProgressStore();
          store.setChain("pages", chain);
          store.createRequest(requestId, contentId, "pages", submitterId, {
            data: "test",
          });

          // Record decisions at specific steps
          for (let i = 0; i < numDecisions; i++) {
            store.addDecision(
              requestId,
              approverIds[i],
              `Approver ${i}`,
              "approved",
              steps[i]
            );
          }

          const response = store.getApprovalProgress(contentId, "pages");

          // Verify each decision's chainStep matches what was recorded
          expect(response.decisions.length).toBe(numDecisions);
          for (let i = 0; i < numDecisions; i++) {
            expect(response.decisions[i].chainStep).toBe(steps[i]);
          }
        }
      ),
      { numRuns: 30 }
    );
  });

  it("when no request exists, response returns zero values and empty arrays", () => {
    fc.assert(
      fc.property(
        fc.uuid(), // contentId (no request created for it)
        chainArb,
        (contentId, chain) => {
          const store = new ApprovalProgressStore();
          store.setChain("pages", chain);

          // Don't create a request — simulate no approval request for this content
          const response = store.getApprovalProgress(contentId, "pages");

          expect(response.currentStep).toBe(0);
          expect(response.totalSteps).toBe(0);
          expect(response.chain).toEqual([]);
          expect(response.decisions).toEqual([]);
          expect(response.status).toBe("none");
        }
      ),
      { numRuns: 30 }
    );
  });
});
