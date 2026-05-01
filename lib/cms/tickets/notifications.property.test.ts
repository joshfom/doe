import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import {
  sendTicketCreatedEmail,
  sendTicketAssignedEmail,
  sendTicketResolvedEmail,
  sendTicketClosedEmail,
} from "./notifications";
import type { Ticket } from "./service";
import type { Database } from "../db";

// Mock the sendEmail function from approval/notifications
vi.mock("../approval/notifications", () => ({
  sendEmail: vi.fn(),
}));

// Mock the logAudit function from audit
vi.mock("../audit", () => ({
  logAudit: vi.fn(),
}));

import { sendEmail } from "../approval/notifications";
import { logAudit } from "../audit";

const mockSendEmail = vi.mocked(sendEmail);
const mockLogAudit = vi.mocked(logAudit);

const fakeDb = {} as Database;

// ── Arbitraries ──────────────────────────────────────────────────────────────

/** Generates a valid email address. */
const arbEmail = fc
  .tuple(
    fc.stringMatching(/^[a-z]{2,8}$/),
    fc.stringMatching(/^[a-z]{2,6}$/),
    fc.constantFrom("com", "org", "net", "io"),
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

/** Generates a non-empty trimmed string. */
const arbNonEmpty = fc.stringMatching(/^[a-zA-Z0-9]{1,20}$/);

/** Generates a ticket number in ORA-XXXXXX format. */
const arbTicketNumber = fc
  .integer({ min: 1, max: 999999 })
  .map((n) => `ORA-${String(n).padStart(6, "0")}`);

/**
 * Builds a Ticket object from individual generated parts.
 * Uses simple constant dates to avoid generation overhead.
 */
function buildTicket(parts: {
  id: string;
  ticketNumber: string;
  subject: string;
  contactName: string;
  contactEmail: string;
  createdBy: string | null;
}): Ticket {
  return {
    id: parts.id,
    ticketNumber: parts.ticketNumber,
    subject: parts.subject,
    description: "Test description",
    status: "open",
    priority: "medium",
    category: null,
    contactName: parts.contactName,
    contactEmail: parts.contactEmail,
    contactPhone: null,
    source: "manual",
    assigneeId: null,
    createdBy: parts.createdBy,
    externalCrmId: null,
    createdAt: new Date("2024-06-15T12:00:00Z"),
    updatedAt: new Date("2024-06-15T12:00:00Z"),
    resolvedAt: null,
    closedAt: null,
  } as Ticket;
}

/** Generates the varying parts of a ticket for property testing. */
const arbTicketParts = fc.record({
  id: fc.uuid(),
  ticketNumber: arbTicketNumber,
  subject: arbNonEmpty,
  contactName: arbNonEmpty,
  contactEmail: arbEmail,
  createdBy: fc.option(fc.uuid(), { nil: null }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 12: Notification triggers on lifecycle events
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 9.1, 9.2, 9.3, 9.4**
 *
 * Property 12: Notification triggers on lifecycle events
 *
 * For any ticket lifecycle event — creation, assignment, resolution, or
 * closure — the notification service should be invoked with the correct
 * recipient email (contact_email for creation/resolution/closure, assignee
 * email for assignment) and the ticket number should be included in the
 * email payload.
 */
// Feature: support-ticketing-system, Property 12: Notification triggers on lifecycle events
describe("Feature: support-ticketing-system, Property 12: Notification triggers on lifecycle events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendEmail.mockResolvedValue(undefined as any);
    mockLogAudit.mockResolvedValue(undefined as any);
  });

  it("sendTicketCreatedEmail sends to contact_email with ticket number in payload (Req 9.1)", async () => {
    await fc.assert(
      fc.asyncProperty(arbTicketParts, async (parts) => {
        mockSendEmail.mockClear();
        mockSendEmail.mockResolvedValue(undefined as any);

        const ticket = buildTicket(parts);
        await sendTicketCreatedEmail(fakeDb, ticket);

        expect(mockSendEmail).toHaveBeenCalledOnce();
        const call = mockSendEmail.mock.calls[0][0];

        // Recipient must be the contact email
        expect(call.to).toBe(ticket.contactEmail);

        // Ticket number must appear in the email subject or HTML body
        const payload = `${call.subject}${call.html}`;
        expect(payload).toContain(ticket.ticketNumber);
      }),
      { numRuns: 20 },
    );
  });

  it("sendTicketAssignedEmail sends to assignee email with ticket number in payload (Req 9.2)", async () => {
    await fc.assert(
      fc.asyncProperty(arbTicketParts, arbEmail, async (parts, assigneeEmail) => {
        mockSendEmail.mockClear();
        mockSendEmail.mockResolvedValue(undefined as any);

        const ticket = buildTicket(parts);
        await sendTicketAssignedEmail(fakeDb, ticket, assigneeEmail);

        expect(mockSendEmail).toHaveBeenCalledOnce();
        const call = mockSendEmail.mock.calls[0][0];

        // Recipient must be the assignee email, not the contact
        expect(call.to).toBe(assigneeEmail);

        // Ticket number must appear in the email subject or HTML body
        const payload = `${call.subject}${call.html}`;
        expect(payload).toContain(ticket.ticketNumber);
      }),
      { numRuns: 20 },
    );
  });

  it("sendTicketResolvedEmail sends to contact_email with ticket number in payload (Req 9.3)", async () => {
    await fc.assert(
      fc.asyncProperty(arbTicketParts, async (parts) => {
        mockSendEmail.mockClear();
        mockSendEmail.mockResolvedValue(undefined as any);

        const ticket = buildTicket(parts);
        await sendTicketResolvedEmail(fakeDb, ticket);

        expect(mockSendEmail).toHaveBeenCalledOnce();
        const call = mockSendEmail.mock.calls[0][0];

        // Recipient must be the contact email
        expect(call.to).toBe(ticket.contactEmail);

        // Ticket number must appear in the email subject or HTML body
        const payload = `${call.subject}${call.html}`;
        expect(payload).toContain(ticket.ticketNumber);
      }),
      { numRuns: 20 },
    );
  });

  it("sendTicketClosedEmail sends to contact_email with ticket number in payload (Req 9.4)", async () => {
    await fc.assert(
      fc.asyncProperty(arbTicketParts, async (parts) => {
        mockSendEmail.mockClear();
        mockSendEmail.mockResolvedValue(undefined as any);

        const ticket = buildTicket(parts);
        await sendTicketClosedEmail(fakeDb, ticket);

        expect(mockSendEmail).toHaveBeenCalledOnce();
        const call = mockSendEmail.mock.calls[0][0];

        // Recipient must be the contact email
        expect(call.to).toBe(ticket.contactEmail);

        // Ticket number must appear in the email subject or HTML body
        const payload = `${call.subject}${call.html}`;
        expect(payload).toContain(ticket.ticketNumber);
      }),
      { numRuns: 20 },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 13: Notification failure does not block ticket operation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 9.6**
 *
 * Property 13: Notification failure does not block ticket operation
 *
 * For any ticket operation where the email notification fails (throws an
 * error), the ticket operation itself should still complete successfully,
 * and an audit_log entry with entity_type "notification" should be created
 * recording the failure.
 */
// Feature: support-ticketing-system, Property 13: Notification failure does not block ticket operation
describe("Feature: support-ticketing-system, Property 13: Notification failure does not block ticket operation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogAudit.mockResolvedValue(undefined as any);
  });

  /** Arbitrary for a random error message. */
  const arbErrorMessage = fc.stringMatching(/^[a-zA-Z0-9 ]{1,50}$/);

  it("sendTicketCreatedEmail does not throw when sendEmail fails, and logs audit entry (Req 9.6)", async () => {
    await fc.assert(
      fc.asyncProperty(arbTicketParts, arbErrorMessage, async (parts, errMsg) => {
        mockSendEmail.mockClear();
        mockLogAudit.mockClear();
        mockSendEmail.mockRejectedValue(new Error(errMsg));
        mockLogAudit.mockResolvedValue(undefined as any);

        const ticket = buildTicket(parts);

        // The notification function must NOT throw
        await expect(sendTicketCreatedEmail(fakeDb, ticket)).resolves.toBeUndefined();

        // An audit_log entry with entity_type "notification" must be created
        expect(mockLogAudit).toHaveBeenCalledOnce();
        const auditCall = mockLogAudit.mock.calls[0];
        expect(auditCall[1]).toMatchObject({
          entityType: "notification",
          entityId: ticket.id,
        });
        // The summary should contain the error message
        expect(auditCall[1].summary).toContain(errMsg);
      }),
      { numRuns: 20 },
    );
  });

  it("sendTicketAssignedEmail does not throw when sendEmail fails, and logs audit entry (Req 9.6)", async () => {
    await fc.assert(
      fc.asyncProperty(arbTicketParts, arbEmail, arbErrorMessage, async (parts, assigneeEmail, errMsg) => {
        mockSendEmail.mockClear();
        mockLogAudit.mockClear();
        mockSendEmail.mockRejectedValue(new Error(errMsg));
        mockLogAudit.mockResolvedValue(undefined as any);

        const ticket = buildTicket(parts);

        // The notification function must NOT throw
        await expect(sendTicketAssignedEmail(fakeDb, ticket, assigneeEmail)).resolves.toBeUndefined();

        // An audit_log entry with entity_type "notification" must be created
        expect(mockLogAudit).toHaveBeenCalledOnce();
        const auditCall = mockLogAudit.mock.calls[0];
        expect(auditCall[1]).toMatchObject({
          entityType: "notification",
          entityId: ticket.id,
        });
        // The summary should contain the error message
        expect(auditCall[1].summary).toContain(errMsg);
      }),
      { numRuns: 20 },
    );
  });

  it("sendTicketResolvedEmail does not throw when sendEmail fails, and logs audit entry (Req 9.6)", async () => {
    await fc.assert(
      fc.asyncProperty(arbTicketParts, arbErrorMessage, async (parts, errMsg) => {
        mockSendEmail.mockClear();
        mockLogAudit.mockClear();
        mockSendEmail.mockRejectedValue(new Error(errMsg));
        mockLogAudit.mockResolvedValue(undefined as any);

        const ticket = buildTicket(parts);

        // The notification function must NOT throw
        await expect(sendTicketResolvedEmail(fakeDb, ticket)).resolves.toBeUndefined();

        // An audit_log entry with entity_type "notification" must be created
        expect(mockLogAudit).toHaveBeenCalledOnce();
        const auditCall = mockLogAudit.mock.calls[0];
        expect(auditCall[1]).toMatchObject({
          entityType: "notification",
          entityId: ticket.id,
        });
        // The summary should contain the error message
        expect(auditCall[1].summary).toContain(errMsg);
      }),
      { numRuns: 20 },
    );
  });

  it("sendTicketClosedEmail does not throw when sendEmail fails, and logs audit entry (Req 9.6)", async () => {
    await fc.assert(
      fc.asyncProperty(arbTicketParts, arbErrorMessage, async (parts, errMsg) => {
        mockSendEmail.mockClear();
        mockLogAudit.mockClear();
        mockSendEmail.mockRejectedValue(new Error(errMsg));
        mockLogAudit.mockResolvedValue(undefined as any);

        const ticket = buildTicket(parts);

        // The notification function must NOT throw
        await expect(sendTicketClosedEmail(fakeDb, ticket)).resolves.toBeUndefined();

        // An audit_log entry with entity_type "notification" must be created
        expect(mockLogAudit).toHaveBeenCalledOnce();
        const auditCall = mockLogAudit.mock.calls[0];
        expect(auditCall[1]).toMatchObject({
          entityType: "notification",
          entityId: ticket.id,
        });
        // The summary should contain the error message
        expect(auditCall[1].summary).toContain(errMsg);
      }),
      { numRuns: 20 },
    );
  });
});
