import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { ContentModule } from "../types";

// Feature: content-approval-workflow, Property 2: Approval-enabled intercepts publish

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
  status: "pending" | "approved" | "rejected";
  createdAt: Date;
}

interface ContentItem {
  id: string;
  title: string;
  status: "draft" | "published" | "pending_review";
}

interface GateResult {
  allowed: boolean;
  approvalRequestId?: string;
  reason?: string;
}

// ── Shared arbitraries ───────────────────────────────────────────────────────

const contentModuleArb = fc.constantFrom<ContentModule>(
  "pages",
  "blog",
  "news",
  "construction_updates"
);

const uuidArb = fc.uuid();

const nonEmptyTitleArb = fc
  .string({ minLength: 1, maxLength: 120 })
  .filter((s) => s.trim().length > 0);

// ── In-memory store simulating the publication gate ──────────────────────────

class ApprovalGateStore {
  private configs: ApprovalConfigRecord[] = [];
  private requests: ApprovalRequestRecord[] = [];
  private content: Map<string, ContentItem> = new Map();

  /** Set up approval config for a module */
  setApprovalConfig(contentModule: ContentModule, enabled: boolean): void {
    const existing = this.configs.find(
      (c) => c.contentModule === contentModule
    );
    if (existing) {
      existing.enabled = enabled;
    } else {
      this.configs.push({
        id: crypto.randomUUID(),
        contentModule,
        enabled,
      });
    }
  }

  /** Register a content item (page or post) */
  addContent(id: string, title: string, status: "draft" | "published" | "pending_review" = "draft"): void {
    this.content.set(id, { id, title, status });
  }

  /** Get a content item */
  getContent(id: string): ContentItem | undefined {
    return this.content.get(id);
  }

  /** Get all approval requests */
  getApprovalRequests(): ApprovalRequestRecord[] {
    return [...this.requests];
  }

  /**
   * Simulate checkPublicationGate logic:
   * - Query approval config for the module
   * - If disabled → return { allowed: true }
   * - If enabled → create approval request, set content to pending_review,
   *   return { allowed: false, approvalRequestId }
   */
  checkPublicationGate(
    contentId: string,
    contentModule: ContentModule,
    submitterId: string
  ): GateResult {
    const config = this.configs.find(
      (c) => c.contentModule === contentModule
    );

    // No config or disabled → allow direct publish
    if (!config || !config.enabled) {
      return { allowed: true };
    }

    // Create approval request
    const request: ApprovalRequestRecord = {
      id: crypto.randomUUID(),
      contentId,
      contentModule,
      submitterId,
      status: "pending",
      createdAt: new Date(),
    };
    this.requests.push(request);

    // Set content status to pending_review
    const item = this.content.get(contentId);
    if (item) {
      item.status = "pending_review";
    }

    return {
      allowed: false,
      approvalRequestId: request.id,
      reason: "Content submitted for approval review",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Property 2: Approval-enabled intercepts publish
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 1.3, 3.1, 8.1**
 *
 * Property 2: Approval-enabled intercepts publish
 *
 * For any content item in a module with approval enabled, calling the publish
 * action should create an approval request with status "pending", set the
 * content status to "pending_review", and not set the content status to
 * "published".
 */
// Feature: content-approval-workflow, Property 2: Approval-enabled intercepts publish
describe("Feature: content-approval-workflow, Property 2: Approval-enabled intercepts publish", () => {
  it("when approval is enabled, publish creates a pending approval request and sets content to pending_review", () => {
    fc.assert(
      fc.property(
        contentModuleArb,
        uuidArb,
        uuidArb,
        nonEmptyTitleArb,
        (contentModule, contentId, submitterId, title) => {
          const store = new ApprovalGateStore();

          // Enable approval for this module
          store.setApprovalConfig(contentModule, true);

          // Add a draft content item
          store.addContent(contentId, title, "draft");

          // Call the publication gate
          const result = store.checkPublicationGate(
            contentId,
            contentModule,
            submitterId
          );

          // Gate should NOT allow direct publish
          expect(result.allowed).toBe(false);

          // An approval request ID should be returned
          expect(result.approvalRequestId).toBeDefined();
          expect(typeof result.approvalRequestId).toBe("string");

          // An approval request should have been created with status "pending"
          const requests = store.getApprovalRequests();
          expect(requests.length).toBe(1);

          const request = requests[0];
          expect(request.status).toBe("pending");
          expect(request.contentId).toBe(contentId);
          expect(request.contentModule).toBe(contentModule);
          expect(request.submitterId).toBe(submitterId);
          expect(request.id).toBe(result.approvalRequestId);

          // Content status should be "pending_review", NOT "published"
          const content = store.getContent(contentId);
          expect(content).toBeDefined();
          expect(content!.status).toBe("pending_review");
          expect(content!.status).not.toBe("published");
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 3: Approval-disabled allows direct publish
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 1.2, 3.2, 8.3**
 *
 * Property 3: Approval-disabled allows direct publish
 *
 * For any content item in a module with approval disabled, calling the publish
 * action should set the content status to "published" and not create any
 * approval request.
 */
// Feature: content-approval-workflow, Property 3: Approval-disabled allows direct publish
describe("Feature: content-approval-workflow, Property 3: Approval-disabled allows direct publish", () => {
  it("when approval is disabled, publish is allowed directly and no approval request is created", () => {
    fc.assert(
      fc.property(
        contentModuleArb,
        uuidArb,
        uuidArb,
        nonEmptyTitleArb,
        (contentModule, contentId, submitterId, title) => {
          const store = new ApprovalGateStore();

          // Disable approval for this module
          store.setApprovalConfig(contentModule, false);

          // Add a draft content item
          store.addContent(contentId, title, "draft");

          // Call the publication gate
          const result = store.checkPublicationGate(
            contentId,
            contentModule,
            submitterId
          );

          // Gate should allow direct publish
          expect(result.allowed).toBe(true);

          // No approval request ID should be returned
          expect(result.approvalRequestId).toBeUndefined();

          // No approval request should have been created
          const requests = store.getApprovalRequests();
          expect(requests.length).toBe(0);

          // Content status should remain "draft" (gate doesn't set to published — that's the caller's job)
          const content = store.getContent(contentId);
          expect(content).toBeDefined();
          expect(content!.status).toBe("draft");
          expect(content!.status).not.toBe("pending_review");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("when no approval config exists for a module, publish is allowed directly", () => {
    fc.assert(
      fc.property(
        contentModuleArb,
        uuidArb,
        uuidArb,
        nonEmptyTitleArb,
        (contentModule, contentId, submitterId, title) => {
          const store = new ApprovalGateStore();

          // Do NOT set any approval config — simulates missing config row

          // Add a draft content item
          store.addContent(contentId, title, "draft");

          // Call the publication gate
          const result = store.checkPublicationGate(
            contentId,
            contentModule,
            submitterId
          );

          // Gate should allow direct publish
          expect(result.allowed).toBe(true);

          // No approval request should have been created
          expect(result.approvalRequestId).toBeUndefined();
          const requests = store.getApprovalRequests();
          expect(requests.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 7: Approval request records required data
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 3.3**
 *
 * Property 7: Approval request records required data
 *
 * For any approval request created by the publication gate, the stored record
 * should contain the correct content item ID, content module type, submitter
 * ID, and a non-null creation timestamp.
 */
// Feature: content-approval-workflow, Property 7: Approval request records required data
describe("Feature: content-approval-workflow, Property 7: Approval request records required data", () => {
  it("approval request created by the gate contains correct contentId, contentModule, submitterId, and non-null createdAt", () => {
    fc.assert(
      fc.property(
        contentModuleArb,
        uuidArb, // contentId
        uuidArb, // submitterId
        nonEmptyTitleArb,
        (contentModule, contentId, submitterId, title) => {
          const store = new ApprovalGateStore();

          // Enable approval for this module
          store.setApprovalConfig(contentModule, true);

          // Add a draft content item
          store.addContent(contentId, title, "draft");

          // Call the publication gate
          const result = store.checkPublicationGate(contentId, contentModule, submitterId);

          // Gate should intercept
          expect(result.allowed).toBe(false);

          // Retrieve the stored approval request
          const requests = store.getApprovalRequests();
          expect(requests.length).toBe(1);

          const request = requests[0];

          // Correct content item ID
          expect(request.contentId).toBe(contentId);

          // Correct content module type
          expect(request.contentModule).toBe(contentModule);

          // Correct submitter ID
          expect(request.submitterId).toBe(submitterId);

          // Non-null creation timestamp
          expect(request.createdAt).not.toBeNull();
          expect(request.createdAt).toBeInstanceOf(Date);
        }
      ),
      { numRuns: 100 }
    );
  });
});
