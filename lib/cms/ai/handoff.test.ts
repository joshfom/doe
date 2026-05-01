import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Database } from "../db";
import { detectHandoffNeed, initiateHandoff } from "./handoff";
import type { Message } from "./handoff";

// ── Mock DB helper ───────────────────────────────────────────────────────────

/**
 * Creates a mock database that supports chained select/insert/update.
 * Each call to a top-level method consumes the next result in the queue.
 */
function createMockDb(options: {
  selectResults?: unknown[][];
  insertResults?: unknown[][];
  updateResults?: unknown[][];
}) {
  let selectIndex = 0;
  let insertIndex = 0;
  let updateIndex = 0;

  const mockDb = {
    select: vi.fn().mockImplementation(() => {
      const result = options.selectResults?.[selectIndex] ?? [];
      selectIndex++;
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(result),
            }),
            limit: vi.fn().mockResolvedValue(result),
          }),
        }),
      };
    }),
    insert: vi.fn().mockImplementation(() => {
      const result = options.insertResults?.[insertIndex] ?? [];
      insertIndex++;
      return {
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(result),
          then: (resolve: (v: unknown) => void) => resolve(undefined),
          [Symbol.toStringTag]: "Promise",
        }),
      };
    }),
    update: vi.fn().mockImplementation(() => {
      const result = options.updateResults?.[updateIndex] ?? [];
      updateIndex++;
      return {
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(result),
        }),
      };
    }),
  };

  return mockDb as unknown as Database;
}

// ── detectHandoffNeed tests ──────────────────────────────────────────────────

describe("detectHandoffNeed", () => {
  it("returns false for empty messages array", () => {
    expect(detectHandoffNeed([])).toBe(false);
  });

  it("returns false for normal conversation without handoff phrases", () => {
    const messages: Message[] = [
      { role: "user", content: "Tell me about ORA properties" },
      { role: "assistant", content: "ORA offers premium villas and apartments." },
      { role: "user", content: "What are the prices?" },
      { role: "assistant", content: "Prices start from..." },
    ];
    expect(detectHandoffNeed(messages)).toBe(false);
  });

  describe("explicit handoff request detection", () => {
    it('detects "speak to human"', () => {
      const messages: Message[] = [
        { role: "user", content: "I want to speak to human please" },
      ];
      expect(detectHandoffNeed(messages)).toBe(true);
    });

    it('detects "talk to agent"', () => {
      const messages: Message[] = [
        { role: "user", content: "Can I talk to agent?" },
      ];
      expect(detectHandoffNeed(messages)).toBe(true);
    });

    it('detects "human agent"', () => {
      const messages: Message[] = [
        { role: "user", content: "I need a human agent" },
      ];
      expect(detectHandoffNeed(messages)).toBe(true);
    });

    it('detects "real person"', () => {
      const messages: Message[] = [
        { role: "user", content: "Let me talk to a real person" },
      ];
      expect(detectHandoffNeed(messages)).toBe(true);
    });

    it("detects handoff phrase regardless of case", () => {
      const messages: Message[] = [
        { role: "user", content: "I want to SPEAK TO HUMAN now" },
      ];
      expect(detectHandoffNeed(messages)).toBe(true);
    });

    it("detects handoff phrase in later messages", () => {
      const messages: Message[] = [
        { role: "user", content: "What are the prices?" },
        { role: "assistant", content: "Prices start from..." },
        { role: "user", content: "This is not helpful, talk to agent" },
      ];
      expect(detectHandoffNeed(messages)).toBe(true);
    });

    it("ignores handoff phrases in assistant messages", () => {
      const messages: Message[] = [
        { role: "assistant", content: "You can speak to human if needed" },
        { role: "user", content: "Tell me about the project" },
      ];
      expect(detectHandoffNeed(messages)).toBe(false);
    });
  });

  describe("repeated query detection", () => {
    it("detects repeated similar queries (word overlap > 60%)", () => {
      const messages: Message[] = [
        { role: "user", content: "What is the construction progress on my unit" },
        { role: "assistant", content: "I'm not sure about that." },
        { role: "user", content: "What is the construction progress on my villa" },
      ];
      expect(detectHandoffNeed(messages)).toBe(true);
    });

    it("does not flag dissimilar consecutive user messages", () => {
      const messages: Message[] = [
        { role: "user", content: "Tell me about ORA community amenities" },
        { role: "assistant", content: "ORA has a pool and gym." },
        { role: "user", content: "What are the payment methods available" },
      ];
      expect(detectHandoffNeed(messages)).toBe(false);
    });

    it("checks only user messages for overlap, ignoring assistant messages between them", () => {
      const messages: Message[] = [
        { role: "user", content: "How do I pay my rent online" },
        { role: "assistant", content: "You can pay through the portal." },
        { role: "user", content: "How do I pay my rent through bank" },
        { role: "assistant", content: "Bank transfers are also accepted." },
      ];
      // "How do I pay my rent online" vs "How do I pay my rent through bank"
      // Shared: how, do, i, pay, my, rent = 6 out of min(7, 8) = 6/7 ≈ 0.86 > 0.6
      expect(detectHandoffNeed(messages)).toBe(true);
    });

    it("does not flag a single user message as repeated", () => {
      const messages: Message[] = [
        { role: "user", content: "What is the construction progress" },
      ];
      expect(detectHandoffNeed(messages)).toBe(false);
    });
  });
});

// ── initiateHandoff tests ────────────────────────────────────────────────────

describe("initiateHandoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads recent messages, updates conversation status, and inserts system message", async () => {
    // Messages returned in DESC order (newest first) as the query uses orderBy(desc(createdAt))
    const recentMessages = [
      { role: "assistant", content: "I could not find that info.", createdAt: new Date("2025-01-01T10:02:00Z") },
      { role: "user", content: "What is my unit status?", createdAt: new Date("2025-01-01T10:01:00Z") },
      { role: "assistant", content: "How can I help?", createdAt: new Date("2025-01-01T10:00:00Z") },
    ];

    const db = createMockDb({
      selectResults: [recentMessages],
      updateResults: [[]],
      insertResults: [[]],
    });

    await initiateHandoff(db, "conv-1", "User requested human agent");

    // Verify select was called to load messages
    expect(db.select).toHaveBeenCalledTimes(1);

    // Verify update was called to set status to "handed_off"
    expect(db.update).toHaveBeenCalledTimes(1);

    // Verify insert was called to add system message
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("builds handoff summary with original query and attempted responses", async () => {
    // Messages returned in DESC order (newest first) as the query uses orderBy(desc(createdAt))
    const recentMessages = [
      { role: "assistant", content: "Let me try again.", createdAt: new Date("2025-01-01T10:03:00Z") },
      { role: "user", content: "That is not what I asked", createdAt: new Date("2025-01-01T10:02:00Z") },
      { role: "assistant", content: "I found some info about villas.", createdAt: new Date("2025-01-01T10:01:00Z") },
      { role: "user", content: "Tell me about my villa", createdAt: new Date("2025-01-01T10:00:00Z") },
    ];

    let capturedSetArg: any = null;
    const db = createMockDb({
      selectResults: [recentMessages],
      insertResults: [[]],
    });

    // Override update to capture the set argument
    db.update = vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((setArg: any) => {
        capturedSetArg = setArg;
        return {
          where: vi.fn().mockResolvedValue(undefined),
        };
      }),
    })) as any;

    await initiateHandoff(db, "conv-1", "Repeated queries detected");

    // Verify the handoff summary structure
    expect(capturedSetArg).toBeDefined();
    expect(capturedSetArg.status).toBe("handed_off");
    expect(capturedSetArg.handoffSummary).toBeDefined();
    expect(capturedSetArg.handoffSummary.originalQuery).toBe("Tell me about my villa");
    expect(capturedSetArg.handoffSummary.attemptedResponses).toEqual([
      "I found some info about villas.",
      "Let me try again.",
    ]);
    expect(capturedSetArg.handoffSummary.reason).toBe("Repeated queries detected");
    expect(capturedSetArg.handoffSummary.handoffAt).toBeDefined();
  });

  it("inserts a system message notifying the user of the transfer", async () => {
    const recentMessages = [
      { role: "user", content: "Help me", createdAt: new Date("2025-01-01T10:00:00Z") },
    ];

    let capturedInsertValues: any = null;
    const db = createMockDb({
      selectResults: [recentMessages],
      updateResults: [[]],
    });

    // Override insert to capture the values
    db.insert = vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation((vals: any) => {
        capturedInsertValues = vals;
        return {
          returning: vi.fn().mockResolvedValue([]),
          then: (resolve: (v: unknown) => void) => resolve(undefined),
          [Symbol.toStringTag]: "Promise",
        };
      }),
    })) as any;

    await initiateHandoff(db, "conv-1", "User requested");

    expect(capturedInsertValues).toBeDefined();
    expect(capturedInsertValues.conversationId).toBe("conv-1");
    expect(capturedInsertValues.role).toBe("system");
    expect(capturedInsertValues.content).toContain("transferred to a human agent");
  });

  it("handles empty message history gracefully", async () => {
    const db = createMockDb({
      selectResults: [[]],
      updateResults: [[]],
      insertResults: [[]],
    });

    // Should not throw even with no messages
    await expect(
      initiateHandoff(db, "conv-1", "No messages found")
    ).resolves.toBeUndefined();

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledTimes(1);
  });
});
