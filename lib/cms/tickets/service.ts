import { eq, and, or, desc, count, sql, ilike, gte, lte } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { Database } from "../db";
import type {
  TicketPriority,
  TicketRequestType,
  TicketSource,
  TicketStatus,
} from "../types";
import { tickets, ticketNotes, ticketCategories, users, auditLog } from "../schema";
import { logAudit } from "../audit";
import { generateTicketNumber } from "./ticket-number";
import { transitionTicketStatus } from "./lifecycle";
import { syncTicketToCrm } from "./crm/sync";
import { validateRequestData } from "./request-types";
import {
  requestTicketApproval,
  TICKET_APPROVAL_SCOPES,
  type TicketApprovalScope,
} from "./approvals";

// ── Input / Filter types ─────────────────────────────────────────────────────

export interface CreateTicketInput {
  subject: string;
  description: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  priority?: TicketPriority;
  category?: string;
  source: TicketSource;
  createdBy: string | null;
  requestType?: TicketRequestType;
  communityId?: string | null;
  projectId?: string | null;
  unitNumber?: string | null;
  requestData?: unknown;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
}

export interface TicketFilters {
  status?: TicketStatus;
  priority?: TicketPriority;
  category?: string;
  assigneeId?: string;
  dateFrom?: string;
  dateTo?: string;
  source?: TicketSource;
  requestType?: TicketRequestType;
  communityId?: string;
  projectId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

// ── Ticket with notes (for getTicketById) ────────────────────────────────────

export type Ticket = typeof tickets.$inferSelect;
export type TicketNote = typeof ticketNotes.$inferSelect;
export type AuditLogRecord = typeof auditLog.$inferSelect;

export interface TicketWithNotes {
  ticket: Ticket;
  notes: TicketNote[];
  auditTrail: AuditLogRecord[];
}

// ── createTicket ─────────────────────────────────────────────────────────────

/**
 * Create a new ticket with status "open", generate a unique ticket number,
 * write an audit log entry, and return the ticket id and number.
 */
export async function createTicket(
  db: Database,
  input: CreateTicketInput
): Promise<{ ticketId: string; ticketNumber: string }> {
  const ticketNumber = await generateTicketNumber(db);
  const requestType: TicketRequestType = input.requestType ?? "general_inquiry";

  // Validate type-specific structured data (throws ZodError on invalid)
  const requestData =
    input.requestData === undefined
      ? null
      : validateRequestData(requestType, input.requestData);

  const [inserted] = await db
    .insert(tickets)
    .values({
      ticketNumber,
      subject: input.subject,
      description: input.description,
      status: "open",
      priority: input.priority ?? "medium",
      category: input.category ?? null,
      requestType,
      communityId: input.communityId ?? null,
      projectId: input.projectId ?? null,
      unitNumber: input.unitNumber ?? null,
      requestData,
      scheduledStart: input.scheduledStart ? new Date(input.scheduledStart) : null,
      scheduledEnd: input.scheduledEnd ? new Date(input.scheduledEnd) : null,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone ?? null,
      source: input.source,
      createdBy: input.createdBy,
      assigneeId: null,
    })
    .returning();

  // Audit log — ticket_create
  await logAudit(db, {
    userId: input.createdBy ?? "system",
    action: "ticket_create",
    entityType: "ticket",
    entityId: inserted.id,
    summary: `Ticket ${ticketNumber} (${requestType}) created via ${input.source}`,
  });

  // Auto-open an approval request for scopes that require manager sign-off
  // (NOC, move-in, vendor access, construction material delivery). Failures
  // are logged but never block ticket creation.
  if (TICKET_APPROVAL_SCOPES.includes(requestType as TicketApprovalScope)) {
    try {
      await requestTicketApproval(db, {
        ticketId: inserted.id,
        scope: requestType as TicketApprovalScope,
        requestedBy: input.createdBy ?? null,
      });
    } catch (err) {
      console.error("[tickets] auto approval failed", err);
    }
  }

  // TODO: Trigger creation notification (task 7.1)
  // e.g. sendTicketCreatedEmail(db, inserted)

  // Sync to CRM (fire-and-forget — never blocks ticket creation)
  syncTicketToCrm(db, inserted.id, "create_case", {
    ticketNumber,
    subject: input.subject,
    description: input.description,
    contactName: input.contactName,
    contactEmail: input.contactEmail,
    contactPhone: input.contactPhone,
    priority: input.priority ?? "medium",
    category: input.category,
    status: "open",
  }).catch(() => {
    // Swallow — syncTicketToCrm already handles errors internally
  });

  return { ticketId: inserted.id, ticketNumber };
}

// ── assignTicket ─────────────────────────────────────────────────────────────

/**
 * Assign (or reassign) a ticket to an active employee.
 *
 * - Validates the assignee is an active user with userType "employee".
 * - If the ticket is currently "open", transitions to "assigned" via the
 *   lifecycle engine.
 * - Otherwise, updates the assigneeId directly and logs the reassignment.
 */
export async function assignTicket(
  db: Database,
  ticketId: string,
  assigneeId: string,
  actorId: string
) {
  // 1. Validate assignee is active employee
  const [assignee] = await db
    .select()
    .from(users)
    .where(eq(users.id, assigneeId));

  if (!assignee) {
    throw new Error("Assignee not found");
  }
  if (!assignee.isActive) {
    throw new Error("Assignee must be an active user");
  }
  if (assignee.userType !== "employee") {
    throw new Error("Assignee must be an employee");
  }

  // 2. Fetch current ticket
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, ticketId));

  if (!ticket) {
    throw new Error("Ticket not found");
  }

  const currentStatus = ticket.status as TicketStatus;

  // 3. If open → transition to "assigned" (lifecycle engine handles audit)
  if (currentStatus === "open") {
    const updated = await transitionTicketStatus(
      db,
      ticketId,
      "assigned",
      actorId,
      assigneeId
    );

    // Audit log — ticket_assign
    await logAudit(db, {
      userId: actorId,
      action: "ticket_assign",
      entityType: "ticket",
      entityId: ticketId,
      summary: `Ticket assigned to ${assignee.name}`,
      changes: {
        assigneeId: { old: ticket.assigneeId, new: assigneeId },
      },
    });

    // TODO: Trigger assignment notification (task 7.1)
    // e.g. sendTicketAssignedEmail(db, updated, assignee.email)

    return updated;
  }

  // 4. Otherwise — reassign without status change
  const oldAssigneeId = ticket.assigneeId;

  const [updated] = await db
    .update(tickets)
    .set({ assigneeId, updatedAt: new Date() })
    .where(eq(tickets.id, ticketId))
    .returning();

  // Audit log — ticket_assign (reassignment)
  await logAudit(db, {
    userId: actorId,
    action: "ticket_assign",
    entityType: "ticket",
    entityId: ticketId,
    summary: `Ticket reassigned to ${assignee.name}`,
    changes: {
      assigneeId: { old: oldAssigneeId, new: assigneeId },
    },
  });

  // TODO: Trigger assignment notification (task 7.1)

  return updated;
}

// ── addNote ──────────────────────────────────────────────────────────────────

/**
 * Add a note to a ticket and write an audit log entry.
 */
export async function addNote(
  db: Database,
  ticketId: string,
  authorId: string,
  content: string,
  isInternal: boolean = true
): Promise<TicketNote> {
  const [note] = await db
    .insert(ticketNotes)
    .values({
      ticketId,
      authorId,
      content,
      isInternal,
    })
    .returning();

  // Audit log — ticket_note_add
  await logAudit(db, {
    userId: authorId,
    action: "ticket_note_add",
    entityType: "ticket_note",
    entityId: ticketId,
    summary: `Note added to ticket`,
  });

  return note;
}

// ── updateTicketRequest ──────────────────────────────────────────────────────

export interface UpdateTicketRequestInput {
  requestType?: TicketRequestType;
  communityId?: string | null;
  projectId?: string | null;
  unitNumber?: string | null;
  requestData?: unknown;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  priority?: TicketPriority;
  category?: string | null;
}

/**
 * Update a ticket's request-type fields and structured data.
 *
 * - Re-validates `requestData` against the schema for the (possibly new)
 *   `requestType`.
 * - Writes a `ticket_request_update` audit entry with the changed keys.
 */
export async function updateTicketRequest(
  db: Database,
  ticketId: string,
  actorId: string,
  input: UpdateTicketRequestInput
): Promise<Ticket> {
  const [existing] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, ticketId));
  if (!existing) {
    throw new Error("Ticket not found");
  }

  const nextRequestType: TicketRequestType =
    input.requestType ?? (existing.requestType as TicketRequestType);

  // If requestData provided, validate against the (new) schema.
  // If only requestType changed, validate the existing data against the new schema.
  let nextRequestData: Record<string, unknown> | null | undefined;
  if (input.requestData !== undefined) {
    nextRequestData = validateRequestData(nextRequestType, input.requestData);
  } else if (input.requestType && input.requestType !== existing.requestType) {
    nextRequestData = validateRequestData(nextRequestType, existing.requestData ?? {});
  }

  const update: Partial<typeof tickets.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.requestType !== undefined) update.requestType = nextRequestType;
  if (nextRequestData !== undefined) update.requestData = nextRequestData;
  if (input.communityId !== undefined) update.communityId = input.communityId;
  if (input.projectId !== undefined) update.projectId = input.projectId;
  if (input.unitNumber !== undefined) update.unitNumber = input.unitNumber;
  if (input.scheduledStart !== undefined) {
    update.scheduledStart = input.scheduledStart ? new Date(input.scheduledStart) : null;
  }
  if (input.scheduledEnd !== undefined) {
    update.scheduledEnd = input.scheduledEnd ? new Date(input.scheduledEnd) : null;
  }
  if (input.priority !== undefined) update.priority = input.priority;
  if (input.category !== undefined) update.category = input.category;

  const [updated] = await db
    .update(tickets)
    .set(update)
    .where(eq(tickets.id, ticketId))
    .returning();

  await logAudit(db, {
    userId: actorId,
    action: "ticket_request_update",
    entityType: "ticket",
    entityId: ticketId,
    summary: `Ticket ${updated.ticketNumber} request updated`,
    changes: Object.fromEntries(
      Object.keys(update)
        .filter((k) => k !== "updatedAt")
        .map((k) => [
          k,
          {
            old: (existing as Record<string, unknown>)[k] ?? null,
            new: (updated as Record<string, unknown>)[k] ?? null,
          },
        ])
    ),
  });

  return updated;
}

// ── getTicketById ────────────────────────────────────────────────────────────

/**
 * Return a ticket with its notes ordered by createdAt ascending
 * and its audit trail from the audit_log table.
 * Returns null if the ticket does not exist.
 */
export async function getTicketById(
  db: Database,
  ticketId: string
): Promise<TicketWithNotes | null> {
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, ticketId));

  if (!ticket) {
    return null;
  }

  const notes = await db
    .select()
    .from(ticketNotes)
    .where(eq(ticketNotes.ticketId, ticketId))
    .orderBy(ticketNotes.createdAt);

  const auditTrail = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.entityId, ticketId))
    .orderBy(desc(auditLog.createdAt));

  return { ticket, notes, auditTrail };
}

// ── listTickets ──────────────────────────────────────────────────────────────

/**
 * Return a paginated list of tickets with filtering, search, and status counts.
 *
 * Filters: status, priority, category, assigneeId, dateFrom/dateTo (createdAt range), source
 * Search: case-insensitive match across ticket_number, subject, contact_name, contact_email
 * Pagination: configurable page size (default 20)
 * Status counts: group-by-status summary across all tickets matching the filters (ignoring pagination)
 */
export async function listTickets(
  db: Database,
  filters: TicketFilters
): Promise<{ tickets: Ticket[]; total: number; statusCounts: Record<string, number> }> {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  // Build dynamic where conditions
  const conditions: SQL[] = [];

  if (filters.status) {
    conditions.push(eq(tickets.status, filters.status));
  }

  if (filters.priority) {
    conditions.push(eq(tickets.priority, filters.priority));
  }

  if (filters.category) {
    conditions.push(eq(tickets.category, filters.category));
  }

  if (filters.assigneeId) {
    conditions.push(eq(tickets.assigneeId, filters.assigneeId));
  }

  if (filters.source) {
    conditions.push(eq(tickets.source, filters.source));
  }

  if (filters.requestType) {
    conditions.push(eq(tickets.requestType, filters.requestType));
  }

  if (filters.communityId) {
    conditions.push(eq(tickets.communityId, filters.communityId));
  }

  if (filters.projectId) {
    conditions.push(eq(tickets.projectId, filters.projectId));
  }

  if (filters.dateFrom) {
    conditions.push(gte(tickets.createdAt, new Date(filters.dateFrom)));
  }

  if (filters.dateTo) {
    conditions.push(lte(tickets.createdAt, new Date(filters.dateTo)));
  }

  if (filters.search) {
    const pattern = `%${filters.search}%`;
    conditions.push(
      or(
        ilike(tickets.ticketNumber, pattern),
        ilike(tickets.subject, pattern),
        ilike(tickets.contactName, pattern),
        ilike(tickets.contactEmail, pattern)
      )!
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Total count (matching filters, before pagination)
  const [totalResult] = await db
    .select({ count: count() })
    .from(tickets)
    .where(whereClause);

  // Paginated ticket rows
  const rows = await db
    .select()
    .from(tickets)
    .where(whereClause)
    .orderBy(desc(tickets.createdAt))
    .limit(pageSize)
    .offset(offset);

  // Status count summary — counts per status across all tickets (unfiltered)
  const statusRows = await db
    .select({
      status: tickets.status,
      count: count(),
    })
    .from(tickets)
    .groupBy(tickets.status);

  const statusCounts: Record<string, number> = {};
  for (const row of statusRows) {
    statusCounts[row.status] = row.count;
  }

  return {
    tickets: rows,
    total: totalResult.count,
    statusCounts,
  };
}

// ── Category types ───────────────────────────────────────────────────────────

export type TicketCategory = typeof ticketCategories.$inferSelect;

export interface CreateCategoryInput {
  name: string;
  displayName: string;
  description?: string;
}

export interface UpdateCategoryInput {
  name?: string;
  displayName?: string;
  description?: string;
}

// ── createCategory ───────────────────────────────────────────────────────────

/**
 * Create a new ticket category. Validates that the name is unique —
 * catches the DB unique constraint violation and throws a user-friendly error.
 */
export async function createCategory(
  db: Database,
  input: CreateCategoryInput
): Promise<TicketCategory> {
  try {
    const [category] = await db
      .insert(ticketCategories)
      .values({
        name: input.name,
        displayName: input.displayName,
        description: input.description ?? null,
      })
      .returning();

    return category;
  } catch (error: unknown) {
    // PostgreSQL unique violation error code is "23505"
    if (
      error instanceof Error &&
      "code" in error &&
      (error as Record<string, unknown>).code === "23505"
    ) {
      throw new Error("A category with this name already exists");
    }
    throw error;
  }
}

// ── listCategories ───────────────────────────────────────────────────────────

/**
 * Return ticket categories. Defaults to active-only unless includeInactive is true.
 */
export async function listCategories(
  db: Database,
  includeInactive: boolean = false
): Promise<TicketCategory[]> {
  if (includeInactive) {
    return db.select().from(ticketCategories);
  }

  return db
    .select()
    .from(ticketCategories)
    .where(eq(ticketCategories.isActive, true));
}

// ── updateCategory ───────────────────────────────────────────────────────────

/**
 * Update a ticket category's name, displayName, or description.
 * Throws if the category does not exist. Catches unique constraint
 * violations on name and throws a user-friendly error.
 */
export async function updateCategory(
  db: Database,
  categoryId: string,
  updates: UpdateCategoryInput
): Promise<TicketCategory> {
  // Build the set object with only provided fields
  const setValues: Record<string, unknown> = {};
  if (updates.name !== undefined) setValues.name = updates.name;
  if (updates.displayName !== undefined) setValues.displayName = updates.displayName;
  if (updates.description !== undefined) setValues.description = updates.description;

  if (Object.keys(setValues).length === 0) {
    // Nothing to update — just return the existing record
    const [existing] = await db
      .select()
      .from(ticketCategories)
      .where(eq(ticketCategories.id, categoryId));

    if (!existing) {
      throw new Error("Category not found");
    }
    return existing;
  }

  try {
    const [updated] = await db
      .update(ticketCategories)
      .set(setValues)
      .where(eq(ticketCategories.id, categoryId))
      .returning();

    if (!updated) {
      throw new Error("Category not found");
    }

    return updated;
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as Record<string, unknown>).code === "23505"
    ) {
      throw new Error("A category with this name already exists");
    }
    throw error;
  }
}

// ── deactivateCategory ───────────────────────────────────────────────────────

/**
 * Soft-delete a ticket category by setting is_active to false.
 * The record is preserved for referential integrity with existing tickets.
 */
export async function deactivateCategory(
  db: Database,
  categoryId: string
): Promise<TicketCategory> {
  const [deactivated] = await db
    .update(ticketCategories)
    .set({ isActive: false })
    .where(eq(ticketCategories.id, categoryId))
    .returning();

  if (!deactivated) {
    throw new Error("Category not found");
  }

  return deactivated;
}
