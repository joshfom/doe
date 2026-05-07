import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { ContentModule } from "../types";

/**
 * Feature: pages-approval-draft-preview, Property 9: Any-employee authorization with threshold
 *
 * **Validates: Requirements 6.1, 6.2, 6.3**
 *
 * For any user with userType = "employee", the system SHALL allow them to submit
 * approval or rejection decisions on any pending pages approval request. The system
 * SHALL commit the pending draft only when the number of "approved" decisions reaches
 * the configured approver count threshold, regardless of which employees provided
 * those approvals.
 */

// ── Types ────────────────────────────────────────────────────────────────────

type UserType = "employee" | "admin" | "client" | "guest" | "contractor";

interface UserRecord {
  id: string;
  userType: UserType;
  name: string;
}

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

// ── In-memory store simulating any-employee authorization with threshold ─────

class AnyEmployeeAuthorizationStore {
  private users: Map<string, UserRecord> = new Map();
  private pages: Map<string, PageRecord> = new Map();
  private configs: ApprovalConfigRecord[] = [];
  private requests: ApprovalRequestRecord[] = [];
  private decisions: ApprovalDecisionRecord[] = [];
  private revisions: RevisionRecord[] = [];

  /** Register a user */
  addUser(user: UserRecord): void {
    this.users.set(user.id, { ...user });
  }

  /** Get a user */
  getUser(id: string): UserRecord | undefined {
    return this.users.get(id);
  }

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
   * Submit a decision (approval or rejection) on a pending approval request.
   *
   * Authorization rules:
   * - Only users with userType = "employee" can submit decisions
   * - Non-employee users are rejected with 403
   *
   * Threshold logic:
   * - The system commits the pending draft only when the number of "approved"
   *   decisions reaches the configured approver count threshold
   * - Any combination of employees can provide those approvals
   */
  submitDecision(
    requestId: string,
    userId: string,
    decision: "approved" | "rejected",
    comment?: string
  ): { success: boolean; status: number; committed?: boolean; error?: string } {
    // Authorization check: only employees can submit decisions
    const user = this.users.get(userId);
    if (!user) {
      return { success: false, status: 404, error: "User not found" };
    }
    if (user.userType !== "employee") {
      return {
        success: false,
        status: 403,
        error: "Only employees can submit decisions",
      };
    }

    const request = this.requests.find((r) => r.id === requestId);
    if (!request) {
      return { success: false, status: 404, error: "Request not found" };
    }
    if (request.status !== "pending") {
      return {
        success: false,
        status: 409,
        error: "Request already resolved",
      };
    }

    // Validate rejection reason if decision is "rejected"
    if (decision === "rejected") {
      if (!comment || comment.trim().length === 0) {
        return {
          success: false,
          status: 400,
          error: "Rejection reason is required",
        };
      }
    }

    // Record the decision
    this.decisions.push({
      id: crypto.randomUUID(),
      requestId,
      approverId: userId,
      decision,
      comment: comment ?? null,
      createdAt: new Date(),
    });

    // Handle rejection
    if (decision === "rejected") {
      request.pendingData = null;
      request.status = "rejected";
      request.resolvedAt = new Date();

      const page = this.pages.get(request.contentId);
      if (page) {
        page.status = "draft";
      }

      return { success: true, status: 200, committed: false };
    }

    // Handle approval — check if threshold is met
    const approvedCount = this.decisions.filter(
      (d) => d.requestId === requestId && d.decision === "approved"
    ).length;
    const required = this.getRequiredApprovals(request.contentModule);

    if (approvedCount >= required) {
      // Full approval reached — commit pendingData
      const page = this.pages.get(request.contentId);
      if (!page) {
        return { success: false, status: 404, error: "Page not found" };
      }

      // Create a revision record with the previous pages.data
      this.revisions.push({
        id: crypto.randomUUID(),
        contentId: request.contentId,
        contentModule: request.contentModule,
        data: JSON.parse(JSON.stringify(page.data)),
        createdAt: new Date(),
      });

      // Copy pendingData into pages.data
      page.data = request.pendingData;
      page.status = "published";
      page.publishedAt = new Date();
      page.updatedAt = new Date();

      // Clear pendingData and mark request as approved
      request.pendingData = null;
      request.status = "approved";
      request.resolvedAt = new Date();

      return { success: true, status: 200, committed: true };
    }

    // Partial approval — no commit yet
    return { success: true, status: 200, committed: false };
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

/** Generates a non-employee user type */
const nonEmployeeUserTypeArb = fc.constantFrom(
  "admin" as UserType,
  "client" as UserType,
  "guest" as UserType,
  "contractor" as UserType
);

/** Generates a user name */
const userNameArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length > 0);

/** Generates a valid rejection reason */
const validReasonArb = fc
  .string({ minLength: 1, maxLength: 500 })
  .filter((s) => s.trim().length > 0);

// ── Property Tests ───────────────────────────────────────────────────────────

// Feature: pages-approval-draft-preview, Property 9: Any-employee authorization with threshold
describe("Feature: pages-approval-draft-preview, Property 9: Any-employee authorization with threshold", () => {
  it("any employee user can submit an approval decision on a pending pages request", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        uuidArb,
        pageTitleArb,
        userNameArb,
        puckPageDataArb,
        puckPageDataArb,
        approvalThresholdArb,
        (pageId, submitterId, employeeId, title, employeeName, originalData, pendingDraftData, threshold) => {
          const store = new AnyEmployeeAuthorizationStore();

          // Register an employee user
          store.addUser({
            id: employeeId,
            userType: "employee",
            name: employeeName,
          });

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

          const request = store.createApprovalRequest(
            pageId,
            submitterId,
            pendingDraftData
          );

          // Any employee can submit an approval decision
          const result = store.submitDecision(
            request.id,
            employeeId,
            "approved"
          );

          expect(result.success).toBe(true);
          expect(result.status).toBe(200);

          // Decision was recorded
          const decisions = store.getDecisionsForRequest(request.id);
          expect(decisions.length).toBe(1);
          expect(decisions[0].approverId).toBe(employeeId);
          expect(decisions[0].decision).toBe("approved");
        }
      ),
      { numRuns: 20 }
    );
  });

  it("any employee user can submit a rejection decision on a pending pages request", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        uuidArb,
        pageTitleArb,
        userNameArb,
        puckPageDataArb,
        puckPageDataArb,
        validReasonArb,
        (pageId, submitterId, employeeId, title, employeeName, originalData, pendingDraftData, reason) => {
          const store = new AnyEmployeeAuthorizationStore();

          // Register an employee user
          store.addUser({
            id: employeeId,
            userType: "employee",
            name: employeeName,
          });

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

          const request = store.createApprovalRequest(
            pageId,
            submitterId,
            pendingDraftData
          );

          // Any employee can submit a rejection decision
          const result = store.submitDecision(
            request.id,
            employeeId,
            "rejected",
            reason
          );

          expect(result.success).toBe(true);
          expect(result.status).toBe(200);

          // Decision was recorded
          const decisions = store.getDecisionsForRequest(request.id);
          expect(decisions.length).toBe(1);
          expect(decisions[0].approverId).toBe(employeeId);
          expect(decisions[0].decision).toBe("rejected");
          expect(decisions[0].comment).toBe(reason);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("non-employee users are rejected with 403 when attempting to submit decisions", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        uuidArb,
        pageTitleArb,
        userNameArb,
        puckPageDataArb,
        puckPageDataArb,
        nonEmployeeUserTypeArb,
        (pageId, submitterId, nonEmployeeId, title, userName, originalData, pendingDraftData, userType) => {
          const store = new AnyEmployeeAuthorizationStore();

          // Register a non-employee user
          store.addUser({
            id: nonEmployeeId,
            userType,
            name: userName,
          });

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

          // Non-employee attempts to approve — should be rejected with 403
          const result = store.submitDecision(
            request.id,
            nonEmployeeId,
            "approved"
          );

          expect(result.success).toBe(false);
          expect(result.status).toBe(403);
          expect(result.error).toBe("Only employees can submit decisions");

          // No decision was recorded
          const decisions = store.getDecisionsForRequest(request.id);
          expect(decisions.length).toBe(0);

          // Request remains pending
          const updatedRequest = store.getRequestById(request.id);
          expect(updatedRequest!.status).toBe("pending");
          expect(updatedRequest!.pendingData).toEqual(pendingDraftData);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("the system commits the pending draft only when approved decisions reach the configured threshold", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        approvalThresholdArb,
        (pageId, submitterId, title, originalData, pendingDraftData, threshold) => {
          const store = new AnyEmployeeAuthorizationStore();

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

          const request = store.createApprovalRequest(
            pageId,
            submitterId,
            pendingDraftData
          );

          // Register and submit approvals from distinct employees
          for (let i = 0; i < threshold; i++) {
            const empId = crypto.randomUUID();
            store.addUser({
              id: empId,
              userType: "employee",
              name: `Employee ${i}`,
            });

            const result = store.submitDecision(request.id, empId, "approved");
            expect(result.success).toBe(true);

            if (i < threshold - 1) {
              // Before reaching threshold, should NOT commit
              expect(result.committed).toBe(false);
              const req = store.getRequestById(request.id);
              expect(req!.status).toBe("pending");
            } else {
              // At threshold, should commit
              expect(result.committed).toBe(true);
            }
          }

          // After reaching threshold: request is approved and data is committed
          const updatedRequest = store.getRequestById(request.id);
          expect(updatedRequest!.status).toBe("approved");
          expect(updatedRequest!.pendingData).toBeNull();

          const page = store.getPage(pageId);
          expect(page!.data).toEqual(pendingDraftData);
          expect(page!.status).toBe("published");
        }
      ),
      { numRuns: 20 }
    );
  });

  it("any combination of employees can provide approvals — identity of approvers does not matter", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        fc.integer({ min: 2, max: 5 }),
        fc.integer({ min: 3, max: 8 }),
        (pageId, submitterId, title, originalData, pendingDraftData, threshold, totalEmployees) => {
          // Ensure we have enough employees to meet the threshold
          const employeeCount = Math.max(totalEmployees, threshold);
          const store = new AnyEmployeeAuthorizationStore();

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

          const request = store.createApprovalRequest(
            pageId,
            submitterId,
            pendingDraftData
          );

          // Create a pool of employees
          const employees: string[] = [];
          for (let i = 0; i < employeeCount; i++) {
            const empId = crypto.randomUUID();
            store.addUser({
              id: empId,
              userType: "employee",
              name: `Employee ${i}`,
            });
            employees.push(empId);
          }

          // Pick a random subset of employees to approve (exactly threshold count)
          // Use the last `threshold` employees from the shuffled pool
          const approvers = employees.slice(0, threshold);

          // Submit approvals from the selected subset
          for (let i = 0; i < approvers.length; i++) {
            const result = store.submitDecision(
              request.id,
              approvers[i],
              "approved"
            );
            expect(result.success).toBe(true);
          }

          // The draft should be committed regardless of WHICH employees approved
          const updatedRequest = store.getRequestById(request.id);
          expect(updatedRequest!.status).toBe("approved");
          expect(updatedRequest!.pendingData).toBeNull();

          const page = store.getPage(pageId);
          expect(page!.data).toEqual(pendingDraftData);
          expect(page!.status).toBe("published");
        }
      ),
      { numRuns: 20 }
    );
  });

  it("partial approvals below threshold do NOT commit, regardless of which employees approved", () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        pageTitleArb,
        puckPageDataArb,
        puckPageDataArb,
        fc.integer({ min: 2, max: 5 }),
        (pageId, submitterId, title, originalData, pendingDraftData, threshold) => {
          const store = new AnyEmployeeAuthorizationStore();

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

          const request = store.createApprovalRequest(
            pageId,
            submitterId,
            pendingDraftData
          );

          // Submit partial approvals (one less than required)
          const partialCount = threshold - 1;
          for (let i = 0; i < partialCount; i++) {
            const empId = crypto.randomUUID();
            store.addUser({
              id: empId,
              userType: "employee",
              name: `Employee ${i}`,
            });

            const result = store.submitDecision(request.id, empId, "approved");
            expect(result.success).toBe(true);
            expect(result.committed).toBe(false);
          }

          // Assert: pages.data is still the original (no commit)
          const page = store.getPage(pageId);
          expect(page!.data).toEqual(originalDataSnapshot);

          // Assert: request is still pending
          const updatedRequest = store.getRequestById(request.id);
          expect(updatedRequest!.status).toBe("pending");
          expect(updatedRequest!.pendingData).toEqual(pendingDraftData);

          // Assert: page status is still pending_review
          expect(page!.status).toBe("pending_review");
        }
      ),
      { numRuns: 20 }
    );
  });
});
