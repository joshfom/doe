import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

/**
 * Feature: sequential-approval-chain, Property 10: Employee authorization
 *
 * **Validates: Requirements 4.1, 4.5, 8.3**
 *
 * For any user with `userType = "employee"`, the system SHALL allow them to submit
 * a decision. For any user with a different `userType`, the system SHALL reject the
 * decision with a 403 error. The decision record SHALL always store the actual
 * employee's ID as `approverId`.
 */

// ── Types ────────────────────────────────────────────────────────────────────

interface UserRecord {
  id: string;
  userType: string;
  name: string;
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

interface ApprovalDecisionRecord {
  id: string;
  requestId: string;
  approverId: string;
  decision: "approved" | "rejected";
  comment: string | null;
  chainStep: number;
  createdAt: Date;
}

// ── In-memory store simulating sequential chain with employee authorization ──

class SequentialChainEmployeeAuthStore {
  private users: Map<string, UserRecord> = new Map();
  private requests: Map<string, ApprovalRequestRecord> = new Map();
  private decisions: ApprovalDecisionRecord[] = [];
  private chainLengths: Map<string, number> = new Map();

  /** Register a user */
  addUser(user: UserRecord): void {
    this.users.set(user.id, { ...user });
  }

  /** Get a user */
  getUser(id: string): UserRecord | undefined {
    return this.users.get(id);
  }

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

  /** Advance the request to a specific step (simulates prior approvals) */
  advanceToStep(requestId: string, targetStep: number): void {
    const request = this.requests.get(requestId);
    if (!request) throw new Error("Request not found");
    request.currentStep = targetStep;
  }

  /**
   * Submit a decision on a pending approval request.
   *
   * Authorization rules (demo mode):
   * - Only users with userType = "employee" can submit decisions
   * - Non-employee users are rejected with 403
   *
   * Sequential chain logic:
   * - Records the decision with chainStep = request.currentStep
   * - On approval at intermediate step: advances currentStep
   * - On approval at final step: commits (sets status to "approved")
   * - On rejection: terminates immediately (cascading rejection)
   */
  submitDecision(
    requestId: string,
    userId: string,
    decision: "approved" | "rejected",
    comment?: string
  ): { success: boolean; status: number; error?: string } {
    // Authorization check: only employees can submit decisions
    const user = this.users.get(userId);
    if (!user) {
      return { success: false, status: 404, error: "User not found" };
    }
    if (user.userType !== "employee") {
      return {
        success: false,
        status: 403,
        error: "Only employees can submit decisions",
      };
    }

    const request = this.requests.get(requestId);
    if (!request) {
      return { success: false, status: 404, error: "Request not found" };
    }
    if (request.status !== "pending") {
      return { success: false, status: 409, error: "Request already resolved" };
    }

    // Validate rejection reason
    if (decision === "rejected") {
      if (!comment || comment.trim().length === 0) {
        return {
          success: false,
          status: 400,
          error: "Rejection reason is required",
        };
      }
    }

    const totalSteps = this.chainLengths.get(request.contentModule) ?? 1;

    // Record the decision with chainStep = currentStep
    this.decisions.push({
      id: crypto.randomUUID(),
      requestId,
      approverId: userId,
      decision,
      comment: comment ?? null,
      chainStep: request.currentStep,
      createdAt: new Date(),
    });

    if (decision === "rejected") {
      // Cascading rejection — terminate immediately
      request.status = "rejected";
      request.resolvedAt = new Date();
      request.pendingData = null;
      return { success: true, status: 200 };
    }

    // Decision is "approved"
    if (request.currentStep >= totalSteps) {
      // Final step — commit
      request.status = "approved";
      request.resolvedAt = new Date();
      request.pendingData = null;
    } else {
      // Intermediate step — advance
      request.currentStep += 1;
    }

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
}

// ── Arbitraries ──────────────────────────────────────────────────────────────

/** Generates non-employee userType values */
const nonEmployeeUserTypeArb = fc.oneof(
  fc.constant("admin"),
  fc.constant("client"),
  fc.constant("viewer"),
  fc.constant("guest"),
  fc.constant("contractor"),
  fc.stringMatching(/^[a-z]{3,12}$/).filter(
    (s) => s !== "employee"
  )
);

/** Generates a user name */
const userNameArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length > 0);

/** Generates a valid rejection reason */
const validReasonArb = fc
  .string({ minLength: 1, maxLength: 500 })
  .filter((s) => s.trim().length > 0);

// ── Property Tests ───────────────────────────────────────────────────────────

// Feature: sequential-approval-chain, Property 10: Employee authorization
describe("Feature: sequential-approval-chain, Property 10: Employee authorization", () => {
  it("employees can submit approval decisions at any chain step and their ID is recorded as approverId", () => {
    fc.assert(
      fc.property(
        fc.uuid(), // employeeId
        fc.uuid(), // requestId
        fc.uuid(), // contentId
        fc.uuid(), // submitterId
        userNameArb, // employeeName
        fc.integer({ min: 1, max: 10 }), // chainLength
        fc.integer({ min: 1, max: 10 }), // currentStep (will be clamped)
        (employeeId, requestId, contentId, submitterId, employeeName, chainLength, rawStep) => {
          const currentStep = Math.min(rawStep, chainLength);
          const store = new SequentialChainEmployeeAuthStore();

          // Register an employee user
          store.addUser({
            id: employeeId,
            userType: "employee",
            name: employeeName,
          });

          store.setChainLength("pages", chainLength);
          store.createRequest(requestId, contentId, "pages", submitterId, { draft: true });
          store.advanceToStep(requestId, currentStep);

          // Employee submits an approval decision
          const result = store.submitDecision(requestId, employeeId, "approved");

          // Assert: decision accepted
          expect(result.success).toBe(true);
          expect(result.status).toBe(200);

          // Assert: decision record stores the actual employee's ID as approverId
          const decisions = store.getDecisionsForRequest(requestId);
          expect(decisions.length).toBe(1);
          expect(decisions[0].approverId).toBe(employeeId);
          expect(decisions[0].decision).toBe("approved");
          expect(decisions[0].chainStep).toBe(currentStep);
        }
      ),
      { numRuns: 30 }
    );
  });

  it("employees can submit rejection decisions at any chain step and their ID is recorded as approverId", () => {
    fc.assert(
      fc.property(
        fc.uuid(), // employeeId
        fc.uuid(), // requestId
        fc.uuid(), // contentId
        fc.uuid(), // submitterId
        userNameArb, // employeeName
        fc.integer({ min: 1, max: 10 }), // chainLength
        fc.integer({ min: 1, max: 10 }), // currentStep (will be clamped)
        validReasonArb, // rejection reason
        (employeeId, requestId, contentId, submitterId, employeeName, chainLength, rawStep, reason) => {
          const currentStep = Math.min(rawStep, chainLength);
          const store = new SequentialChainEmployeeAuthStore();

          // Register an employee user
          store.addUser({
            id: employeeId,
            userType: "employee",
            name: employeeName,
          });

          store.setChainLength("pages", chainLength);
          store.createRequest(requestId, contentId, "pages", submitterId, { draft: true });
          store.advanceToStep(requestId, currentStep);

          // Employee submits a rejection decision
          const result = store.submitDecision(requestId, employeeId, "rejected", reason);

          // Assert: decision accepted
          expect(result.success).toBe(true);
          expect(result.status).toBe(200);

          // Assert: decision record stores the actual employee's ID as approverId
          const decisions = store.getDecisionsForRequest(requestId);
          expect(decisions.length).toBe(1);
          expect(decisions[0].approverId).toBe(employeeId);
          expect(decisions[0].decision).toBe("rejected");
          expect(decisions[0].comment).toBe(reason);
          expect(decisions[0].chainStep).toBe(currentStep);
        }
      ),
      { numRuns: 30 }
    );
  });

  it("non-employee users are rejected with 403 regardless of userType value", () => {
    fc.assert(
      fc.property(
        fc.uuid(), // nonEmployeeId
        fc.uuid(), // requestId
        fc.uuid(), // contentId
        fc.uuid(), // submitterId
        userNameArb, // userName
        nonEmployeeUserTypeArb, // non-employee userType
        fc.integer({ min: 1, max: 10 }), // chainLength
        fc.constantFrom("approved" as const, "rejected" as const), // decision type
        (nonEmployeeId, requestId, contentId, submitterId, userName, userType, chainLength, decision) => {
          const store = new SequentialChainEmployeeAuthStore();

          // Register a non-employee user
          store.addUser({
            id: nonEmployeeId,
            userType,
            name: userName,
          });

          store.setChainLength("pages", chainLength);
          store.createRequest(requestId, contentId, "pages", submitterId, { draft: true });

          // Non-employee attempts to submit a decision — should be rejected with 403
          const comment = decision === "rejected" ? "Some reason" : undefined;
          const result = store.submitDecision(requestId, nonEmployeeId, decision, comment);

          // Assert: rejected with 403
          expect(result.success).toBe(false);
          expect(result.status).toBe(403);
          expect(result.error).toBe("Only employees can submit decisions");

          // Assert: no decision was recorded
          const decisions = store.getDecisionsForRequest(requestId);
          expect(decisions.length).toBe(0);

          // Assert: request remains pending and unchanged
          const request = store.getRequest(requestId)!;
          expect(request.status).toBe("pending");
          expect(request.currentStep).toBe(1);
          expect(request.pendingData).not.toBeNull();
        }
      ),
      { numRuns: 30 }
    );
  });

  it("the decision record always stores the actual employee's ID as approverId (not the nominal chain approver)", () => {
    fc.assert(
      fc.property(
        fc.uuid(), // nominalApproverId (the person "supposed" to approve at this step)
        fc.uuid(), // actualEmployeeId (the employee who actually submits)
        fc.uuid(), // requestId
        fc.uuid(), // contentId
        fc.uuid(), // submitterId
        userNameArb, // nominalName
        userNameArb, // actualName
        fc.integer({ min: 2, max: 10 }), // chainLength
        fc.integer({ min: 1, max: 10 }), // currentStep (will be clamped)
        (nominalApproverId, actualEmployeeId, requestId, contentId, submitterId, nominalName, actualName, chainLength, rawStep) => {
          // Ensure the two IDs are different to demonstrate the property
          fc.pre(nominalApproverId !== actualEmployeeId);

          const currentStep = Math.min(rawStep, chainLength);
          const store = new SequentialChainEmployeeAuthStore();

          // Register the nominal approver (also an employee, but not the one acting)
          store.addUser({
            id: nominalApproverId,
            userType: "employee",
            name: nominalName,
          });

          // Register the actual employee who will submit the decision
          store.addUser({
            id: actualEmployeeId,
            userType: "employee",
            name: actualName,
          });

          store.setChainLength("pages", chainLength);
          store.createRequest(requestId, contentId, "pages", submitterId, { draft: true });
          store.advanceToStep(requestId, currentStep);

          // The actual employee (not the nominal approver) submits the decision
          const result = store.submitDecision(requestId, actualEmployeeId, "approved");

          // Assert: decision accepted
          expect(result.success).toBe(true);
          expect(result.status).toBe(200);

          // Assert: the decision record stores the ACTUAL employee's ID, not the nominal approver
          const decisions = store.getDecisionsForRequest(requestId);
          expect(decisions.length).toBe(1);
          expect(decisions[0].approverId).toBe(actualEmployeeId);
          expect(decisions[0].approverId).not.toBe(nominalApproverId);
        }
      ),
      { numRuns: 30 }
    );
  });
});
