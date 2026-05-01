import { describe, it, expect, vi } from "vitest";
import type { Database } from "../db";
import { isWithinScope, loadScopeConfig, type ScopeConfig } from "./scope";

// ── Mock DB helper ───────────────────────────────────────────────────────────

/**
 * Creates a mock database that returns predefined results for select queries.
 * Each call to db.select() consumes the next result in the queue.
 */
function createSelectMockDb(queryResults: unknown[][]) {
  let callIndex = 0;

  const mockDb = {
    select: vi.fn().mockImplementation(() => {
      const result = queryResults[callIndex] ?? [];
      callIndex++;

      const whereMock: any = Object.assign(Promise.resolve(result), {
        limit: vi.fn().mockResolvedValue(result),
      });

      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue(whereMock),
        }),
      };
    }),
  };

  return mockDb as unknown as Database;
}

// ── isWithinScope tests ──────────────────────────────────────────────────────

describe("isWithinScope", () => {
  it("returns true when no blocked keywords and no permitted categories", () => {
    const config: ScopeConfig = {
      permittedCategories: [],
      blockedKeywords: [],
    };

    expect(isWithinScope("Tell me about ORA Tower", config)).toBe(true);
  });

  it("returns false when query contains a blocked keyword", () => {
    const config: ScopeConfig = {
      permittedCategories: [],
      blockedKeywords: ["politics", "gambling"],
    };

    expect(isWithinScope("What is the latest politics news?", config)).toBe(false);
  });

  it("performs case-insensitive blocked keyword matching", () => {
    const config: ScopeConfig = {
      permittedCategories: [],
      blockedKeywords: ["Politics"],
    };

    expect(isWithinScope("tell me about POLITICS today", config)).toBe(false);
  });

  it("returns true when query has no blocked keywords and categories are empty", () => {
    const config: ScopeConfig = {
      permittedCategories: [],
      blockedKeywords: ["gambling"],
    };

    expect(isWithinScope("What are the payment options?", config)).toBe(true);
  });

  it("returns true when query matches a permitted category", () => {
    const config: ScopeConfig = {
      permittedCategories: ["real estate", "payments", "construction"],
      blockedKeywords: [],
    };

    expect(isWithinScope("Tell me about construction progress", config)).toBe(true);
  });

  it("returns false when query does not match any permitted category", () => {
    const config: ScopeConfig = {
      permittedCategories: ["real estate", "payments", "construction"],
      blockedKeywords: [],
    };

    expect(isWithinScope("What is the weather today?", config)).toBe(false);
  });

  it("blocked keywords take priority over permitted categories", () => {
    const config: ScopeConfig = {
      permittedCategories: ["real estate", "payments"],
      blockedKeywords: ["scam"],
    };

    expect(isWithinScope("Is this real estate a scam?", config)).toBe(false);
  });

  it("performs case-insensitive permitted category matching", () => {
    const config: ScopeConfig = {
      permittedCategories: ["Real Estate"],
      blockedKeywords: [],
    };

    expect(isWithinScope("tell me about real estate options", config)).toBe(true);
  });

  it("handles empty query string", () => {
    const config: ScopeConfig = {
      permittedCategories: ["real estate"],
      blockedKeywords: ["politics"],
    };

    expect(isWithinScope("", config)).toBe(false);
  });

  it("ignores empty strings in blocked keywords array", () => {
    const config: ScopeConfig = {
      permittedCategories: [],
      blockedKeywords: ["", "gambling"],
    };

    expect(isWithinScope("Tell me about ORA Tower", config)).toBe(true);
  });
});

// ── loadScopeConfig tests ────────────────────────────────────────────────────

describe("loadScopeConfig", () => {
  it("loads permitted categories and blocked keywords from aiConfig table", async () => {
    const db = createSelectMockDb([
      [{ value: '["real estate","payments","construction"]' }],
      [{ value: '["politics","gambling"]' }],
    ]);

    const config = await loadScopeConfig(db);

    expect(config.permittedCategories).toEqual(["real estate", "payments", "construction"]);
    expect(config.blockedKeywords).toEqual(["politics", "gambling"]);
  });

  it("returns empty arrays when no config rows exist", async () => {
    const db = createSelectMockDb([[], []]);

    const config = await loadScopeConfig(db);

    expect(config.permittedCategories).toEqual([]);
    expect(config.blockedKeywords).toEqual([]);
  });

  it("returns empty arrays when config values are invalid JSON", async () => {
    const db = createSelectMockDb([
      [{ value: "not-valid-json" }],
      [{ value: "{}" }],
    ]);

    const config = await loadScopeConfig(db);

    expect(config.permittedCategories).toEqual([]);
    expect(config.blockedKeywords).toEqual([]);
  });

  it("filters out non-string values from parsed arrays", async () => {
    const db = createSelectMockDb([
      [{ value: '["real estate", 42, null, "payments"]' }],
      [{ value: '["politics"]' }],
    ]);

    const config = await loadScopeConfig(db);

    expect(config.permittedCategories).toEqual(["real estate", "payments"]);
    expect(config.blockedKeywords).toEqual(["politics"]);
  });
});
