import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { ContentModule } from "../types";

// Feature: content-approval-workflow, Property 1: Configuration round-trip
// Feature: content-approval-workflow, Property 4: Approver assignment round-trip
// Feature: content-approval-workflow, Property 5: Approver assignment validation
// Feature: content-approval-workflow, Property 6: Removing approver preserves existing requests

// ── Types ────────────────────────────────────────────────────────────────────

interface ApprovalConfigRecord {
  id: string;
  contentModule: ContentModule;
  enabled: boolean;
  updatedAt: Date;
}

interface ApprovalDecisionRecord {
  id: string;
  requestId: string;
  approverId: string;
  decision: "approved" | "rejected";
  comment: string | null;
  createdAt: Date;
}

interface ApprovalRequestRecord {
  id: string;
  contentId: string;
  contentModule: ContentModule;
  submitterId: string;
  status: "pending" | "approved" | "rejected";
  createdAt: Date;
  resolvedAt: Date | null;
}

// ── In-memory store simulating approval config persistence ───────────────────

const MAX_APPROVERS_PER_MODULE = 10;

class ApprovalConfigStore {
  private configs: Map<ContentModule, ApprovalConfigRecord> = new Map();
  private approvers: Map<string, Set<string>> = new Map(); // configId → set of userIds
  private requests: Map<string, ApprovalRequestRecord> = new Map();
  private decisions: ApprovalDecisionRecord[] = [];

  /** Set of user IDs that exist in the "users table" */
  registeredUsers: Set<string> = new Set();

  /**
   * Upsert approval configuration for a content module.
   * Mirrors the PUT /approval-config/:module logic:
   * - If config exists for the module, update the enabled flag
   * - Otherwise, create a new config record
   */
  upsert(contentModule: ContentModule, enabled: boolean): ApprovalConfigRecord {
    const existing = this.configs.get(contentModule);

    if (existing) {
      existing.enabled = enabled;
      existing.updatedAt = new Date();
      return { ...existing };
    }

    const record: ApprovalConfigRecord = {
      id: crypto.randomUUID(),
      contentModule,
      enabled,
      updatedAt: new Date(),
    };
    this.configs.set(contentModule, record);
    return { ...record };
  }

  /**
   * Read back the approval configuration for a content module.
   * Mirrors the GET /approval-config query filtered by module.
   */
  get(contentModule: ContentModule): ApprovalConfigRecord | undefined {
    const record = this.configs.get(contentModule);
    return record ? { ...record } : undefined;
  }

  /**
   * Assign a set of user IDs as approvers for a content module.
   * Validates:
   * - The set must not be empty
   * - The set must not exceed MAX_APPROVERS_PER_MODULE
   * - All user IDs must exist in registeredUsers
   * Throws an error if validation fails.
   */
  assignApprovers(contentModule: ContentModule, userIds: string[]): void {
    if (userIds.length === 0) {
      throw new Error("Approver list must not be empty");
    }
    if (userIds.length > MAX_APPROVERS_PER_MODULE) {
      throw new Error(`Approver list exceeds maximum of ${MAX_APPROVERS_PER_MODULE}`);
    }
    for (const uid of userIds) {
      if (!this.registeredUsers.has(uid)) {
        throw new Error(`User ${uid} does not exist in the users table`);
      }
    }

    // Ensure config exists
    let config = this.configs.get(contentModule);
    if (!config) {
      config = this.upsert(contentModule, false);
    }

    this.approvers.set(config.id, new Set(userIds));
  }

  /**
   * Read back the set of approver user IDs for a content module.
   */
  getApprovers(contentModule: ContentModule): Set<string> {
    const config = this.configs.get(contentModule);
    if (!config) return new Set();
    return new Set(this.approvers.get(config.id) ?? []);
  }

  /**
   * Remove a single approver from a content module's configuration.
   * Existing approval decisions by this approver are NOT deleted.
   */
  removeApprover(contentModule: ContentModule, userId: string): void {
    const config = this.configs.get(contentModule);
    if (!config) return;
    const set = this.approvers.get(config.id);
    if (set) {
      set.delete(userId);
    }
  }

  /**
   * Seed a pending approval request (used by Property 6 tests).
   */
  addPendingRequest(id: string, contentId: string, contentModule: ContentModule, submitterId: string): void {
    this.requests.set(id, {
      id,
      contentId,
      contentModule,
      submitterId,
      status: "pending",
      createdAt: new Date(),
      resolvedAt: null,
    });
  }

  /**
   * Record an approval decision (used by Property 6 tests).
   */
  addDecision(requestId: string, approverId: string, decision: "approved" | "rejected", comment?: string): ApprovalDecisionRecord {
    const record: ApprovalDecisionRecord = {
      id: crypto.randomUUID(),
      requestId,
      approverId,
      decision,
      comment: comment ?? null,
      createdAt: new Date(),
    };
    this.decisions.push(record);
    return record;
  }

  /**
   * Get all decisions for a given request.
   */
  getDecisionsForRequest(requestId: string): ApprovalDecisionRecord[] {
    return this.decisions.filter((d) => d.requestId === requestId).map((d) => ({ ...d }));
  }

  /**
   * Get a specific decision by ID.
   */
  getDecision(decisionId: string): ApprovalDecisionRecord | undefined {
    const d = this.decisions.find((d) => d.id === decisionId);
    return d ? { ...d } : undefined;
  }
}

// ── Shared arbitraries ───────────────────────────────────────────────────────

const contentModuleArb = fc.constantFrom<ContentModule>(
  "pages",
  "blog",
  "news",
  "construction_updates"
);

const enabledArb = fc.boolean();

// ─────────────────────────────────────────────────────────────────────────────
// Property 1: Configuration round-trip
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 1.1, 1.4**
 *
 * Property 1: Configuration round-trip
 *
 * For any content module and boolean toggle value, saving the approval
 * configuration and reading it back should return the same module and
 * toggle state.
 */
// Feature: content-approval-workflow, Property 1: Configuration round-trip
describe("Feature: content-approval-workflow, Property 1: Configuration round-trip", () => {
  it("saving a config and reading it back preserves the module and enabled state", () => {
    fc.assert(
      fc.property(
        contentModuleArb,
        enabledArb,
        (contentModule, enabled) => {
          const store = new ApprovalConfigStore();

          // Save (upsert) the config
          store.upsert(contentModule, enabled);

          // Read it back
          const readBack = store.get(contentModule);

          // Must exist
          expect(readBack).toBeDefined();

          // Same module
          expect(readBack!.contentModule).toBe(contentModule);

          // Same enabled state
          expect(readBack!.enabled).toBe(enabled);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("overwriting a config with a new toggle value reflects the latest state on read-back", () => {
    fc.assert(
      fc.property(
        contentModuleArb,
        enabledArb,
        enabledArb,
        (contentModule, firstEnabled, secondEnabled) => {
          const store = new ApprovalConfigStore();

          // Save initial config
          store.upsert(contentModule, firstEnabled);

          // Overwrite with a new toggle value
          store.upsert(contentModule, secondEnabled);

          // Read it back
          const readBack = store.get(contentModule);

          // Must exist
          expect(readBack).toBeDefined();

          // Same module
          expect(readBack!.contentModule).toBe(contentModule);

          // Reflects the latest enabled state
          expect(readBack!.enabled).toBe(secondEnabled);
        }
      ),
      { numRuns: 20 }
    );
  });
});

// ── Additional arbitraries for approver tests ────────────────────────────────

const uuidArb = fc.uuid();

/**
 * Generate a non-empty set of unique user IDs (1..MAX_APPROVERS_PER_MODULE)
 * that are all drawn from a known "registered users" pool.
 */
function registeredUserIdsArb(poolSize: number = 15) {
  return fc
    .uniqueArray(fc.uuid(), { minLength: poolSize, maxLength: poolSize })
    .chain((pool) =>
      fc.tuple(
        fc.constant(pool),
        fc.integer({ min: 1, max: Math.min(pool.length, MAX_APPROVERS_PER_MODULE) }).chain((n) =>
          fc.shuffledSubarray(pool, { minLength: n, maxLength: n })
        )
      )
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Property 4: Approver assignment round-trip
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 2.1**
 *
 * Property 4: Approver assignment round-trip
 *
 * For any content module and non-empty set of valid user IDs, assigning
 * them as approvers and reading back the configuration should return the
 * same set of user IDs.
 */
// Feature: content-approval-workflow, Property 4: Approver assignment round-trip
describe("Feature: content-approval-workflow, Property 4: Approver assignment round-trip", () => {
  it("assigning approvers and reading them back returns the same set of user IDs", () => {
    fc.assert(
      fc.property(
        contentModuleArb,
        registeredUserIdsArb(),
        (contentModule, [pool, userIds]) => {
          const store = new ApprovalConfigStore();

          // Register all pool users so validation passes
          for (const uid of pool) {
            store.registeredUsers.add(uid);
          }

          // Assign approvers
          store.assignApprovers(contentModule, userIds);

          // Read back
          const readBack = store.getApprovers(contentModule);

          // Must be the same set (order-independent)
          expect(readBack.size).toBe(userIds.length);
          for (const uid of userIds) {
            expect(readBack.has(uid)).toBe(true);
          }
        }
      ),
      { numRuns: 20 }
    );
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Property 5: Approver assignment validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 2.2, 2.3**
 *
 * Property 5: Approver assignment validation
 *
 * For any set of user IDs submitted as approvers, the system should reject
 * the assignment if the set is empty, exceeds the maximum allowed, or
 * contains any user ID that does not exist in the users table.
 */
// Feature: content-approval-workflow, Property 5: Approver assignment validation
describe("Feature: content-approval-workflow, Property 5: Approver assignment validation", () => {
  it("rejects an empty approver list", () => {
    fc.assert(
      fc.property(
        contentModuleArb,
        (contentModule) => {
          const store = new ApprovalConfigStore();

          expect(() => store.assignApprovers(contentModule, [])).toThrow(
            "Approver list must not be empty"
          );
        }
      ),
      { numRuns: 20 }
    );
  });

  it("rejects an approver list that exceeds the maximum", () => {
    fc.assert(
      fc.property(
        contentModuleArb,
        fc.uniqueArray(fc.uuid(), {
          minLength: MAX_APPROVERS_PER_MODULE + 1,
          maxLength: MAX_APPROVERS_PER_MODULE + 5,
        }),
        (contentModule, oversizedList) => {
          const store = new ApprovalConfigStore();

          // Register all users so only the size check triggers
          for (const uid of oversizedList) {
            store.registeredUsers.add(uid);
          }

          expect(() => store.assignApprovers(contentModule, oversizedList)).toThrow(
            `Approver list exceeds maximum of ${MAX_APPROVERS_PER_MODULE}`
          );
        }
      ),
      { numRuns: 20 }
    );
  });

  it("rejects when any user ID does not exist in the users table", () => {
    fc.assert(
      fc.property(
        contentModuleArb,
        fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 5 }),
        fc.uuid(), // an unregistered user ID to inject
        fc.integer({ min: 0, max: 4 }), // injection index
        (contentModule, validIds, unregisteredId, injectIdx) => {
          // Ensure unregisteredId is not in validIds
          const filtered = validIds.filter((id) => id !== unregisteredId);
          if (filtered.length === 0) return; // skip degenerate case

          const store = new ApprovalConfigStore();

          // Register only the valid IDs
          for (const uid of filtered) {
            store.registeredUsers.add(uid);
          }

          // Build a list that includes the unregistered ID
          const idx = Math.min(injectIdx, filtered.length);
          const withBadId = [...filtered];
          withBadId.splice(idx, 0, unregisteredId);

          // Trim to max if needed
          const trimmed = withBadId.slice(0, MAX_APPROVERS_PER_MODULE);

          expect(() => store.assignApprovers(contentModule, trimmed)).toThrow(
            "does not exist in the users table"
          );
        }
      ),
      { numRuns: 20 }
    );
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Property 6: Removing approver preserves existing requests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 2.4**
 *
 * Property 6: Removing approver preserves existing requests
 *
 * For any approver who has submitted decisions on existing approval requests,
 * removing that approver from the module configuration should not delete or
 * modify those existing approval decisions.
 */
// Feature: content-approval-workflow, Property 6: Removing approver preserves existing requests
describe("Feature: content-approval-workflow, Property 6: Removing approver preserves existing requests", () => {
  it("removing an approver does not delete or modify their existing decisions", () => {
    fc.assert(
      fc.property(
        contentModuleArb,
        uuidArb, // requestId
        uuidArb, // contentId
        uuidArb, // submitterId
        uuidArb, // approverId (the one we'll remove)
        fc.constantFrom<"approved" | "rejected">("approved", "rejected"),
        fc.option(
          fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
          { nil: undefined }
        ),
        (contentModule, requestId, contentId, submitterId, approverId, decision, comment) => {
          const store = new ApprovalConfigStore();

          // Register the approver
          store.registeredUsers.add(approverId);

          // Set up config with the approver assigned
          store.assignApprovers(contentModule, [approverId]);

          // Create a pending request and record a decision from this approver
          store.addPendingRequest(requestId, contentId, contentModule, submitterId);
          const created = store.addDecision(requestId, approverId, decision, comment);

          // Snapshot the decision before removal
          const beforeRemoval = store.getDecision(created.id);
          expect(beforeRemoval).toBeDefined();

          // Remove the approver from the module config
          store.removeApprover(contentModule, approverId);

          // Verify the approver is no longer in the config
          const approversAfter = store.getApprovers(contentModule);
          expect(approversAfter.has(approverId)).toBe(false);

          // Verify the decision is still intact and unchanged
          const afterRemoval = store.getDecision(created.id);
          expect(afterRemoval).toBeDefined();
          expect(afterRemoval!.id).toBe(beforeRemoval!.id);
          expect(afterRemoval!.requestId).toBe(beforeRemoval!.requestId);
          expect(afterRemoval!.approverId).toBe(beforeRemoval!.approverId);
          expect(afterRemoval!.decision).toBe(beforeRemoval!.decision);
          expect(afterRemoval!.comment).toBe(beforeRemoval!.comment);
          expect(afterRemoval!.createdAt.getTime()).toBe(beforeRemoval!.createdAt.getTime());

          // Also verify via the request-level query
          const requestDecisions = store.getDecisionsForRequest(requestId);
          expect(requestDecisions.length).toBe(1);
          expect(requestDecisions[0].approverId).toBe(approverId);
          expect(requestDecisions[0].decision).toBe(decision);
        }
      ),
      { numRuns: 20 }
    );
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Property 16: Non-retroactive enablement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 8.4**
 *
 * Property 16: Non-retroactive enablement
 *
 * For any content item that is already in "published" status, enabling
 * approval for its module should not change the item's status.
 */

interface ContentItemRecord {
  id: string;
  title: string;
  status: "draft" | "published" | "pending_review";
}

class NonRetroactiveStore {
  private configs: Map<ContentModule, { id: string; enabled: boolean }> = new Map();
  private content: Map<string, ContentItemRecord> = new Map();

  addContent(id: string, title: string, status: "draft" | "published" | "pending_review"): void {
    this.content.set(id, { id, title, status });
  }

  getContent(id: string): ContentItemRecord | undefined {
    const item = this.content.get(id);
    return item ? { ...item } : undefined;
  }

  /**
   * Enable approval for a module. This should NOT retroactively change
   * the status of already-published content.
   */
  enableApproval(contentModule: ContentModule): void {
    const existing = this.configs.get(contentModule);
    if (existing) {
      existing.enabled = true;
    } else {
      this.configs.set(contentModule, { id: crypto.randomUUID(), enabled: true });
    }
    // Crucially: no content status changes happen here
  }

  isApprovalEnabled(contentModule: ContentModule): boolean {
    return this.configs.get(contentModule)?.enabled ?? false;
  }
}

// Feature: content-approval-workflow, Property 16: Non-retroactive enablement
describe("Feature: content-approval-workflow, Property 16: Non-retroactive enablement", () => {
  it("enabling approval for a module does not change the status of already-published content", () => {
    fc.assert(
      fc.property(
        contentModuleArb,
        fc.uniqueArray(
          fc.tuple(
            uuidArb,
            fc.string({ minLength: 1, maxLength: 80 }).filter((s) => s.trim().length > 0)
          ),
          { minLength: 1, maxLength: 10, selector: (t) => t[0] }
        ),
        (contentModule, contentItems) => {
          const store = new NonRetroactiveStore();

          // Add content items as already published
          for (const [id, title] of contentItems) {
            store.addContent(id, title, "published");
          }

          // Snapshot statuses before enabling approval
          const statusesBefore = contentItems.map(([id]) => ({
            id,
            status: store.getContent(id)!.status,
          }));

          // Enable approval for the module
          store.enableApproval(contentModule);

          // Verify approval is now enabled
          expect(store.isApprovalEnabled(contentModule)).toBe(true);

          // Verify no content status changed
          for (const { id, status } of statusesBefore) {
            const after = store.getContent(id);
            expect(after).toBeDefined();
            expect(after!.status).toBe(status);
            expect(after!.status).toBe("published");
          }
        }
      ),
      { numRuns: 20 }
    );
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Property 17: Auto-resolve on disable
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 8.5**
 *
 * Property 17: Auto-resolve on disable
 *
 * For any set of pending approval requests in a module, disabling approval
 * for that module should change all those requests' statuses to "rejected"
 * (auto-resolved) and revert the associated content items' statuses to "draft".
 */

interface AutoResolveRequest {
  id: string;
  contentId: string;
  contentModule: ContentModule;
  submitterId: string;
  status: "pending" | "approved" | "rejected";
}

interface AutoResolveContent {
  id: string;
  status: "draft" | "published" | "pending_review";
}

class AutoResolveStore {
  private configs: Map<ContentModule, { id: string; enabled: boolean }> = new Map();
  private requests: AutoResolveRequest[] = [];
  private content: Map<string, AutoResolveContent> = new Map();

  enableApproval(contentModule: ContentModule): void {
    this.configs.set(contentModule, { id: crypto.randomUUID(), enabled: true });
  }

  addContent(id: string, status: "draft" | "published" | "pending_review"): void {
    this.content.set(id, { id, status });
  }

  addPendingRequest(id: string, contentId: string, contentModule: ContentModule, submitterId: string): void {
    this.requests.push({ id, contentId, contentModule, submitterId, status: "pending" });
  }

  /**
   * Disable approval for a module. All pending requests for that module
   * are auto-resolved: request status → "rejected", content status → "draft".
   */
  disableApproval(contentModule: ContentModule): number {
    const config = this.configs.get(contentModule);
    if (config) {
      config.enabled = false;
    }

    let resolved = 0;
    for (const req of this.requests) {
      if (req.contentModule === contentModule && req.status === "pending") {
        req.status = "rejected";
        const content = this.content.get(req.contentId);
        if (content) {
          content.status = "draft";
        }
        resolved++;
      }
    }
    return resolved;
  }

  getRequest(id: string): AutoResolveRequest | undefined {
    return this.requests.find((r) => r.id === id);
  }

  getContent(id: string): AutoResolveContent | undefined {
    return this.content.get(id);
  }
}

// Feature: content-approval-workflow, Property 17: Auto-resolve on disable
describe("Feature: content-approval-workflow, Property 17: Auto-resolve on disable", () => {
  it("disabling approval auto-resolves all pending requests to rejected and reverts content to draft", () => {
    fc.assert(
      fc.property(
        contentModuleArb,
        fc.uniqueArray(
          fc.tuple(uuidArb, uuidArb, uuidArb), // requestId, contentId, submitterId
          { minLength: 1, maxLength: 8, selector: (t) => t[0] }
        ),
        (contentModule, requestData) => {
          const store = new AutoResolveStore();

          // Enable approval for the module
          store.enableApproval(contentModule);

          // Ensure unique content IDs
          const seenContentIds = new Set<string>();
          const validRequests: Array<{ reqId: string; contentId: string; submitterId: string }> = [];

          for (const [reqId, contentId, submitterId] of requestData) {
            if (seenContentIds.has(contentId)) continue;
            seenContentIds.add(contentId);

            store.addContent(contentId, "pending_review");
            store.addPendingRequest(reqId, contentId, contentModule, submitterId);
            validRequests.push({ reqId, contentId, submitterId });
          }

          // Disable approval → should auto-resolve all pending requests
          const resolvedCount = store.disableApproval(contentModule);

          expect(resolvedCount).toBe(validRequests.length);

          // Verify all requests are now "rejected"
          for (const { reqId } of validRequests) {
            const req = store.getRequest(reqId);
            expect(req).toBeDefined();
            expect(req!.status).toBe("rejected");
          }

          // Verify all content items are now "draft"
          for (const { contentId } of validRequests) {
            const content = store.getContent(contentId);
            expect(content).toBeDefined();
            expect(content!.status).toBe("draft");
          }
        }
      ),
      { numRuns: 20 }
    );
  });
});
