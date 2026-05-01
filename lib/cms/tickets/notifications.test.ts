import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "ticket-uuid-1",
    ticketNumber: "ORA-000042",
    subject: "Cannot access my account",
    description: "I am locked out of my account",
    status: "open",
    priority: "medium",
    category: "technical",
    requestType: "general_inquiry",
    communityId: null,
    projectId: null,
    unitNumber: null,
    requestData: null,
    scheduledStart: null,
    scheduledEnd: null,
    contactName: "Jane Doe",
    contactEmail: "jane@example.com",
    contactPhone: null,
    source: "manual",
    assigneeId: null,
    createdBy: "user-uuid-1",
    externalCrmId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    resolvedAt: null,
    closedAt: null,
    ...overrides,
  };
}

const fakeDb = {} as Database;

describe("Ticket Notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── sendTicketCreatedEmail ───────────────────────────────────────────────

  describe("sendTicketCreatedEmail", () => {
    it("sends confirmation email to contact_email with ticket number and subject", async () => {
      const ticket = makeTicket();
      await sendTicketCreatedEmail(fakeDb, ticket);

      expect(mockSendEmail).toHaveBeenCalledOnce();
      const call = mockSendEmail.mock.calls[0][0];
      expect(call.to).toBe("jane@example.com");
      expect(call.subject).toContain("ORA-000042");
      expect(call.html).toContain("ORA-000042");
      expect(call.html).toContain("Cannot access my account");
    });

    it("logs to audit_log on email failure and does not throw", async () => {
      mockSendEmail.mockRejectedValueOnce(new Error("SMTP down"));
      const ticket = makeTicket();

      await expect(
        sendTicketCreatedEmail(fakeDb, ticket)
      ).resolves.toBeUndefined();

      expect(mockLogAudit).toHaveBeenCalledOnce();
      const auditCall = mockLogAudit.mock.calls[0];
      expect(auditCall[1].entityType).toBe("notification");
      expect(auditCall[1].entityId).toBe("ticket-uuid-1");
      expect(auditCall[1].summary).toContain("Failed to send");
      expect(auditCall[1].summary).toContain("SMTP down");
    });

    it("does not throw even if audit logging also fails", async () => {
      mockSendEmail.mockRejectedValueOnce(new Error("SMTP down"));
      mockLogAudit.mockRejectedValueOnce(new Error("DB down"));
      const ticket = makeTicket();

      await expect(
        sendTicketCreatedEmail(fakeDb, ticket)
      ).resolves.toBeUndefined();
    });

    it("uses 'system' as userId when createdBy is null", async () => {
      mockSendEmail.mockRejectedValueOnce(new Error("fail"));
      const ticket = makeTicket({ createdBy: null });

      await sendTicketCreatedEmail(fakeDb, ticket);

      expect(mockLogAudit).toHaveBeenCalledOnce();
      expect(mockLogAudit.mock.calls[0][1].userId).toBe("system");
    });
  });

  // ── sendTicketAssignedEmail ──────────────────────────────────────────────

  describe("sendTicketAssignedEmail", () => {
    it("sends notification email to assignee with ticket number and subject", async () => {
      const ticket = makeTicket({ assigneeId: "assignee-uuid" });
      await sendTicketAssignedEmail(fakeDb, ticket, "agent@example.com");

      expect(mockSendEmail).toHaveBeenCalledOnce();
      const call = mockSendEmail.mock.calls[0][0];
      expect(call.to).toBe("agent@example.com");
      expect(call.subject).toContain("ORA-000042");
      expect(call.html).toContain("ORA-000042");
      expect(call.html).toContain("Cannot access my account");
    });

    it("logs to audit_log on email failure and does not throw", async () => {
      mockSendEmail.mockRejectedValueOnce(new Error("Connection refused"));
      const ticket = makeTicket();

      await expect(
        sendTicketAssignedEmail(fakeDb, ticket, "agent@example.com")
      ).resolves.toBeUndefined();

      expect(mockLogAudit).toHaveBeenCalledOnce();
      expect(mockLogAudit.mock.calls[0][1].entityType).toBe("notification");
      expect(mockLogAudit.mock.calls[0][1].summary).toContain(
        "Connection refused"
      );
    });
  });

  // ── sendTicketResolvedEmail ──────────────────────────────────────────────

  describe("sendTicketResolvedEmail", () => {
    it("sends resolved notification to contact_email with ticket number", async () => {
      const ticket = makeTicket({ status: "resolved" });
      await sendTicketResolvedEmail(fakeDb, ticket);

      expect(mockSendEmail).toHaveBeenCalledOnce();
      const call = mockSendEmail.mock.calls[0][0];
      expect(call.to).toBe("jane@example.com");
      expect(call.subject).toContain("ORA-000042");
      expect(call.subject).toContain("resolved");
      expect(call.html).toContain("ORA-000042");
    });

    it("logs to audit_log on email failure and does not throw", async () => {
      mockSendEmail.mockRejectedValueOnce(new Error("Timeout"));
      const ticket = makeTicket();

      await expect(
        sendTicketResolvedEmail(fakeDb, ticket)
      ).resolves.toBeUndefined();

      expect(mockLogAudit).toHaveBeenCalledOnce();
      expect(mockLogAudit.mock.calls[0][1].entityType).toBe("notification");
    });
  });

  // ── sendTicketClosedEmail ────────────────────────────────────────────────

  describe("sendTicketClosedEmail", () => {
    it("sends closed notification to contact_email with ticket number", async () => {
      const ticket = makeTicket({ status: "closed" });
      await sendTicketClosedEmail(fakeDb, ticket);

      expect(mockSendEmail).toHaveBeenCalledOnce();
      const call = mockSendEmail.mock.calls[0][0];
      expect(call.to).toBe("jane@example.com");
      expect(call.subject).toContain("ORA-000042");
      expect(call.subject).toContain("closed");
      expect(call.html).toContain("ORA-000042");
    });

    it("logs to audit_log on email failure and does not throw", async () => {
      mockSendEmail.mockRejectedValueOnce(new Error("Auth failed"));
      const ticket = makeTicket();

      await expect(
        sendTicketClosedEmail(fakeDb, ticket)
      ).resolves.toBeUndefined();

      expect(mockLogAudit).toHaveBeenCalledOnce();
      expect(mockLogAudit.mock.calls[0][1].entityType).toBe("notification");
      expect(mockLogAudit.mock.calls[0][1].summary).toContain("Auth failed");
    });

    it("does not throw even if audit logging also fails", async () => {
      mockSendEmail.mockRejectedValueOnce(new Error("SMTP down"));
      mockLogAudit.mockRejectedValueOnce(new Error("DB down"));
      const ticket = makeTicket();

      await expect(
        sendTicketClosedEmail(fakeDb, ticket)
      ).resolves.toBeUndefined();
    });
  });
});
