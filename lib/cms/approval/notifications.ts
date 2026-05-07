import nodemailer from "nodemailer";
import { eq, and, sql } from "drizzle-orm";
import type { Database } from "../db";
import type { ContentModule } from "../types";
import { logAudit } from "../audit";
import {
  approvalConfig,
  approvalConfigApprovers,
  users,
  pages,
  posts,
} from "../schema";

interface ApprovalRequest {
  id: string;
  contentId: string;
  contentModule: string;
  submitterId: string;
  status: string;
}

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

/**
 * Read SMTP configuration from environment variables.
 * Returns null if any required variable is missing.
 */
function getSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM;

  if (!host || !port || !user || !pass || !from) {
    return null;
  }

  return { host, port: parseInt(port, 10), user, pass, from };
}

/**
 * Send an email via SMTP.
 * If SMTP is not configured, logs a warning and skips silently.
 */
export async function sendEmail(payload: EmailPayload): Promise<void> {
  const config = getSmtpConfig();
  if (!config) {
    console.warn("[notifications] SMTP not configured — skipping email send");
    return;
  }

  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    auth: { user: config.user, pass: config.pass },
  });

  await transport.sendMail({
    from: config.from,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
  });
}

/**
 * Notify all approvers about a new approval request.
 * Sends an email to each approver. Failures are caught and logged to audit
 * with entity type `notification` — they never block the approval workflow.
 */
export async function notifyApprovers(
  db: Database,
  approvalRequest: ApprovalRequest,
  approvers: { email: string; name: string }[],
  submitterName: string,
  contentTitle: string,
  contentModule: ContentModule
): Promise<void> {
  const reviewLink = "/ora-panel/reviews";

  for (const approver of approvers) {
    const subject = `[Ora CMS] New ${contentModule} content awaiting your review`;
    const html = [
      `<h2>Content Review Request</h2>`,
      `<p><strong>${approver.name}</strong>, a new item needs your review.</p>`,
      `<table>`,
      `<tr><td><strong>Content Title:</strong></td><td>${contentTitle}</td></tr>`,
      `<tr><td><strong>Module:</strong></td><td>${contentModule}</td></tr>`,
      `<tr><td><strong>Submitted by:</strong></td><td>${submitterName}</td></tr>`,
      `<tr><td><strong>Request ID:</strong></td><td>${approvalRequest.id}</td></tr>`,
      `</table>`,
      `<p><a href="${reviewLink}">Review now</a></p>`,
    ].join("\n");

    try {
      await sendEmail({ to: approver.email, subject, html });
    } catch (error) {
      // Log failure to audit with entity type "notification"
      try {
        await logAudit(db, {
          userId: approvalRequest.submitterId,
          action: "approval_submit",
          entityType: "notification",
          entityId: approvalRequest.id,
          summary: `Failed to send notification email to ${approver.email} for approval request ${approvalRequest.id}: ${error instanceof Error ? error.message : String(error)}`,
        });
      } catch {
        // If audit logging itself fails, swallow silently
      }
    }
  }
}

/**
 * Notify the submitter about the outcome of their approval request.
 * Failures are caught and logged to audit with entity type `notification`.
 */
export async function notifySubmitter(
  db: Database,
  approvalRequest: ApprovalRequest,
  submitterEmail: string,
  outcome: "approved" | "rejected",
  contentTitle: string
): Promise<void> {
  const statusLabel = outcome === "approved" ? "Approved" : "Rejected";
  const subject = `[Ora CMS] Your content "${contentTitle}" has been ${statusLabel.toLowerCase()}`;
  const html = [
    `<h2>Content Review ${statusLabel}</h2>`,
    `<p>Your content <strong>${contentTitle}</strong> has been <strong>${statusLabel.toLowerCase()}</strong>.</p>`,
    `<table>`,
    `<tr><td><strong>Content Title:</strong></td><td>${contentTitle}</td></tr>`,
    `<tr><td><strong>Outcome:</strong></td><td>${statusLabel}</td></tr>`,
    `<tr><td><strong>Request ID:</strong></td><td>${approvalRequest.id}</td></tr>`,
    `</table>`,
  ].join("\n");

  try {
    await sendEmail({ to: submitterEmail, subject, html });
  } catch (error) {
    try {
      await logAudit(db, {
        userId: approvalRequest.submitterId,
        action: "approval_decide",
        entityType: "notification",
        entityId: approvalRequest.id,
        summary: `Failed to send outcome notification to ${submitterEmail} for approval request ${approvalRequest.id}: ${error instanceof Error ? error.message : String(error)}`,
      });
    } catch {
      // If audit logging itself fails, swallow silently
    }
  }
}

/**
 * Notify the approver at a specific chain position that content is awaiting their review.
 *
 * Looks up the approver at the given position for the content module, retrieves
 * the content title and submitter name, then sends a notification email with
 * step context ("Step X of Y").
 *
 * Failures are caught and logged to audit — they never block the approval workflow.
 */
export async function notifyApproverAtStep(
  db: Database,
  contentModule: ContentModule,
  step: number,
  request: ApprovalRequest
): Promise<void> {
  try {
    // Find the approval config for this content module
    const [config] = await db
      .select({ id: approvalConfig.id })
      .from(approvalConfig)
      .where(eq(approvalConfig.contentModule, contentModule))
      .limit(1);

    if (!config) return;

    // Look up the approver at the given chain position
    const [approver] = await db
      .select({
        userId: approvalConfigApprovers.userId,
        name: users.name,
        email: users.email,
      })
      .from(approvalConfigApprovers)
      .innerJoin(users, eq(approvalConfigApprovers.userId, users.id))
      .where(
        and(
          eq(approvalConfigApprovers.configId, config.id),
          eq(approvalConfigApprovers.position, step)
        )
      )
      .limit(1);

    if (!approver) return;

    // Get total chain length
    const [{ count: totalSteps }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(approvalConfigApprovers)
      .where(eq(approvalConfigApprovers.configId, config.id));

    // Get content title
    let contentTitle = "Untitled";
    if (contentModule === "pages") {
      const [page] = await db
        .select({ title: pages.title })
        .from(pages)
        .where(eq(pages.id, request.contentId))
        .limit(1);
      if (page) contentTitle = page.title;
    } else {
      const [post] = await db
        .select({ title: posts.title })
        .from(posts)
        .where(eq(posts.id, request.contentId))
        .limit(1);
      if (post) contentTitle = post.title;
    }

    // Get submitter name
    const [submitter] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, request.submitterId))
      .limit(1);
    const submitterName = submitter?.name ?? "Unknown";

    // Build and send the notification email
    const subject = `[Ora CMS] Step ${step} of ${totalSteps} — Content awaiting your review`;
    const reviewLink = "/ora-panel/reviews";
    const html = [
      `<h2>Content Review Request</h2>`,
      `<p><strong>${approver.name}</strong>, content is awaiting your review at step ${step} of ${totalSteps}.</p>`,
      `<table>`,
      `<tr><td><strong>Content Title:</strong></td><td>${contentTitle}</td></tr>`,
      `<tr><td><strong>Module:</strong></td><td>${contentModule}</td></tr>`,
      `<tr><td><strong>Submitted by:</strong></td><td>${submitterName}</td></tr>`,
      `<tr><td><strong>Step:</strong></td><td>Step ${step} of ${totalSteps}</td></tr>`,
      `<tr><td><strong>Request ID:</strong></td><td>${request.id}</td></tr>`,
      `</table>`,
      `<p><a href="${reviewLink}">Review now</a></p>`,
    ].join("\n");

    await sendEmail({ to: approver.email, subject, html });
  } catch (error) {
    // Log failure to audit — notification failures must not block the approval workflow
    try {
      await logAudit(db, {
        userId: request.submitterId,
        action: "approval_submit",
        entityType: "notification",
        entityId: request.id,
        summary: `Failed to send step notification to approver at step ${step} for approval request ${request.id}: ${error instanceof Error ? error.message : String(error)}`,
      });
    } catch {
      // If audit logging itself fails, swallow silently
    }
  }
}
