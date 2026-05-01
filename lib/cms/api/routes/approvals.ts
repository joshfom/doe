import { Elysia } from "elysia";
import { eq, and, sql } from "drizzle-orm";
import { authGuard } from "../auth";
import {
  approvalRequests,
  approvalDecisions,
  approvalConfig,
  approvalConfigApprovers,
  users,
} from "../../schema";
import { db } from "../../db";
import {
  getPendingForApprover,
  submitDecision,
  getApprovalProgress,
} from "../../approval/service";
import type { ContentModule, ApprovalDecisionValue } from "../../types";

const VALID_MODULES: ContentModule[] = [
  "pages",
  "blog",
  "news",
  "construction_updates",
];

// ── Authenticated routes ─────────────────────────────────────────────────────

export const approvalRoutes = new Elysia({ name: "approvals" })
  .use(authGuard)

  // GET /approvals/pending — list pending requests for current user
  .get("/approvals/pending", async ({ userId }) => {
    const pending = await getPendingForApprover(db, userId);
    return { data: pending };
  })

  // GET /approvals/content/:module/:contentId — get approval status for a content item
  .get("/approvals/content/:module/:contentId", async ({ params, set }) => {
    const { module: moduleName, contentId } = params;

    if (!VALID_MODULES.includes(moduleName as ContentModule)) {
      set.status = 400;
      return { error: `Invalid module: ${moduleName}` };
    }

    const progress = await getApprovalProgress(
      db,
      contentId,
      moduleName as ContentModule
    );

    // Also fetch the latest request for status info
    const [request] = await db
      .select()
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.contentId, contentId),
          eq(approvalRequests.contentModule, moduleName as ContentModule)
        )
      )
      .orderBy(sql`${approvalRequests.createdAt} desc`)
      .limit(1);

    return {
      data: {
        request: request ?? null,
        ...progress,
      },
    };
  })

  // GET /approvals/:id — get single request with all decisions
  .get("/approvals/:id", async ({ params, set }) => {
    const { id } = params;

    const [request] = await db
      .select({
        id: approvalRequests.id,
        contentId: approvalRequests.contentId,
        contentModule: approvalRequests.contentModule,
        submitterId: approvalRequests.submitterId,
        submitterName: users.name,
        status: approvalRequests.status,
        createdAt: approvalRequests.createdAt,
        resolvedAt: approvalRequests.resolvedAt,
      })
      .from(approvalRequests)
      .innerJoin(users, eq(approvalRequests.submitterId, users.id))
      .where(eq(approvalRequests.id, id))
      .limit(1);

    if (!request) {
      set.status = 404;
      return { error: "Approval request not found" };
    }

    // Fetch all decisions for this request
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
      .where(eq(approvalDecisions.requestId, id));

    return { data: { ...request, decisions } };
  })

  // POST /approvals/:id/decide — submit approve/reject decision
  .post("/approvals/:id/decide", async ({ params, body, userId, set }) => {
    const { id } = params;
    const { decision, comment } = body as {
      decision: ApprovalDecisionValue;
      comment?: string;
    };

    // Validate decision value
    if (!decision || !["approved", "rejected"].includes(decision)) {
      set.status = 400;
      return { error: "Decision must be 'approved' or 'rejected'" };
    }

    // Fetch the request
    const [request] = await db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, id))
      .limit(1);

    if (!request) {
      set.status = 404;
      return { error: "Approval request not found" };
    }

    // Check if already resolved
    if (request.status !== "pending") {
      set.status = 409;
      return { error: "This approval request has already been resolved" };
    }

    // Verify user is an assigned approver for this module
    const approverConfig = await db
      .select({ configId: approvalConfig.id })
      .from(approvalConfig)
      .where(eq(approvalConfig.contentModule, request.contentModule))
      .limit(1);

    if (approverConfig.length === 0) {
      set.status = 403;
      return { error: "No approval configuration found for this module" };
    }

    const [isApprover] = await db
      .select({ id: approvalConfigApprovers.id })
      .from(approvalConfigApprovers)
      .where(
        and(
          eq(approvalConfigApprovers.configId, approverConfig[0].configId),
          eq(approvalConfigApprovers.userId, userId)
        )
      )
      .limit(1);

    if (!isApprover) {
      set.status = 403;
      return { error: "You are not an assigned approver for this module" };
    }

    // Submit the decision — catch unique constraint violation for duplicate
    try {
      const updated = await submitDecision(db, id, userId, decision, comment);
      return { data: updated };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : String(err);
      // Unique constraint violation (duplicate decision)
      if (
        message.includes("unique") ||
        message.includes("duplicate") ||
        message.includes("approval_decisions_unique_idx")
      ) {
        set.status = 409;
        return { error: "You have already submitted a decision for this request" };
      }
      throw err;
    }
  });
