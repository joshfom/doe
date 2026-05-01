import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock modules ─────────────────────────────────────────────────────────────

vi.mock("../../db", () => ({
  db: {},
}));

vi.mock("../../ai/gateway", () => ({
  generateEmbedding: vi.fn(),
}));

vi.mock("../../ai/content-sync", () => ({
  reindexAllBlogContent: vi.fn(),
}));

// Mock the RBAC middleware to pass through
vi.mock("../../rbac/middleware", () => {
  const { Elysia } = require("elysia");
  return {
    identityGuard: new Elysia({ name: "identityGuard" }).derive(
      { as: "scoped" },
      () => ({
        userId: "admin-user-id",
        userType: "employee",
        isActive: true,
        emailVerified: true,
        brokerContext: null,
      })
    ),
    requirePermission: () =>
      new Elysia({ name: "requirePermission:mock" }).derive(
        { as: "scoped" },
        () => ({
          resolvedRoles: ["super_admin"],
          resolvedPermissions: ["*:*"],
        })
      ),
  };
});

// Mock the auth module
vi.mock("../auth", () => {
  const { Elysia } = require("elysia");
  return {
    SESSION_COOKIE_NAME: "ora_session",
    validateSession: vi.fn().mockResolvedValue("admin-user-id"),
    authGuard: new Elysia({ name: "authGuard" }).derive(
      { as: "scoped" },
      () => ({ userId: "admin-user-id" })
    ),
  };
});

// Mock drizzle-orm schema operations
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock("../../schema", () => ({
  knowledgeDocuments: {
    id: "id",
    title: "title",
    content: "content",
    sourceType: "source_type",
    category: "category",
    locale: "locale",
    sourceRefId: "source_ref_id",
    lastIndexedAt: "last_indexed_at",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  knowledgeEmbeddings: {
    id: "id",
    documentId: "document_id",
    embedding: "embedding",
    chunkIndex: "chunk_index",
    chunkText: "chunk_text",
    createdAt: "created_at",
  },
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { Elysia } from "elysia";
import { aiKnowledgeBaseRoutes } from "./ai-knowledge-base";
import { generateEmbedding } from "../../ai/gateway";
import { reindexAllBlogContent } from "../../ai/content-sync";

// ── Helpers ──────────────────────────────────────────────────────────────────

function createApp() {
  return new Elysia().use(aiKnowledgeBaseRoutes);
}

async function makeRequest(
  app: ReturnType<typeof createApp>,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Cookie: "ora_session=valid-token",
  };

  const options: RequestInit = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await app.handle(
    new Request(`http://localhost${path}`, options)
  );

  const json = await res.json();
  return { status: res.status, body: json };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(generateEmbedding).mockResolvedValue(
    new Array(768).fill(0.1)
  );

  vi.mocked(reindexAllBlogContent).mockResolvedValue({
    indexed: 5,
    errors: 0,
  });
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Knowledge Base API Routes", () => {
  describe("POST /ai/knowledge-base", () => {
    it("returns 400 when title is missing", async () => {
      const app = createApp();

      const res = await makeRequest(app, "POST", "/ai/knowledge-base", {
        content: "Some content",
        sourceType: "manual",
        locale: "en",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
    });

    it("returns 400 when content is missing", async () => {
      const app = createApp();

      const res = await makeRequest(app, "POST", "/ai/knowledge-base", {
        title: "Test Document",
        sourceType: "manual",
        locale: "en",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
    });

    it("returns 400 when sourceType is invalid", async () => {
      const app = createApp();

      const res = await makeRequest(app, "POST", "/ai/knowledge-base", {
        title: "Test Document",
        content: "Some content",
        sourceType: "invalid_type",
        locale: "en",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
    });

    it("returns 400 when locale is invalid", async () => {
      const app = createApp();

      const res = await makeRequest(app, "POST", "/ai/knowledge-base", {
        title: "Test Document",
        content: "Some content",
        sourceType: "manual",
        locale: "fr",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
    });
  });

  describe("PUT /ai/knowledge-base/:id", () => {
    it("returns 400 when title is empty string", async () => {
      const app = createApp();

      const res = await makeRequest(
        app,
        "PUT",
        "/ai/knowledge-base/some-id",
        { title: "" }
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
    });
  });

  describe("POST /ai/knowledge-base/reindex", () => {
    it("calls reindexAllBlogContent and returns result", async () => {
      const app = createApp();

      const res = await makeRequest(
        app,
        "POST",
        "/ai/knowledge-base/reindex"
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ indexed: 5, errors: 0 });
      expect(reindexAllBlogContent).toHaveBeenCalled();
    });
  });
});
