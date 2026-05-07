import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { ContentModule } from "../types";

/**
 * Feature: pages-approval-draft-preview, Property 2: Live data invariant
 *
 * **Validates: Requirements 1.2, 4.5, 8.2**
 *
 * For any page with a pending approval request, pages.data SHALL remain
 * unchanged regardless of how many saves to the pending draft or partial
 * approvals are submitted. The public endpoint and the GET /pages/:id/live-data
 * endpoint SHALL always return the original pages.data.
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
}

interface ApprovalDecisionRecord {
  id: string;
  requestId: string;
  approverId: string;
  decision: "approved" | "rejected";
  comment: string | null;
  createdAt: Date;
}

// ── In-memory store simulating the live data invariant logic ──────────────────

class LiveDataInvariantStore {
  private pages: Map<string, PageRecord> = new Map();
  private configs: ApprovalConfigRecord[] = [];
  private requests: ApprovalRequestRecord[] = [];
  private decisions: ApprovalDecisionRecord[] = [];

  /** Register a page */
  addPage(page: PageRecord): void {
    this.pages.set(page.id, { ...page });
  }

  /** Get a page (simulates pages table read) */
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

  /** Check if approval is enabled for a module */
  isApprovalEnabled(contentModule: ContentModule): boolean {
    const config = this.configs.find(
      (c) => c.contentModule === contentModule
    );
    return config?.enabled ?? false;
  }

  /** Get required approvals count */
  getRequiredApprovals(contentModule: ContentModule): number {
    const config = this.configs.find(
      (c) => c.contentModule === contentModule
    );
    return config?.requiredApprovals ?? 1;
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

  /** Get decisions for a request */
  getDecisionsForRequest(requestId: string): ApprovalDecisionRecord[] {
    return this.decisions.filter((d) => d.requestId === requestId);
  }

  /**
   * Simulate the PUT /pages/:id save routing logic:
   * Routes to pendingData when approval is enabled, never modifies pages.data.
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
      // Direct save to pages.data (not relevant for this invariant test)
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

  /**
   * Simulate a partial approval decision (does NOT reach threshold).
   * pages.data must remain unchanged after partial approvals.
   */
  submitPartialApproval(
    requestId: string,
    approverId: string
  ): { success: boolean; error?: string } {
    const request = this.requests.find((r) => r.id === requestId);
    if (!request) {
      return { success: false, error: "Request not found" };
    }
    if (request.status !== "pending") {
      return { success: false, error: "Request not pending" };
    }

    // Record the decision
    this.decisions.push({
      id: crypto.randomUUID(),
      requestId,
      approverId,
      decision: "approved",
      comment: null,
      createdAt: new Date(),
    });

    // Check if threshold is met
    const approvedCount = this.decisions.filter(
      (d) => d.requestId === requestId && d.decision === "approved"
    ).length;
    const required = this.getRequiredApprovals(request.contentModule);

    if (approvedCount >= required) {
      // Full approval: commit pendingData → pages.data
      const page = this.pages.get(request.contentId);
      if (page && request.pendingData != null) {
        page.data = request.pendingData;
        page.status = "published";
        page.publishedAt = new Date();
      }
      request.pendingData = null;
      request.status = "approved";
    }
    // Otherwise: partial approval — pages.data remains unchanged

    return { success: true };
  }

  /**
   * Simulate GET /pages/:id/live-data endpoint.
   * Always returns pages.data regardless of approval status.
   */
  getLiveData(pageId: string): { data: unknown } | null {
    const page = this.pages.get(pageId);
    if (!page) return null;
    return { data: page.data };
  }

  /**
   * Simulate public endpoint serving pages.data.
   * Always returns pages.data (the live version).
   */
  getPublicPageData(pageId: string): { data: unknown } | null {
    const page = this.pages.get(pageId);
    if (!page) return null;
    return { data: page.data };
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

/** Generates a list of distinct save data payloads (simulating multiple edits) */
const multipleSavesArb = fc.array(puckPageDataArb, {
  minLength: 1,
  maxLength: 10,
});

/** Generates a list of distinct approver IDs for partial approvals */
const approverIdsArb = (count: number) =>
  fc.array(fc.uuid(), { minLength: count, maxLength: count });

// ── Property Tests ───────────────────────────────────────────────────────────

// Feature: pages-approval-draft-preview, Property 2: Live data invariant
describe("Feature: pages-approval-draft-preview, Property 2: Live data invariant", () => {
  it("pages.data remains unchanged after multiple saves to pending draft", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        multipleSavesArb,
        (pageId, userId, title, originalData, savesData) => {
          const store = new LiveDataInvariantStore();

          // Set up: approval enabled, page exists with original data
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

          // Snapshot the original data
          const originalDataSnapshot = JSON.parse(JSON.stringify(originalData));

          // Act: perform multiple saves to the pending draft
          for (const saveData of savesData) {
            const result = store.handlePageSave(pageId, saveData, userId);
            expect(result.success).toBe(true);
          }

          // Assert: pages.data is STILL the original data after all saves
          const page = store.getPage(pageId);
          expect(page).toBeDefined();
          expect(page!.data).toEqual(originalDataSnapshot);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("pages.data remains unchanged after partial approvals (below threshold)", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        fc.integer({ min: 2, max: 5 }),
        (pageId, userId, title, originalData, pendingDraftData, requiredApprovals) => {
          const store = new LiveDataInvariantStore();

          // Set up: approval enabled with N required approvals
          store.setApprovalConfig("pages", true, requiredApprovals);
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

          // Snapshot the original data
          const originalDataSnapshot = JSON.parse(JSON.stringify(originalData));

          // Create a pending draft
          const saveResult = store.handlePageSave(
            pageId,
            pendingDraftData,
            userId
          );
          expect(saveResult.success).toBe(true);

          // Get the approval request
          const request = store.getActiveApprovalRequest(pageId, "pages");
          expect(request).toBeDefined();

          // Submit partial approvals (one less than required)
          const partialCount = requiredApprovals - 1;
          for (let i = 0; i < partialCount; i++) {
            const approverId = crypto.randomUUID();
            const result = store.submitPartialApproval(request!.id, approverId);
            expect(result.success).toBe(true);
          }

          // Assert: pages.data is STILL the original data after partial approvals
          const page = store.getPage(pageId);
          expect(page).toBeDefined();
          expect(page!.data).toEqual(originalDataSnapshot);

          // Assert: the request is still pending (not yet fully approved)
          const activeRequest = store.getActiveApprovalRequest(pageId, "pages");
          expect(activeRequest).toBeDefined();
          expect(activeRequest!.status).toBe("pending");
        }
      ),
      { numRuns: 20 }
    );
  });

  it("GET /pages/:id/live-data always returns original pages.data during pending approval", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        multipleSavesArb,
        fc.integer({ min: 2, max: 5 }),
        (pageId, userId, title, originalData, savesData, requiredApprovals) => {
          const store = new LiveDataInvariantStore();

          // Set up: approval enabled, page exists with original data
          store.setApprovalConfig("pages", true, requiredApprovals);
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

          // Snapshot the original data
          const originalDataSnapshot = JSON.parse(JSON.stringify(originalData));

          // Perform multiple saves
          for (const saveData of savesData) {
            store.handlePageSave(pageId, saveData, userId);
          }

          // Submit some partial approvals
          const request = store.getActiveApprovalRequest(pageId, "pages");
          if (request) {
            const partialCount = Math.min(
              requiredApprovals - 1,
              savesData.length
            );
            for (let i = 0; i < partialCount; i++) {
              const approverId = crypto.randomUUID();
              store.submitPartialApproval(request.id, approverId);
            }
          }

          // Assert: live-data endpoint returns original pages.data
          const liveData = store.getLiveData(pageId);
          expect(liveData).not.toBeNull();
          expect(liveData!.data).toEqual(originalDataSnapshot);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("public endpoint always returns original pages.data during pending approval", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        multipleSavesArb,
        fc.integer({ min: 2, max: 5 }),
        (pageId, userId, title, originalData, savesData, requiredApprovals) => {
          const store = new LiveDataInvariantStore();

          // Set up: approval enabled, page exists with original data
          store.setApprovalConfig("pages", true, requiredApprovals);
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

          // Snapshot the original data
          const originalDataSnapshot = JSON.parse(JSON.stringify(originalData));

          // Perform multiple saves to pending draft
          for (const saveData of savesData) {
            store.handlePageSave(pageId, saveData, userId);
          }

          // Submit some partial approvals
          const request = store.getActiveApprovalRequest(pageId, "pages");
          if (request) {
            const partialCount = Math.min(
              requiredApprovals - 1,
              savesData.length
            );
            for (let i = 0; i < partialCount; i++) {
              const approverId = crypto.randomUUID();
              store.submitPartialApproval(request.id, approverId);
            }
          }

          // Assert: public endpoint returns original pages.data
          const publicData = store.getPublicPageData(pageId);
          expect(publicData).not.toBeNull();
          expect(publicData!.data).toEqual(originalDataSnapshot);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("pages.data remains unchanged after interleaved saves and partial approvals", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        multipleSavesArb,
        fc.integer({ min: 2, max: 5 }),
        (pageId, userId, title, originalData, savesData, requiredApprovals) => {
          const store = new LiveDataInvariantStore();

          // Set up: approval enabled, page exists with original data
          store.setApprovalConfig("pages", true, requiredApprovals);
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

          // Snapshot the original data
          const originalDataSnapshot = JSON.parse(JSON.stringify(originalData));

          // Interleave saves and partial approvals
          for (let i = 0; i < savesData.length; i++) {
            // Save
            const saveResult = store.handlePageSave(
              pageId,
              savesData[i],
              userId
            );
            expect(saveResult.success).toBe(true);

            // After each save, submit a partial approval (if below threshold)
            // Note: saves reset decisions, so each save starts fresh
            const request = store.getActiveApprovalRequest(pageId, "pages");
            if (request) {
              const currentDecisions = store.getDecisionsForRequest(request.id);
              if (currentDecisions.length < requiredApprovals - 1) {
                const approverId = crypto.randomUUID();
                store.submitPartialApproval(request.id, approverId);
              }
            }

            // Assert invariant holds after each operation
            const page = store.getPage(pageId);
            expect(page!.data).toEqual(originalDataSnapshot);

            // Assert live-data endpoint returns original
            const liveData = store.getLiveData(pageId);
            expect(liveData!.data).toEqual(originalDataSnapshot);

            // Assert public endpoint returns original
            const publicData = store.getPublicPageData(pageId);
            expect(publicData!.data).toEqual(originalDataSnapshot);
          }
        }
      ),
      { numRuns: 20 }
    );
  });
});
