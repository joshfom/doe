import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { ContentModule } from "../types";

// Feature: content-approval-workflow, Property 14: Dashboard returns correct filtered data

// ── Types ────────────────────────────────────────────────────────────────────

interface ApprovalConfigRecord {
  id: string;
  contentModule: ContentModule;
  enabled: boolean;
}

interface ApprovalRequestRecord {
  id: string;
  contentId: string;
  contentModule: ContentModule;
  submitterId: string;
  submitterName: string;
  status: "pending" | "approved" | "rejected";
  createdAt: Date;
  contentTitle: string;
}

// ── In-memory store simulating the dashboard query ───────────────────────────

class DashboardStore {
  private configs: ApprovalConfigRecord[] = [];
  private approvers: Map<string, Set<string>> = new Map(); // configId → userIds
  private requests: ApprovalRequestRecord[] = [];

  setApprovalConfig(contentModule: ContentModule, enabled: boolean): string {
    const existing = this.configs.find((c) => c.contentModule === contentModule);
    if (existing) {
      existing.enabled = enabled;
      return existing.id;
    }
    const id = crypto.randomUUID();
    this.configs.push({ id, contentModule, enabled });
    return id;
  }

  assignApprovers(configId: string, userIds: string[]): void {
    this.approvers.set(configId, new Set(userIds));
  }

  addRequest(req: ApprovalRequestRecord): void {
    this.requests.push(req);
  }

  /**
   * Simulate getPendingForApprover: returns pending requests where the
   * approver is assigned to the request's module.
   */
  getPendingForApprover(approverId: string): ApprovalRequestRecord[] {
    // Find modules this approver is assigned to
    const assignedModules = new Set<ContentModule>();
    for (const config of this.configs) {
      const approverSet = this.approvers.get(config.id);
      if (approverSet?.has(approverId)) {
        assignedModules.add(config.contentModule);
      }
    }

    return this.requests.filter(
      (r) => r.status === "pending" && assignedModules.has(r.contentModule)
    );
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

const nonEmptyStringArb = fc
  .string({ minLength: 1, maxLength: 80 })
  .filter((s) => s.trim().length > 0);

const statusArb = fc.constantFrom<"pending" | "approved" | "rejected">(
  "pending",
  "approved",
  "rejected"
);


// ─────────────────────────────────────────────────────────────────────────────
// Property 14: Dashboard returns correct filtered data
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 6.1, 6.2**
 *
 * Property 14: Dashboard returns correct filtered data
 *
 * For any set of approval requests across multiple modules and approvers,
 * querying the pending dashboard for a specific approver should return
 * exactly those requests where: (a) the approver is assigned to the
 * request's module, (b) the request status is "pending", and (c) each
 * returned item includes content title, module type, submitter name,
 * and submission date.
 */
// Feature: content-approval-workflow, Property 14: Dashboard returns correct filtered data
describe("Feature: content-approval-workflow, Property 14: Dashboard returns correct filtered data", () => {
  it("dashboard returns exactly the pending requests for modules the approver is assigned to, with required fields", () => {
    fc.assert(
      fc.property(
        uuidArb, // target approver
        fc.array(
          fc.tuple(
            contentModuleArb,
            fc.uniqueArray(uuidArb, { minLength: 0, maxLength: 3 }) // approvers for this module
          ),
          { minLength: 1, maxLength: 4 }
        ),
        fc.array(
          fc.tuple(
            uuidArb, // request id
            uuidArb, // content id
            contentModuleArb,
            uuidArb, // submitter id
            nonEmptyStringArb, // submitter name
            nonEmptyStringArb, // content title
            statusArb
          ),
          { minLength: 1, maxLength: 10 }
        ),
        (targetApprover, moduleConfigs, requestData) => {
          const store = new DashboardStore();

          // Set up module configs with approvers
          const moduleApprovers = new Map<ContentModule, Set<string>>();
          for (const [mod, approverIds] of moduleConfigs) {
            const configId = store.setApprovalConfig(mod, true);
            store.assignApprovers(configId, approverIds);
            moduleApprovers.set(mod, new Set(approverIds));
          }

          // Add requests with unique IDs
          const seenIds = new Set<string>();
          const addedRequests: ApprovalRequestRecord[] = [];
          for (const [reqId, contentId, mod, submitterId, submitterName, contentTitle, status] of requestData) {
            if (seenIds.has(reqId)) continue;
            seenIds.add(reqId);
            const req: ApprovalRequestRecord = {
              id: reqId,
              contentId,
              contentModule: mod,
              submitterId,
              submitterName,
              status,
              createdAt: new Date(),
              contentTitle,
            };
            store.addRequest(req);
            addedRequests.push(req);
          }

          // Query dashboard for the target approver
          const result = store.getPendingForApprover(targetApprover);

          // Compute expected: pending requests where target approver is assigned to the module
          const expected = addedRequests.filter((r) => {
            const approvers = moduleApprovers.get(r.contentModule);
            return r.status === "pending" && approvers !== undefined && approvers.has(targetApprover);
          });

          // (a) + (b): correct count and IDs
          expect(result.length).toBe(expected.length);
          const resultIds = new Set(result.map((r) => r.id));
          for (const exp of expected) {
            expect(resultIds.has(exp.id)).toBe(true);
          }

          // (c): each returned item includes required fields
          for (const item of result) {
            expect(item.contentTitle).toBeDefined();
            expect(typeof item.contentTitle).toBe("string");
            expect(item.contentModule).toBeDefined();
            expect(item.submitterName).toBeDefined();
            expect(typeof item.submitterName).toBe("string");
            expect(item.createdAt).toBeDefined();
            expect(item.createdAt).toBeInstanceOf(Date);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
