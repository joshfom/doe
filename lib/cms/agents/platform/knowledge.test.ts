// lib/cms/agents/platform/knowledge.test.ts
import { describe, it, expect } from "vitest";

import {
  PLATFORM_KNOWLEDGE,
  searchPlatformKnowledge,
  listPlatformTopics,
} from "./knowledge";

describe("platform knowledge — data integrity", () => {
  it("has unique section ids", () => {
    const ids = PLATFORM_KNOWLEDGE.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every section has non-empty title, summary, content, and keywords", () => {
    for (const s of PLATFORM_KNOWLEDGE) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.summary.length).toBeGreaterThan(0);
      expect(s.content.length).toBeGreaterThan(0);
      expect(s.keywords.length).toBeGreaterThan(0);
    }
  });

  it("keywords are lower-cased (so they match the tokenizer)", () => {
    for (const s of PLATFORM_KNOWLEDGE) {
      for (const k of s.keywords) {
        expect(k).toBe(k.toLowerCase());
      }
    }
  });

  it("covers the six required categories", () => {
    const cats = new Set(PLATFORM_KNOWLEDGE.map((s) => s.category));
    for (const c of [
      "overview",
      "capabilities",
      "architecture",
      "build-vs-buy",
      "governance",
      "future",
    ]) {
      expect(cats.has(c as never)).toBe(true);
    }
  });
});

describe("searchPlatformKnowledge", () => {
  it("returns the overview section for 'what is DOE?'", () => {
    const hits = searchPlatformKnowledge("what is DOE?");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].id).toBe("what-is-doe");
  });

  it("returns the build-vs-buy case for 'why build instead of buying a ready-made agent'", () => {
    const hits = searchPlatformKnowledge(
      "why build instead of buying a ready-made agent",
    );
    expect(hits.map((h) => h.id)).toContain("build-vs-buy-summary");
  });

  it("returns the governance section for 'security audit data governance'", () => {
    const hits = searchPlatformKnowledge("security audit data governance");
    expect(hits[0].id).toBe("governance-infra-team");
  });

  it("returns the future section for 'what is the roadmap and future'", () => {
    const hits = searchPlatformKnowledge("what is the roadmap and future");
    expect(hits.map((h) => h.id)).toContain("future-roadmap");
  });

  it("orders results by descending score", () => {
    const hits = searchPlatformKnowledge("platform capabilities agents voice");
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
    }
  });

  it("honours topK", () => {
    const hits = searchPlatformKnowledge("platform doe build governance future", {
      topK: 2,
    });
    expect(hits.length).toBeLessThanOrEqual(2);
  });

  it("honours a category filter", () => {
    const hits = searchPlatformKnowledge("when should we not build", {
      category: "build-vs-buy",
    });
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.category).toBe("build-vs-buy");
  });

  it("returns nothing for a signal-free (stopword-only) query", () => {
    expect(searchPlatformKnowledge("what is the")).toEqual([]);
  });

  it("is deterministic — same query yields same ordering", () => {
    const a = searchPlatformKnowledge("why build vs buy ready-made");
    const b = searchPlatformKnowledge("why build vs buy ready-made");
    expect(a.map((h) => h.id)).toEqual(b.map((h) => h.id));
  });
});

describe("listPlatformTopics", () => {
  it("lists every section without leaking full content bodies", () => {
    const topics = listPlatformTopics();
    expect(topics.length).toBe(PLATFORM_KNOWLEDGE.length);
    for (const t of topics) {
      expect(t).not.toHaveProperty("content");
      expect(t.title.length).toBeGreaterThan(0);
    }
  });
});
