// lib/cms/ai/tools/platform-capabilities.test.ts
import { describe, it, expect } from "vitest";

import {
  loadPlatformCapabilities,
  platformKnowledgeEntry,
  PLATFORM_KNOWLEDGE_TOOL_NAME,
} from "./platform-capabilities";
import { loadHomeCapabilities, HOME_TOOL_NAMES, AGENT_HOME_PERMISSIONS } from "./home-capabilities";

describe("platform-capabilities", () => {
  it("assembles a valid catalog with the platform tool", () => {
    const loaded = loadPlatformCapabilities();
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.catalog.get(PLATFORM_KNOWLEDGE_TOOL_NAME)).toBeDefined();
    }
  });

  it("is not OTP-gated and uses the home identity permission", () => {
    expect(platformKnowledgeEntry.requiresOtp).toBe(false);
    expect(platformKnowledgeEntry.permission).toBe(
      "home:tool:get_platform_knowledge",
    );
    expect(platformKnowledgeEntry.auditActor).toBe("agent:home-twin");
  });

  it("handler returns scored platform matches", async () => {
    const out = (await platformKnowledgeEntry.handler(
      undefined as never,
      {} as never,
      { query: "why build instead of buy", topK: 3 } as never,
    )) as { matches: Array<{ id: string }> };
    expect(out.matches.length).toBeGreaterThan(0);
    expect(out.matches.map((m) => m.id)).toContain("build-vs-buy-summary");
  });
});

describe("home catalog integration", () => {
  it("includes the platform tool in the assembled home catalog", () => {
    const loaded = loadHomeCapabilities();
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.catalog.get(PLATFORM_KNOWLEDGE_TOOL_NAME)).toBeDefined();
    }
  });

  it("lists the platform tool name in HOME_TOOL_NAMES", () => {
    expect(HOME_TOOL_NAMES).toContain(PLATFORM_KNOWLEDGE_TOOL_NAME);
  });

  it("grants the home agent the platform tool permission", () => {
    expect(AGENT_HOME_PERMISSIONS.has("home:tool:get_platform_knowledge")).toBe(
      true,
    );
  });
});
