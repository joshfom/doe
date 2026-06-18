import { describe, it, expect } from "vitest";

import { runVoiceEvals } from "@/lib/cms/agents/voice-agent.eval";

/**
 * Runs the voice capability eval case through the S1 Eval_Harness (S6 task 6.4).
 *
 * Validates: Requirement 6.1 — a known caller turn resolves to the expected
 * tool intent (a single `update_qualification` dispatch), deterministically and
 * without a live model or database.
 */
describe("voice-agent eval", () => {
  it("a qualification turn resolves to the expected tool intent", async () => {
    const reports = await runVoiceEvals();
    expect(reports).toHaveLength(1);
    expect(reports[0]?.capability).toBe("voice_qualification");
    expect(reports[0]?.pass).toBe(true);
  });
});
