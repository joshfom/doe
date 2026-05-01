import { and, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "../db";
import { ticketApprovals, tickets, users } from "../schema";
import { logAudit } from "../audit";
import { transitionTicketStatus } from "./lifecycle";
import type {
  TicketApprovalScope,
  TicketApprovalStatus,
} from "../types";

export type { TicketApprovalScope, TicketApprovalStatus };

/**
 * Request types that require manager approval before the ticket can progress.
 * Kept in sync with the `scope` enum on the `ticket_approvals` table.
 */
export const TICKET_APPROVAL_SCOPES: TicketApprovalScope[] = [
  "noc",
  "move_in",
  "vendor_access",
  "construction_material_delivery",
];

export interface TicketApprovalRecord {
  id: string;
  ticketId: string;
  scope: TicketApprovalScope;
  status: TicketApprovalStatus;
  requestedBy: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionComment: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TicketApprovalWithActors extends TicketApprovalRecord {
  requestedByName: string | null;
  decidedByName: string | null;
}

// ── requestTicketApproval ────────────────────────────────────────────────────

/**
 * Open a new approval request for the given ticket + scope, or return the
 * existing pending one (idempotent). Re-opens a previously cancelled approval
 * by inserting a new row — only one non-terminal approval is enforced via
 * application logic above the unique (ticket_id, scope) index.
 *
 * Note: the unique index on (ticket_id, scope) means at most one approval
 * row exists per scope per ticket. If a prior approval was rejected/approved/
 * cancelled and a new one is needed, the caller should `cancelTicketApproval`
 * the old row first (or the row is reused via update).
 */
export async function requestTicketApproval(
  db: Database,
  input: {
    ticketId: string;
    scope: TicketApprovalScope;
    requestedBy: string | null;
  }
): Promise<TicketApprovalRecord> {
  const [existing] = await db
    .select()
    .from(ticketApprovals)
    .where(
      and(
        eq(ticketApprovals.ticketId, input.ticketId),
        eq(ticketApprovals.scope, input.scope)
      )
    )
    .limit(1);

  if (existing && existing.status === "pending") {
    return existing as TicketApprovalRecord;
  }

  let row: TicketApprovalRecord;
  if (existing) {
    // Reset prior terminal approval back to pending
    const [updated] = await db
      .update(ticketApprovals)
      .set({
        status: "pending",
        requestedBy: input.requestedBy,
        decidedBy: null,
        decidedAt: null,
        decisionComment: null,
        updatedAt: new Date(),
      })
      .where(eq(ticketApprovals.id, existing.id))
      .returning();
    row = updated as TicketApprovalRecord;
  } else {
    const [inserted] = await db
      .insert(ticketApprovals)
      .values({
        ticketId: input.ticketId,
        scope: input.scope,
        status: "pending",
        requestedBy: input.requestedBy,
      })
      .returning();
    row = inserted as TicketApprovalRecord;
  }

  await logAudit(db, {
    userId: input.requestedBy ?? "system",
    action: "ticket_approval_request",
    entityType: "ticket_approval",
    entityId: row.id,
    summary: `Approval requested for ticket ${input.ticketId} (${input.scope})`,
    changes: {
      ticketId: { old: null, new: input.ticketId },
      scope: { old: null, new: input.scope },
    },
  });

  return row;
}

// ── decideTicketApproval ─────────────────────────────────────────────────────

/**
 * Approve or reject a pending ticket approval.
 *
 * - approved → ticket transitions to "in_progress" (if currently open/assigned)
 * - rejected → ticket transitions to "closed" with the comment as the
 *   resolution note context
 *
 * Status transitions are best-effort: if the ticket is not in a transitionable
 * state, the approval is still recorded but the lifecycle change is skipped.
 */
export async function decideTicketApproval(
  db: Database,
  approvalId: string,
  approverId: string,
  decision: "approved" | "rejected",
  comment?: string
): Promise<TicketApprovalRecord> {
  const [approval] = await db
    .select()
    .from(ticketApprovals)
    .where(eq(ticketApprovals.id, approvalId))
    .limit(1);

  if (!approval) {
    throw new Error("Approval request not found");
  }
  if (approval.status !== "pending") {
    throw new Error(`Approval is already ${approval.status}`);
  }

  const now = new Date();
  const [updated] = await db
    .update(ticketApprovals)
    .set({
      status: decision,
      decidedBy: approverId,
      decidedAt: now,
      decisionComment: comment ?? null,
      updatedAt: now,
    })
    .where(eq(ticketApprovals.id, approvalId))
    .returning();

  await logAudit(db, {
    userId: approverId,
    action: "ticket_approval_decide",
    entityType: "ticket_approval",
    entityId: approvalId,
    summary: `Approval ${decision} for ticket ${approval.ticketId} (${approval.scope})`,
    changes: {
      decision: { old: "pending", new: decision },
      comment: { old: null, new: comment ?? null },
    },
  });

  // Best-effort lifecycle transition
  const [ticket] = await db
    .select({ status: tickets.status })
    .from(tickets)
    .where(eq(tickets.id, approval.ticketId))
    .limit(1);

  if (ticket) {
    const transitionable = new Set(["open", "assigned"]);
    try {
      if (decision === "approved" && transitionable.has(ticket.status)) {
        await transitionTicketStatus(
          db,
          approval.ticketId,
          "in_progress",
          approverId
        );
      } else if (
        decision === "rejected" &&
        ticket.status !== "closed" &&
        ticket.status !== "resolved"
      ) {
        // Lifecycle requires resolved → closed; transition through resolved
        // first so we can close the ticket on rejection.
        try {
          await transitionTicketStatus(
            db,
            approval.ticketId,
            "resolved",
            approverId
          );
        } catch {
          // ignore — try closing directly
        }
        await transitionTicketStatus(
          db,
          approval.ticketId,
          "closed",
          approverId
        );
      }
    } catch (err) {
      console.error("[ticket-approvals] lifecycle transition failed", err);
    }
  }

  return updated as TicketApprovalRecord;
}

// ── cancelTicketApproval ─────────────────────────────────────────────────────

export async function cancelTicketApproval(
  db: Database,
  approvalId: string,
  actorId: string,
  reason?: string
): Promise<TicketApprovalRecord> {
  const [approval] = await db
    .select()
    .from(ticketApprovals)
    .where(eq(ticketApprovals.id, approvalId))
    .limit(1);

  if (!approval) {
    throw new Error("Approval request not found");
  }
  if (approval.status !== "pending") {
    throw new Error(`Approval is already ${approval.status}`);
  }

  const [updated] = await db
    .update(ticketApprovals)
    .set({
      status: "cancelled",
      decidedBy: actorId,
      decidedAt: new Date(),
      decisionComment: reason ?? null,
      updatedAt: new Date(),
    })
    .where(eq(ticketApprovals.id, approvalId))
    .returning();

  await logAudit(db, {
    userId: actorId,
    action: "ticket_approval_cancel",
    entityType: "ticket_approval",
    entityId: approvalId,
    summary: `Approval cancelled for ticket ${approval.ticketId} (${approval.scope})`,
    changes: { reason: { old: null, new: reason ?? null } },
  });

  return updated as TicketApprovalRecord;
}

// ── Queries ──────────────────────────────────────────────────────────────────

export async function getTicketApprovals(
  db: Database,
  ticketId: string
): Promise<TicketApprovalWithActors[]> {
  const requestedByUsers = users;
  const rows = await db
    .select({
      id: ticketApprovals.id,
      ticketId: ticketApprovals.ticketId,
      scope: ticketApprovals.scope,
      status: ticketApprovals.status,
      requestedBy: ticketApprovals.requestedBy,
      decidedBy: ticketApprovals.decidedBy,
      decidedAt: ticketApprovals.decidedAt,
      decisionComment: ticketApprovals.decisionComment,
      createdAt: ticketApprovals.createdAt,
      updatedAt: ticketApprovals.updatedAt,
      requestedByName: requestedByUsers.name,
    })
    .from(ticketApprovals)
    .leftJoin(
      requestedByUsers,
      eq(requestedByUsers.id, ticketApprovals.requestedBy)
    )
    .where(eq(ticketApprovals.ticketId, ticketId))
    .orderBy(desc(ticketApprovals.createdAt));

  // Resolve decidedBy names with a second pass to avoid double join aliasing
  const decidedIds = rows
    .map((r) => r.decidedBy)
    .filter((v): v is string => Boolean(v));
  const decidedByMap = new Map<string, string>();
  if (decidedIds.length > 0) {
    const decided = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, decidedIds));
    for (const u of decided) {
      decidedByMap.set(u.id, u.name);
    }
  }

  return rows.map((r) => ({
    id: r.id,
    ticketId: r.ticketId,
    scope: r.scope as TicketApprovalScope,
    status: r.status as TicketApprovalStatus,
    requestedBy: r.requestedBy,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt,
    decisionComment: r.decisionComment,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    requestedByName: r.requestedByName ?? null,
    decidedByName: r.decidedBy ? decidedByMap.get(r.decidedBy) ?? null : null,
  }));
}

export async function listPendingApprovals(
  db: Database,
  filters: { scope?: TicketApprovalScope } = {}
): Promise<TicketApprovalWithActors[]> {
  const conditions = [eq(ticketApprovals.status, "pending")];
  if (filters.scope) {
    conditions.push(eq(ticketApprovals.scope, filters.scope));
  }

  const rows = await db
    .select({
      id: ticketApprovals.id,
      ticketId: ticketApprovals.ticketId,
      scope: ticketApprovals.scope,
      status: ticketApprovals.status,
      requestedBy: ticketApprovals.requestedBy,
      decidedBy: ticketApprovals.decidedBy,
      decidedAt: ticketApprovals.decidedAt,
      decisionComment: ticketApprovals.decisionComment,
      createdAt: ticketApprovals.createdAt,
      updatedAt: ticketApprovals.updatedAt,
      requestedByName: users.name,
    })
    .from(ticketApprovals)
    .leftJoin(users, eq(users.id, ticketApprovals.requestedBy))
    .where(and(...conditions))
    .orderBy(desc(ticketApprovals.createdAt));

  return rows.map((r) => ({
    id: r.id,
    ticketId: r.ticketId,
    scope: r.scope as TicketApprovalScope,
    status: r.status as TicketApprovalStatus,
    requestedBy: r.requestedBy,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt,
    decisionComment: r.decisionComment,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    requestedByName: r.requestedByName ?? null,
    decidedByName: null,
  }));
}
