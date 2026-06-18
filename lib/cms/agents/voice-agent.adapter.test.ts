import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the runtime so the lazily-imported `runAgentTurn` returns a controlled
// budgeted outcome (no live model). The dynamic import inside runVoiceAgentTurn
// resolves to this mock.
const runAgentTurn = vi.fn();
vi.mock("@/lib/cms/agents/runtime", () => ({
  runAgentTurn: (...args: unknown[]) => runAgentTurn(...args),
}));

// Keep the real orchestrator (buildSystemPrompt etc.) but stub `appendTurn` so
// the adapter test never touches the database / SSE bus.
const appendTurn = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/cms/voice/orchestrator", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/cms/voice/orchestrator")>();
  return { ...actual, appendTurn: (...args: unknown[]) => appendTurn(...args) };
});

import { runVoiceAgentTurn } from "@/lib/cms/agents/voice-agent";
import type { CallContext } from "@/lib/cms/voice/contracts";

/**
 * Unit tests for the Voice_Agent turn adapter (S6 task 2.3).
 *
 * Validates: Requirements 2.3, 6.2, 6.4.
 *  - adapts a Mastra result into the lean `OrchestratorResult` shape,
 *  - persists the turn via `appendTurn` (so observability is identical), and
 *  - THROWS on a budget-exceeded outcome so the serving path falls back.
 */

const context: CallContext = {
  partyId: "p1",
  known: true,
  name: "Sam",
  language: "en",
};

const deps = {
  db: {} as never,
  callTool: vi.fn(),
  now: () => 1000,
};

const input = {
  conversationId: "c1",
  context,
  userText: "I'd like to book a viewing",
  history: [{ role: "user" as const, content: "hello" }],
};

beforeEach(() => {
  runAgentTurn.mockReset();
  appendTurn.mockClear();
});

describe("runVoiceAgentTurn", () => {
  it("adapts a Mastra result into OrchestratorResult and persists the turn", async () => {
    runAgentTurn.mockResolvedValueOnce({
      ok: true,
      result: {
        text: "Sure — what date suits you?",
        toolCalls: [
          { toolCallId: "t1", toolName: "check_viewing_slots", args: { project: "Marina" } },
        ],
        toolResults: [{ toolCallId: "t1", result: { slots: [] } }],
      },
    });

    const result = await runVoiceAgentTurn(deps, input);

    expect(result.agentText).toBe("Sure — what date suits you?");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.name).toBe("check_viewing_slots");
    expect(result.toolCalls[0]?.output).toEqual({ slots: [] });
    expect(result.latency.voiceToVoiceMs).toBeTypeOf("number");
    // Persisted through the SAME appendTurn the lean path uses (R6.2).
    expect(appendTurn).toHaveBeenCalledTimes(1);
  });

  it("falls back to a graceful utterance when the model returns empty text", async () => {
    runAgentTurn.mockResolvedValueOnce({
      ok: true,
      result: { text: "   ", toolCalls: [], toolResults: [] },
    });
    const result = await runVoiceAgentTurn(deps, input);
    expect(result.agentText.length).toBeGreaterThan(0);
    expect(result.toolCalls).toHaveLength(0);
  });

  it("THROWS on a budget-exceeded outcome so the serving path falls back (R4.2, R6.4)", async () => {
    runAgentTurn.mockResolvedValueOnce({
      ok: false,
      budgetExceeded: { reason: "tokens", usedTokens: 999, usedSteps: 3 },
    });
    await expect(runVoiceAgentTurn(deps, input)).rejects.toThrow(/budget/i);
    // No turn is persisted when the run breaches its budget.
    expect(appendTurn).not.toHaveBeenCalled();
  });
});
