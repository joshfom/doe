import { eq, and, sql } from "drizzle-orm";
import type { Database } from "../db";
import type { ContentModule, ApprovalDecisionValue } from "../types";
import {
  approvalRequests,
  approvalDecisions,
  approvalConfig,
  approvalConfigApprovers,
  pages,
  posts,
  users,
  revisions,
} from "../schema";
import { logAudit } from "../audit";
import { notifySubmitter } from "./notifications";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ApprovalRequest {
  id: string;
  contentId: string;
  contentModule: string;
  submitterId: string;
  status: string;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface ApprovalRequestWithDetails {
  id: string;
  contentId: string;
  contentModule: string;
  submitterId: string;
  submitterName: string;
  status: string;
  createdAt: Date;
  resolvedAt: Date | null;
  contentTitle: string;
}

export interface ApprovalDecisionRecord {
  id: string;
  requestId: string;
  approverId: string;
  approverName: string;
  decision: string;
  comment: string | null;
  createdAt: Date;
}

// ── submitDecision ───────────────────────────────────────────────────────────

/**
 * Submit an approval decision (approve/reject) for a pending request.
 * Uses a transaction with row-level locking to prevent race conditions.
 *
 * Sequential chain logic:
 * - On rejection at any step: terminate immediately (cascading rejection)
 * - On approval at intermediate step (currentStep < totalSteps): advance step
 * - On approval at final step (currentStep >= totalSteps): commit pending draft
 */
export async function submitDecision(
  db: Database,
  approvalRequestId: string,
  approverId: string,
  decision: ApprovalDecisionValue,
  comment?: string
): Promise<ApprovalRequest> {
  return await db.transaction(async (tx) => {
    // Row-level lock: SELECT ... FOR UPDATE to prevent concurrent decisions
    const [request] = await tx
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, approvalRequestId))
      .for("update")
      .limit(1);

    if (!request) {
      throw new Error("Approval request not found");
    }

    if (request.status !== "pending") {
      throw new Error("This approval request has already been resolved");
    }

    // Get total chain length (number of approvers configured for this module)
    const configRow = await tx
      .select()
      .from(approvalConfig)
      .where(eq(approvalConfig.contentModule, request.contentModule))
      .limit(1);

    const config = configRow[0];
    if (!config) {
      throw new Error("Approval config not found for module");
    }

    const [{ count: totalSteps }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(approvalConfigApprovers)
      .where(eq(approvalConfigApprovers.configId, config.id));

    // Insert decision with chainStep recording the current step
    await tx.insert(approvalDecisions).values({
      requestId: approvalRequestId,
      approverId,
      decision,
      comment: comment ?? null,
      chainStep: request.currentStep,
    });

    // ── Rejection: cascading termination ──
    if (decision === "rejected") {
      const now = new Date();
      await tx
        .update(approvalRequests)
        .set({ status: "rejected", resolvedAt: now, pendingData: null })
        .where(eq(approvalRequests.id, approvalRequestId));

      // Revert content to draft
      await updateContentStatus(tx, request.contentId, request.contentModule, "draft");

      // Log audit
      await logAudit(tx as unknown as Database, {
        userId: approverId,
        action: "approval_decide",
        entityType: "approval_request",
        entityId: approvalRequestId,
        summary: `Rejected ${request.contentModule} content ${request.contentId} at step ${request.currentStep}`,
      });

      // Notify submitter
      await safeNotifySubmitter(tx as unknown as Database, request, "rejected");

      return { ...request, status: "rejected", resolvedAt: now };
    }

    // ── Approval: sequential step advancement ──

    if (request.currentStep >= totalSteps) {
      // Final step — commit pending draft
      const now = new Date();

      // Commit-on-approval: copy pendingData → pages.data for pages module
      if (request.contentModule === "pages" && request.pendingData != null) {
        // Fetch the current page to get previous data for revision
        const [currentPage] = await tx
          .select()
          .from(pages)
          .where(eq(pages.id, request.contentId))
          .limit(1);

        if (currentPage) {
          // Create a revision record with the previous pages.data
          const [lastRevision] = await tx
            .select({ revisionNumber: revisions.revisionNumber })
            .from(revisions)
            .where(eq(revisions.pageId, request.contentId))
            .orderBy(sql`${revisions.revisionNumber} DESC`)
            .limit(1);

          const nextRevisionNumber = (lastRevision?.revisionNumber ?? 0) + 1;

          await tx.insert(revisions).values({
            pageId: request.contentId,
            userId: approverId,
            data: currentPage.data,
            titleSnapshot: currentPage.title,
            slugSnapshot: currentPage.slug,
            action: "save",
            revisionNumber: nextRevisionNumber,
          });

          // Copy pendingData → pages.data, set status to published with publishedAt
          await tx
            .update(pages)
            .set({
              data: request.pendingData,
              status: "published",
              publishedAt: now,
              updatedAt: now,
            })
            .where(eq(pages.id, request.contentId));
        }
      } else {
        // Non-pages module or no pendingData: use existing behavior
        await updateContentStatus(tx, request.contentId, request.contentModule, "published");
      }

      // Clear pendingData and set request status to approved
      await tx
        .update(approvalRequests)
        .set({
          status: "approved",
          resolvedAt: now,
          pendingData: null,
          currentStep: request.currentStep,
        })
        .where(eq(approvalRequests.id, approvalRequestId));

      // Log audit
      await logAudit(tx as unknown as Database, {
        userId: approverId,
        action: "approval_decide",
        entityType: "approval_request",
        entityId: approvalRequestId,
        summary: `Approved ${request.contentModule} content ${request.contentId} at final step ${request.currentStep}/${totalSteps}`,
      });

      // Notify submitter
      await safeNotifySubmitter(tx as unknown as Database, request, "approved");

      return { ...request, status: "approved", resolvedAt: now };
    } else {
      // Intermediate step — advance to next step
      const nextStep = request.currentStep + 1;

      await tx
        .update(approvalRequests)
        .set({ currentStep: nextStep })
        .where(eq(approvalRequests.id, approvalRequestId));

      // Log audit
      await logAudit(tx as unknown as Database, {
        userId: approverId,
        action: "approval_decide",
        entityType: "approval_request",
        entityId: approvalRequestId,
        summary: `Approved ${request.contentModule} content ${request.contentId} at step ${request.currentStep}/${totalSteps}, advancing to step ${nextStep}`,
      });

      return { ...request, currentStep: nextStep };
    }
  });
}

// ── getPendingForApprover ────────────────────────────────────────────────────

/**
 * Get all pending approval requests for a given approver.
 * Joins with content tables and users to return title, module, submitter name, date.
 *
 * For the "pages" module, all employees can see pending requests (relaxed authorization).
 * For other modules, only assigned approvers see pending requests.
 */
export async function getPendingForApprover(
  db: Database,
  approverId: string
): Promise<ApprovalRequestWithDetails[]> {
  // Find which modules this approver is assigned to
  const approverConfigs = await db
    .select({
      configId: approvalConfigApprovers.configId,
      contentModule: approvalConfig.contentModule,
    })
    .from(approvalConfigApprovers)
    .innerJoin(approvalConfig, eq(approvalConfigApprovers.configId, approvalConfig.id))
    .where(eq(approvalConfigApprovers.userId, approverId));

  const moduleNames = approverConfigs.map((c) => c.contentModule);

  // Check if user is an employee (for relaxed pages authorization)
  const [user] = await db
    .select({ userType: users.userType })
    .from(users)
    .where(eq(users.id, approverId))
    .limit(1);

  const isEmployee = user?.userType === "employee";

  // If not an assigned approver for any module AND not an employee, return empty
  if (approverConfigs.length === 0 && !isEmployee) {
    return [];
  }

  // Fetch all pending requests
  const pendingRequests = await db
    .select({
      id: approvalRequests.id,
      contentId: approvalRequests.contentId,
      contentModule: approvalRequests.contentModule,
      submitterId: approvalRequests.submitterId,
      status: approvalRequests.status,
      createdAt: approvalRequests.createdAt,
      resolvedAt: approvalRequests.resolvedAt,
      submitterName: users.name,
    })
    .from(approvalRequests)
    .innerJoin(users, eq(approvalRequests.submitterId, users.id))
    .where(eq(approvalRequests.status, "pending"));

  // Filter: show pages to any employee, other modules only to assigned approvers
  const filtered = pendingRequests.filter((r) => {
    if (r.contentModule === "pages" && isEmployee) return true;
    return moduleNames.includes(r.contentModule as ContentModule);
  });

  // Enrich with content titles
  const results: ApprovalRequestWithDetails[] = [];
  for (const req of filtered) {
    const title = await getContentTitle(db, req.contentId, req.contentModule as ContentModule);
    results.push({
      ...req,
      contentTitle: title,
    });
  }

  return results;
}

// ── getApprovalProgress ──────────────────────────────────────────────────────

export interface ChainApprover {
  userId: string;
  userName: string;
  position: number;
}

export interface ChainDecisionRecord {
  id: string;
  requestId: string;
  approverId: string;
  approverName: string;
  decision: string;
  comment: string | null;
  chainStep: number | null;
  createdAt: Date;
}

export interface ApprovalProgressResult {
  currentStep: number;
  totalSteps: number;
  chain: ChainApprover[];
  decisions: ChainDecisionRecord[];
  status: string;
}

/**
 * Get approval progress for a specific content item.
 * Returns chain-aware data including currentStep, totalSteps, ordered chain,
 * and decisions with chainStep for rendering a flowchart/stepper UI.
 */
export async function getApprovalProgress(
  db: Database,
  contentId: string,
  contentModule: ContentModule
): Promise<ApprovalProgressResult> {
  // Find the latest pending or resolved request for this content
  const [request] = await db
    .select()
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.contentId, contentId),
        eq(approvalRequests.contentModule, contentModule)
      )
    )
    .orderBy(sql`${approvalRequests.createdAt} desc`)
    .limit(1);

  if (!request) {
    return { currentStep: 0, totalSteps: 0, chain: [], decisions: [], status: "none" };
  }

  // Get ordered approvers with positions from approvalConfigApprovers joined with users
  const chainApprovers = await db
    .select({
      userId: approvalConfigApprovers.userId,
      position: approvalConfigApprovers.position,
      userName: users.name,
    })
    .from(approvalConfigApprovers)
    .innerJoin(approvalConfig, eq(approvalConfigApprovers.configId, approvalConfig.id))
    .innerJoin(users, eq(approvalConfigApprovers.userId, users.id))
    .where(eq(approvalConfig.contentModule, contentModule))
    .orderBy(approvalConfigApprovers.position);

  // Get all decisions for this request with approver names and chainStep
  const decisions = await db
    .select({
      id: approvalDecisions.id,
      requestId: approvalDecisions.requestId,
      approverId: approvalDecisions.approverId,
      approverName: users.name,
      decision: approvalDecisions.decision,
      comment: approvalDecisions.comment,
      chainStep: approvalDecisions.chainStep,
      createdAt: approvalDecisions.createdAt,
    })
    .from(approvalDecisions)
    .innerJoin(users, eq(approvalDecisions.approverId, users.id))
    .where(eq(approvalDecisions.requestId, request.id));

  return {
    currentStep: request.currentStep,
    totalSteps: chainApprovers.length,
    chain: chainApprovers,
    decisions,
    status: request.status,
  };
}

// ── autoResolvePendingRequests ───────────────────────────────────────────────

/**
 * When approval is disabled for a module, revert all pending requests:
 * set request status to "rejected", content status to "draft".
 * Returns the number of requests resolved.
 */
export async function autoResolvePendingRequests(
  db: Database,
  contentModule: ContentModule
): Promise<number> {
  // Find all pending requests for this module
  const pendingReqs = await db
    .select()
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.contentModule, contentModule),
        eq(approvalRequests.status, "pending")
      )
    );

  if (pendingReqs.length === 0) {
    return 0;
  }

  const now = new Date();

  for (const req of pendingReqs) {
    // Set request status to rejected
    await db
      .update(approvalRequests)
      .set({ status: "rejected", resolvedAt: now })
      .where(eq(approvalRequests.id, req.id));

    // Revert content to draft
    await updateContentStatus(db, req.contentId, contentModule, "draft");

    // Log audit
    await logAudit(db, {
      userId: req.submitterId,
      action: "approval_auto_resolve",
      entityType: "approval_request",
      entityId: req.id,
      summary: `Auto-resolved ${contentModule} content ${req.contentId} (approval disabled)`,
    });
  }

  return pendingReqs.length;
}

// ── Pending Draft Helpers ─────────────────────────────────────────────────────

/**
 * Get the active (pending) approval request for a given content item.
 * Returns the first pending request for the contentId + contentModule, or undefined.
 */
export async function getActiveApprovalRequest(
  db: Database,
  contentId: string,
  contentModule: ContentModule
) {
  const [request] = await db
    .select()
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.contentId, contentId),
        eq(approvalRequests.contentModule, contentModule),
        eq(approvalRequests.status, "pending")
      )
    )
    .limit(1);

  return request ?? null;
}

/**
 * Update the pendingData on an existing approval request.
 */
export async function updatePendingData(
  db: Database,
  requestId: string,
  data: unknown
): Promise<void> {
  await db
    .update(approvalRequests)
    .set({ pendingData: data })
    .where(eq(approvalRequests.id, requestId));
}

/**
 * Delete all existing approval decisions for a request (for re-review after re-edit).
 * Also resets currentStep to 1 so the chain restarts from the beginning.
 */
export async function resetDecisions(
  db: Database,
  requestId: string
): Promise<void> {
  await db
    .delete(approvalDecisions)
    .where(eq(approvalDecisions.requestId, requestId));
  await db
    .update(approvalRequests)
    .set({ currentStep: 1 })
    .where(eq(approvalRequests.id, requestId));
}

/**
 * Create a new approval request with pendingData populated.
 * Returns the newly created approval request.
 */
export async function createApprovalRequestWithDraft(
  db: Database,
  contentId: string,
  contentModule: ContentModule,
  submitterId: string,
  data: unknown
) {
  const [request] = await db
    .insert(approvalRequests)
    .values({
      contentId,
      contentModule,
      submitterId,
      status: "pending",
      pendingData: data,
      currentStep: 1,
    })
    .returning();

  return request;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Update content status in the appropriate table based on module.
 */
async function updateContentStatus(
  db: Database | Parameters<Parameters<Database["transaction"]>[0]>[0],
  contentId: string,
  contentModule: string,
  status: string
): Promise<void> {
  if (contentModule === "pages") {
    await (db as Database)
      .update(pages)
      .set({ status: status as "draft" | "published" | "pending_review", updatedAt: new Date() })
      .where(eq(pages.id, contentId));
  } else {
    // blog, news, construction_updates all use the posts table
    await (db as Database)
      .update(posts)
      .set({ status: status as "draft" | "published" | "trashed" | "pending_review", updatedAt: new Date() })
      .where(eq(posts.id, contentId));
  }
}

/**
 * Get content title from the appropriate table.
 */
async function getContentTitle(
  db: Database,
  contentId: string,
  contentModule: ContentModule
): Promise<string> {
  if (contentModule === "pages") {
    const [page] = await db
      .select({ title: pages.title })
      .from(pages)
      .where(eq(pages.id, contentId))
      .limit(1);
    return page?.title ?? "Untitled";
  } else {
    const [post] = await db
      .select({ title: posts.title })
      .from(posts)
      .where(eq(posts.id, contentId))
      .limit(1);
    return post?.title ?? "Untitled";
  }
}

/**
 * Safely notify submitter — failures are caught and don't block the workflow.
 */
async function safeNotifySubmitter(
  db: Database,
  request: { id: string; contentId: string; contentModule: string; submitterId: string },
  outcome: "approved" | "rejected"
): Promise<void> {
  try {
    const [submitter] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, request.submitterId))
      .limit(1);

    if (!submitter) return;

    const contentTitle = await getContentTitle(
      db,
      request.contentId,
      request.contentModule as ContentModule
    );

    await notifySubmitter(db, request as ApprovalRequest, submitter.email, outcome, contentTitle);
  } catch {
    // Notification failures must not block the approval workflow
  }
}
