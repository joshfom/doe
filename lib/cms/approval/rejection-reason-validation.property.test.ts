import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { ContentModule } from "../types";

/**
 * Feature: pages-approval-draft-preview, Property 7: Rejection reason validation
 *
 * **Validates: Requirements 5.2, 5.3**
 *
 * For any string composed entirely of whitespace (including empty string),
 * the system SHALL reject a rejection decision submission. For any non-empty,
 * non-whitespace reason string, the rejection SHALL be accepted and the reason
 * stored verbatim as the decision comment.
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

// ── In-memory store simulating rejection reason validation logic ──────────────

class RejectionReasonValidationStore {
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
   * Submit a rejection decision with reason validation.
   *
   * Validates that the reason is non-empty and not whitespace-only.
   * Returns 400 status if reason is invalid.
   * On valid rejection:
   * - Stores the reason verbatim as the decision comment
   * - Sets pendingData to null
   * - Reverts page status to "draft"
   * - Sets request status to "rejected"
   */
  submitRejectionDecision(
    requestId: string,
    reviewerId: string,
    reason: string
  ): { success: boolean; status: number; error?: string } {
    // Validate rejection reason: must be non-empty and not whitespace-only
    if (!reason || reason.trim().length === 0) {
      return {
        success: false,
        status: 400,
        error: "Rejection reason is required",
      };
    }

    const request = this.requests.find((r) => r.id === requestId);
    if (!request) {
      return { success: false, status: 404, error: "Request not found" };
    }
    if (request.status !== "pending") {
      return { success: false, status: 409, error: "Request already resolved" };
    }

    // Record the rejection decision with the reason stored verbatim as comment
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

    return { success: true, status: 200 };
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

/** Generates whitespace-only strings (including empty string) */
const whitespaceOnlyArb = fc.oneof(
  fc.constant(""),
  fc.constant(" "),
  fc.constant("  "),
  fc.constant("\t"),
  fc.constant("\n"),
  fc.constant("\r"),
  fc.constant("\r\n"),
  fc.constant("  \t\n  "),
  fc.constant("\t\t\t"),
  fc.constant("   \n   \t   "),
  fc.constant("\f"),
  fc.constant("\v"),
  fc.stringMatching(/^[ \t\n\r]{1,20}$/)
);

/** Generates a non-empty, non-whitespace rejection reason string */
const validReasonArb = fc
  .string({ minLength: 1, maxLength: 500 })
  .filter((s) => s.trim().length > 0);

const pageTitleArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0);

// ── Property Tests ───────────────────────────────────────────────────────────

// Feature: pages-approval-draft-preview, Property 7: Rejection reason validation
describe("Feature: pages-approval-draft-preview, Property 7: Rejection reason validation", () => {
  it("empty string reasons are rejected with status 400", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        (pageId, submitterId, reviewerId, title, originalData, pendingDraftData) => {
          const store = new RejectionReasonValidationStore();

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

          const request = store.createApprovalRequest(
            pageId,
            submitterId,
            pendingDraftData
          );

          // Submit rejection with empty string reason
          const result = store.submitRejectionDecision(
            request.id,
            reviewerId,
            ""
          );

          // Assert: rejection is rejected with 400
          expect(result.success).toBe(false);
          expect(result.status).toBe(400);

          // Assert: request remains pending (not modified)
          const updatedRequest = store.getRequestById(request.id);
          expect(updatedRequest!.status).toBe("pending");
          expect(updatedRequest!.pendingData).toEqual(pendingDraftData);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("whitespace-only strings are rejected with status 400", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        whitespaceOnlyArb,
        (pageId, submitterId, reviewerId, title, originalData, pendingDraftData, whitespaceReason) => {
          const store = new RejectionReasonValidationStore();

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

          const request = store.createApprovalRequest(
            pageId,
            submitterId,
            pendingDraftData
          );

          // Submit rejection with whitespace-only reason
          const result = store.submitRejectionDecision(
            request.id,
            reviewerId,
            whitespaceReason
          );

          // Assert: rejection is rejected with 400
          expect(result.success).toBe(false);
          expect(result.status).toBe(400);
          expect(result.error).toBe("Rejection reason is required");

          // Assert: request remains pending (not modified)
          const updatedRequest = store.getRequestById(request.id);
          expect(updatedRequest!.status).toBe("pending");
          expect(updatedRequest!.pendingData).toEqual(pendingDraftData);

          // Assert: no decisions were recorded
          const decisions = store.getDecisionsForRequest(request.id);
          expect(decisions.length).toBe(0);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("any non-empty, non-whitespace reason string is accepted", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        validReasonArb,
        (pageId, submitterId, reviewerId, title, originalData, pendingDraftData, reason) => {
          const store = new RejectionReasonValidationStore();

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

          const request = store.createApprovalRequest(
            pageId,
            submitterId,
            pendingDraftData
          );

          // Submit rejection with valid reason
          const result = store.submitRejectionDecision(
            request.id,
            reviewerId,
            reason
          );

          // Assert: rejection is accepted
          expect(result.success).toBe(true);
          expect(result.status).toBe(200);

          // Assert: request is now rejected
          const updatedRequest = store.getRequestById(request.id);
          expect(updatedRequest!.status).toBe("rejected");
        }
      ),
      { numRuns: 20 }
    );
  });

  it("when accepted, the reason is stored verbatim as the decision comment", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        validReasonArb,
        (pageId, submitterId, reviewerId, title, originalData, pendingDraftData, reason) => {
          const store = new RejectionReasonValidationStore();

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

          const request = store.createApprovalRequest(
            pageId,
            submitterId,
            pendingDraftData
          );

          // Submit rejection with valid reason
          const result = store.submitRejectionDecision(
            request.id,
            reviewerId,
            reason
          );
          expect(result.success).toBe(true);

          // Assert: the reason is stored VERBATIM (not trimmed, not modified)
          const decisions = store.getDecisionsForRequest(request.id);
          expect(decisions.length).toBe(1);
          expect(decisions[0].decision).toBe("rejected");
          expect(decisions[0].comment).toBe(reason);

          // Verify it's exactly the same string (identity check)
          expect(decisions[0].comment).toStrictEqual(reason);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("reasons with leading/trailing whitespace but non-whitespace content are accepted and stored verbatim", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        validReasonArb,
        fc.stringMatching(/^[ \t\n]{1,5}$/),
        fc.stringMatching(/^[ \t\n]{1,5}$/),
        (pageId, submitterId, reviewerId, title, originalData, pendingDraftData, coreReason, leadingWs, trailingWs) => {
          const store = new RejectionReasonValidationStore();

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

          const request = store.createApprovalRequest(
            pageId,
            submitterId,
            pendingDraftData
          );

          // Reason with leading/trailing whitespace but non-whitespace content
          const reasonWithWhitespace = leadingWs + coreReason + trailingWs;

          // Submit rejection
          const result = store.submitRejectionDecision(
            request.id,
            reviewerId,
            reasonWithWhitespace
          );

          // Assert: accepted because it contains non-whitespace content
          expect(result.success).toBe(true);
          expect(result.status).toBe(200);

          // Assert: stored VERBATIM (including the leading/trailing whitespace)
          const decisions = store.getDecisionsForRequest(request.id);
          expect(decisions.length).toBe(1);
          expect(decisions[0].comment).toBe(reasonWithWhitespace);
        }
      ),
      { numRuns: 20 }
    );
  });
});
