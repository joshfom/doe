/**
 * Voice Re-base (S6) — the voice serving-path router (Design §Components #3,
 * Requirement 4).
 *
 * A small, pure-ish router consulted by `VoiceAgentSession.handleCallerTurn`.
 * It selects whether a turn is served by the Mastra Voice_Agent or the proven
 * lean orchestrator, and guarantees the lean path is the always-safe default
 * and fallback:
 *
 *  - {@link selectVoiceServingPath} reads the `voice_lead` Migration_Switch
 *    flag. The DEFAULT (no row / disabled / deterministic) is `"lean"`; only an
 *    `mode === "agent" && enabled === true` flag selects `"agent"` (R4.1).
 *  - {@link runVoiceTurnRouted} runs the Voice_Agent path ONLY when routed
 *    there, and on ANY agent throw or budget breach falls back to the lean path
 *    for that turn — recording a divergence — so enabling the agent path can
 *    never regress audit, OTP, parity, or latency (R4.2, R4.3). The fallback
 *    still dispatches through `dispatchTool` (R4.3).
 *
 * The Voice_Agent module is imported LAZILY inside the agent branch so Mastra
 * stays off any static import path (so this module — and the worker that
 * imports it — never statically pulls `@mastra/core` onto a route).
 *
 * Design references: §Components #3 (Voice serving path). Requirements: 4.1,
 * 4.2, 4.3.
 */

import type { Database } from "../db";
import { recordDivergence, routeCapability } from "../agents/migration-switch";
import {
  runVoiceTurn,
  type OrchestratorResult,
  type OrchestratorTurn,
  type VoiceDeps,
} from "./orchestrator";

/** Which path serves a voice turn. */
export type VoiceServingPath = "agent" | "lean";

/**
 * Resolve whether this call should be served by the Mastra Voice_Agent. The
 * default and fallback is the proven lean orchestrator (R4.1): the agent path
 * is selected only when the `voice_lead` flag is `mode === "agent"` AND
 * `enabled === true`.
 */
export async function selectVoiceServingPath(
  db: Database,
): Promise<VoiceServingPath> {
  return (await routeCapability(db, "voice_lead")) === "agent"
    ? "agent"
    : "lean";
}

/**
 * Run a voice turn on the selected path. When routed to the agent, run the
 * Voice_Agent path; on ANY throw (including a budget breach, which
 * {@link runVoiceAgentTurn} signals by throwing) record a divergence and fall
 * back to the lean path for THIS turn (R4.2, R4.3). The fallback still
 * dispatches every tool through the audited `dispatchTool` behind
 * {@link VoiceDeps.callTool}, so no fallback bypasses the audited boundary.
 *
 * Recording the divergence must never mask the fallback, so its failure is
 * swallowed.
 */
export async function runVoiceTurnRouted(
  deps: VoiceDeps,
  turn: OrchestratorTurn,
): Promise<OrchestratorResult> {
  // Staff "talk to your twin" turns are a different conversation entirely: the
  // signed-in employee is a teammate, served by the employee Twin (the
  // Home_Agent) under THEIR identity — not the public lead-qualification agent.
  // The presence of `employeeUserId` on the prefetched context is the gate. On
  // ANY Twin failure we fall back to the proven lean path for this turn so the
  // call never drops (the lean path still dispatches through the audited
  // `dispatchTool`); a public/lead call never has `employeeUserId`, so its
  // behaviour is unchanged.
  if (turn.context.employeeUserId) {
    try {
      const { runEmployeeVoiceTurn } = await import("./employee-twin");
      return await runEmployeeVoiceTurn(deps, turn);
    } catch (err) {
      try {
        await recordDivergence(deps.db, "voice_lead", err);
      } catch {
        // swallow — fallback correctness takes precedence over bookkeeping
      }
      // fall through to the lean path — STILL audited via deps.callTool.
      return runVoiceTurn(deps, turn);
    }
  }

  const path = await selectVoiceServingPath(deps.db);

  if (path === "agent") {
    try {
      // Lazy import: keep Mastra (`@mastra/core`) off this module's static
      // import path so the worker never statically bundles it.
      const { runVoiceAgentTurn } = await import("../agents/voice-agent");
      return await runVoiceAgentTurn(
        { db: deps.db, callTool: deps.callTool, now: deps.now },
        {
          conversationId: turn.conversationId,
          context: turn.context,
          userText: turn.userText,
          history: turn.history.map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content,
          })),
        },
      );
    } catch (err) {
      // Agent path threw / exceeded budget → fall back to lean for this turn
      // and stamp the divergence (R4.2, R4.3). Never let the bookkeeping mask
      // the fallback.
      try {
        await recordDivergence(deps.db, "voice_lead", err);
      } catch {
        // swallow — fallback correctness takes precedence over divergence bookkeeping
      }
      // fall through to the lean path — STILL audited via deps.callTool.
    }
  }

  return runVoiceTurn(deps, turn);
}
