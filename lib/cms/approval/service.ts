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
 * Uses a transaction to prevent race conditions on resolution check.
 */
export async function submitDecision(
  db: Database,
  approvalRequestId: string,
  approverId: string,
  decision: ApprovalDecisionValue,
  comment?: string
): Promise<ApprovalRequest> {
  return await db.transaction(async (tx) => {
    // Insert the decision
    await tx.insert(approvalDecisions).values({
      requestId: approvalRequestId,
      approverId,
      decision,
      comment: comment ?? null,
    });

    // Fetch the request
    const [request] = await tx
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, approvalRequestId))
      .limit(1);

    if (!request) {
      throw new Error("Approval request not found");
    }

    // If rejected → immediately resolve
    if (decision === "rejected") {
      const now = new Date();
      await tx
        .update(approvalRequests)
        .set({ status: "rejected", resolvedAt: now })
        .where(eq(approvalRequests.id, approvalRequestId));

      // Revert content to draft
      await updateContentStatus(tx, request.contentId, request.contentModule, "draft");

      // Log audit
      await logAudit(tx as unknown as Database, {
        userId: approverId,
        action: "approval_decide",
        entityType: "approval_request",
        entityId: approvalRequestId,
        summary: `Rejected ${request.contentModule} content ${request.contentId}`,
      });

      // Notify submitter
      await safeNotifySubmitter(tx as unknown as Database, request, "rejected");

      return { ...request, status: "rejected", resolvedAt: now };
    }

    // Decision is "approved" — check if all approvers have approved
    const configRow = await tx
      .select()
      .from(approvalConfig)
      .where(eq(approvalConfig.contentModule, request.contentModule))
      .limit(1);

    const config = configRow[0];
    if (!config) {
      throw new Error("Approval config not found for module");
    }

    // Count total assigned approvers
    const [{ count: totalApprovers }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(approvalConfigApprovers)
      .where(eq(approvalConfigApprovers.configId, config.id));

    // Count approved decisions for this request
    const [{ count: approvedCount }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(approvalDecisions)
      .where(
        and(
          eq(approvalDecisions.requestId, approvalRequestId),
          eq(approvalDecisions.decision, "approved")
        )
      );

    // Log audit for the decision
    await logAudit(tx as unknown as Database, {
      userId: approverId,
      action: "approval_decide",
      entityType: "approval_request",
      entityId: approvalRequestId,
      summary: `Approved ${request.contentModule} content ${request.contentId} (${approvedCount}/${totalApprovers})`,
    });

    // If all approvers approved → publish
    if (approvedCount >= totalApprovers) {
      const now = new Date();
      await tx
        .update(approvalRequests)
        .set({ status: "approved", resolvedAt: now })
        .where(eq(approvalRequests.id, approvalRequestId));

      await updateContentStatus(tx, request.contentId, request.contentModule, "published");

      // Notify submitter
      await safeNotifySubmitter(tx as unknown as Database, request, "approved");

      return { ...request, status: "approved", resolvedAt: now };
    }

    return request;
  });
}

// ── getPendingForApprover ────────────────────────────────────────────────────

/**
 * Get all pending approval requests for a given approver.
 * Joins with content tables and users to return title, module, submitter name, date.
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

  if (approverConfigs.length === 0) {
    return [];
  }

  const moduleNames = approverConfigs.map((c) => c.contentModule);

  // Fetch all pending requests for those modules
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

  // Filter to only modules this approver is assigned to
  const filtered = pendingRequests.filter((r) =>
    moduleNames.includes(r.contentModule as ContentModule)
  );

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

/**
 * Get approval progress for a specific content item.
 */
export async function getApprovalProgress(
  db: Database,
  contentId: string,
  contentModule: ContentModule
): Promise<{ approved: number; total: number; decisions: ApprovalDecisionRecord[] }> {
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
    return { approved: 0, total: 0, decisions: [] };
  }

  // Get total approvers for this module
  const configRow = await db
    .select()
    .from(approvalConfig)
    .where(eq(approvalConfig.contentModule, contentModule))
    .limit(1);

  const config = configRow[0];
  let total = 0;
  if (config) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(approvalConfigApprovers)
      .where(eq(approvalConfigApprovers.configId, config.id));
    total = count;
  }

  // Get all decisions for this request with approver names
  const decisions = await db
    .select({
      id: approvalDecisions.id,
      requestId: approvalDecisions.requestId,
      approverId: approvalDecisions.approverId,
      approverName: users.name,
      decision: approvalDecisions.decision,
      comment: approvalDecisions.comment,
      createdAt: approvalDecisions.createdAt,
    })
    .from(approvalDecisions)
    .innerJoin(users, eq(approvalDecisions.approverId, users.id))
    .where(eq(approvalDecisions.requestId, request.id));

  const approved = decisions.filter((d) => d.decision === "approved").length;

  return { approved, total, decisions };
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
