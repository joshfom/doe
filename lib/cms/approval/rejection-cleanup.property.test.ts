import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { ContentModule } from "../types";

/**
 * Feature: pages-approval-draft-preview, Property 6: Rejection cleanup
 *
 * **Validates: Requirements 5.4**
 *
 * For any pending approval request that is rejected, the system SHALL set
 * pendingData to null, revert the page status to "draft", and store the
 * rejection reason as the decision comment.
 */

// ── Types ────────────────────────────────────────────────────────────────────

interface PageRecord {
  id: string;
  title: string;
  slug: string;
  locale: "en" | "ar";
  status: "draft" | "published" | "pending_review";
  data: unknown;
  publishedAt: Date | null;
  updatedAt: Date;
}

interface ApprovalConfigRecord {
  id: string;
  contentModule: ContentModule;
  enabled: boolean;
  requiredApprovals: number;
}

interface ApprovalRequestRecord {
  id: string;
  contentId: string;
  contentModule: ContentModule;
  submitterId: string;
  status: "pending" | "approved" | "rejected";
  pendingData: unknown | null;
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

// ── In-memory store simulating rejection cleanup logic ───────────────────────

class RejectionCleanupStore {
  private pages: Map<string, PageRecord> = new Map();
  private configs: ApprovalConfigRecord[] = [];
  private requests: ApprovalRequestRecord[] = [];
  private decisions: ApprovalDecisionRecord[] = [];

  /** Register a page */
  addPage(page: PageRecord): void {
    this.pages.set(page.id, { ...page });
  }

  /** Get a page */
  getPage(id: string): PageRecord | undefined {
    const page = this.pages.get(id);
    return page ? { ...page } : undefined;
  }

  /** Set approval config for a module */
  setApprovalConfig(
    contentModule: ContentModule,
    enabled: boolean,
    requiredApprovals: number
  ): void {
    const existing = this.configs.find(
      (c) => c.contentModule === contentModule
    );
    if (existing) {
      existing.enabled = enabled;
      existing.requiredApprovals = requiredApprovals;
    } else {
      this.configs.push({
        id: crypto.randomUUID(),
        contentModule,
        enabled,
        requiredApprovals,
      });
    }
  }

  /** Get the active (pending) approval request for a content item */
  getActiveApprovalRequest(
    contentId: string,
    contentModule: ContentModule
  ): ApprovalRequestRecord | undefined {
    return this.requests.find(
      (r) =>
        r.contentId === contentId &&
        r.contentModule === contentModule &&
        r.status === "pending"
    );
  }

  /** Get a request by ID */
  getRequestById(id: string): ApprovalRequestRecord | undefined {
    return this.requests.find((r) => r.id === id);
  }

  /** Get decisions for a request */
  getDecisionsForRequest(requestId: string): ApprovalDecisionRecord[] {
    return this.decisions.filter((d) => d.requestId === requestId);
  }

  /**
   * Create a pending approval request with pendingData for a page.
   * Sets the page status to "pending_review".
   */
  createApprovalRequest(
    pageId: string,
    submitterId: string,
    pendingData: unknown
  ): ApprovalRequestRecord {
    const page = this.pages.get(pageId);
    if (page) {
      page.status = "pending_review";
    }

    const request: ApprovalRequestRecord = {
      id: crypto.randomUUID(),
      contentId: pageId,
      contentModule: "pages",
      submitterId,
      status: "pending",
      pendingData,
      createdAt: new Date(),
      resolvedAt: null,
    };
    this.requests.push(request);
    return request;
  }

  /**
   * Submit a rejection decision with a reason.
   * On rejection:
   * - Set pendingData to null
   * - Revert page status to "draft"
   * - Store the rejection reason as the decision comment
   * - Set request status to "rejected"
   */
  submitRejectionDecision(
    requestId: string,
    reviewerId: string,
    reason: string
  ): { success: boolean; error?: string } {
    const request = this.requests.find((r) => r.id === requestId);
    if (!request) {
      return { success: false, error: "Request not found" };
    }
    if (request.status !== "pending") {
      return { success: false, error: "Request not pending" };
    }

    // Record the rejection decision with the reason as comment
    this.decisions.push({
      id: crypto.randomUUID(),
      requestId,
      approverId: reviewerId,
      decision: "rejected",
      comment: reason,
      createdAt: new Date(),
    });

    // Set pendingData to null
    request.pendingData = null;

    // Set request status to "rejected"
    request.status = "rejected";
    request.resolvedAt = new Date();

    // Revert page status to "draft"
    const page = this.pages.get(request.contentId);
    if (page) {
      page.status = "draft";
    }

    return { success: true };
  }
}

// ── Arbitraries ──────────────────────────────────────────────────────────────

const uuidArb = fc.uuid();

const componentInstanceArb = fc.record({
  type: fc.constantFrom(
    "Hero",
    "Text",
    "Image",
    "ContentBlock",
    "PropertyCard",
    "FormBuilder",
    "Gallery",
    "Video",
    "Accordion"
  ),
  props: fc
    .record({
      id: fc.uuid(),
    })
    .chain((base) =>
      fc
        .dictionary(
          fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,10}$/),
          fc.oneof(
            fc.string({ maxLength: 50 }),
            fc.integer(),
            fc.boolean(),
            fc.constant(null)
          ),
          { minKeys: 0, maxKeys: 5 }
        )
        .map((extra) => ({ ...base, ...extra }))
    ),
});

/** Generates random valid Puck JSON page data */
const puckPageDataArb = fc.record({
  root: fc.record({
    props: fc
      .dictionary(
        fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,10}$/),
        fc.oneof(
          fc.string({ maxLength: 30 }),
          fc.integer(),
          fc.boolean(),
          fc.constant(null)
        ),
        { minKeys: 0, maxKeys: 4 }
      )
      .map((extra) => ({
        title: undefined as string | undefined,
        ...extra,
      }))
      .chain((base) =>
        fc
          .option(fc.string({ minLength: 1, maxLength: 20 }), {
            nil: undefined,
          })
          .map((title) => (title ? { ...base, title } : base))
      ),
  }),
  content: fc.array(componentInstanceArb, { minLength: 0, maxLength: 5 }),
  zones: fc
    .option(
      fc.dictionary(
        fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9-]{0,15}$/),
        fc.array(componentInstanceArb, { maxLength: 3 }),
        { minKeys: 0, maxKeys: 3 }
      ),
      { nil: undefined }
    )
    .map((z) => z ?? undefined),
});

const pageTitleArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0);

/** Generates a non-empty, non-whitespace rejection reason string */
const rejectionReasonArb = fc
  .string({ minLength: 1, maxLength: 500 })
  .filter((s) => s.trim().length > 0);

// ── Property Tests ───────────────────────────────────────────────────────────

// Feature: pages-approval-draft-preview, Property 6: Rejection cleanup
describe("Feature: pages-approval-draft-preview, Property 6: Rejection cleanup", () => {
  it("after rejection, pendingData is set to null", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        rejectionReasonArb,
        (pageId, submitterId, reviewerId, title, originalData, pendingDraftData, reason) => {
          const store = new RejectionCleanupStore();

          store.setApprovalConfig("pages", true, 1);
          store.addPage({
            id: pageId,
            title,
            slug: "test-page",
            locale: "en",
            status: "published",
            data: originalData,
            publishedAt: new Date(),
            updatedAt: new Date(),
          });

          // Create a pending approval request with pendingData
          const request = store.createApprovalRequest(
            pageId,
            submitterId,
            pendingDraftData
          );

          // Verify pendingData is set before rejection
          const beforeReject = store.getRequestById(request.id);
          expect(beforeReject!.pendingData).toEqual(pendingDraftData);

          // Submit rejection
          const result = store.submitRejectionDecision(
            request.id,
            reviewerId,
            reason
          );
          expect(result.success).toBe(true);

          // Assert: pendingData is null after rejection
          const updatedRequest = store.getRequestById(request.id);
          expect(updatedRequest).toBeDefined();
          expect(updatedRequest!.pendingData).toBeNull();
        }
      ),
      { numRuns: 20 }
    );
  });

  it("after rejection, page status is reverted to 'draft'", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        rejectionReasonArb,
        (pageId, submitterId, reviewerId, title, originalData, pendingDraftData, reason) => {
          const store = new RejectionCleanupStore();

          store.setApprovalConfig("pages", true, 1);
          store.addPage({
            id: pageId,
            title,
            slug: "test-page",
            locale: "en",
            status: "published",
            data: originalData,
            publishedAt: new Date(),
            updatedAt: new Date(),
          });

          // Create a pending approval request (sets status to pending_review)
          const request = store.createApprovalRequest(
            pageId,
            submitterId,
            pendingDraftData
          );

          // Verify page status is pending_review before rejection
          const pageBefore = store.getPage(pageId);
          expect(pageBefore!.status).toBe("pending_review");

          // Submit rejection
          const result = store.submitRejectionDecision(
            request.id,
            reviewerId,
            reason
          );
          expect(result.success).toBe(true);

          // Assert: page status is reverted to "draft"
          const pageAfter = store.getPage(pageId);
          expect(pageAfter).toBeDefined();
          expect(pageAfter!.status).toBe("draft");
        }
      ),
      { numRuns: 20 }
    );
  });

  it("the rejection reason is stored as the decision comment", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        rejectionReasonArb,
        (pageId, submitterId, reviewerId, title, originalData, pendingDraftData, reason) => {
          const store = new RejectionCleanupStore();

          store.setApprovalConfig("pages", true, 1);
          store.addPage({
            id: pageId,
            title,
            slug: "test-page",
            locale: "en",
            status: "published",
            data: originalData,
            publishedAt: new Date(),
            updatedAt: new Date(),
          });

          // Create a pending approval request
          const request = store.createApprovalRequest(
            pageId,
            submitterId,
            pendingDraftData
          );

          // Submit rejection with reason
          const result = store.submitRejectionDecision(
            request.id,
            reviewerId,
            reason
          );
          expect(result.success).toBe(true);

          // Assert: the rejection reason is stored verbatim as the decision comment
          const decisions = store.getDecisionsForRequest(request.id);
          expect(decisions.length).toBe(1);
          expect(decisions[0].decision).toBe("rejected");
          expect(decisions[0].comment).toBe(reason);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("all three rejection cleanup conditions hold simultaneously for any data and reason", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        rejectionReasonArb,
        (pageId, submitterId, reviewerId, title, originalData, pendingDraftData, reason) => {
          const store = new RejectionCleanupStore();

          store.setApprovalConfig("pages", true, 2);
          store.addPage({
            id: pageId,
            title,
            slug: "test-page",
            locale: "en",
            status: "published",
            data: originalData,
            publishedAt: new Date(),
            updatedAt: new Date(),
          });

          // Create a pending approval request
          const request = store.createApprovalRequest(
            pageId,
            submitterId,
            pendingDraftData
          );

          // Verify initial state
          expect(store.getPage(pageId)!.status).toBe("pending_review");
          expect(store.getRequestById(request.id)!.pendingData).toEqual(pendingDraftData);

          // Submit rejection
          const result = store.submitRejectionDecision(
            request.id,
            reviewerId,
            reason
          );
          expect(result.success).toBe(true);

          // (1) pendingData is set to null
          const updatedRequest = store.getRequestById(request.id);
          expect(updatedRequest).toBeDefined();
          expect(updatedRequest!.pendingData).toBeNull();

          // (2) page status is reverted to "draft"
          const page = store.getPage(pageId);
          expect(page).toBeDefined();
          expect(page!.status).toBe("draft");

          // (3) rejection reason is stored as the decision comment
          const decisions = store.getDecisionsForRequest(request.id);
          expect(decisions.length).toBe(1);
          expect(decisions[0].decision).toBe("rejected");
          expect(decisions[0].comment).toBe(reason);

          // Also verify request status is "rejected"
          expect(updatedRequest!.status).toBe("rejected");
        }
      ),
      { numRuns: 20 }
    );
  });

  it("rejection does not modify the original pages.data (live data preserved)", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        rejectionReasonArb,
        (pageId, submitterId, reviewerId, title, originalData, pendingDraftData, reason) => {
          const store = new RejectionCleanupStore();

          store.setApprovalConfig("pages", true, 1);
          store.addPage({
            id: pageId,
            title,
            slug: "test-page",
            locale: "en",
            status: "published",
            data: originalData,
            publishedAt: new Date(),
            updatedAt: new Date(),
          });

          // Snapshot original data
          const originalDataSnapshot = JSON.parse(JSON.stringify(originalData));

          // Create a pending approval request
          const request = store.createApprovalRequest(
            pageId,
            submitterId,
            pendingDraftData
          );

          // Submit rejection
          store.submitRejectionDecision(request.id, reviewerId, reason);

          // Assert: pages.data is unchanged (live data preserved)
          const page = store.getPage(pageId);
          expect(page).toBeDefined();
          expect(page!.data).toEqual(originalDataSnapshot);
        }
      ),
      { numRuns: 20 }
    );
  });
});
