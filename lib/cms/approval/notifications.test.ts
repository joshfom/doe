import { describe, it, expect, vi, beforeEach } from "vitest";
import { notifyApproverAtStep } from "./notifications";

// Mock nodemailer
vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn().mockResolvedValue(undefined),
    })),
  },
}));

// Mock audit
vi.mock("../audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

import { logAudit } from "../audit";

/**
 * Helper to create a mock database that returns controlled query results.
 */
function createMockDb(options: {
  config?: { id: string } | null;
  approver?: { userId: string; name: string; email: string } | null;
  totalSteps?: number;
  contentTitle?: string;
  submitterName?: string;
}) {
  const {
    config = { id: "config-1" },
    approver = { userId: "user-1", name: "Alice", email: "alice@example.com" },
    totalSteps = 3,
    contentTitle = "Test Page",
    submitterName = "Bob",
  } = options;

  // Track which queries have been made to return appropriate results
  let queryCount = 0;

  const mockDb = {
    select: vi.fn(() => {
      queryCount++;
      return mockDb;
    }),
    from: vi.fn(() => mockDb),
    where: vi.fn(() => mockDb),
    innerJoin: vi.fn(() => mockDb),
    limit: vi.fn(() => {
      // Return results based on query order:
      // 1st query: approvalConfig lookup
      // 2nd query: approver at position lookup
      // 3rd query: total chain length (no limit)
      // 4th query: content title
      // 5th query: submitter name
      const currentQuery = queryCount;
      if (currentQuery === 1) return config ? [config] : [];
      if (currentQuery === 2) return approver ? [approver] : [];
      if (currentQuery === 4) return contentTitle ? [{ title: contentTitle }] : [];
      if (currentQuery === 5) return submitterName ? [{ name: submitterName }] : [];
      return [];
    }),
  };

  // Override for the count query (3rd query - no limit call)
  const originalFrom = mockDb.from;
  let fromCallCount = 0;
  mockDb.from = vi.fn((...args: unknown[]) => {
    fromCallCount++;
    // The 3rd from() call is the count query which doesn't have .limit()
    if (fromCallCount === 3) {
      return {
        where: vi.fn(() => [{ count: totalSteps }]),
      } as any;
    }
    return originalFrom.call(mockDb, ...args);
  }) as any;

  return mockDb as any;
}

describe("notifyApproverAtStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set SMTP env vars so sendEmail doesn't skip
    process.env.SMTP_HOST = "smtp.test.com";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "user";
    process.env.SMTP_PASS = "pass";
    process.env.SMTP_FROM = "noreply@test.com";
  });

  it("should not throw when config is not found", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    } as any;

    const request = {
      id: "req-1",
      contentId: "page-1",
      contentModule: "pages",
      submitterId: "submitter-1",
      status: "pending",
    };

    // Should not throw
    await expect(
      notifyApproverAtStep(mockDb, "pages", 1, request)
    ).resolves.toBeUndefined();
  });

  it("should not throw when approver at position is not found", async () => {
    let selectCount = 0;
    const mockDb = {
      select: vi.fn(() => {
        selectCount++;
        return mockDb;
      }),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      limit: vi.fn(() => {
        // 1st: config found, 2nd: approver not found
        if (selectCount === 1) return [{ id: "config-1" }];
        return [];
      }),
    } as any;

    const request = {
      id: "req-1",
      contentId: "page-1",
      contentModule: "pages",
      submitterId: "submitter-1",
      status: "pending",
    };

    await expect(
      notifyApproverAtStep(mockDb, "pages", 5, request)
    ).resolves.toBeUndefined();
  });

  it("should catch and log errors without throwing", async () => {
    // Create a db that throws on the first query
    const mockDb = {
      select: vi.fn(() => {
        throw new Error("Database connection failed");
      }),
    } as any;

    const request = {
      id: "req-1",
      contentId: "page-1",
      contentModule: "pages",
      submitterId: "submitter-1",
      status: "pending",
    };

    // Should not throw — errors are caught and logged
    await expect(
      notifyApproverAtStep(mockDb, "pages", 1, request)
    ).resolves.toBeUndefined();

    // Should have attempted to log the failure
    expect(logAudit).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        entityType: "notification",
        entityId: "req-1",
        summary: expect.stringContaining("Database connection failed"),
      })
    );
  });
});
