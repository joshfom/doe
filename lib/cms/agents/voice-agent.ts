// lib/cms/agents/voice-agent.ts
//
// The Mastra Voice_Agent (Design §Components #2, Requirement 2). This mirrors
// `text-agent.ts`: a Mastra `Agent`, bound 1:1 to the voice catalog via
// `bindCatalog`, on the `fast` model tier, with lazy Agent_Memory. It is
// registered in `runtime.ts` and is NEVER statically imported by `app/`
// (Requirement 2.6) — only the worker (and the serving path's lazy import)
// reaches it, so Mastra is never bundled onto a serverless route.
//
// `runVoiceAgentTurn` runs a single voice turn through the runtime
// (`runAgentTurn`) under the per-run cost ceiling, then adapts the Mastra
// result into the SAME `OrchestratorResult` shape the lean `runVoiceTurn`
// returns — so `VoiceAgentSession` (via the serving path) can swap the two
// transparently. On a budget-exceeded outcome it THROWS, so the serving path
// falls back to the proven lean orchestrator for that turn (Requirement 4.2).
//
// [container-only] The Mastra runtime, this Agent, its memory connection, and
// its tracing run on the container/worker tier ONLY, never on Next.js
// serverless (Requirement 15.3). This module pulls in `@mastra/core/agent`, so
// it MUST NOT be statically imported by any `app/` route/page/layout module —
// the serving path imports it lazily (dynamic `import()` in its agent branch).
//
// Design references: §Components #2 (Voice_Agent). Requirements: 2.1, 2.2, 2.3,
// 2.4, 2.5, 2.6, 6.1, 6.2, 6.4.

import { Agent } from "@mastra/core/agent";

import type { Database } from "../db";
import { VOICE_AGENT_ACTOR } from "../ai/tools/registry";
import {
  loadVoiceAgentCatalog,
  VOICE_AGENT_TOOL_NAMES,
} from "../ai/tools/voice-capabilities";
import {
  appendTurn,
  buildSystemPrompt,
  type OrchestratorResult,
  type ToolCaller,
  type ToolCallRecord,
  type TurnLatency,
} from "../voice/orchestrator";
import type { CallContext } from "../voice/contracts";

import { bindCatalog } from "./binding";
import { MODEL_TIERS, type ModelTier } from "./gateway";
import { getAgentMemory } from "./memory";
// Type-only import (erased at build) so there is NO static import cycle with
// runtime.ts — runtime.ts imports `voiceAgent` from this module to register it,
// while this module reaches `runAgentTurn` lazily (dynamic import in the turn
// runner below).
import type { RunAgentTurnOptions } from "./runtime";

// ── Agent identity, model tier, and the bound catalog ────────────────────────

/** The key the Voice_Agent is registered under in the single Mastra runtime. */
export const VOICE_AGENT_NAME = "voiceAgent";

/**
 * The declared Model_Tier for the Voice_Agent (Requirement 2.4). The voice path
 * is a low-latency, tool-capable multi-step loop, so it runs on the `fast`
 * tier; the runtime selects this tier for every voice-agent run.
 */
export const VOICE_AGENT_MODEL_TIER: ModelTier = "fast";

/**
 * The model string the runtime resolves through {@link MODEL_TIERS} (the `doe`
 * gateway, its `cf` provider, and the concrete tool-capable model backing the
 * declared tier), keeping the agent on the Cloudflare AI Gateway transport.
 */
export const VOICE_AGENT_MODEL = `doe/cf/${MODEL_TIERS[VOICE_AGENT_MODEL_TIER]}`;

/**
 * The system prompt encoding the voice conversation constraints (FR-V5): one
 * question per turn, at most two sentences, never read lists, never ask for the
 * caller's phone number, use the caller's name at most twice. The per-call
 * {@link CallContext} (caller identity, tier, interests) is layered on top of
 * this as a per-turn system message in {@link runVoiceAgentTurn}.
 */
export const VOICE_AGENT_INSTRUCTIONS = [
  "You are DOE, ORA's digital voice assistant for luxury real estate.",
  "Speak naturally and concisely: ONE question per turn, at most two sentences.",
  "Never read lists aloud. Never ask for the caller's phone number. Use the",
  "caller's name at most twice in the whole call.",
  "Use the available tools to qualify, score, route, check availability, and",
  "book — never invent figures; numbers come from tools.",
  "If a tool returns a structured error, speak around it gracefully and",
  "continue; never read a raw error or stack trace to the caller.",
].join(" ");

/**
 * Load and validate the Voice_Agent's bound catalog once at module load. A
 * failure means a voice capability is malformed (missing field / duplicate
 * name) — fail fast rather than register an Agent with a partial tool set
 * (Requirement 1.6).
 */
function loadVoiceCatalogOrThrow() {
  const result = loadVoiceAgentCatalog();
  if (!result.ok) {
    throw new Error(
      `voice-agent: voice capability catalog failed to load: ${result.errors
        .map((e) => e.message)
        .join("; ")}`,
    );
  }
  return result.catalog;
}

/**
 * The Voice_Agent (Requirement 2.1). Its tools are generated 1:1 from the voice
 * Catalog_Entries via {@link bindCatalog}, each dispatching through the audited
 * `dispatchTool` (Requirements 2.2, 2.3). `bindCatalog` throws a
 * `CatalogBindingError` if any bound name is absent, so the agent is never
 * constructed with a partial tool set (Requirement 2.3). Memory is resolved
 * lazily (a function) so importing this module never opens a database
 * connection (Requirement 2.5).
 */
export const voiceAgent = new Agent({
  id: VOICE_AGENT_NAME,
  name: VOICE_AGENT_NAME,
  instructions: VOICE_AGENT_INSTRUCTIONS,
  model: VOICE_AGENT_MODEL,
  tools: bindCatalog(loadVoiceCatalogOrThrow(), VOICE_AGENT_TOOL_NAMES, {
    agentActor: VOICE_AGENT_ACTOR,
  }),
  // Lazy: defer the Agent_Memory (Postgres + pgvector) connection to first use.
  memory: () => getAgentMemory(),
});

// ── runVoiceAgentTurn — the agent-path turn handler ──────────────────────────

/** The input for one Voice_Agent turn, mirroring the lean `OrchestratorTurn`. */
export interface RunVoiceAgentTurnInput {
  conversationId: string;
  /** Prefetched mirror-only context, resolved once at session start (R5.1). */
  context: CallContext;
  /** Final STT transcript for this caller turn (non-empty). */
  userText: string;
  /** Prior turns in this call, oldest first. */
  history: Array<{ role: "user" | "assistant"; content: string }>;
}

/** Dependencies for {@link runVoiceAgentTurn}. */
export interface RunVoiceAgentTurnDeps {
  db: Database;
  /**
   * The audited tool caller for the serving path. The Voice_Agent's bound tools
   * dispatch through their own `bindCatalog → callTool → dispatchTool` seam, so
   * this is threaded for signature symmetry with the lean path and any future
   * per-turn injection; it is intentionally not re-invoked here.
   */
  callTool: ToolCaller;
  /** Injectable clock (ms). Defaults to `Date.now`. */
  now?: () => number;
  /** Optional per-run budget override forwarded to {@link runAgentTurn}. */
  options?: RunAgentTurnOptions;
}

/** A concrete, role-typed message for a Mastra turn (assignable to its input). */
type TurnMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

/**
 * Defensively read a tool call's name from a Mastra `FullOutput.toolCalls`
 * entry. The AI-SDK tool-call shape carries `toolName` (and `toolCallId`); we
 * read it tolerantly so a provider shape change degrades to an unnamed record
 * rather than throwing on the live path.
 */
function readToolCall(raw: unknown): { id?: string; name: string; input: unknown } {
  const c = raw as
    | { toolCallId?: unknown; toolName?: unknown; args?: unknown; input?: unknown }
    | null
    | undefined;
  return {
    id: typeof c?.toolCallId === "string" ? c.toolCallId : undefined,
    name: typeof c?.toolName === "string" ? c.toolName : "unknown_tool",
    input: c?.args ?? c?.input,
  };
}

/** Index a Mastra `FullOutput.toolResults` array by `toolCallId` for matching. */
function indexToolResults(raw: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (!Array.isArray(raw)) return out;
  for (const r of raw) {
    const tr = r as { toolCallId?: unknown; result?: unknown; output?: unknown };
    if (typeof tr?.toolCallId === "string") {
      out.set(tr.toolCallId, tr.result ?? tr.output);
    }
  }
  return out;
}

/**
 * Adapt a Mastra `FullOutput`'s tool calls + results into the lean path's
 * {@link ToolCallRecord}[] so the Demo_Console and the {@link OrchestratorResult}
 * shape are identical on both paths. Durations are not measured per call here
 * (the dispatch happens inside the agent run), so `ms` is recorded as 0.
 */
function adaptToolCalls(
  toolCalls: unknown,
  toolResults: unknown,
): ToolCallRecord[] {
  if (!Array.isArray(toolCalls)) return [];
  const results = indexToolResults(toolResults);
  return toolCalls.map((raw) => {
    const { id, name, input } = readToolCall(raw);
    const hasResult = id !== undefined && results.has(id);
    return {
      name,
      input,
      ok: true,
      output: hasResult ? results.get(id) : undefined,
      ms: 0,
    } satisfies ToolCallRecord;
  });
}

/**
 * Run one voice turn through the Mastra Voice_Agent under the per-run cost
 * ceiling, adapting the result into the lean {@link OrchestratorResult} shape.
 *
 * The per-turn system context is built from the prefetched {@link CallContext}
 * (the same content the lean path encodes in `buildSystemPrompt`) and layered
 * over the agent's static {@link VOICE_AGENT_INSTRUCTIONS}; the context is never
 * re-resolved per turn (parity with the lean path, R5.1). Tool execution inside
 * the run dispatches through the bound catalog → `callTool` → `dispatchTool`
 * (audited, R2.2), and both the caller and agent turns are persisted + a
 * privacy-safe `turn.appended` event is emitted via the SAME {@link appendTurn}
 * the lean path uses (R6.2).
 *
 * THROWS on a budget-exceeded outcome so the serving path falls back to the
 * lean orchestrator for that turn (R4.2, R6.4); it does not swallow the breach.
 */
export async function runVoiceAgentTurn(
  deps: RunVoiceAgentTurnDeps,
  input: RunVoiceAgentTurnInput,
): Promise<OrchestratorResult> {
  const now = deps.now ?? (() => Date.now());
  const turnStart = now();

  // Per-turn system context = static constraints + the prefetched CallContext.
  const messages: TurnMessage[] = [
    { role: "system", content: buildSystemPrompt(input.context) },
    ...input.history.map(
      (m): TurnMessage =>
        m.role === "assistant"
          ? { role: "assistant", content: m.content }
          : { role: "user", content: m.content },
    ),
    { role: "user", content: input.userText },
  ];

  // Run through the single Mastra runtime under the per-run cost ceiling.
  // Imported lazily to keep runtime.ts ↔ voice-agent.ts free of a static cycle
  // (runtime.ts statically imports `voiceAgent` from here to register it).
  const { runAgentTurn } = await import("./runtime");
  const outcome = await runAgentTurn(VOICE_AGENT_NAME, messages, deps.options);

  if (!outcome.ok) {
    // Budget crossed before the run could complete — throw so the serving path
    // falls back to the proven lean orchestrator for this turn (R4.2, R6.4).
    throw new Error(
      `voice-agent: run exceeded its budget ` +
        `(${outcome.budgetExceeded.reason}: tokens=${outcome.budgetExceeded.usedTokens}, ` +
        `steps=${outcome.budgetExceeded.usedSteps})`,
    );
  }

  const result = outcome.result as {
    text?: unknown;
    toolCalls?: unknown;
    toolResults?: unknown;
  };
  const agentText =
    typeof result.text === "string" && result.text.trim().length > 0
      ? result.text.trim()
      : "Sorry, I didn't quite catch that — could you say that again?";

  const llmFirstTokenMs = now() - turnStart;
  const toolCalls = adaptToolCalls(result.toolCalls, result.toolResults);
  const voiceToVoiceMs = now() - turnStart;

  const latency: TurnLatency = {
    sttFinalMs: 0,
    llmFirstTokenMs,
    ttsFirstByteMs: 0,
    voiceToVoiceMs,
  };

  // Persist both turns + emit `turn.appended` via the SAME path the lean
  // orchestrator uses, so observability is identical on both paths (R6.2).
  await appendTurn(
    deps.db,
    {
      conversationId: input.conversationId,
      context: input.context,
      userText: input.userText,
      history: input.history.map((m) => ({ role: m.role, content: m.content })),
    },
    agentText,
    latency,
  );

  return { agentText, toolCalls, latency };
}
