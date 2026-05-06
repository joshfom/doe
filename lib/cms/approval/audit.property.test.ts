import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { ContentModule, AuditAction, AuditEntityType } from "../types";

// Feature: content-approval-workflow, Property 15: Approval actions produce audit entries

// ── Types ────────────────────────────────────────────────────────────────────

interface AuditLogEntry {
  id: string;
  userId: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  timestamp: Date;
}

interface ApprovalRequestRecord {
  id: string;
  contentId: string;
  contentModule: ContentModule;
  submitterId: string;
  status: "pending" | "approved" | "rejected";
}

// ── In-memory store simulating approval actions with audit logging ───────────

class AuditApprovalStore {
  private auditLog: AuditLogEntry[] = [];
  private requests: Map<string, ApprovalRequestRecord> = new Map();
  private assignedApprovers: Map<string, string[]> = new Map();

  addPendingRequest(
    id: string,
    contentId: string,
    contentModule: ContentModule,
    submitterId: string,
    approverIds: string[]
  ): void {
    this.requests.set(id, { id, contentId, contentModule, submitterId, status: "pending" });
    this.assignedApprovers.set(id, approverIds);

    // Log the submission audit entry
    this.auditLog.push({
      id: crypto.randomUUID(),
      userId: submitterId,
      action: "approval_submit",
      entityType: "approval_request",
      entityId: id,
      timestamp: new Date(),
    });
  }

  submitDecision(
    requestId: string,
    approverId: string,
    decision: "approved" | "rejected"
  ): void {
    const request = this.requests.get(requestId);
    if (!request || request.status !== "pending") return;

    // Log the decision audit entry
    this.auditLog.push({
      id: crypto.randomUUID(),
      userId: approverId,
      action: "approval_decide",
      entityType: "approval_request",
      entityId: requestId,
      timestamp: new Date(),
    });

    if (decision === "rejected") {
      request.status = "rejected";
    } else {
      // Check if all approvers approved
      const approvers = this.assignedApprovers.get(requestId) ?? [];
      const decideEntries = this.auditLog.filter(
        (e) => e.entityId === requestId && e.action === "approval_decide"
      );
      if (decideEntries.length >= approvers.length) {
        request.status = "approved";
      }
    }
  }

  autoResolve(requestId: string, actorId: string): void {
    const request = this.requests.get(requestId);
    if (!request || request.status !== "pending") return;

    request.status = "rejected";

    this.auditLog.push({
      id: crypto.randomUUID(),
      userId: actorId,
      action: "approval_auto_resolve",
      entityType: "approval_request",
      entityId: requestId,
      timestamp: new Date(),
    });
  }

  getAuditLog(): AuditLogEntry[] {
    return [...this.auditLog];
  }

  getRequest(id: string): ApprovalRequestRecord | undefined {
    return this.requests.get(id);
  }
}

// ── Shared arbitraries ───────────────────────────────────────────────────────

const contentModuleArb = fc.constantFrom<ContentModule>(
  "pages",
  "blog",
  "news",
  "construction_updates"
);

const uuidArb = fc.uuid();
const decisionArb = fc.constantFrom<"approved" | "rejected">("approved", "rejected");


// ─────────────────────────────────────────────────────────────────────────────
// Property 15: Approval actions produce audit entries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 7.1, 7.2**
 *
 * Property 15: Approval actions produce audit entries
 *
 * For any approval decision submitted or approval request status change,
 * the audit log should contain a corresponding entry with the correct
 * actor ID, action type, entity ID, and timestamp.
 */
// Feature: content-approval-workflow, Property 15: Approval actions produce audit entries
describe("Feature: content-approval-workflow, Property 15: Approval actions produce audit entries", () => {
  it("submitting an approval request creates an audit entry with correct actor, action, entity, and timestamp", () => {
    fc.assert(
      fc.property(
        uuidArb, // requestId
        uuidArb, // contentId
        contentModuleArb,
        uuidArb, // submitterId
        uuidArb, // approverId
        (requestId, contentId, contentModule, submitterId, approverId) => {
          const store = new AuditApprovalStore();

          store.addPendingRequest(requestId, contentId, contentModule, submitterId, [approverId]);

          const log = store.getAuditLog();
          const submitEntry = log.find(
            (e) => e.action === "approval_submit" && e.entityId === requestId
          );

          expect(submitEntry).toBeDefined();
          expect(submitEntry!.userId).toBe(submitterId);
          expect(submitEntry!.action).toBe("approval_submit");
          expect(submitEntry!.entityType).toBe("approval_request");
          expect(submitEntry!.entityId).toBe(requestId);
          expect(submitEntry!.timestamp).toBeInstanceOf(Date);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("submitting a decision creates an audit entry with correct approver, action, entity, and timestamp", () => {
    fc.assert(
      fc.property(
        uuidArb, // requestId
        uuidArb, // contentId
        contentModuleArb,
        uuidArb, // submitterId
        uuidArb, // approverId
        decisionArb,
        (requestId, contentId, contentModule, submitterId, approverId, decision) => {
          const store = new AuditApprovalStore();

          store.addPendingRequest(requestId, contentId, contentModule, submitterId, [approverId]);
          store.submitDecision(requestId, approverId, decision);

          const log = store.getAuditLog();
          const decideEntry = log.find(
            (e) => e.action === "approval_decide" && e.entityId === requestId
          );

          expect(decideEntry).toBeDefined();
          expect(decideEntry!.userId).toBe(approverId);
          expect(decideEntry!.action).toBe("approval_decide");
          expect(decideEntry!.entityType).toBe("approval_request");
          expect(decideEntry!.entityId).toBe(requestId);
          expect(decideEntry!.timestamp).toBeInstanceOf(Date);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("auto-resolving a request creates an audit entry with correct actor, action, entity, and timestamp", () => {
    fc.assert(
      fc.property(
        uuidArb, // requestId
        uuidArb, // contentId
        contentModuleArb,
        uuidArb, // submitterId
        uuidArb, // actorId (admin who disabled approval)
        (requestId, contentId, contentModule, submitterId, actorId) => {
          const store = new AuditApprovalStore();

          store.addPendingRequest(requestId, contentId, contentModule, submitterId, []);
          store.autoResolve(requestId, actorId);

          const log = store.getAuditLog();
          const resolveEntry = log.find(
            (e) => e.action === "approval_auto_resolve" && e.entityId === requestId
          );

          expect(resolveEntry).toBeDefined();
          expect(resolveEntry!.userId).toBe(actorId);
          expect(resolveEntry!.action).toBe("approval_auto_resolve");
          expect(resolveEntry!.entityType).toBe("approval_request");
          expect(resolveEntry!.entityId).toBe(requestId);
          expect(resolveEntry!.timestamp).toBeInstanceOf(Date);
        }
      ),
      { numRuns: 20 }
    );
  });
});
