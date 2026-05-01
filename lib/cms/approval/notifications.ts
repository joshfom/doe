import nodemailer from "nodemailer";
import type { Database } from "../db";
import type { ContentModule } from "../types";
import { logAudit } from "../audit";

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
