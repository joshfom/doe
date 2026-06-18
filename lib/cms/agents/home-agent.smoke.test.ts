import { describe, it, expect } from "vitest";
import {
  homeAgent,
  HOME_AGENT_NAME,
  HOME_MODEL_TIER,
  HOME_AGENT_MODEL,
  assertHomeContainerTier,
  HomeAgentTierError,
} from "./home-agent";
import { HOME_TOOL_NAMES, loadHomeCapabilities } from "../ai/tools/home-capabilities";

describe("home-agent module-load smoke", () => {
  it("declares homeAgent and binds every HOME_TOOL_NAME (bindCatalog resolved)", () => {
    expect(HOME_AGENT_NAME).toBe("homeAgent");
    expect(HOME_MODEL_TIER).toBe("fast");
    expect(HOME_AGENT_MODEL.startsWith("doe/cf/")).toBe(true);
    // The Agent constructed at import without throwing means bindCatalog
    // resolved every HOME_TOOL_NAME; assert the resolution invariant directly
    // against the same catalog the agent binds.
    expect(homeAgent).toBeDefined();
    const loaded = loadHomeCapabilities();
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      for (const name of HOME_TOOL_NAMES) {
        expect(loaded.catalog.has(name)).toBe(true);
      }
    }
  });

  it("container-tier guard refuses serverless and passes on container", () => {
    expect(() => assertHomeContainerTier(true)).toThrow(HomeAgentTierError);
    expect(() => assertHomeContainerTier(false)).not.toThrow();
  });
});
