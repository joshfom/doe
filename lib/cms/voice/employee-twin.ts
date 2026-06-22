/**
 * DOE Voice Surface — employee Twin adapter (the "talk to your twin" brain).
 *
 * A public/lead voice call is served by the lead-qualification Voice_Agent. An
 * authenticated STAFF call ("talk to your twin") is a completely different
 * conversation: the employee is a teammate, not a lead, and the agent must act
 * AS THEM — manage their stack, check leads, summarise their pipeline, draft
 * follow-ups — under THEIR identity and RBAC. That brain already exists: it is
 * the Home_Agent that powers the `/ora-panel` home chat.
 *
 * This module is the thin seam that runs one staff voice turn through
 * {@link runHomeAgentTurn} (the home Twin) under the signed-in employee's
 * identity, with the `voice` channel hint so replies stay short and speakable,
 * and adapts the {@link HomeAgentTurnResult} into the voice
 * {@link OrchestratorResult} the worker's TTS pipeline consumes. RBAC, audit,
 * figure-grounding, and confirm-before-commit are all inherited unchanged from
 * the Home_Agent + the audited dispatcher — nothing is re-implemented here.
 *
 * [container-only] The Home_Agent pulls in `@mastra/core`; it is imported
 * LAZILY (the default `runHomeTurn`) so this module — and the worker that
 * imports the serving-path router — never statically bundles Mastra.
 */

import type { OrchestratorResult, OrchestratorTurn, VoiceDeps } from "./orchestrator";

/** The shape of the Home_Agent turn runner this adapter depends on. */
export type HomeTurnRunner = (input: {
  userId: string;
  roles: string[];
  message: string;
  history?: Array<{ role: string; content: string }>;
  channel?: "text" | "voice";
}) => Promise<
  | { ok: true; response: string; toolResults: Array<{ toolName: string; result: unknown }> }
  | { ok: false; reason: "budget_exceeded"; budgetExceeded: unknown }
>;

/** The spoken fallback when the Twin turn cannot complete (never throws to TTS). */
const VOICE_FALLBACK_UTTERANCE =
  "Sorry, I didn't catch that fully — could you say that again?";

/** Lazy, container-only default: run the turn through the real Home_Agent. */
const defaultRunHomeTurn: HomeTurnRunner = async (input) => {
  const { runHomeAgentTurn } = await import("../agents/home-agent");
  return runHomeAgentTurn(input);
};

/**
 * Decide whether a turn is a staff "talk to your twin" turn (served by the
 * employee Twin) rather than a public lead call. True iff the prefetched
 * {@link CallContext} carries the signed-in employee's id.
 */
export function isEmployeeTwinTurn(turn: OrchestratorTurn): boolean {
  return typeof turn.context.employeeUserId === "string" && turn.context.employeeUserId.length > 0;
}

/**
 * Run one staff voice turn through the employee Twin (the Home_Agent) under the
 * employee's identity, returning the voice {@link OrchestratorResult}. Never
 * throws: a budget breach or any Twin failure yields a graceful spoken fallback
 * so the call continues (the caller can retry the turn).
 *
 * `runHomeTurn` is injectable for testing; the default lazily imports the real
 * Home_Agent (keeping Mastra off the static import path).
 */
export async function runEmployeeVoiceTurn(
  deps: VoiceDeps,
  turn: OrchestratorTurn,
  runHomeTurn: HomeTurnRunner = defaultRunHomeTurn,
): Promise<OrchestratorResult> {
  const now = deps.now ?? (() => Date.now());
  const startedAt = now();

  const employeeUserId = turn.context.employeeUserId;
  if (!employeeUserId) {
    // Caller should gate on isEmployeeTwinTurn; defend anyway rather than throw.
    return {
      agentText: VOICE_FALLBACK_UTTERANCE,
      toolCalls: [],
      latency: emptyLatency(now() - startedAt),
    };
  }

  const result = await runHomeTurn({
    userId: employeeUserId,
    roles: turn.context.employeeRoles ?? [],
    message: turn.userText,
    history: turn.history.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    })),
    channel: "voice",
  });

  const elapsed = now() - startedAt;

  if (!result.ok) {
    // Budget breach (or any non-ok outcome): speak a graceful line, no tools.
    return {
      agentText:
        "I need a moment on that one — could we take it a step at a time?",
      toolCalls: [],
      latency: emptyLatency(elapsed),
    };
  }

  const agentText = result.response.trim() || VOICE_FALLBACK_UTTERANCE;
  const toolCalls = result.toolResults.map((tr) => ({
    name: tr.toolName,
    input: undefined as unknown,
    ok: true,
    output: tr.result,
    ms: 0,
  }));

  return {
    agentText,
    toolCalls,
    latency: emptyLatency(elapsed),
  };
}

/** A latency record carrying only the orchestrator wall-clock for the turn. */
function emptyLatency(voiceToVoiceMs: number) {
  return {
    sttFinalMs: 0,
    llmFirstTokenMs: 0,
    ttsFirstByteMs: 0,
    voiceToVoiceMs,
  };
}
