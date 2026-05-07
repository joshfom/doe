import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { ContentModule } from "../types";

/**
 * Feature: pages-approval-draft-preview, Property 8: Decision reset on re-edit
 *
 * **Validates: Requirements 7.4**
 *
 * For any pending approval request that has one or more existing decisions,
 * when the submitter saves new changes to the pending draft, the system SHALL
 * delete all existing decisions for that request, effectively requiring
 * re-review from all approvers.
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

// ── In-memory store simulating decision reset on re-edit logic ────────────────

class DecisionResetStore {
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
   * Add an approval decision to a request (simulates an approver approving).
   */
  addApprovalDecision(
    requestId: string,
    approverId: string,
    decision: "approved" | "rejected" = "approved",
    comment: string | null = null
  ): void {
    this.decisions.push({
      id: crypto.randomUUID(),
      requestId,
      approverId,
      decision,
      comment,
      createdAt: new Date(),
    });
  }

  /**
   * Simulate the re-edit save logic:
   *
   * When the submitter saves new changes to the pending draft:
   * 1. Update pendingData on the existing approval request
   * 2. Delete ALL existing decisions for that request (reset for re-review)
   * 3. The request remains in "pending" status
   * 4. pages.data is NOT modified
   */
  handleReEditSave(
    pageId: string,
    newData: unknown,
    userId: string
  ): { success: boolean; error?: string } {
    const page = this.pages.get(pageId);
    if (!page) {
      return { success: false, error: "Page not found" };
    }

    const existingRequest = this.getActiveApprovalRequest(pageId, "pages");
    if (!existingRequest) {
      return { success: false, error: "No active approval request" };
    }

    // Update pendingData on existing request
    existingRequest.pendingData = newData;

    // Delete ALL existing decisions for this request (re-review required)
    this.decisions = this.decisions.filter(
      (d) => d.requestId !== existingRequest.id
    );

    // pages.data is NOT modified — live data stays unchanged
    // Request remains in "pending" status

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

/** Generates a random number of decisions (1 to 5) with unique approver IDs */
const decisionsCountArb = fc.integer({ min: 1, max: 5 });

// ── Property Tests ───────────────────────────────────────────────────────────

// Feature: pages-approval-draft-preview, Property 8: Decision reset on re-edit
describe("Feature: pages-approval-draft-preview, Property 8: Decision reset on re-edit", () => {
  it("after re-edit, all existing decisions are deleted regardless of count", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        puckPageDataArb,
        decisionsCountArb,
        fc.array(uuidArb, { minLength: 5, maxLength: 5 }),
        (pageId, submitterId, title, originalData, initialDraft, newDraft, numDecisions, approverIds) => {
          const store = new DecisionResetStore();

          store.setApprovalConfig("pages", true, 3);
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
            initialDraft
          );

          // Add numDecisions approval decisions
          for (let i = 0; i < numDecisions; i++) {
            store.addApprovalDecision(request.id, approverIds[i], "approved");
          }

          // Verify decisions exist before re-edit
          const decisionsBefore = store.getDecisionsForRequest(request.id);
          expect(decisionsBefore.length).toBe(numDecisions);

          // Re-edit: submitter saves new changes
          const result = store.handleReEditSave(pageId, newDraft, submitterId);
          expect(result.success).toBe(true);

          // Assert: ALL decisions are deleted after re-edit
          const decisionsAfter = store.getDecisionsForRequest(request.id);
          expect(decisionsAfter.length).toBe(0);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("after re-edit, pendingData is updated to the new data", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        puckPageDataArb,
        (pageId, submitterId, approverId, title, originalData, initialDraft, newDraft) => {
          const store = new DecisionResetStore();

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
            initialDraft
          );

          // Add a decision
          store.addApprovalDecision(request.id, approverId, "approved");

          // Re-edit: submitter saves new changes
          const result = store.handleReEditSave(pageId, newDraft, submitterId);
          expect(result.success).toBe(true);

          // Assert: pendingData is updated to the new draft data
          const updatedRequest = store.getRequestById(request.id);
          expect(updatedRequest).toBeDefined();
          expect(updatedRequest!.pendingData).toEqual(newDraft);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("after re-edit, the request remains in 'pending' status", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        puckPageDataArb,
        decisionsCountArb,
        fc.array(uuidArb, { minLength: 5, maxLength: 5 }),
        (pageId, submitterId, title, originalData, initialDraft, newDraft, numDecisions, approverIds) => {
          const store = new DecisionResetStore();

          store.setApprovalConfig("pages", true, 3);
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
            initialDraft
          );

          // Add decisions
          for (let i = 0; i < numDecisions; i++) {
            store.addApprovalDecision(request.id, approverIds[i], "approved");
          }

          // Re-edit: submitter saves new changes
          const result = store.handleReEditSave(pageId, newDraft, submitterId);
          expect(result.success).toBe(true);

          // Assert: request remains in "pending" status
          const updatedRequest = store.getRequestById(request.id);
          expect(updatedRequest).toBeDefined();
          expect(updatedRequest!.status).toBe("pending");
        }
      ),
      { numRuns: 20 }
    );
  });

  it("all decision reset conditions hold simultaneously for any number of decisions and any data", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        puckPageDataArb,
        decisionsCountArb,
        fc.array(uuidArb, { minLength: 5, maxLength: 5 }),
        (pageId, submitterId, title, originalData, initialDraft, newDraft, numDecisions, approverIds) => {
          const store = new DecisionResetStore();

          store.setApprovalConfig("pages", true, 5);
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
            initialDraft
          );

          // Add numDecisions decisions (mix of approved and rejected)
          for (let i = 0; i < numDecisions; i++) {
            const decision = i % 2 === 0 ? "approved" : "rejected";
            store.addApprovalDecision(
              request.id,
              approverIds[i],
              decision as "approved" | "rejected",
              decision === "rejected" ? "needs changes" : null
            );
          }

          // Verify decisions exist before re-edit
          const decisionsBefore = store.getDecisionsForRequest(request.id);
          expect(decisionsBefore.length).toBe(numDecisions);

          // Snapshot original pages.data
          const originalDataSnapshot = JSON.parse(JSON.stringify(originalData));

          // Re-edit: submitter saves new changes
          const result = store.handleReEditSave(pageId, newDraft, submitterId);
          expect(result.success).toBe(true);

          // (1) ALL decisions are deleted
          const decisionsAfter = store.getDecisionsForRequest(request.id);
          expect(decisionsAfter.length).toBe(0);

          // (2) pendingData is updated to the new draft
          const updatedRequest = store.getRequestById(request.id);
          expect(updatedRequest).toBeDefined();
          expect(updatedRequest!.pendingData).toEqual(newDraft);

          // (3) request remains in "pending" status
          expect(updatedRequest!.status).toBe("pending");

          // (4) pages.data is unchanged (live data preserved)
          const page = store.getPage(pageId);
          expect(page).toBeDefined();
          expect(page!.data).toEqual(originalDataSnapshot);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("re-edit resets decisions even when only a single decision exists", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        puckPageDataArb,
        (pageId, submitterId, approverId, title, originalData, initialDraft, newDraft) => {
          const store = new DecisionResetStore();

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
            initialDraft
          );

          // Add exactly 1 decision
          store.addApprovalDecision(request.id, approverId, "approved");

          // Verify 1 decision exists
          const decisionsBefore = store.getDecisionsForRequest(request.id);
          expect(decisionsBefore.length).toBe(1);

          // Re-edit
          const result = store.handleReEditSave(pageId, newDraft, submitterId);
          expect(result.success).toBe(true);

          // Assert: decision is deleted
          const decisionsAfter = store.getDecisionsForRequest(request.id);
          expect(decisionsAfter.length).toBe(0);

          // Assert: pendingData updated
          const updatedRequest = store.getRequestById(request.id);
          expect(updatedRequest!.pendingData).toEqual(newDraft);

          // Assert: still pending
          expect(updatedRequest!.status).toBe("pending");
        }
      ),
      { numRuns: 20 }
    );
  });
});
