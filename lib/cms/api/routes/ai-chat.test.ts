import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock modules ─────────────────────────────────────────────────────────────

// Mock the chat orchestrator
vi.mock("../../ai/chat", () => ({
  handleChatMessage: vi.fn(),
}));

// Mock the auth module
vi.mock("../auth", () => ({
  SESSION_COOKIE_NAME: "ora_session",
  validateSession: vi.fn(),
}));

// Mock the db module
vi.mock("../../db", () => ({
  db: {},
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { Elysia } from "elysia";
import { aiChatRoutes } from "./ai-chat";
import { handleChatMessage } from "../../ai/chat";
import { validateSession } from "../auth";

// ── Helpers ──────────────────────────────────────────────────────────────────

function createApp() {
  return new Elysia().use(aiChatRoutes);
}

async function postChat(
  app: ReturnType<typeof createApp>,
  body: unknown,
  cookie?: string
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (cookie) {
    headers["Cookie"] = cookie;
  }

  const res = await app.handle(
    new Request("http://localhost/ai/chat", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
  );

  const json = await res.json();
  return { status: res.status, body: json };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Default: no session
  vi.mocked(validateSession).mockResolvedValue(null);

  // Default: handleChatMessage returns a standard response
  vi.mocked(handleChatMessage).mockResolvedValue({
    message: "Hello! How can I help you today?",
    conversationId: "conv-123",
    language: "en",
    identityType: "visitor",
    metadata: {
      retrievedDocIds: [],
    },
  });
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("POST /ai/chat", () => {
  describe("new conversation creation", () => {
    it("creates a new conversation when no conversationId is provided", async () => {
      const app = createApp();

      const res = await postChat(app, {
        message: "Hello, tell me about ORA",
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.conversationId).toBe("conv-123");
      expect(res.body.data.message).toBe("Hello! How can I help you today?");

      // Verify handleChatMessage was called with correct input
      expect(handleChatMessage).toHaveBeenCalledWith(
        expect.anything(), // db
        expect.objectContaining({
          message: "Hello, tell me about ORA",
          conversationId: undefined,
          userId: undefined,
        })
      );
    });
  });

  describe("continuing existing conversation", () => {
    it("passes conversationId to handleChatMessage when provided", async () => {
      const app = createApp();

      const res = await postChat(app, {
        message: "Follow up question",
        conversationId: "conv-existing",
      });

      expect(res.status).toBe(200);
      expect(handleChatMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          message: "Follow up question",
          conversationId: "conv-existing",
        })
      );
    });

    it("passes phone and email to handleChatMessage when provided", async () => {
      const app = createApp();

      const res = await postChat(app, {
        message: "Hello",
        phone: "+971501234567",
        email: "test@example.com",
      });

      expect(res.status).toBe(200);
      expect(handleChatMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          message: "Hello",
          phone: "+971501234567",
          email: "test@example.com",
        })
      );
    });
  });

  describe("identity resolution from session", () => {
    it("resolves userId from session cookie and passes it to handleChatMessage", async () => {
      vi.mocked(validateSession).mockResolvedValue("user-abc");

      const app = createApp();

      const res = await postChat(
        app,
        { message: "Hello" },
        "ora_session=valid-token"
      );

      expect(res.status).toBe(200);
      expect(validateSession).toHaveBeenCalledWith("valid-token");
      expect(handleChatMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          message: "Hello",
          userId: "user-abc",
        })
      );
    });

    it("proceeds without userId when no session cookie is present", async () => {
      const app = createApp();

      const res = await postChat(app, { message: "Hello" });

      expect(res.status).toBe(200);
      expect(handleChatMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          message: "Hello",
          userId: undefined,
        })
      );
    });

    it("proceeds without userId when session validation fails", async () => {
      vi.mocked(validateSession).mockRejectedValue(new Error("DB error"));

      const app = createApp();

      const res = await postChat(
        app,
        { message: "Hello" },
        "ora_session=bad-token"
      );

      expect(res.status).toBe(200);
      expect(handleChatMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          message: "Hello",
          userId: undefined,
        })
      );
    });

    it("proceeds without userId when session returns null", async () => {
      vi.mocked(validateSession).mockResolvedValue(null);

      const app = createApp();

      const res = await postChat(
        app,
        { message: "Hello" },
        "ora_session=expired-token"
      );

      expect(res.status).toBe(200);
      expect(handleChatMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          userId: undefined,
        })
      );
    });
  });

  describe("request validation", () => {
    it("returns 400 when message is missing", async () => {
      const app = createApp();

      const res = await postChat(app, {});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
      expect(res.body.details).toBeDefined();
      expect(handleChatMessage).not.toHaveBeenCalled();
    });

    it("returns 400 when message is empty string", async () => {
      const app = createApp();

      const res = await postChat(app, { message: "" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
      expect(res.body.details.message).toBeDefined();
      expect(handleChatMessage).not.toHaveBeenCalled();
    });

    it("returns 400 when email format is invalid", async () => {
      const app = createApp();

      const res = await postChat(app, {
        message: "Hello",
        email: "not-an-email",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
      expect(res.body.details.email).toBe("Invalid email format");
      expect(handleChatMessage).not.toHaveBeenCalled();
    });

    it("accepts valid email format", async () => {
      const app = createApp();

      const res = await postChat(app, {
        message: "Hello",
        email: "user@example.com",
      });

      expect(res.status).toBe(200);
      expect(handleChatMessage).toHaveBeenCalled();
    });
  });
});
