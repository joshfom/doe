import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Database } from "../db";

// ── Mock modules ─────────────────────────────────────────────────────────────

vi.mock("./identity", () => ({
  resolveIdentityByPhone: vi.fn(),
  resolveIdentityByEmail: vi.fn(),
  resolveIdentityBySession: vi.fn(),
}));

vi.mock("./language", () => ({
  detectLanguage: vi.fn(),
}));

vi.mock("./scope", () => ({
  isWithinScope: vi.fn(),
  loadScopeConfig: vi.fn(),
}));

vi.mock("./rag", () => ({
  processQuery: vi.fn(),
}));

vi.mock("./actions", () => ({
  bookAppointment: vi.fn(),
  lookupClientAccount: vi.fn(),
}));

vi.mock("./otp", () => ({
  handleOtpGate: vi.fn(),
}));

import { handleChatMessage } from "./chat";
import {
  resolveIdentityByPhone,
  resolveIdentityByEmail,
  resolveIdentityBySession,
} from "./identity";
import { detectLanguage } from "./language";
import { isWithinScope, loadScopeConfig } from "./scope";
import { processQuery } from "./rag";
import { lookupClientAccount } from "./actions";
import { handleOtpGate } from "./otp";

// ── Mock DB helper ───────────────────────────────────────────────────────────

/**
 * Creates a mock database that supports select, insert, and update chains.
 * - select().from().where().orderBy().limit() returns queued results
 * - insert().values().returning() returns queued insert results
 * - update().set().where() resolves
 */
function createMockDb(options: {
  selectResults?: unknown[][];
  insertResults?: unknown[][];
}) {
  let selectIndex = 0;
  let insertIndex = 0;

  const mockDb = {
    select: vi.fn().mockImplementation(() => {
      const result = options.selectResults?.[selectIndex] ?? [];
      selectIndex++;
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(result),
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(result),
            }),
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
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    })),
  };

  return mockDb as unknown as Database;
}

// ── Setup ────────────────────────────────────────────────────────────────────

const defaultScopeConfig = {
  permittedCategories: [],
  blockedKeywords: [],
};

const defaultRagResult = {
  response: "Here is some information about ORA properties.",
  retrievedDocuments: [
    {
      id: "emb-1",
      documentId: "doc-1",
      title: "ORA Community Guide",
      chunkText: "ORA offers premium amenities...",
      chunkIndex: 0,
      locale: "en",
      category: "community",
      similarity: 0.85,
    },
  ],
  language: "en" as const,
};

beforeEach(() => {
  vi.clearAllMocks();

  // Default mock implementations
  vi.mocked(detectLanguage).mockReturnValue("en");
  vi.mocked(loadScopeConfig).mockResolvedValue(defaultScopeConfig);
  vi.mocked(isWithinScope).mockReturnValue(true);
  vi.mocked(processQuery).mockResolvedValue(defaultRagResult);
  vi.mocked(resolveIdentityByPhone).mockResolvedValue({
    type: "visitor",
    units: [],
  });
  vi.mocked(resolveIdentityByEmail).mockResolvedValue({
    type: "visitor",
    units: [],
  });
  vi.mocked(resolveIdentityBySession).mockResolvedValue({
    type: "visitor",
    units: [],
  });
  vi.mocked(handleOtpGate).mockResolvedValue({
    action: "proceed",
    queryCategory: "general",
  });
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("handleChatMessage", () => {
  describe("conversation creation", () => {
    it("creates a new conversation when no conversationId is provided", async () => {
      const db = createMockDb({
        insertResults: [[{ id: "conv-new" }]],
      });

      const result = await handleChatMessage(db, {
        message: "Hello, tell me about ORA",
      });

      expect(result.conversationId).toBe("conv-new");
      expect(result.language).toBe("en");
      expect(result.identityType).toBe("visitor");
      expect(db.insert).toHaveBeenCalled();
    });

    it("loads existing conversation when conversationId is provided", async () => {
      const db = createMockDb({
        selectResults: [
          // First select: load conversation
          [{ id: "conv-existing", language: "en", status: "active" }],
          // Second select: load messages (last 10)
          [
            { role: "user", content: "Previous question" },
            { role: "assistant", content: "Previous answer" },
          ],
        ],
      });

      const result = await handleChatMessage(db, {
        message: "Follow up question",
        conversationId: "conv-existing",
      });

      expect(result.conversationId).toBe("conv-existing");
      // processQuery should have been called with conversation history
      expect(processQuery).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          conversationHistory: expect.arrayContaining([
            expect.objectContaining({ role: "user", content: "Previous question" }),
          ]),
        })
      );
    });

    it("creates a new conversation when provided conversationId is not found", async () => {
      const db = createMockDb({
        selectResults: [
          // First select: conversation not found
          [],
        ],
        insertResults: [[{ id: "conv-fallback" }]],
      });

      const result = await handleChatMessage(db, {
        message: "Hello",
        conversationId: "nonexistent-id",
      });

      expect(result.conversationId).toBe("conv-fallback");
    });
  });

  describe("identity resolution", () => {
    it("resolves identity by userId (session)", async () => {
      vi.mocked(resolveIdentityBySession).mockResolvedValue({
        type: "client",
        clientId: "client-1",
        firstName: "John",
        units: [],
      });

      const db = createMockDb({
        insertResults: [[{ id: "conv-1" }]],
      });

      const result = await handleChatMessage(db, {
        message: "Hello",
        userId: "user-1",
      });

      expect(resolveIdentityBySession).toHaveBeenCalledWith(db, "user-1");
      expect(result.identityType).toBe("client");
    });

    it("resolves identity by phone", async () => {
      vi.mocked(resolveIdentityByPhone).mockResolvedValue({
        type: "tenant",
        tenantId: "tenant-1",
        firstName: "Sara",
        units: [],
      });

      const db = createMockDb({
        insertResults: [[{ id: "conv-1" }]],
      });

      const result = await handleChatMessage(db, {
        message: "Hello",
        phone: "+971501234567",
      });

      expect(resolveIdentityByPhone).toHaveBeenCalledWith(db, "+971501234567");
      expect(result.identityType).toBe("tenant");
    });

    it("resolves identity by email", async () => {
      vi.mocked(resolveIdentityByEmail).mockResolvedValue({
        type: "client",
        clientId: "client-2",
        firstName: "Ahmed",
        units: [],
      });

      const db = createMockDb({
        insertResults: [[{ id: "conv-1" }]],
      });

      const result = await handleChatMessage(db, {
        message: "Hello",
        email: "ahmed@example.com",
      });

      expect(resolveIdentityByEmail).toHaveBeenCalledWith(
        db,
        "ahmed@example.com"
      );
      expect(result.identityType).toBe("client");
    });

    it("defaults to visitor when no identification is provided", async () => {
      const db = createMockDb({
        insertResults: [[{ id: "conv-1" }]],
      });

      const result = await handleChatMessage(db, {
        message: "Hello",
      });

      expect(resolveIdentityBySession).not.toHaveBeenCalled();
      expect(resolveIdentityByPhone).not.toHaveBeenCalled();
      expect(resolveIdentityByEmail).not.toHaveBeenCalled();
      expect(result.identityType).toBe("visitor");
    });

    it("prefers userId over phone and email for identity resolution", async () => {
      vi.mocked(resolveIdentityBySession).mockResolvedValue({
        type: "client",
        clientId: "client-1",
        firstName: "John",
        units: [],
      });

      const db = createMockDb({
        insertResults: [[{ id: "conv-1" }]],
      });

      await handleChatMessage(db, {
        message: "Hello",
        userId: "user-1",
        phone: "+971501234567",
        email: "john@example.com",
      });

      expect(resolveIdentityBySession).toHaveBeenCalled();
      expect(resolveIdentityByPhone).not.toHaveBeenCalled();
      expect(resolveIdentityByEmail).not.toHaveBeenCalled();
    });
  });

  describe("language detection", () => {
    it("detects English language", async () => {
      vi.mocked(detectLanguage).mockReturnValue("en");

      const db = createMockDb({
        insertResults: [[{ id: "conv-1" }]],
      });

      const result = await handleChatMessage(db, {
        message: "Tell me about ORA properties",
      });

      expect(detectLanguage).toHaveBeenCalledWith("Tell me about ORA properties");
      expect(result.language).toBe("en");
    });

    it("detects Arabic language", async () => {
      vi.mocked(detectLanguage).mockReturnValue("ar");
      vi.mocked(processQuery).mockResolvedValue({
        ...defaultRagResult,
        language: "ar",
      });

      const db = createMockDb({
        insertResults: [[{ id: "conv-1" }]],
      });

      const result = await handleChatMessage(db, {
        message: "أخبرني عن عقارات أورا",
      });

      expect(result.language).toBe("ar");
    });
  });

  describe("scope boundary enforcement", () => {
    it("returns decline message when query is out of scope", async () => {
      vi.mocked(isWithinScope).mockReturnValue(false);

      const db = createMockDb({
        insertResults: [[{ id: "conv-1" }]],
      });

      const result = await handleChatMessage(db, {
        message: "What is the weather today?",
      });

      expect(result.message).toContain("outside the scope");
      expect(result.metadata?.retrievedDocIds).toEqual([]);
      // processQuery should NOT be called for out-of-scope queries
      expect(processQuery).not.toHaveBeenCalled();
    });

    it("returns Arabic decline message when language is Arabic and out of scope", async () => {
      vi.mocked(isWithinScope).mockReturnValue(false);
      vi.mocked(detectLanguage).mockReturnValue("ar");

      const db = createMockDb({
        insertResults: [[{ id: "conv-1" }]],
      });

      const result = await handleChatMessage(db, {
        message: "ما هو الطقس اليوم؟",
      });

      expect(result.message).toContain("خارج نطاق");
      expect(result.language).toBe("ar");
    });
  });

  describe("action intent detection", () => {
    it("detects booking intent from keywords", async () => {
      const db = createMockDb({
        insertResults: [[{ id: "conv-1" }]],
      });

      const result = await handleChatMessage(db, {
        message: "I want to book an appointment for a site visit",
      });

      // Booking intent now routes to the agent's executeCreateBooking,
      // which short-circuits and asks for contact info before any booking.
      expect(result.metadata?.actionPerformed).toBe("create_booking");
    });

    it("detects account lookup intent and augments with account data", async () => {
      vi.mocked(resolveIdentityByPhone).mockResolvedValue({
        type: "client",
        clientId: "client-1",
        firstName: "John",
        units: [],
      });

      vi.mocked(lookupClientAccount).mockResolvedValue({
        type: "client",
        clientId: "client-1",
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
        phone: "+971501234567",
        units: [
          {
            id: "unit-1",
            projectName: "ORA Tower",
            unitNumber: "A-101",
            unitType: "apartment",
            floorNumber: 10,
            areaSqm: 120,
            status: "sold",
            constructionProgress: 75,
            estimatedHandoverDate: "2025-12-01",
          },
        ],
      });

      const db = createMockDb({
        insertResults: [[{ id: "conv-1" }]],
      });

      const result = await handleChatMessage(db, {
        message: "What is my account status?",
        phone: "+971501234567",
      });

      expect(lookupClientAccount).toHaveBeenCalled();
      expect(result.metadata?.actionPerformed).toBe("account_lookup");
    });

    it("does not perform account lookup for visitors", async () => {
      const db = createMockDb({
        insertResults: [[{ id: "conv-1" }]],
      });

      const result = await handleChatMessage(db, {
        message: "What is my account status?",
      });

      expect(lookupClientAccount).not.toHaveBeenCalled();
    });

    it("detects both booking and account intents", async () => {
      vi.mocked(resolveIdentityByPhone).mockResolvedValue({
        type: "client",
        clientId: "client-1",
        firstName: "John",
        units: [],
      });

      vi.mocked(lookupClientAccount).mockResolvedValue({
        type: "client",
        clientId: "client-1",
        firstName: "John",
        lastName: "Doe",
        units: [],
      });

      const db = createMockDb({
        insertResults: [[{ id: "conv-1" }]],
      });

      const result = await handleChatMessage(db, {
        message: "I want to book a meeting about my account",
        phone: "+971501234567",
      });

      // Agent intercepts booking intent before account-lookup branch runs.
      expect(result.metadata?.actionPerformed).toBe("create_booking");
    });
  });

  describe("response generation", () => {
    it("does not include source attribution in user-visible response", async () => {
      const db = createMockDb({
        insertResults: [[{ id: "conv-1" }]],
      });

      const result = await handleChatMessage(db, {
        message: "Tell me about ORA community",
      });

      expect(result.message).not.toContain("Sources:");
      expect(result.message).not.toContain("المصادر");
    });

    it("returns retrieved document IDs in metadata", async () => {
      const db = createMockDb({
        insertResults: [[{ id: "conv-1" }]],
      });

      const result = await handleChatMessage(db, {
        message: "Tell me about ORA",
      });

      expect(result.metadata?.retrievedDocIds).toEqual(["doc-1"]);
    });

    it("handles response with no retrieved documents", async () => {
      vi.mocked(processQuery).mockResolvedValue({
        response: "I don't have specific information about that.",
        retrievedDocuments: [],
        language: "en",
      });

      const db = createMockDb({
        insertResults: [[{ id: "conv-1" }]],
      });

      const result = await handleChatMessage(db, {
        message: "Tell me something",
      });

      expect(result.message).toBe(
        "I don't have specific information about that."
      );
      expect(result.message).not.toContain("Sources:");
      expect(result.metadata?.retrievedDocIds).toEqual([]);
    });

    it("deduplicates source titles in attribution", async () => {
      vi.mocked(processQuery).mockResolvedValue({
        response: "Here is info.",
        retrievedDocuments: [
          {
            id: "emb-1",
            documentId: "doc-1",
            title: "FAQ",
            chunkText: "chunk 1",
            chunkIndex: 0,
            locale: "en",
            category: "faq",
            similarity: 0.9,
          },
          {
            id: "emb-2",
            documentId: "doc-1",
            title: "FAQ",
            chunkText: "chunk 2",
            chunkIndex: 1,
            locale: "en",
            category: "faq",
            similarity: 0.8,
          },
        ],
        language: "en",
      });

      const db = createMockDb({
        insertResults: [[{ id: "conv-1" }]],
      });

      const result = await handleChatMessage(db, {
        message: "FAQ question",
      });

      // Sources should not appear in user-visible message
      expect(result.message).toBe("Here is info.");
    });
  });

  describe("OTP gate integration", () => {
    it("personal query from unverified client triggers OTP prompt instead of RAG", async () => {
      vi.mocked(resolveIdentityByPhone).mockResolvedValue({
        type: "client",
        clientId: "client-1",
        firstName: "John",
        units: [],
      });

      vi.mocked(handleOtpGate).mockResolvedValue({
        action: "respond",
        response:
          "I need to verify your identity before sharing personal account details. Shall I send an OTP to your registered email?",
        queryCategory: "personal",
      });

      const db = createMockDb({
        insertResults: [[{ id: "conv-1" }]],
      });

      const result = await handleChatMessage(db, {
        message: "What is my unit status?",
        phone: "+971501234567",
      });

      expect(result.message).toBe(
        "I need to verify your identity before sharing personal account details. Shall I send an OTP to your registered email?"
      );
      expect(processQuery).not.toHaveBeenCalled();
    });

    it("general query from unverified client proceeds to RAG normally", async () => {
      vi.mocked(resolveIdentityByPhone).mockResolvedValue({
        type: "client",
        clientId: "client-1",
        firstName: "John",
        units: [],
      });

      vi.mocked(handleOtpGate).mockResolvedValue({
        action: "proceed",
        queryCategory: "general",
      });

      const db = createMockDb({
        insertResults: [[{ id: "conv-1" }]],
      });

      const result = await handleChatMessage(db, {
        message: "Tell me about ORA communities",
        phone: "+971501234567",
      });

      expect(processQuery).toHaveBeenCalled();
      expect(result.message).not.toContain("Sources:");
    });

    it("personal query from verified client proceeds to RAG normally", async () => {
      vi.mocked(resolveIdentityByPhone).mockResolvedValue({
        type: "client",
        clientId: "client-1",
        firstName: "John",
        units: [],
      });

      vi.mocked(handleOtpGate).mockResolvedValue({
        action: "proceed",
        queryCategory: "personal",
      });

      const db = createMockDb({
        insertResults: [[{ id: "conv-1" }]],
      });

      const result = await handleChatMessage(db, {
        message: "What is my unit status?",
        phone: "+971501234567",
      });

      expect(processQuery).toHaveBeenCalled();
      expect(result.message).toContain("ORA");
    });

    it("sensitive query triggers escalation and does not reach RAG", async () => {
      vi.mocked(resolveIdentityByPhone).mockResolvedValue({
        type: "client",
        clientId: "client-1",
        firstName: "John",
        units: [],
      });

      vi.mocked(handleOtpGate).mockResolvedValue({
        action: "respond",
        response:
          "A support ticket has been created for your request. A human agent will follow up shortly. Your ticket reference is TKT-001.",
        queryCategory: "sensitive",
      });

      const db = createMockDb({
        insertResults: [[{ id: "conv-1" }]],
      });

      const result = await handleChatMessage(db, {
        message: "I want a refund for my payment",
        phone: "+971501234567",
      });

      expect(result.message).toContain("support ticket has been created");
      expect(result.message).toContain("TKT-001");
      expect(processQuery).not.toHaveBeenCalled();
    });
  });
});
