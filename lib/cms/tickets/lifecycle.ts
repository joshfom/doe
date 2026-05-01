import { eq } from "drizzle-orm";
import type { Database } from "../db";
import type { TicketStatus } from "../types";
import { tickets } from "../schema";
import { logAudit } from "../audit";
import { syncTicketToCrm } from "./crm/sync";

/**
 * Valid status transitions as a lookup table.
 *
 * open       → assigned, in_progress
 * assigned   → in_progress
 * in_progress → resolved
 * resolved   → closed, in_progress (reopen)
 * closed     → (terminal state, no transitions)
 */
export const VALID_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ["assigned", "in_progress"],
  assigned: ["in_progress"],
  in_progress: ["resolved"],
  resolved: ["closed", "in_progress"],
  closed: [],
};

/**
 * Pure function — returns true if the transition from `from` to `to` is allowed.
 */
export function isValidTransition(
  from: TicketStatus,
  to: TicketStatus
): boolean {
  const allowed = VALID_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

/**
 * Pure function — determines the update fields (side effects) that should be
 * applied for a given status transition.
 *
 * Returns an object describing which fields to set:
 * - `assigneeId`: the assignee UUID (when transitioning to "assigned")
 * - `resolvedAt`: a Date (when resolving) or `null` (when reopening)
 * - `closedAt`: a Date (when closing)
 *
 * Throws if transitioning to "assigned" without an assigneeId.
 */
export function getTransitionSideEffects(
  from: TicketStatus,
  to: TicketStatus,
  assigneeId?: string
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    status: to,
  };

  if (to === "assigned") {
    if (!assigneeId) {
      throw new Error("Assignee is required for status 'assigned'");
    }
    fields.assigneeId = assigneeId;
  }

  if (to === "resolved") {
    fields.resolvedAt = new Date();
  }

  if (to === "closed") {
    fields.closedAt = new Date();
  }

  // Reopen: resolved → in_progress clears resolved_at
  if (from === "resolved" && to === "in_progress") {
    fields.resolvedAt = null;
  }

  return fields;
}

/**
 * Transition a ticket's status within a transaction.
 * Validates the transition, applies side effects (timestamps, assignee),
 * writes audit log, and returns the updated ticket.
 *
 * Side effects:
 * - "assigned"  → assignee_id must be non-null
 * - "resolved"  → set resolved_at timestamp
 * - "closed"    → set closed_at timestamp
 * - "resolved" → "in_progress" (reopen) → clear resolved_at
 */
export async function transitionTicketStatus(
  db: Database,
  ticketId: string,
  newStatus: TicketStatus,
  actorId: string,
  assigneeId?: string
) {
  return await db.transaction(async (tx) => {
    // 1. Fetch the current ticket
    const [ticket] = await tx
      .select()
      .from(tickets)
      .where(eq(tickets.id, ticketId));

    if (!ticket) {
      throw new Error("Ticket not found");
    }

    const currentStatus = ticket.status as TicketStatus;

    // 2. Validate the transition
    if (!isValidTransition(currentStatus, newStatus)) {
      throw new Error(
        `Invalid status transition from ${currentStatus} to ${newStatus}`
      );
    }

    // 3. Apply side effects (delegated to pure helper)
    const sideEffects = getTransitionSideEffects(
      currentStatus,
      newStatus,
      assigneeId
    );
    const updateFields: Record<string, unknown> = {
      ...sideEffects,
      updatedAt: new Date(),
    };

    // 4. Update the ticket
    const [updatedTicket] = await tx
      .update(tickets)
      .set(updateFields)
      .where(eq(tickets.id, ticketId))
      .returning();

    // 5. Write audit log entry
    await logAudit(tx as unknown as Database, {
      userId: actorId,
      action: "ticket_status_change",
      entityType: "ticket_status_change",
      entityId: ticketId,
      summary: `Ticket status changed from ${currentStatus} to ${newStatus}`,
      changes: {
        status: { old: currentStatus, new: newStatus },
      },
    });

    // TODO: Trigger notifications (task 7.1)
    // e.g. sendTicketResolvedEmail, sendTicketClosedEmail, sendTicketAssignedEmail

    // Sync status change to CRM (fire-and-forget — never blocks transition)
    syncTicketToCrm(
      tx as unknown as Database,
      ticketId,
      "update_case",
      {
        ticketNumber: updatedTicket.ticketNumber,
        subject: updatedTicket.subject,
        description: updatedTicket.description,
        contactName: updatedTicket.contactName,
        contactEmail: updatedTicket.contactEmail,
        contactPhone: updatedTicket.contactPhone ?? undefined,
        priority: updatedTicket.priority,
        category: updatedTicket.category ?? undefined,
        status: newStatus,
      },
      updatedTicket.externalCrmId
    ).catch(() => {
      // Swallow — syncTicketToCrm already handles errors internally
    });

    return updatedTicket;
  });
}
