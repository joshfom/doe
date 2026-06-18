import { describe, it, expect } from "vitest";

import {
  loadVoiceCapabilities,
  loadVoiceAgentCatalog,
  voiceCapabilityEntries,
  VOICE_SPECIFIC_NAMES,
  VOICE_AGENT_TOOL_NAMES,
  SHARED_REPORTING_TOOLS,
} from "@/lib/cms/ai/tools/voice-capabilities";
import { reportingCapabilityEntries } from "@/lib/cms/ai/tools/reporting-capabilities";
import { toolRegistry } from "@/lib/cms/ai/tools/registry";
import { TOOL_NAMES } from "@/lib/cms/voice/contracts";

/**
 * Unit tests for the voice Catalog_Entries (S6 task 1.3).
 *
 * Validates: Requirements 1.2, 1.3, 1.4, 1.6.
 *
 *  - `loadVoiceCapabilities()` assembles the eight voice-specific entries
 *    cleanly (no duplicate names / incomplete entries) and reuses the contract
 *    schemas verbatim (R1.2, R1.6).
 *  - `loadVoiceAgentCatalog()` contains all ten tool names exactly once (R1.3)
 *    and the two shared reporting entries are the SAME objects (by reference)
 *    the Reporting_Agent uses — the structural root of figure consistency
 *    (R1.4).
 */
describe("voice-capabilities catalog assembly", () => {
  it("loads the eight voice-specific entries cleanly", () => {
    const result = loadVoiceCapabilities();
    expect(result.ok).toBe(true);
    expect(voiceCapabilityEntries).toHaveLength(8);
    // None of the voice-specific names is a shared reporting tool.
    for (const name of VOICE_SPECIFIC_NAMES) {
      expect(SHARED_REPORTING_TOOLS).not.toContain(name);
    }
  });

  it("reuses the registry (contract) schemas verbatim (R1.2)", () => {
    for (const entry of voiceCapabilityEntries) {
      const reg = toolRegistry[entry.name as keyof typeof toolRegistry];
      expect(entry.inputSchema).toBe(reg.inputSchema);
      expect(entry.outputSchema).toBe(reg.outputSchema);
      expect(entry.requiresOtp).toBe(reg.requiresOtp);
      expect(entry.permission).toBe(reg.permission);
      expect(entry.auditActor).toBe("agent:voice-lead");
    }
  });

  it("assembles all ten tool names exactly once (R1.3)", () => {
    const result = loadVoiceAgentCatalog();
    expect(result.ok).toBe(true);
    expect([...result.catalog.keys()].sort()).toEqual([...TOOL_NAMES].sort());
    expect(result.catalog.size).toBe(TOOL_NAMES.length);
    expect(VOICE_AGENT_TOOL_NAMES).toHaveLength(TOOL_NAMES.length);
  });

  it("binds the SAME shared reporting entries as the reporting agent (R1.4)", () => {
    const result = loadVoiceAgentCatalog();
    expect(result.ok).toBe(true);
    for (const name of SHARED_REPORTING_TOOLS) {
      const boundEntry = result.catalog.get(name);
      const reportingEntry = reportingCapabilityEntries.find(
        (e) => e.name === name,
      );
      expect(boundEntry).toBeDefined();
      expect(reportingEntry).toBeDefined();
      // SAME object by reference — figure consistency is structural (R1.4).
      expect(boundEntry).toBe(reportingEntry);
    }
  });
});
