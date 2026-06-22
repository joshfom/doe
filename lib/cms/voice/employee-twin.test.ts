/**
 * Tests for the employee Twin voice adapter (`runEmployeeVoiceTurn`) and the
 * staff-turn predicate — the "talk to your twin" brain seam.
 *
 * These are PURE unit tests: the Home_Agent turn runner is injected as a stub,
 * so no Mastra/DB is touched. They verify the adapter (1) routes a staff turn
 * through the Home_Agent under the EMPLOYEE's identity + roles with the `voice`
 * channel hint, (2) maps the Twin result into the voice `OrchestratorResult`
 * shape, and (3) never throws to TTS — a budget breach / failure yields a
 * graceful spoken fallback.
 */
import { describe, it, expect, vi } from "vitest";

import {
  isEmployeeTwinTurn,
  runEmployeeVoiceTurn,
  type HomeTurnRunner,
} from "./employee-twin";
import type { OrchestratorTurn, VoiceDeps } from "./orchestrator";
import type { CallContext } from "./contracts";

// A minimal deps object — the adapter only reads `now`.
const deps = { now: () => 1000 } as unknown as VoiceDeps;

function staffContext(over: Partial<CallContext> = {}): CallContext {
  return {
    partyId: "party-1",
    known: true,
    language: "en",
    employeeUserId: "user-42",
    employeeRoles: ["c_level"],
    ...over,
  } as CallContext;
}

function turn(over: Partial<OrchestratorTurn> = {}): OrchestratorTurn {
  return {
    conversationId: "conv-1",
    context: staffContext(),
    userText: "what's on my stack today?",
    history: [],
    ...over,
  };
}

describe("isEmployeeTwinTurn", () => {
  it("is true when the context carries an employeeUserId", () => {
    expect(isEmployeeTwinTurn(turn())).toBe(true);
  });

  it("is false for a public/lead call (no employeeUserId)", () => {
    const leadTurn = turn({
      context: { partyId: "p", known: false, language: "en" } as CallContext,
    });
    expect(isEmployeeTwinTurn(leadTurn)).toBe(false);
  });
});

describe("runEmployeeVoiceTurn", () => {
  it("runs the Home_Agent under the employee identity with the voice channel", async () => {
    const runHome: HomeTurnRunner = vi.fn(async () => ({
      ok: true as const,
      response: "Three leads need a follow-up. Want me to nudge the owners?",
      toolResults: [{ toolName: "list_stack", result: { items: [] } }],
    }));

    const result = await runEmployeeVoiceTurn(deps, turn(), runHome);

    expect(runHome).toHaveBeenCalledWith({
      userId: "user-42",
      roles: ["c_level"],
      message: "what's on my stack today?",
      history: [],
      channel: "voice",
    });
    expect(result.agentText).toBe(
      "Three leads need a follow-up. Want me to nudge the owners?",
    );
    // Tool results are mapped into the voice tool-call records.
    expect(result.toolCalls).toEqual([
      { name: "list_stack", input: undefined, ok: true, output: { items: [] }, ms: 0 },
    ]);
    expect(result.latency.voiceToVoiceMs).toBe(0); // now() is constant in the stub
  });

  it("maps history roles and passes them to the Home_Agent", async () => {
    const runHome: HomeTurnRunner = vi.fn(async () => ({
      ok: true as const,
      response: "Done.",
      toolResults: [],
    }));

    await runEmployeeVoiceTurn(
      deps,
      turn({
        history: [
          { role: "assistant", content: "hi" },
          { role: "user", content: "hello" },
          { role: "system", content: "ignored→user" },
        ],
      }),
      runHome,
    );

    expect(runHome).toHaveBeenCalledWith(
      expect.objectContaining({
        history: [
          { role: "assistant", content: "hi" },
          { role: "user", content: "hello" },
          { role: "user", content: "ignored→user" },
        ],
      }),
    );
  });

  it("speaks a graceful fallback on a budget breach (never throws to TTS)", async () => {
    const runHome: HomeTurnRunner = vi.fn(async () => ({
      ok: false as const,
      reason: "budget_exceeded" as const,
      budgetExceeded: { reason: "steps", usedTokens: 1, usedSteps: 99 },
    }));

    const result = await runEmployeeVoiceTurn(deps, turn(), runHome);

    expect(result.agentText).toMatch(/step at a time/i);
    expect(result.toolCalls).toEqual([]);
  });

  it("falls back to a re-ask when the Twin returns empty prose", async () => {
    const runHome: HomeTurnRunner = vi.fn(async () => ({
      ok: true as const,
      response: "   ",
      toolResults: [],
    }));

    const result = await runEmployeeVoiceTurn(deps, turn(), runHome);
    expect(result.agentText).toMatch(/say that again/i);
  });
});
