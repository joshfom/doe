import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Database } from "../db";
import type { IdentityResult } from "./identity";
import {
  retrieveContext,
  buildPrompt,
  processQuery,
  type RAGContext,
  type RetrievedDocument,
} from "./rag";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("./gateway", () => ({
  generateEmbedding: vi.fn(),
  generateCompletion: vi.fn(),
}));

import { generateEmbedding, generateCompletion } from "./gateway";

const mockGenerateEmbedding = generateEmbedding as ReturnType<typeof vi.fn>;
const mockGenerateCompletion = generateCompletion as ReturnType<typeof vi.fn>;

function createMockDb(rows: any[] = []): Database {
  return {
    execute: vi.fn().mockResolvedValue({ rows }),
  } as unknown as Database;
}

// ── retrieveContext tests ────────────────────────────────────────────────────

describe("retrieveContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("generates embedding for the query and executes similarity search", async () => {
    const fakeEmbedding = Array(768).fill(0.1);
    mockGenerateEmbedding.mockResolvedValue(fakeEmbedding);

    const mockRows = [
      {
        id: "emb-1",
        documentId: "doc-1",
        title: "ORA Tower FAQ",
        chunkText: "ORA Tower is a luxury residential building.",
        chunkIndex: 0,
        locale: "en",
        category: "faq",
        similarity: 0.92,
      },
    ];

    const db = createMockDb(mockRows);

    const results = await retrieveContext(db, "Tell me about ORA Tower", "en", 5, 0.5);

    expect(mockGenerateEmbedding).toHaveBeenCalledWith("Tell me about ORA Tower");
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
    expect(results[0].documentId).toBe("doc-1");
    expect(results[0].title).toBe("ORA Tower FAQ");
    expect(results[0].similarity).toBe(0.92);
  });

  it("returns empty array when no documents meet the threshold", async () => {
    mockGenerateEmbedding.mockResolvedValue(Array(768).fill(0));
    const db = createMockDb([]);

    const results = await retrieveContext(db, "random query", "en", 5, 0.8);

    expect(results).toEqual([]);
  });

  it("logs retrieved document IDs and similarity scores", async () => {
    const consoleSpy = vi.spyOn(console, "log");
    mockGenerateEmbedding.mockResolvedValue(Array(768).fill(0.1));

    const mockRows = [
      {
        id: "emb-1",
        documentId: "doc-1",
        title: "FAQ",
        chunkText: "text",
        chunkIndex: 0,
        locale: "en",
        category: null,
        similarity: 0.85,
      },
    ];

    const db = createMockDb(mockRows);
    await retrieveContext(db, "test", "en", 5, 0.5);

    expect(consoleSpy).toHaveBeenCalledWith(
      "[RAG] Retrieved documents:",
      expect.arrayContaining([
        expect.objectContaining({
          documentId: "doc-1",
          similarity: "0.8500",
        }),
      ])
    );
  });

  it("returns multiple documents with correct fields", async () => {
    mockGenerateEmbedding.mockResolvedValue(Array(768).fill(0.1));

    const mockRows = [
      {
        id: "emb-1",
        documentId: "doc-1",
        title: "Payment Guide",
        chunkText: "Payment methods include bank transfer.",
        chunkIndex: 0,
        locale: "en",
        category: "payments",
        similarity: 0.95,
      },
      {
        id: "emb-2",
        documentId: "doc-2",
        title: "دليل الدفع",
        chunkText: "طرق الدفع تشمل التحويل البنكي.",
        chunkIndex: 0,
        locale: "ar",
        category: "payments",
        similarity: 0.78,
      },
    ];

    const db = createMockDb(mockRows);
    const results = await retrieveContext(db, "payment options", "en", 5, 0.5);

    expect(results).toHaveLength(2);
    expect(results[0].locale).toBe("en");
    expect(results[1].locale).toBe("ar");
  });
});

// ── buildPrompt tests ────────────────────────────────────────────────────────

describe("buildPrompt", () => {
  it("includes system instructions and current query", () => {
    const context: RAGContext = {
      retrievedDocuments: [],
      conversationHistory: [],
      identityContext: null,
      language: "en",
      currentQuery: "What is ORA Tower?",
    };

    const prompt = buildPrompt(context);

    expect(prompt).toContain("You are ORA AI");
    expect(prompt).toContain("What is ORA Tower?");
    expect(prompt).toContain("Respond in English");
  });

  it("includes Arabic language instruction when language is ar", () => {
    const context: RAGContext = {
      retrievedDocuments: [],
      conversationHistory: [],
      identityContext: null,
      language: "ar",
      currentQuery: "ما هو برج أورا؟",
    };

    const prompt = buildPrompt(context);

    expect(prompt).toContain("Respond in Arabic");
    expect(prompt).toContain("ما هو برج أورا؟");
  });

  it("includes retrieved documents in the prompt", () => {
    const docs: RetrievedDocument[] = [
      {
        id: "emb-1",
        documentId: "doc-1",
        title: "ORA Tower FAQ",
        chunkText: "ORA Tower is a luxury residential building.",
        chunkIndex: 0,
        locale: "en",
        category: "faq",
        similarity: 0.92,
      },
    ];

    const context: RAGContext = {
      retrievedDocuments: docs,
      conversationHistory: [],
      identityContext: null,
      language: "en",
      currentQuery: "Tell me about ORA Tower",
    };

    const prompt = buildPrompt(context);

    expect(prompt).toContain("Knowledge Base Context");
    expect(prompt).toContain("[Source: ORA Tower FAQ]");
    expect(prompt).toContain("ORA Tower is a luxury residential building.");
  });

  it("includes identity context for identified clients", () => {
    const identity: IdentityResult = {
      type: "client",
      clientId: "client-1",
      firstName: "Ahmed",
      units: [
        {
          id: "unit-1",
          projectName: "ORA Tower",
          unitNumber: "A-101",
          unitType: "apartment",
          floorNumber: 10,
          areaSqm: 120,
          status: "under_construction",
          constructionProgress: 65,
          estimatedHandoverDate: "2025-12-01",
        },
      ],
    };

    const context: RAGContext = {
      retrievedDocuments: [],
      conversationHistory: [],
      identityContext: identity,
      language: "en",
      currentQuery: "What is my unit status?",
    };

    const prompt = buildPrompt(context);

    expect(prompt).toContain("User Identity");
    expect(prompt).toContain("Type: client");
    expect(prompt).toContain("Name: Ahmed");
    expect(prompt).toContain("ORA Tower A-101");
    expect(prompt).toContain("Progress: 65%");
    expect(prompt).toContain("Handover: 2025-12-01");
  });

  it("does not include identity section for visitors", () => {
    const identity: IdentityResult = {
      type: "visitor",
      units: [],
    };

    const context: RAGContext = {
      retrievedDocuments: [],
      conversationHistory: [],
      identityContext: identity,
      language: "en",
      currentQuery: "Hello",
    };

    const prompt = buildPrompt(context);

    expect(prompt).not.toContain("User Identity");
  });

  it("includes conversation history in the prompt", () => {
    const context: RAGContext = {
      retrievedDocuments: [],
      conversationHistory: [
        { role: "user", content: "Hi there" },
        { role: "assistant", content: "Hello! How can I help you?" },
      ],
      identityContext: null,
      language: "en",
      currentQuery: "Tell me about payments",
    };

    const prompt = buildPrompt(context);

    expect(prompt).toContain("Conversation History");
    expect(prompt).toContain("User: Hi there");
    expect(prompt).toContain("Assistant: Hello! How can I help you?");
  });

  it("does not include identity section when identityContext is null", () => {
    const context: RAGContext = {
      retrievedDocuments: [],
      conversationHistory: [],
      identityContext: null,
      language: "en",
      currentQuery: "Hello",
    };

    const prompt = buildPrompt(context);

    expect(prompt).not.toContain("User Identity");
  });
});

// ── processQuery tests ───────────────────────────────────────────────────────

describe("processQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("orchestrates the full RAG pipeline and returns response with metadata", async () => {
    mockGenerateEmbedding.mockResolvedValue(Array(768).fill(0.1));
    mockGenerateCompletion.mockResolvedValue(
      "ORA Tower is a luxury residential building in the heart of the city."
    );

    const mockRows = [
      {
        id: "emb-1",
        documentId: "doc-1",
        title: "ORA Tower FAQ",
        chunkText: "ORA Tower is a luxury residential building.",
        chunkIndex: 0,
        locale: "en",
        category: "faq",
        similarity: 0.92,
      },
    ];

    const db = createMockDb(mockRows);

    const result = await processQuery(db, {
      query: "Tell me about ORA Tower",
      language: "en",
    });

    expect(mockGenerateEmbedding).toHaveBeenCalledWith("Tell me about ORA Tower");
    expect(mockGenerateCompletion).toHaveBeenCalledTimes(1);
    expect(result.response).toContain("ORA Tower");
    expect(result.retrievedDocuments).toHaveLength(1);
    expect(result.language).toBe("en");
  });

  it("uses default topK and threshold when not provided", async () => {
    mockGenerateEmbedding.mockResolvedValue(Array(768).fill(0));
    mockGenerateCompletion.mockResolvedValue("Response");

    const db = createMockDb([]);

    await processQuery(db, {
      query: "test",
      language: "en",
    });

    // Verify the pipeline ran (embedding was generated, completion was called)
    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(1);
    expect(mockGenerateCompletion).toHaveBeenCalledTimes(1);
  });

  it("passes identity context through to the prompt", async () => {
    mockGenerateEmbedding.mockResolvedValue(Array(768).fill(0.1));
    mockGenerateCompletion.mockResolvedValue("Hi Ahmed, your unit is under construction.");

    const db = createMockDb([]);

    const identity: IdentityResult = {
      type: "client",
      clientId: "client-1",
      firstName: "Ahmed",
      units: [],
    };

    const result = await processQuery(db, {
      query: "What is my unit status?",
      language: "en",
      identityContext: identity,
    });

    // The completion call should include identity context in the system prompt
    const completionCall = mockGenerateCompletion.mock.calls[0][0];
    const systemMessage = completionCall.find(
      (m: any) => m.role === "system"
    );
    expect(systemMessage.content).toContain("Name: Ahmed");
    expect(result.response).toContain("Ahmed");
  });

  it("passes conversation history through to the prompt", async () => {
    mockGenerateEmbedding.mockResolvedValue(Array(768).fill(0.1));
    mockGenerateCompletion.mockResolvedValue("Here are the payment options.");

    const db = createMockDb([]);

    const result = await processQuery(db, {
      query: "What about payments?",
      language: "en",
      conversationHistory: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello! How can I help?" },
      ],
    });

    const completionCall = mockGenerateCompletion.mock.calls[0][0];
    const systemMessage = completionCall.find(
      (m: any) => m.role === "system"
    );
    expect(systemMessage.content).toContain("User: Hi");
    expect(systemMessage.content).toContain("Assistant: Hello! How can I help?");
    expect(result.response).toBe("Here are the payment options.");
  });
});
