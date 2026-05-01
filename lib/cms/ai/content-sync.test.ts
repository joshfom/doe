import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Database } from "../db";
import {
  extractPlainText,
  syncBlogPost,
  reindexAllBlogContent,
} from "./content-sync";

// ── Mock gateway ─────────────────────────────────────────────────────────────

vi.mock("./gateway", () => ({
  generateEmbedding: vi.fn(),
}));

import { generateEmbedding } from "./gateway";

const mockGenerateEmbedding = generateEmbedding as ReturnType<typeof vi.fn>;

// ── Mock DB helper ───────────────────────────────────────────────────────────

/**
 * Creates a mock database that supports chained select/insert/update/delete.
 * Each call to a top-level method (select, insert, update, delete) consumes
 * the next result in the queue.
 */
function createMockDb(queryResults: unknown[][]) {
  let callIndex = 0;

  function nextResult() {
    const result = queryResults[callIndex] ?? [];
    callIndex++;
    return result;
  }

  const mockDb = {
    select: vi.fn().mockImplementation(() => {
      const result = nextResult();
      const whereMock: any = Object.assign(Promise.resolve(result), {
        limit: vi.fn().mockResolvedValue(result),
      });
      const fromMock: any = Object.assign(Promise.resolve(result), {
        where: vi.fn().mockReturnValue(whereMock),
      });
      return {
        from: vi.fn().mockReturnValue(fromMock),
      };
    }),

    insert: vi.fn().mockImplementation(() => {
      const result = nextResult();
      return {
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(result),
        }),
      };
    }),

    update: vi.fn().mockImplementation(() => {
      const result = nextResult();
      return {
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(result),
        }),
      };
    }),

    delete: vi.fn().mockImplementation(() => {
      const result = nextResult();
      return {
        where: vi.fn().mockResolvedValue(result),
      };
    }),
  };

  return mockDb as unknown as Database;
}

// ── Fixed embedding for mocks ────────────────────────────────────────────────

const FAKE_EMBEDDING = Array(768).fill(0.1);

// ── extractPlainText tests ───────────────────────────────────────────────────

describe("extractPlainText", () => {
  it("extracts text from a simple paragraph", () => {
    const tiptapJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hello" }],
        },
      ],
    };

    expect(extractPlainText(tiptapJson)).toBe("Hello");
  });

  it("joins multiple paragraphs with newlines", () => {
    const tiptapJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "First paragraph" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Second paragraph" }],
        },
      ],
    };

    expect(extractPlainText(tiptapJson)).toBe(
      "First paragraph\nSecond paragraph"
    );
  });

  it("handles headings", () => {
    const tiptapJson = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Title" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Body text" }],
        },
      ],
    };

    expect(extractPlainText(tiptapJson)).toBe("Title\nBody text");
  });

  it("handles nested bullet lists", () => {
    const tiptapJson = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Item one" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Item two" }],
                },
              ],
            },
          ],
        },
      ],
    };

    const result = extractPlainText(tiptapJson);
    expect(result).toContain("Item one");
    expect(result).toContain("Item two");
  });

  it("returns empty string for an empty doc", () => {
    const tiptapJson = { type: "doc", content: [] };
    expect(extractPlainText(tiptapJson)).toBe("");
  });

  it("returns empty string for non-object input", () => {
    expect(extractPlainText(null)).toBe("");
    expect(extractPlainText(undefined)).toBe("");
    expect(extractPlainText("string")).toBe("");
    expect(extractPlainText(42)).toBe("");
  });

  it("handles inline formatting (bold, italic) by concatenating text", () => {
    const tiptapJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "world", marks: [{ type: "bold" }] },
          ],
        },
      ],
    };

    expect(extractPlainText(tiptapJson)).toBe("Hello world");
  });

  it("handles a doc with no content property", () => {
    const tiptapJson = { type: "doc" };
    expect(extractPlainText(tiptapJson)).toBe("");
  });
});

// ── syncBlogPost tests ───────────────────────────────────────────────────────

describe("syncBlogPost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateEmbedding.mockResolvedValue(FAKE_EMBEDDING);
  });

  it("creates a new knowledge document and embeddings on publish", async () => {
    const postContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Blog post content here." }],
        },
      ],
    };

    const db = createMockDb([
      // Query 1: select post by id
      [
        {
          id: "post-1",
          title: "My Blog Post",
          content: postContent,
          locale: "en",
          status: "published",
        },
      ],
      // Query 2: select existing knowledge doc by sourceRefId → none
      [],
      // Query 3: insert new knowledge document → returning id
      [{ id: "doc-1" }],
      // Query 4: delete old embeddings for this document
      [],
      // Query 5: insert embedding for chunk
      [{ id: "emb-1" }],
    ]);

    await syncBlogPost(db, "post-1", "publish");

    expect(mockGenerateEmbedding).toHaveBeenCalledWith(
      "Blog post content here."
    );
    expect(mockDb(db).insert).toHaveBeenCalled();
  });

  it("updates existing knowledge document and regenerates embeddings on update", async () => {
    const postContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Updated content." }],
        },
      ],
    };

    const db = createMockDb([
      // Query 1: select post by id
      [
        {
          id: "post-1",
          title: "Updated Post",
          content: postContent,
          locale: "en",
          status: "published",
        },
      ],
      // Query 2: select existing knowledge doc → found
      [{ id: "doc-1" }],
      // Query 3: update knowledge document
      [],
      // Query 4: delete old embeddings
      [],
      // Query 5: insert new embedding
      [{ id: "emb-2" }],
    ]);

    await syncBlogPost(db, "post-1", "update");

    expect(mockGenerateEmbedding).toHaveBeenCalledWith("Updated content.");
    expect(mockDb(db).update).toHaveBeenCalled();
  });

  it("deletes knowledge document on delete action", async () => {
    const db = createMockDb([
      // Query 1: select existing knowledge doc by sourceRefId → found
      [{ id: "doc-1" }],
      // Query 2: delete knowledge document
      [],
    ]);

    await syncBlogPost(db, "post-1", "delete");

    expect(mockDb(db).delete).toHaveBeenCalled();
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
  });

  it("does nothing on delete when no knowledge document exists", async () => {
    const db = createMockDb([
      // Query 1: select existing knowledge doc → not found
      [],
    ]);

    await syncBlogPost(db, "post-1", "delete");

    expect(mockDb(db).select).toHaveBeenCalledTimes(1);
    expect(mockDb(db).delete).not.toHaveBeenCalled();
  });

  it("throws error when blog post is not found on publish", async () => {
    const db = createMockDb([
      // Query 1: select post by id → not found
      [],
    ]);

    await expect(syncBlogPost(db, "post-999", "publish")).rejects.toThrow(
      "Blog post not found: post-999"
    );
  });

  it("removes existing document when post content is empty on update", async () => {
    const emptyContent = { type: "doc", content: [] };

    const db = createMockDb([
      // Query 1: select post by id
      [
        {
          id: "post-1",
          title: "Empty Post",
          content: emptyContent,
          locale: "en",
          status: "published",
        },
      ],
      // Query 2: select existing knowledge doc → found
      [{ id: "doc-1" }],
      // Query 3: delete knowledge document (cleanup empty content)
      [],
    ]);

    await syncBlogPost(db, "post-1", "update");

    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
    expect(mockDb(db).delete).toHaveBeenCalled();
  });
});

// ── reindexAllBlogContent tests ──────────────────────────────────────────────

describe("reindexAllBlogContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateEmbedding.mockResolvedValue(FAKE_EMBEDDING);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("indexes all published posts and returns count", async () => {
    const postContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Content" }],
        },
      ],
    };

    const db = createMockDb([
      // Query 1: select all published posts
      [{ id: "post-1" }, { id: "post-2" }],
      // syncBlogPost for post-1:
      //   Query 2: select post by id
      [
        {
          id: "post-1",
          title: "Post 1",
          content: postContent,
          locale: "en",
          status: "published",
        },
      ],
      //   Query 3: select existing knowledge doc → none
      [],
      //   Query 4: insert knowledge document
      [{ id: "doc-1" }],
      //   Query 5: delete old embeddings
      [],
      //   Query 6: insert embedding
      [{ id: "emb-1" }],
      // syncBlogPost for post-2:
      //   Query 7: select post by id
      [
        {
          id: "post-2",
          title: "Post 2",
          content: postContent,
          locale: "en",
          status: "published",
        },
      ],
      //   Query 8: select existing knowledge doc → none
      [],
      //   Query 9: insert knowledge document
      [{ id: "doc-2" }],
      //   Query 10: delete old embeddings
      [],
      //   Query 11: insert embedding
      [{ id: "emb-2" }],
    ]);

    const result = await reindexAllBlogContent(db);

    expect(result.indexed).toBe(2);
    expect(result.errors).toBe(0);
  });

  it("counts errors when individual post sync fails", async () => {
    const db = createMockDb([
      // Query 1: select all published posts
      [{ id: "post-1" }, { id: "post-2" }],
      // syncBlogPost for post-1: select post → not found (will throw)
      [],
      // syncBlogPost for post-2: select post → found
      [
        {
          id: "post-2",
          title: "Post 2",
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Content" }],
              },
            ],
          },
          locale: "en",
          status: "published",
        },
      ],
      // select existing knowledge doc → none
      [],
      // insert knowledge document
      [{ id: "doc-2" }],
      // delete old embeddings
      [],
      // insert embedding
      [{ id: "emb-2" }],
    ]);

    const result = await reindexAllBlogContent(db);

    expect(result.indexed).toBe(1);
    expect(result.errors).toBe(1);
  });

  it("returns zero counts when no published posts exist", async () => {
    const db = createMockDb([
      // Query 1: select all published posts → none
      [],
    ]);

    const result = await reindexAllBlogContent(db);

    expect(result.indexed).toBe(0);
    expect(result.errors).toBe(0);
  });
});

// ── Helper to access mock db methods ─────────────────────────────────────────

function mockDb(db: Database) {
  return db as unknown as {
    select: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
}
