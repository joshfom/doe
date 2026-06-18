// lib/cms/agents/voice-agent.eval.ts
//
// Eval case(s) for the voice capability through the S1 Eval_Harness (S6 task
// 6.4, Design §Testing Strategy, Requirement 6.1). The harness is deterministic
// and credential-free: the model and the tool dispatch are mocked (the counting
// fake dispatcher stands in for `dispatchTool`), so a known caller turn is
// asserted to resolve to the expected tool intent without any live model or DB.
//
// This mirrors the text/admin eval cases (./evals/cases.ts): a deterministic
// reference voice agent ({@link createReferenceVoiceAgent}) maps a caller turn
// onto exactly the catalog tool a correctly-behaving voice turn would dispatch,
// and the case predicate asserts that tool was called.
//
// [container-only] Container/worker tier only — do NOT import from any `app/`
// route/page/layout module (Requirement 15.3).
//
// Design references: §Testing Strategy. Requirements: 6.1.

import type { ModelTier } from "./gateway";
import {
  runEvals,
  type AgentLike,
  type EvalAgentContext,
  type EvalCase,
  type EvalReport,
} from "./evals";

/** Case-insensitive "input contains any of these substrings" helper. */
function mentions(input: string, ...needles: string[]): boolean {
  const lower = input.toLowerCase();
  return needles.some((needle) => lower.includes(needle));
}

/**
 * Deterministic reference voice agent. Routes a caller turn onto the voice tool
 * a correctly-behaving turn would dispatch, then dispatches it through the
 * counting fake. Declares the SAME model tier as the real Voice_Agent for trace
 * parity, but uses no model/gateway/memory (the "[deps]" constraint).
 */
export function createReferenceVoiceAgent(): AgentLike {
  // The real Voice_Agent declares the `fast` tier (voice-agent.ts); stated as a
  // literal here so the eval stays free of the `@mastra/core/agent` runtime
  // graph and remains model-free and credential-free.
  const modelTier: ModelTier = "fast";
  return {
    id: "voiceAgent",
    modelTier,
    async runTurn(input: string, ctx: EvalAgentContext): Promise<string> {
      // A caller stating qualification facts → record them on the mirror.
      if (mentions(input, "budget", "bedroom", "interested in")) {
        await ctx.callTool("update_qualification", {
          partyId: "eval-party",
          budgetBand: "3M-5M",
          unitType: "2-bed",
        });
        return "Noted your interest — when are you hoping to move?";
      }
      // A caller asking to view a property → check availability.
      if (mentions(input, "viewing", "visit", "see the")) {
        await ctx.callTool("check_viewing_slots", { project: "Marina" });
        return "Let me check what's available.";
      }
      return "Could you tell me a little more about what you're looking for?";
    },
  };
}

/**
 * One eval case for the voice capability: a known caller stating their interest
 * + budget should resolve to a single `update_qualification` dispatch (the
 * expected tool intent for a qualification turn).
 */
export const voiceEvalCases: EvalCase[] = [
  {
    capability: "voice_qualification",
    input:
      "I'm interested in a 2-bedroom at Marina, my budget is around 3 million.",
    expect: (_trace, toolCalls) =>
      toolCalls.length === 1 &&
      toolCalls[0]?.toolName === "update_qualification",
    detail:
      "a qualification turn should dispatch exactly one update_qualification call",
  },
];

/**
 * Run the voice eval case(s) against the deterministic reference voice agent
 * and return one pass/fail report per case.
 */
export async function runVoiceEvals(): Promise<EvalReport[]> {
  return runEvals(createReferenceVoiceAgent(), voiceEvalCases);
}
