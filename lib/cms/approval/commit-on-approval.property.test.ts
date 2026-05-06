import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { ContentModule } from "../types";

/**
 * Feature: pages-approval-draft-preview, Property 5: Commit-on-approval
 *
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
 *
 * For any page with a pending approval request containing pendingData, when all
 * required approvers submit "approved" decisions, the system SHALL:
 * (a) copy pendingData into pages.data,
 * (b) create a revision record with the previous pages.data,
 * (c) set page status to "published" with a publishedAt timestamp,
 * (d) set pendingData to null, and
 * (e) set the request status to "approved".
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

interface RevisionRecord {
  id: string;
  contentId: string;
  contentModule: ContentModule;
  data: unknown;
  createdAt: Date;
}

// ── In-memory store simulating commit-on-approval logic ──────────────────────

class CommitOnApprovalStore {
  private pages: Map<string, PageRecord> = new Map();
  private configs: ApprovalConfigRecord[] = [];
  private requests: ApprovalRequestRecord[] = [];
  private decisions: ApprovalDecisionRecord[] = [];
  private revisions: RevisionRecord[] = [];

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

  /** Get a request by ID */
  getRequestById(id: string): ApprovalRequestRecord | undefined {
    return this.requests.find((r) => r.id === id);
  }

  /** Get decisions for a request */
  getDecisionsForRequest(requestId: string): ApprovalDecisionRecord[] {
    return this.decisions.filter((d) => d.requestId === requestId);
  }

  /** Get all revisions for a content item */
  getRevisions(
    contentId: string,
    contentModule: ContentModule
  ): RevisionRecord[] {
    return this.revisions.filter(
      (r) => r.contentId === contentId && r.contentModule === contentModule
    );
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
   * Submit an approval decision. When the threshold is met, performs the
   * commit-on-approval logic:
   * (a) copy pendingData into pages.data
   * (b) create a revision record with the previous pages.data
   * (c) set page status to "published" with a publishedAt timestamp
   * (d) set pendingData to null
   * (e) set the request status to "approved"
   */
  submitApprovalDecision(
    requestId: string,
    approverId: string
  ): { success: boolean; committed: boolean; error?: string } {
    const request = this.requests.find((r) => r.id === requestId);
    if (!request) {
      return { success: false, committed: false, error: "Request not found" };
    }
    if (request.status !== "pending") {
      return { success: false, committed: false, error: "Request not pending" };
    }

    // Record the approval decision
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
      // Full approval reached — commit pendingData
      const page = this.pages.get(request.contentId);
      if (!page) {
        return { success: false, committed: false, error: "Page not found" };
      }

      // (b) Create a revision record with the previous pages.data
      this.revisions.push({
        id: crypto.randomUUID(),
        contentId: request.contentId,
        contentModule: request.contentModule,
        data: JSON.parse(JSON.stringify(page.data)),
        createdAt: new Date(),
      });

      // (a) Copy pendingData into pages.data
      page.data = request.pendingData;

      // (c) Set page status to "published" with a publishedAt timestamp
      page.status = "published";
      page.publishedAt = new Date();
      page.updatedAt = new Date();

      // (d) Set pendingData to null
      request.pendingData = null;

      // (e) Set the request status to "approved"
      request.status = "approved";
      request.resolvedAt = new Date();

      return { success: true, committed: true };
    }

    // Partial approval — no commit yet
    return { success: true, committed: false };
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

/** Generates a random approval threshold between 1 and 5 */
const approvalThresholdArb = fc.integer({ min: 1, max: 5 });

/** Generates N distinct approver UUIDs */
const distinctApproverIdsArb = (count: number) =>
  fc
    .uniqueArray(fc.uuid(), { minLength: count, maxLength: count })
    .filter((arr) => arr.length === count);

// ── Property Tests ───────────────────────────────────────────────────────────

// Feature: pages-approval-draft-preview, Property 5: Commit-on-approval
describe("Feature: pages-approval-draft-preview, Property 5: Commit-on-approval", () => {
  it("(a) when all required approvers approve, pendingData is copied into pages.data", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        approvalThresholdArb,
        (pageId, submitterId, title, originalData, pendingDraftData, threshold) => {
          const store = new CommitOnApprovalStore();

          // Set up: approval enabled with random threshold
          store.setApprovalConfig("pages", true, threshold);
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

          // Submit approvals up to the threshold
          for (let i = 0; i < threshold; i++) {
            const approverId = crypto.randomUUID();
            store.submitApprovalDecision(request.id, approverId);
          }

          // Assert (a): pages.data now equals pendingDraftData
          const page = store.getPage(pageId);
          expect(page).toBeDefined();
          expect(page!.data).toEqual(pendingDraftData);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("(b) when committed, a revision record is created with the previous pages.data", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        approvalThresholdArb,
        (pageId, submitterId, title, originalData, pendingDraftData, threshold) => {
          const store = new CommitOnApprovalStore();

          store.setApprovalConfig("pages", true, threshold);
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

          // Snapshot original data before commit
          const originalDataSnapshot = JSON.parse(JSON.stringify(originalData));

          // Create pending request and approve fully
          const request = store.createApprovalRequest(
            pageId,
            submitterId,
            pendingDraftData
          );

          for (let i = 0; i < threshold; i++) {
            const approverId = crypto.randomUUID();
            store.submitApprovalDecision(request.id, approverId);
          }

          // Assert (b): a revision record exists with the previous pages.data
          const revisions = store.getRevisions(pageId, "pages");
          expect(revisions.length).toBe(1);
          expect(revisions[0].contentId).toBe(pageId);
          expect(revisions[0].contentModule).toBe("pages");
          expect(revisions[0].data).toEqual(originalDataSnapshot);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("(c) when committed, page status is set to 'published' with a publishedAt timestamp", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        approvalThresholdArb,
        (pageId, submitterId, title, originalData, pendingDraftData, threshold) => {
          const store = new CommitOnApprovalStore();

          store.setApprovalConfig("pages", true, threshold);
          store.addPage({
            id: pageId,
            title,
            slug: "test-page",
            locale: "en",
            status: "draft",
            data: originalData,
            publishedAt: null,
            updatedAt: new Date(),
          });

          const beforeCommit = new Date();

          // Create pending request and approve fully
          const request = store.createApprovalRequest(
            pageId,
            submitterId,
            pendingDraftData
          );

          for (let i = 0; i < threshold; i++) {
            const approverId = crypto.randomUUID();
            store.submitApprovalDecision(request.id, approverId);
          }

          // Assert (c): page status is "published" and publishedAt is set
          const page = store.getPage(pageId);
          expect(page).toBeDefined();
          expect(page!.status).toBe("published");
          expect(page!.publishedAt).not.toBeNull();
          expect(page!.publishedAt!.getTime()).toBeGreaterThanOrEqual(
            beforeCommit.getTime()
          );
        }
      ),
      { numRuns: 20 }
    );
  });

  it("(d) when committed, pendingData is set to null on the approval request", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        approvalThresholdArb,
        (pageId, submitterId, title, originalData, pendingDraftData, threshold) => {
          const store = new CommitOnApprovalStore();

          store.setApprovalConfig("pages", true, threshold);
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

          // Create pending request and approve fully
          const request = store.createApprovalRequest(
            pageId,
            submitterId,
            pendingDraftData
          );

          for (let i = 0; i < threshold; i++) {
            const approverId = crypto.randomUUID();
            store.submitApprovalDecision(request.id, approverId);
          }

          // Assert (d): pendingData is null
          const updatedRequest = store.getRequestById(request.id);
          expect(updatedRequest).toBeDefined();
          expect(updatedRequest!.pendingData).toBeNull();
        }
      ),
      { numRuns: 20 }
    );
  });

  it("(e) when committed, the request status is set to 'approved'", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        approvalThresholdArb,
        (pageId, submitterId, title, originalData, pendingDraftData, threshold) => {
          const store = new CommitOnApprovalStore();

          store.setApprovalConfig("pages", true, threshold);
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

          // Create pending request and approve fully
          const request = store.createApprovalRequest(
            pageId,
            submitterId,
            pendingDraftData
          );

          for (let i = 0; i < threshold; i++) {
            const approverId = crypto.randomUUID();
            store.submitApprovalDecision(request.id, approverId);
          }

          // Assert (e): request status is "approved"
          const updatedRequest = store.getRequestById(request.id);
          expect(updatedRequest).toBeDefined();
          expect(updatedRequest!.status).toBe("approved");
        }
      ),
      { numRuns: 20 }
    );
  });

  it("all five commit-on-approval conditions hold simultaneously for any threshold and data", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        approvalThresholdArb,
        (pageId, submitterId, title, originalData, pendingDraftData, threshold) => {
          const store = new CommitOnApprovalStore();

          store.setApprovalConfig("pages", true, threshold);
          store.addPage({
            id: pageId,
            title,
            slug: "test-page",
            locale: "en",
            status: "draft",
            data: originalData,
            publishedAt: null,
            updatedAt: new Date(),
          });

          // Snapshot original data
          const originalDataSnapshot = JSON.parse(JSON.stringify(originalData));

          const beforeCommit = new Date();

          // Create pending request
          const request = store.createApprovalRequest(
            pageId,
            submitterId,
            pendingDraftData
          );

          // Submit all required approvals
          let lastResult: { success: boolean; committed: boolean } = {
            success: false,
            committed: false,
          };
          for (let i = 0; i < threshold; i++) {
            const approverId = crypto.randomUUID();
            lastResult = store.submitApprovalDecision(request.id, approverId);
          }

          // The last approval should trigger the commit
          expect(lastResult.success).toBe(true);
          expect(lastResult.committed).toBe(true);

          // (a) pages.data now equals pendingDraftData
          const page = store.getPage(pageId);
          expect(page).toBeDefined();
          expect(page!.data).toEqual(pendingDraftData);

          // (b) revision record created with previous pages.data
          const revisions = store.getRevisions(pageId, "pages");
          expect(revisions.length).toBe(1);
          expect(revisions[0].data).toEqual(originalDataSnapshot);

          // (c) page status is "published" with publishedAt timestamp
          expect(page!.status).toBe("published");
          expect(page!.publishedAt).not.toBeNull();
          expect(page!.publishedAt!.getTime()).toBeGreaterThanOrEqual(
            beforeCommit.getTime()
          );

          // (d) pendingData is null
          const updatedRequest = store.getRequestById(request.id);
          expect(updatedRequest).toBeDefined();
          expect(updatedRequest!.pendingData).toBeNull();

          // (e) request status is "approved"
          expect(updatedRequest!.status).toBe("approved");
        }
      ),
      { numRuns: 20 }
    );
  });

  it("partial approvals (below threshold) do NOT trigger commit", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        fc.integer({ min: 2, max: 5 }),
        (pageId, submitterId, title, originalData, pendingDraftData, threshold) => {
          const store = new CommitOnApprovalStore();

          store.setApprovalConfig("pages", true, threshold);
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

          // Create pending request
          const request = store.createApprovalRequest(
            pageId,
            submitterId,
            pendingDraftData
          );

          // Submit partial approvals (one less than required)
          const partialCount = threshold - 1;
          for (let i = 0; i < partialCount; i++) {
            const approverId = crypto.randomUUID();
            const result = store.submitApprovalDecision(
              request.id,
              approverId
            );
            expect(result.success).toBe(true);
            expect(result.committed).toBe(false);
          }

          // Assert: pages.data is still the original (no commit)
          const page = store.getPage(pageId);
          expect(page).toBeDefined();
          expect(page!.data).toEqual(originalDataSnapshot);

          // Assert: request is still pending
          const updatedRequest = store.getRequestById(request.id);
          expect(updatedRequest).toBeDefined();
          expect(updatedRequest!.status).toBe("pending");

          // Assert: pendingData is still present
          expect(updatedRequest!.pendingData).toEqual(pendingDraftData);

          // Assert: page status is still pending_review
          expect(page!.status).toBe("pending_review");
        }
      ),
      { numRuns: 20 }
    );
  });
});
