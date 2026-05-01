import { eq } from "drizzle-orm";
import type { Database } from "../db";
import type { ContentModule } from "../types";
import {
  approvalConfig,
  approvalConfigApprovers,
  approvalRequests,
  pages,
  posts,
  users,
} from "../schema";
import { logAudit } from "../audit";
import { notifyApprovers } from "./notifications";

export interface GateResult {
  allowed: boolean;
  approvalRequestId?: string;
  reason?: string;
}

/**
 * Publication gate — called by publish endpoints before changing content status.
 *
 * If approval is disabled for the module, returns { allowed: true }.
 * If enabled, creates an approval request, sets content to pending_review,
 * notifies approvers, logs to audit, and returns { allowed: false }.
 */
export async function checkPublicationGate(
  db: Database,
  contentId: string,
  contentModule: ContentModule,
  submitterId: string
): Promise<GateResult> {
  // Look up approval config for this module
  const [config] = await db
    .select()
    .from(approvalConfig)
    .where(eq(approvalConfig.contentModule, contentModule))
    .limit(1);

  // No config row or approval disabled → allow direct publish
  if (!config || !config.enabled) {
    return { allowed: true };
  }

  // Create approval request record
  const [request] = await db
    .insert(approvalRequests)
    .values({
      contentId,
      contentModule,
      submitterId,
      status: "pending",
    })
    .returning();

  // Set content status to pending_review
  if (contentModule === "pages") {
    await db
      .update(pages)
      .set({ status: "pending_review", updatedAt: new Date() })
      .where(eq(pages.id, contentId));
  } else {
    // blog, news, construction_updates all use the posts table
    await db
      .update(posts)
      .set({ status: "pending_review", updatedAt: new Date() })
      .where(eq(posts.id, contentId));
  }

  // Log approval_submit to audit
  await logAudit(db, {
    userId: submitterId,
    action: "approval_submit",
    entityType: "approval_request",
    entityId: request.id,
    summary: `Submitted ${contentModule} content ${contentId} for approval`,
  });

  // Notify approvers (fire-and-forget — failures are logged internally)
  try {
    // Fetch approvers for this config
    const approverRows = await db
      .select({
        email: users.email,
        name: users.name,
      })
      .from(approvalConfigApprovers)
      .innerJoin(users, eq(approvalConfigApprovers.userId, users.id))
      .where(eq(approvalConfigApprovers.configId, config.id));

    // Fetch submitter name
    const [submitter] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, submitterId))
      .limit(1);

    // Fetch content title
    let contentTitle = "Untitled";
    if (contentModule === "pages") {
      const [page] = await db
        .select({ title: pages.title })
        .from(pages)
        .where(eq(pages.id, contentId))
        .limit(1);
      if (page) contentTitle = page.title;
    } else {
      const [post] = await db
        .select({ title: posts.title })
        .from(posts)
        .where(eq(posts.id, contentId))
        .limit(1);
      if (post) contentTitle = post.title;
    }

    await notifyApprovers(
      db,
      request,
      approverRows,
      submitter?.name ?? "Unknown",
      contentTitle,
      contentModule
    );
  } catch {
    // Notification failures must not block the gate
  }

  return {
    allowed: false,
    approvalRequestId: request.id,
    reason: "Content submitted for approval review",
  };
}
