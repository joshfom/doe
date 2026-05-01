import type { Database } from "../db";
import type { Ticket } from "./service";
import { sendEmail } from "../approval/notifications";
import { logAudit } from "../audit";

/**
 * Send a confirmation email to the contact when a ticket is created.
 * Contains the ticket number, subject, and a receipt confirmation message.
 *
 * Failures are caught, logged to audit_log with entity_type "notification",
 * and never block the ticket operation.
 */
export async function sendTicketCreatedEmail(
  db: Database,
  ticket: Ticket
): Promise<void> {
  const subject = `[Ora] Ticket ${ticket.ticketNumber} — We received your request`;
  const html = [
    `<h2>We received your support request</h2>`,
    `<p>Thank you for reaching out, <strong>${ticket.contactName}</strong>.</p>`,
    `<table>`,
    `<tr><td><strong>Ticket Number:</strong></td><td>${ticket.ticketNumber}</td></tr>`,
    `<tr><td><strong>Subject:</strong></td><td>${ticket.subject}</td></tr>`,
    `</table>`,
    `<p>Our team will review your request and get back to you shortly.</p>`,
  ].join("\n");

  try {
    await sendEmail({ to: ticket.contactEmail, subject, html });
  } catch (error) {
    try {
      await logAudit(db, {
        userId: ticket.createdBy ?? "system",
        action: "ticket_create",
        entityType: "notification",
        entityId: ticket.id,
        summary: `Failed to send ticket created email to ${ticket.contactEmail} for ticket ${ticket.ticketNumber}: ${error instanceof Error ? error.message : String(error)}`,
      });
    } catch {
      // If audit logging itself fails, swallow silently
    }
  }
}

/**
 * Send a notification email to the assignee when a ticket is assigned to them.
 * Contains the ticket number and subject.
 *
 * Failures are caught, logged to audit_log with entity_type "notification",
 * and never block the ticket operation.
 */
export async function sendTicketAssignedEmail(
  db: Database,
  ticket: Ticket,
  assigneeEmail: string
): Promise<void> {
  const subject = `[Ora] Ticket ${ticket.ticketNumber} assigned to you`;
  const html = [
    `<h2>New Ticket Assignment</h2>`,
    `<p>You have been assigned a support ticket.</p>`,
    `<table>`,
    `<tr><td><strong>Ticket Number:</strong></td><td>${ticket.ticketNumber}</td></tr>`,
    `<tr><td><strong>Subject:</strong></td><td>${ticket.subject}</td></tr>`,
    `<tr><td><strong>Contact:</strong></td><td>${ticket.contactName} (${ticket.contactEmail})</td></tr>`,
    `<tr><td><strong>Priority:</strong></td><td>${ticket.priority}</td></tr>`,
    `</table>`,
    `<p><a href="/ora-panel/tickets/${ticket.id}">View ticket</a></p>`,
  ].join("\n");

  try {
    await sendEmail({ to: assigneeEmail, subject, html });
  } catch (error) {
    try {
      await logAudit(db, {
        userId: ticket.createdBy ?? "system",
        action: "ticket_assign",
        entityType: "notification",
        entityId: ticket.id,
        summary: `Failed to send ticket assigned email to ${assigneeEmail} for ticket ${ticket.ticketNumber}: ${error instanceof Error ? error.message : String(error)}`,
      });
    } catch {
      // If audit logging itself fails, swallow silently
    }
  }
}

/**
 * Send a notification email to the contact when a ticket is resolved.
 * Contains the ticket number.
 *
 * Failures are caught, logged to audit_log with entity_type "notification",
 * and never block the ticket operation.
 */
export async function sendTicketResolvedEmail(
  db: Database,
  ticket: Ticket
): Promise<void> {
  const subject = `[Ora] Ticket ${ticket.ticketNumber} — Your request has been resolved`;
  const html = [
    `<h2>Your support request has been resolved</h2>`,
    `<p>Hi <strong>${ticket.contactName}</strong>,</p>`,
    `<p>We're writing to let you know that your support ticket has been resolved.</p>`,
    `<table>`,
    `<tr><td><strong>Ticket Number:</strong></td><td>${ticket.ticketNumber}</td></tr>`,
    `<tr><td><strong>Subject:</strong></td><td>${ticket.subject}</td></tr>`,
    `</table>`,
    `<p>If you have any further questions, feel free to reach out.</p>`,
  ].join("\n");

  try {
    await sendEmail({ to: ticket.contactEmail, subject, html });
  } catch (error) {
    try {
      await logAudit(db, {
        userId: ticket.createdBy ?? "system",
        action: "ticket_status_change",
        entityType: "notification",
        entityId: ticket.id,
        summary: `Failed to send ticket resolved email to ${ticket.contactEmail} for ticket ${ticket.ticketNumber}: ${error instanceof Error ? error.message : String(error)}`,
      });
    } catch {
      // If audit logging itself fails, swallow silently
    }
  }
}

/**
 * Send a notification email to the contact when a ticket is closed.
 * Contains the ticket number.
 *
 * Failures are caught, logged to audit_log with entity_type "notification",
 * and never block the ticket operation.
 */
export async function sendTicketClosedEmail(
  db: Database,
  ticket: Ticket
): Promise<void> {
  const subject = `[Ora] Ticket ${ticket.ticketNumber} — Your request has been closed`;
  const html = [
    `<h2>Your support ticket has been closed</h2>`,
    `<p>Hi <strong>${ticket.contactName}</strong>,</p>`,
    `<p>Your support ticket has been closed.</p>`,
    `<table>`,
    `<tr><td><strong>Ticket Number:</strong></td><td>${ticket.ticketNumber}</td></tr>`,
    `<tr><td><strong>Subject:</strong></td><td>${ticket.subject}</td></tr>`,
    `</table>`,
    `<p>If you need further assistance, please don't hesitate to open a new ticket.</p>`,
  ].join("\n");

  try {
    await sendEmail({ to: ticket.contactEmail, subject, html });
  } catch (error) {
    try {
      await logAudit(db, {
        userId: ticket.createdBy ?? "system",
        action: "ticket_status_change",
        entityType: "notification",
        entityId: ticket.id,
        summary: `Failed to send ticket closed email to ${ticket.contactEmail} for ticket ${ticket.ticketNumber}: ${error instanceof Error ? error.message : String(error)}`,
      });
    } catch {
      // If audit logging itself fails, swallow silently
    }
  }
}
