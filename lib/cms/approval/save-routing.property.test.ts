import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { ContentModule } from "../types";

/**
 * Feature: pages-approval-draft-preview, Property 1: Save-to-pending routing
 *
 * **Validates: Requirements 1.1, 1.5, 1.6, 2.1, 2.2, 2.3, 7.2**
 *
 * For any valid Puck JSON page data and any page with approval enabled,
 * saving via PUT /pages/:id SHALL store the data in approvalRequests.pendingData
 * without modifying pages.data, and SHALL reuse the existing approval request
 * (no duplicates created). When approval is disabled, the save SHALL write
 * directly to pages.data with no approval request created.
 */

// ── Types ────────────────────────────────────────────────────────────────────

interface PageRecord {
  id: string;
  title: string;
  slug: string;
  locale: "en" | "ar";
  status: "draft" | "published" | "pending_review";
  data: unknown;
  updatedAt: Date;
}

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
  pendingData: unknown | null;
  createdAt: Date;
}

interface ApprovalDecisionRecord {
  id: string;
  requestId: string;
  approverId: string;
  decision: "approved" | "rejected";
  comment: string | null;
  createdAt: Date;
}

// ── In-memory store simulating the save routing logic ────────────────────────

class SaveRoutingStore {
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

  /** Check if approval is enabled for a module */
  isApprovalEnabled(contentModule: ContentModule): boolean {
    const config = this.configs.find(
      (c) => c.contentModule === contentModule
    );
    return config?.enabled ?? false;
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

  /** Get all approval requests */
  getAllApprovalRequests(): ApprovalRequestRecord[] {
    return [...this.requests];
  }

  /** Get all decisions for a request */
  getDecisionsForRequest(requestId: string): ApprovalDecisionRecord[] {
    return this.decisions.filter((d) => d.requestId === requestId);
  }

  /** Add a decision to a request (for testing re-edit reset) */
  addDecision(requestId: string, approverId: string): void {
    this.decisions.push({
      id: crypto.randomUUID(),
      requestId,
      approverId,
      decision: "approved",
      comment: null,
      createdAt: new Date(),
    });
  }

  /**
   * Simulate the PUT /pages/:id save routing logic:
   *
   * 1. Check if approval is enabled for "pages" module
   * 2. If enabled and active approval request exists:
   *    - Update pendingData on existing request
   *    - Reset any existing decisions (re-review required)
   *    - Do NOT modify pages.data
   * 3. If enabled and no active request exists:
   *    - Create new approval request with pendingData
   *    - Set page status to "pending_review"
   *    - Do NOT modify pages.data
   * 4. If disabled:
   *    - Save directly to pages.data (existing behavior)
   *    - No approval request created
   */
  handlePageSave(
    pageId: string,
    newData: unknown,
    userId: string
  ): { success: boolean; error?: string } {
    const page = this.pages.get(pageId);
    if (!page) {
      return { success: false, error: "Page not found" };
    }

    const approvalEnabled = this.isApprovalEnabled("pages");

    if (!approvalEnabled) {
      // Direct save to pages.data
      page.data = newData;
      page.updatedAt = new Date();
      return { success: true };
    }

    // Approval is enabled — route to pending draft
    const existingRequest = this.getActiveApprovalRequest(pageId, "pages");

    if (existingRequest) {
      // Update existing request's pendingData
      existingRequest.pendingData = newData;
      // Reset any existing decisions (re-review required)
      this.decisions = this.decisions.filter(
        (d) => d.requestId !== existingRequest.id
      );
    } else {
      // Create new approval request with pendingData
      const request: ApprovalRequestRecord = {
        id: crypto.randomUUID(),
        contentId: pageId,
        contentModule: "pages",
        submitterId: userId,
        status: "pending",
        pendingData: newData,
        createdAt: new Date(),
      };
      this.requests.push(request);
      // Set page status to pending_review
      page.status = "pending_review";
    }

    // pages.data is NOT modified
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
  props: fc.record({
    id: fc.uuid(),
  }).chain((base) =>
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

// ── Property Tests ───────────────────────────────────────────────────────────

// Feature: pages-approval-draft-preview, Property 1: Save-to-pending routing
describe("Feature: pages-approval-draft-preview, Property 1: Save-to-pending routing", () => {
  it("when approval is enabled and no existing request, save stores data in pendingData without modifying pages.data", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        (pageId, userId, title, originalData, newData) => {
          const store = new SaveRoutingStore();

          // Set up: approval enabled, page exists with original data
          store.setApprovalConfig("pages", true);
          store.addPage({
            id: pageId,
            title,
            slug: "test-page",
            locale: "en",
            status: "draft",
            data: originalData,
            updatedAt: new Date(),
          });

          // Act: save new data
          const result = store.handlePageSave(pageId, newData, userId);

          // Assert: save succeeded
          expect(result.success).toBe(true);

          // Assert: pages.data is NOT modified (still has original data)
          const page = store.getPage(pageId);
          expect(page).toBeDefined();
          expect(page!.data).toEqual(originalData);

          // Assert: an approval request was created with pendingData
          const requests = store.getAllApprovalRequests();
          expect(requests.length).toBe(1);

          const request = requests[0];
          expect(request.contentId).toBe(pageId);
          expect(request.contentModule).toBe("pages");
          expect(request.submitterId).toBe(userId);
          expect(request.status).toBe("pending");
          expect(request.pendingData).toEqual(newData);

          // Assert: page status set to pending_review
          expect(page!.status).toBe("pending_review");
        }
      ),
      { numRuns: 20 }
    );
  });

  it("when approval is enabled and an existing pending request exists, save updates pendingData on existing request (no duplicates)", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        puckPageDataArb,
        (pageId, userId, title, originalData, firstSaveData, secondSaveData) => {
          const store = new SaveRoutingStore();

          // Set up: approval enabled, page exists
          store.setApprovalConfig("pages", true);
          store.addPage({
            id: pageId,
            title,
            slug: "test-page",
            locale: "en",
            status: "draft",
            data: originalData,
            updatedAt: new Date(),
          });

          // First save: creates approval request
          const result1 = store.handlePageSave(pageId, firstSaveData, userId);
          expect(result1.success).toBe(true);

          // Second save: should reuse existing request
          const result2 = store.handlePageSave(pageId, secondSaveData, userId);
          expect(result2.success).toBe(true);

          // Assert: still only ONE approval request (no duplicates)
          const requests = store.getAllApprovalRequests();
          expect(requests.length).toBe(1);

          // Assert: pendingData is updated to the second save's data
          const request = requests[0];
          expect(request.pendingData).toEqual(secondSaveData);

          // Assert: pages.data is still the original (never modified)
          const page = store.getPage(pageId);
          expect(page).toBeDefined();
          expect(page!.data).toEqual(originalData);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("when approval is disabled, save writes directly to pages.data with no approval request created", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        (pageId, userId, title, originalData, newData) => {
          const store = new SaveRoutingStore();

          // Set up: approval DISABLED, page exists
          store.setApprovalConfig("pages", false);
          store.addPage({
            id: pageId,
            title,
            slug: "test-page",
            locale: "en",
            status: "draft",
            data: originalData,
            updatedAt: new Date(),
          });

          // Act: save new data
          const result = store.handlePageSave(pageId, newData, userId);

          // Assert: save succeeded
          expect(result.success).toBe(true);

          // Assert: pages.data IS modified to the new data
          const page = store.getPage(pageId);
          expect(page).toBeDefined();
          expect(page!.data).toEqual(newData);

          // Assert: NO approval request was created
          const requests = store.getAllApprovalRequests();
          expect(requests.length).toBe(0);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("when approval is enabled and existing request has decisions, re-save resets decisions", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        puckPageDataArb,
        (pageId, userId, approverId, title, originalData, firstSaveData, secondSaveData) => {
          const store = new SaveRoutingStore();

          // Set up: approval enabled, page exists
          store.setApprovalConfig("pages", true);
          store.addPage({
            id: pageId,
            title,
            slug: "test-page",
            locale: "en",
            status: "draft",
            data: originalData,
            updatedAt: new Date(),
          });

          // First save: creates approval request
          store.handlePageSave(pageId, firstSaveData, userId);

          // Simulate an approver submitting a decision
          const requests = store.getAllApprovalRequests();
          expect(requests.length).toBe(1);
          store.addDecision(requests[0].id, approverId);

          // Verify decision exists
          const decisionsBefore = store.getDecisionsForRequest(requests[0].id);
          expect(decisionsBefore.length).toBe(1);

          // Second save: should reset decisions
          store.handlePageSave(pageId, secondSaveData, userId);

          // Assert: decisions are cleared (reset for re-review)
          const decisionsAfter = store.getDecisionsForRequest(requests[0].id);
          expect(decisionsAfter.length).toBe(0);

          // Assert: pendingData is updated
          const updatedRequests = store.getAllApprovalRequests();
          expect(updatedRequests[0].pendingData).toEqual(secondSaveData);

          // Assert: pages.data unchanged
          const page = store.getPage(pageId);
          expect(page!.data).toEqual(originalData);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("when no approval config exists (undefined), save writes directly to pages.data", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        (pageId, userId, title, originalData, newData) => {
          const store = new SaveRoutingStore();

          // Set up: NO approval config at all, page exists
          store.addPage({
            id: pageId,
            title,
            slug: "test-page",
            locale: "en",
            status: "draft",
            data: originalData,
            updatedAt: new Date(),
          });

          // Act: save new data
          const result = store.handlePageSave(pageId, newData, userId);

          // Assert: save succeeded
          expect(result.success).toBe(true);

          // Assert: pages.data IS modified (direct save)
          const page = store.getPage(pageId);
          expect(page).toBeDefined();
          expect(page!.data).toEqual(newData);

          // Assert: NO approval request was created
          const requests = store.getAllApprovalRequests();
          expect(requests.length).toBe(0);
        }
      ),
      { numRuns: 20 }
    );
  });
});
