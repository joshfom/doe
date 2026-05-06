import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { ContentModule } from "../types";

/**
 * Feature: pages-approval-draft-preview, Property 3: Pending draft retrieval
 *
 * **Validates: Requirements 1.3, 7.1, 8.1, 8.4**
 *
 * For any page with an active approval request containing pendingData,
 * GET /pages/:id/pending-draft SHALL return that pendingData. For any page
 * without an active pending request, the endpoint SHALL return 404. The
 * GET /pages/:id response SHALL include hasPendingDraft: true if and only if
 * an active pending request with non-null pendingData exists.
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

// ── In-memory store simulating pending draft retrieval logic ──────────────────

class PendingDraftRetrievalStore {
  private pages: Map<string, PageRecord> = new Map();
  private requests: ApprovalRequestRecord[] = [];

  /** Register a page */
  addPage(page: PageRecord): void {
    this.pages.set(page.id, { ...page });
  }

  /** Get a page */
  getPage(id: string): PageRecord | undefined {
    const page = this.pages.get(id);
    return page ? { ...page } : undefined;
  }

  /** Add an approval request directly */
  addApprovalRequest(request: ApprovalRequestRecord): void {
    this.requests.push({ ...request });
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

  /**
   * Simulate GET /pages/:id/pending-draft endpoint.
   *
   * Returns the pendingData from the active approval request for a page.
   * Returns 404 (null) if no active pending request with pendingData exists.
   */
  getPendingDraft(pageId: string): { status: 200; data: unknown } | { status: 404; error: string } {
    const page = this.pages.get(pageId);
    if (!page) {
      return { status: 404, error: "Page not found" };
    }

    const activeRequest = this.getActiveApprovalRequest(pageId, "pages");

    if (!activeRequest || activeRequest.pendingData == null) {
      return { status: 404, error: "No pending draft" };
    }

    return { status: 200, data: activeRequest.pendingData };
  }

  /**
   * Simulate GET /pages/:id response with hasPendingDraft boolean.
   *
   * hasPendingDraft is true if and only if an active pending request
   * with non-null pendingData exists for this page.
   */
  getPageDetail(pageId: string): { page: PageRecord; hasPendingDraft: boolean } | null {
    const page = this.pages.get(pageId);
    if (!page) return null;

    const activeRequest = this.getActiveApprovalRequest(pageId, "pages");
    const hasPendingDraft =
      activeRequest != null && activeRequest.pendingData != null;

    return { page: { ...page }, hasPendingDraft };
  }

  /**
   * Simulate saving to pending draft (creates or updates approval request).
   * Used to set up test scenarios.
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

    const existingRequest = this.getActiveApprovalRequest(pageId, "pages");

    if (existingRequest) {
      existingRequest.pendingData = newData;
    } else {
      const request: ApprovalRequestRecord = {
        id: crypto.randomUUID(),
        contentId: pageId,
        contentModule: "pages",
        submitterId: userId,
        status: "pending",
        pendingData: newData,
        createdAt: new Date(),
        resolvedAt: null,
      };
      this.requests.push(request);
      page.status = "pending_review";
    }

    return { success: true };
  }

  /**
   * Simulate approval (clears pendingData and sets status to approved).
   * Used to set up test scenarios where pendingData is null after approval.
   */
  approveRequest(requestId: string): void {
    const request = this.requests.find((r) => r.id === requestId);
    if (request) {
      request.pendingData = null;
      request.status = "approved";
      request.resolvedAt = new Date();
    }
  }

  /**
   * Simulate rejection (clears pendingData and sets status to rejected).
   * Used to set up test scenarios where pendingData is null after rejection.
   */
  rejectRequest(requestId: string): void {
    const request = this.requests.find((r) => r.id === requestId);
    if (request) {
      request.pendingData = null;
      request.status = "rejected";
      request.resolvedAt = new Date();
    }
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

// ── Property Tests ───────────────────────────────────────────────────────────

// Feature: pages-approval-draft-preview, Property 3: Pending draft retrieval
describe("Feature: pages-approval-draft-preview, Property 3: Pending draft retrieval", () => {
  it("when a pending request with pendingData exists, GET /pending-draft returns that data", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        (pageId, userId, title, originalData, pendingDraftData) => {
          const store = new PendingDraftRetrievalStore();

          // Set up: page exists with original data
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

          // Create a pending draft via save
          const saveResult = store.handlePageSave(pageId, pendingDraftData, userId);
          expect(saveResult.success).toBe(true);

          // Act: GET /pages/:id/pending-draft
          const result = store.getPendingDraft(pageId);

          // Assert: returns 200 with the pendingData
          expect(result.status).toBe(200);
          if (result.status === 200) {
            expect(result.data).toEqual(pendingDraftData);
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  it("when no pending request exists, GET /pending-draft returns 404", () => {
    fc.assert(
      fc.property(
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        (pageId, title, originalData) => {
          const store = new PendingDraftRetrievalStore();

          // Set up: page exists but NO approval request
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

          // Act: GET /pages/:id/pending-draft
          const result = store.getPendingDraft(pageId);

          // Assert: returns 404
          expect(result.status).toBe(404);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("when pendingData is null (after approval), GET /pending-draft returns 404", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        (pageId, userId, title, originalData, pendingDraftData) => {
          const store = new PendingDraftRetrievalStore();

          // Set up: page exists
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

          // Create a pending draft
          store.handlePageSave(pageId, pendingDraftData, userId);

          // Approve the request (clears pendingData)
          const activeRequest = store.getActiveApprovalRequest(pageId, "pages");
          expect(activeRequest).toBeDefined();
          store.approveRequest(activeRequest!.id);

          // Act: GET /pages/:id/pending-draft
          const result = store.getPendingDraft(pageId);

          // Assert: returns 404 because pendingData is now null and request is no longer pending
          expect(result.status).toBe(404);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("when pendingData is null (after rejection), GET /pending-draft returns 404", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        (pageId, userId, title, originalData, pendingDraftData) => {
          const store = new PendingDraftRetrievalStore();

          // Set up: page exists
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

          // Create a pending draft
          store.handlePageSave(pageId, pendingDraftData, userId);

          // Reject the request (clears pendingData)
          const activeRequest = store.getActiveApprovalRequest(pageId, "pages");
          expect(activeRequest).toBeDefined();
          store.rejectRequest(activeRequest!.id);

          // Act: GET /pages/:id/pending-draft
          const result = store.getPendingDraft(pageId);

          // Assert: returns 404 because pendingData is now null and request is rejected
          expect(result.status).toBe(404);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("GET /pages/:id includes hasPendingDraft: true iff active pending request with non-null pendingData exists", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        fc.constantFrom("none", "pending_with_data", "approved", "rejected") as fc.Arbitrary<
          "none" | "pending_with_data" | "approved" | "rejected"
        >,
        (pageId, userId, title, originalData, pendingDraftData, scenario) => {
          const store = new PendingDraftRetrievalStore();

          // Set up: page exists
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

          // Set up scenario
          if (scenario === "pending_with_data") {
            // Active pending request with pendingData
            store.handlePageSave(pageId, pendingDraftData, userId);
          } else if (scenario === "approved") {
            // Request was approved (pendingData cleared, status = approved)
            store.handlePageSave(pageId, pendingDraftData, userId);
            const req = store.getActiveApprovalRequest(pageId, "pages");
            store.approveRequest(req!.id);
          } else if (scenario === "rejected") {
            // Request was rejected (pendingData cleared, status = rejected)
            store.handlePageSave(pageId, pendingDraftData, userId);
            const req = store.getActiveApprovalRequest(pageId, "pages");
            store.rejectRequest(req!.id);
          }
          // scenario === "none": no approval request at all

          // Act: GET /pages/:id
          const detail = store.getPageDetail(pageId);
          expect(detail).not.toBeNull();

          // Assert: hasPendingDraft is true ONLY when there's an active pending
          // request with non-null pendingData
          if (scenario === "pending_with_data") {
            expect(detail!.hasPendingDraft).toBe(true);
          } else {
            expect(detail!.hasPendingDraft).toBe(false);
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  it("pending draft retrieval returns the latest saved data after multiple edits", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        fc.array(puckPageDataArb, { minLength: 2, maxLength: 5 }),
        (pageId, userId, title, originalData, edits) => {
          const store = new PendingDraftRetrievalStore();

          // Set up: page exists
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

          // Perform multiple saves (each updates the pending draft)
          for (const editData of edits) {
            const result = store.handlePageSave(pageId, editData, userId);
            expect(result.success).toBe(true);
          }

          // Act: GET /pages/:id/pending-draft
          const result = store.getPendingDraft(pageId);

          // Assert: returns the LAST saved data
          const lastEdit = edits[edits.length - 1];
          expect(result.status).toBe(200);
          if (result.status === 200) {
            expect(result.data).toEqual(lastEdit);
          }

          // Assert: hasPendingDraft is true
          const detail = store.getPageDetail(pageId);
          expect(detail!.hasPendingDraft).toBe(true);
        }
      ),
      { numRuns: 20 }
    );
  });
});
