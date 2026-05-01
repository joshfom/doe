import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import type { TicketStatus, TicketSource, TicketPriority } from "../types";
import type { Database } from "../db";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock the audit module
vi.mock("../audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

// Mock the ticket-number module
vi.mock("./ticket-number", () => ({
  generateTicketNumber: vi.fn(),
}));

// Mock the notifications module (service calls these but we don't test them here)
vi.mock("./notifications", () => ({
  sendTicketCreatedEmail: vi.fn().mockResolvedValue(undefined),
  sendTicketAssignedEmail: vi.fn().mockResolvedValue(undefined),
  sendTicketResolvedEmail: vi.fn().mockResolvedValue(undefined),
  sendTicketClosedEmail: vi.fn().mockResolvedValue(undefined),
}));

// Mock the approval notifications (sendEmail used by notifications)
vi.mock("../approval/notifications", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

import { logAudit } from "../audit";
import { generateTicketNumber } from "./ticket-number";
import { createTicket, assignTicket, addNote } from "./service";
import { transitionTicketStatus } from "./lifecycle";

const mockLogAudit = vi.mocked(logAudit);
const mockGenerateTicketNumber = vi.mocked(generateTicketNumber);

// ── Arbitraries ──────────────────────────────────────────────────────────────

const arbUuid = fc.uuid();

const arbNonEmpty = fc.stringMatching(/^[a-zA-Z0-9]{1,20}$/);

const arbEmail = fc
  .tuple(
    fc.stringMatching(/^[a-z]{2,8}$/),
    fc.stringMatching(/^[a-z]{2,6}$/),
    fc.constantFrom("com", "org", "net", "io"),
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

const arbTicketSource = fc.constantFrom<TicketSource>("manual", "api", "form");

const arbTicketNumber = fc
  .integer({ min: 1, max: 999999 })
  .map((n) => `ORA-${String(n).padStart(6, "0")}`);

const arbTicketStatus = fc.constantFrom<TicketStatus>(
  "open",
  "assigned",
  "in_progress",
  "resolved",
  "closed",
);

// ── Mock DB helpers ──────────────────────────────────────────────────────────

/**
 * Creates a mock database that simulates insert/select/update operations.
 * Tracks inserted rows and supports returning() chains.
 */
function createMockDb(options?: {
  existingTicket?: Record<string, unknown>;
  existingUser?: Record<string, unknown>;
}) {
  const insertedRows: Record<string, unknown>[] = [];

  const returningFn = vi.fn().mockImplementation(() => {
    // Return the last inserted row
    return insertedRows.length > 0 ? [insertedRows[insertedRows.length - 1]] : [];
  });

  const valuesFn = vi.fn().mockImplementation((values: Record<string, unknown>) => {
    const row = {
      id: values.id ?? crypto.randomUUID(),
      ...values,
      createdAt: values.createdAt ?? new Date(),
      updatedAt: values.updatedAt ?? new Date(),
    };
    insertedRows.push(row);
    return { returning: returningFn };
  });

  const insertFn = vi.fn().mockReturnValue({ values: valuesFn });

  // For select queries (used by assignTicket and transitionTicketStatus)
  const selectWhereFn = vi.fn().mockImplementation(() => {
    if (options?.existingTicket) {
      return [options.existingTicket];
    }
    if (options?.existingUser) {
      return [options.existingUser];
    }
    return [];
  });

  const selectFromFn = vi.fn().mockReturnValue({
    where: selectWhereFn,
  });

  const selectFn = vi.fn().mockReturnValue({
    from: selectFromFn,
  });

  // For update queries
  const updateReturningFn = vi.fn().mockImplementation(() => {
    if (options?.existingTicket) {
      return [options.existingTicket];
    }
    return [];
  });

  const updateWhereFn = vi.fn().mockReturnValue({
    returning: updateReturningFn,
  });

  const updateSetFn = vi.fn().mockReturnValue({
    where: updateWhereFn,
  });

  const updateFn = vi.fn().mockReturnValue({
    set: updateSetFn,
  });

  const db = {
    insert: insertFn,
    select: selectFn,
    update: updateFn,
    // transaction mock for transitionTicketStatus
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      // Create a transaction-scoped mock that behaves like the db
      const txSelectWhereFn = vi.fn().mockImplementation(() => {
        if (options?.existingTicket) {
          return [options.existingTicket];
        }
        return [];
      });

      const txSelectFromFn = vi.fn().mockReturnValue({
        where: txSelectWhereFn,
      });

      const txSelectFn = vi.fn().mockReturnValue({
        from: txSelectFromFn,
      });

      const txUpdateReturningFn = vi.fn().mockImplementation(() => {
        if (options?.existingTicket) {
          return [{ ...options.existingTicket, status: "updated" }];
        }
        return [];
      });

      const txUpdateWhereFn = vi.fn().mockReturnValue({
        returning: txUpdateReturningFn,
      });

      const txUpdateSetFn = vi.fn().mockReturnValue({
        where: txUpdateWhereFn,
      });

      const txUpdateFn = vi.fn().mockReturnValue({
        set: txUpdateSetFn,
      });

      const txInsertReturningFn = vi.fn().mockReturnValue([]);
      const txInsertValuesFn = vi.fn().mockReturnValue({ returning: txInsertReturningFn });
      const txInsertFn = vi.fn().mockReturnValue({ values: txInsertValuesFn });

      const tx = {
        select: txSelectFn,
        update: txUpdateFn,
        insert: txInsertFn,
      };

      return fn(tx);
    }),
  } as unknown as Database;

  return { db, insertedRows };
}

// ─────────────────────────────────────────────────────────────────────────────
// Property 11: Ticket audit trail completeness
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 2.7, 14.1, 14.2, 14.3, 14.4**
 *
 * Property 11: Ticket audit trail completeness
 *
 * For any ticket mutation — creation, assignment/reassignment, status
 * transition, or note addition — an audit_log entry should be created with
 * the correct entity_type, action, entity_id (ticket_id), actor user_id,
 * and relevant change details (old/new status, old/new assignee).
 */
// Feature: support-ticketing-system, Property 11: Ticket audit trail completeness
describe("Feature: support-ticketing-system, Property 11: Ticket audit trail completeness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogAudit.mockResolvedValue(undefined);
  });

  // ── 1. createTicket calls logAudit with entity_type "ticket", action "ticket_create" ──

  it("createTicket calls logAudit with entity_type 'ticket' and action 'ticket_create' (Req 14.1)", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbNonEmpty,
        arbNonEmpty,
        arbNonEmpty,
        arbEmail,
        arbTicketSource,
        arbUuid,
        arbTicketNumber,
        async (subject, description, contactName, contactEmail, source, userId, ticketNumber) => {
          vi.clearAllMocks();
          mockLogAudit.mockResolvedValue(undefined);
          mockGenerateTicketNumber.mockResolvedValue(ticketNumber);

          const ticketId = crypto.randomUUID();
          const { db } = createMockDb();

          // Override insert to return a ticket with a known ID
          (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockReturnValue([
                {
                  id: ticketId,
                  ticketNumber,
                  subject,
                  description,
                  status: "open",
                  priority: "medium",
                  category: null,
                  contactName,
                  contactEmail,
                  contactPhone: null,
                  source,
                  assigneeId: null,
                  createdBy: source === "form" ? null : userId,
                  externalCrmId: null,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  resolvedAt: null,
                  closedAt: null,
                },
              ]),
            }),
          });

          const createdBy = source === "form" ? null : userId;
          await createTicket(db, {
            subject,
            description,
            contactName,
            contactEmail,
            source,
            createdBy,
          });

          // logAudit must have been called at least once
          expect(mockLogAudit).toHaveBeenCalled();

          // Find the audit call for ticket_create
          const createAuditCall = mockLogAudit.mock.calls.find(
            (call) => call[1].action === "ticket_create" && call[1].entityType === "ticket",
          );

          expect(createAuditCall).toBeDefined();
          const entry = createAuditCall![1];

          // entity_type must be "ticket"
          expect(entry.entityType).toBe("ticket");
          // action must be "ticket_create"
          expect(entry.action).toBe("ticket_create");
          // entity_id must be the ticket ID
          expect(entry.entityId).toBe(ticketId);
          // actor user_id must be the creator (or "system" for form)
          expect(entry.userId).toBe(createdBy ?? "system");
        },
      ),
      { numRuns: 20 },
    );
  });

  // ── 2. assignTicket calls logAudit with entity_type "ticket", action "ticket_assign" ──

  it("assignTicket calls logAudit with entity_type 'ticket', action 'ticket_assign', and old/new assignee in changes (Req 14.2)", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUuid, // ticketId
        arbUuid, // old assigneeId (or null)
        arbUuid, // new assigneeId
        arbUuid, // actorId
        fc.constantFrom<TicketStatus>("open", "assigned", "in_progress"),
        async (ticketId, oldAssigneeId, newAssigneeId, actorId, currentStatus) => {
          vi.clearAllMocks();
          mockLogAudit.mockResolvedValue(undefined);

          const existingTicket = {
            id: ticketId,
            ticketNumber: "ORA-000001",
            subject: "Test",
            description: "Test",
            status: currentStatus,
            priority: "medium",
            category: null,
            contactName: "Test",
            contactEmail: "test@test.com",
            contactPhone: null,
            source: "manual",
            assigneeId: oldAssigneeId,
            createdBy: actorId,
            externalCrmId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            resolvedAt: null,
            closedAt: null,
          };

          const existingUser = {
            id: newAssigneeId,
            name: "Agent",
            email: "agent@test.com",
            isActive: true,
            userType: "employee",
          };

          // Build a mock db that handles the select calls in sequence:
          // 1st select: user lookup (assignee validation)
          // 2nd select: ticket lookup
          let selectCallCount = 0;
          const mockSelectWhere = vi.fn().mockImplementation(() => {
            selectCallCount++;
            if (selectCallCount === 1) return [existingUser];
            return [existingTicket];
          });

          const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
          const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

          // For the "open" → "assigned" path, transitionTicketStatus is called
          // which uses db.transaction. For other statuses, a direct update is done.
          const updatedTicket = { ...existingTicket, assigneeId: newAssigneeId };

          const mockUpdateReturning = vi.fn().mockReturnValue([updatedTicket]);
          const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
          const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
          const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

          // Transaction mock for the "open" status path
          const mockTransaction = vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
            const txSelectWhere = vi.fn().mockReturnValue([existingTicket]);
            const txSelectFrom = vi.fn().mockReturnValue({ where: txSelectWhere });
            const txSelect = vi.fn().mockReturnValue({ from: txSelectFrom });

            const txUpdatedTicket = { ...existingTicket, status: "assigned", assigneeId: newAssigneeId };
            const txUpdateReturning = vi.fn().mockReturnValue([txUpdatedTicket]);
            const txUpdateWhere = vi.fn().mockReturnValue({ returning: txUpdateReturning });
            const txUpdateSet = vi.fn().mockReturnValue({ where: txUpdateWhere });
            const txUpdate = vi.fn().mockReturnValue({ set: txUpdateSet });

            const tx = { select: txSelect, update: txUpdate, insert: vi.fn() };
            return fn(tx);
          });

          const db = {
            select: mockSelect,
            update: mockUpdate,
            insert: vi.fn(),
            transaction: mockTransaction,
          } as unknown as Database;

          await assignTicket(db, ticketId, newAssigneeId, actorId);

          // Find the audit call for ticket_assign
          const assignAuditCall = mockLogAudit.mock.calls.find(
            (call) => call[1].action === "ticket_assign" && call[1].entityType === "ticket",
          );

          expect(assignAuditCall).toBeDefined();
          const entry = assignAuditCall![1];

          // entity_type must be "ticket"
          expect(entry.entityType).toBe("ticket");
          // action must be "ticket_assign"
          expect(entry.action).toBe("ticket_assign");
          // entity_id must be the ticket ID
          expect(entry.entityId).toBe(ticketId);
          // actor user_id must be the actorId
          expect(entry.userId).toBe(actorId);
          // changes must contain old/new assignee
          expect(entry.changes).toBeDefined();
          expect(entry.changes!.assigneeId).toBeDefined();
          expect(entry.changes!.assigneeId.old).toBe(oldAssigneeId);
          expect(entry.changes!.assigneeId.new).toBe(newAssigneeId);
        },
      ),
      { numRuns: 20 },
    );
  });

  // ── 3. transitionTicketStatus calls logAudit with entity_type "ticket_status_change" ──

  it("transitionTicketStatus calls logAudit with entity_type 'ticket_status_change' and old/new status in changes (Req 2.7, 14.3)", async () => {
    // Valid transitions to test
    const validTransitions: [TicketStatus, TicketStatus][] = [
      ["open", "assigned"],
      ["open", "in_progress"],
      ["assigned", "in_progress"],
      ["in_progress", "resolved"],
      ["resolved", "closed"],
      ["resolved", "in_progress"],
    ];

    const arbTransition = fc.constantFrom(...validTransitions);

    await fc.assert(
      fc.asyncProperty(
        arbUuid, // ticketId
        arbUuid, // actorId
        arbUuid, // assigneeId (for open → assigned)
        arbTransition,
        async (ticketId, actorId, assigneeId, [fromStatus, toStatus]) => {
          vi.clearAllMocks();
          mockLogAudit.mockResolvedValue(undefined);

          const existingTicket = {
            id: ticketId,
            ticketNumber: "ORA-000001",
            subject: "Test",
            description: "Test",
            status: fromStatus,
            priority: "medium",
            category: null,
            contactName: "Test",
            contactEmail: "test@test.com",
            contactPhone: null,
            source: "manual",
            assigneeId: toStatus === "assigned" ? null : assigneeId,
            createdBy: actorId,
            externalCrmId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            resolvedAt: fromStatus === "resolved" ? new Date() : null,
            closedAt: null,
          };

          const updatedTicket = { ...existingTicket, status: toStatus };

          // Transaction mock
          const mockTransaction = vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
            const txSelectWhere = vi.fn().mockReturnValue([existingTicket]);
            const txSelectFrom = vi.fn().mockReturnValue({ where: txSelectWhere });
            const txSelect = vi.fn().mockReturnValue({ from: txSelectFrom });

            const txUpdateReturning = vi.fn().mockReturnValue([updatedTicket]);
            const txUpdateWhere = vi.fn().mockReturnValue({ returning: txUpdateReturning });
            const txUpdateSet = vi.fn().mockReturnValue({ where: txUpdateWhere });
            const txUpdate = vi.fn().mockReturnValue({ set: txUpdateSet });

            const tx = { select: txSelect, update: txUpdate, insert: vi.fn() };
            return fn(tx);
          });

          const db = {
            transaction: mockTransaction,
          } as unknown as Database;

          const assigneeArg = toStatus === "assigned" ? assigneeId : undefined;
          await transitionTicketStatus(db, ticketId, toStatus, actorId, assigneeArg);

          // Find the audit call for ticket_status_change
          const statusAuditCall = mockLogAudit.mock.calls.find(
            (call) =>
              call[1].action === "ticket_status_change" &&
              call[1].entityType === "ticket_status_change",
          );

          expect(statusAuditCall).toBeDefined();
          const entry = statusAuditCall![1];

          // entity_type must be "ticket_status_change"
          expect(entry.entityType).toBe("ticket_status_change");
          // action must be "ticket_status_change"
          expect(entry.action).toBe("ticket_status_change");
          // entity_id must be the ticket ID
          expect(entry.entityId).toBe(ticketId);
          // actor user_id must be the actorId
          expect(entry.userId).toBe(actorId);
          // changes must contain old/new status
          expect(entry.changes).toBeDefined();
          expect(entry.changes!.status).toBeDefined();
          expect(entry.changes!.status.old).toBe(fromStatus);
          expect(entry.changes!.status.new).toBe(toStatus);
        },
      ),
      { numRuns: 20 },
    );
  });

  // ── 4. addNote calls logAudit with entity_type "ticket_note", action "ticket_note_add" ──

  it("addNote calls logAudit with entity_type 'ticket_note' and action 'ticket_note_add' (Req 14.4)", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUuid, // ticketId
        arbUuid, // authorId
        arbNonEmpty, // content
        fc.boolean(), // isInternal
        async (ticketId, authorId, content, isInternal) => {
          vi.clearAllMocks();
          mockLogAudit.mockResolvedValue(undefined);

          const noteId = crypto.randomUUID();

          const mockInsertReturning = vi.fn().mockReturnValue([
            {
              id: noteId,
              ticketId,
              authorId,
              content,
              isInternal,
              createdAt: new Date(),
            },
          ]);
          const mockInsertValues = vi.fn().mockReturnValue({ returning: mockInsertReturning });
          const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

          const db = {
            insert: mockInsert,
          } as unknown as Database;

          const note = await addNote(db, ticketId, authorId, content, isInternal);

          // logAudit must have been called
          expect(mockLogAudit).toHaveBeenCalled();

          // Find the audit call for ticket_note_add
          const noteAuditCall = mockLogAudit.mock.calls.find(
            (call) =>
              call[1].action === "ticket_note_add" && call[1].entityType === "ticket_note",
          );

          expect(noteAuditCall).toBeDefined();
          const entry = noteAuditCall![1];

          // entity_type must be "ticket_note"
          expect(entry.entityType).toBe("ticket_note");
          // action must be "ticket_note_add"
          expect(entry.action).toBe("ticket_note_add");
          // entity_id must be the ticket ID
          expect(entry.entityId).toBe(ticketId);
          // actor user_id must be the authorId
          expect(entry.userId).toBe(authorId);
        },
      ),
      { numRuns: 20 },
    );
  });
});
