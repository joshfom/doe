// lib/cms/agents/runtime.ts
//
// THE single Mastra configuration entry point (Requirement 1.3, Design
// §Architecture "The single Mastra configuration entry point"). There is
// exactly one `new Mastra(...)` in the codebase — this one. Importing it twice
// yields the same instance (module singleton), so "exactly one configuration
// entry point" holds (Requirement 1.3).
//
// It wires the five required pieces (R1.3):
//   1. agents            — the migrated text + admin Mastra Agents
//   2. workflows         — Mastra Workflows (multi-step)
//   3. Tool_Catalog      — every agent's tools are generated from the canonical
//      binding             Tool_Catalog via `bindCatalog` (re-exported below so
//                          each Agent module registers its tools through it)
//   4. Agent_Memory      — Mastra `Memory` on Postgres + pgvector (memory.ts)
//   5. tracing           — the Agent_Trace exporter → SSE bus (tracing.ts)
//
// plus model tiering through the Cloudflare AI Gateway (`gateways`, R5.1).
//
// [container-only] The Mastra runtime, its agents, workflows, the memory
// connection, and the tracing exporter run on the container/worker tier ONLY,
// never on Next.js serverless (Requirement 15.3). This module MUST NOT be
// imported by any `app/` route/page/layout module — only by worker entrypoints.
//
// [deps] Depends on the pinned Mastra packages (@mastra/core, @mastra/memory,
// @mastra/pg) and the Cloudflare AI Gateway env (gateway.ts).
//
// NOTE ON INCREMENTAL BUILD ORDER: the Mastra `workflows` are created later in
// the plan. The migrated `textAgent` (task 5.3) and `adminAgent` (task 5.4) are
// registered below; until the remaining workflows land, this entry point
// registers them as empty so the runtime stands up without breaking. New
// agents/workflows are added to the maps below as each capability is migrated.
// The catalog-binding seam (`bindCatalog`) and the tracing exporter are wired
// here now so agent modules can register against a stable surface.
//
// Design references: §Architecture (single Mastra configuration entry point),
// §Module layout. Requirements: 1.2, 1.3.

import { Mastra } from "@mastra/core";
import type { Agent } from "@mastra/core/agent";

import { DoeModelGateway } from "./gateway";
import { getAgentMemory } from "./memory";
import { runWithBudget, type RunBudget, type BudgetedResult } from "./budget";
import { textAgent } from "./text-agent";
import { adminAgent } from "./admin-agent";
import { homeAgent } from "./home-agent";
import { voiceAgent } from "./voice-agent";
import { prospectingAgent } from "./prospecting-agent";
import { outreachAgent } from "./outreach-agent";

// Re-export the catalog-binding seam so each Agent module (text-agent.ts /
// admin-agent.ts) generates its `tools` from the single canonical Tool_Catalog
// (Requirement 1.3 #3, 2.3). An agent has no tool object for any name that is
// not a Catalog_Entry, preserving the audited boundary.
export { bindCatalog } from "./binding";
// Re-export the tracing exporter (Requirement 1.3 #5) so the worker tier feeds
// Mastra run/step spans to it (`tracingExporter.exportSpan`), projecting agent
// reasoning onto the SSE bus / Demo Console.
export { tracingExporter } from "./tracing";

// Register the S5 Briefing_Workflow through the runtime's public surface. It is
// a function-style workflow (`assembleBriefing`) — the same convention as the S3
// lead-nudge sweep — not a Mastra `Workflow` instance, so it cannot go in the
// typed `workflows` map (which accepts `AnyWorkflow` only). Re-exporting its
// entry point here keeps the single runtime module the one discovery point for
// the home agent + briefing workflow, consistent with `bindCatalog` above.
// [container-only] — assembly runs on the worker tier (`assertBriefingContainerTier`).
export { assembleBriefing, type BriefingResult } from "./workflows/briefing-workflow";

/**
 * The default per-run cost ceiling applied by {@link runAgentTurn} when a caller
 * does not supply its own (Requirement 5.4). Conservative defaults suitable for
 * the cheap multi-step `fast` tier; high-stakes turns can pass a wider budget.
 */
export const DEFAULT_RUN_BUDGET: RunBudget = {
  maxSteps: 12,
  maxTokens: 100_000,
};

/**
 * The ONE Mastra instance (Requirement 1.3). Registers:
 *   - `gateways.doe` — model tiering routed through the CF AI Gateway (R5.1)
 *   - `memory.agentMemory` — durable Agent_Memory (Postgres + pgvector, R4.1)
 *   - `agents` / `workflows` — populated as capabilities migrate (5.3 / 5.4)
 * The tracing exporter (R6) is wired through `tracingExporter` (re-exported
 * above) rather than the Mastra observability registry, because the project's
 * exporter publishes to the existing SSE bus (tracing.ts) rather than to a
 * Mastra-native observability backend.
 */
export const mastra = new Mastra({
  // 1. agents — the migrated text + admin Agents (tasks 5.3 / 5.4) plus the S5
  //    Home_Agent (agent:home-twin, task 9.1), registered so the single runtime
  //    resolves it by name (`mastra.getAgent("homeAgent")`) exactly as it does
  //    the text/admin agents. [container-only] — `homeAgent` and its tooling run
  //    on the worker tier only; runtime.ts is never imported by `app/`.
  //    The S6 Voice_Agent (agent:voice-lead) is registered here too so the
  //    serving path resolves it by name (`mastra.getAgent("voiceAgent")`).
  //    The S7 Prospecting_Agent (agent:prospecting) is registered so its turn
  //    runner resolves it by name (`mastra.getAgent("prospectingAgent")`) with
  //    the `doe` model gateway in scope. [container-only] — worker tier only.
  //    The S7 Outreach_Agent (agent:outreach) is registered alongside it so its
  //    turn runner resolves it by name (`mastra.getAgent("outreachAgent")`); it
  //    holds only `draft_outreach` — the send is human-gated and ungrantable.
  agents: { textAgent, adminAgent, homeAgent, voiceAgent, prospectingAgent, outreachAgent },
  // 2. workflows — Mastra Workflows are added here as multi-step flows land.
  //    The S5 Briefing_Workflow is a function-style workflow (`assembleBriefing`,
  //    re-exported below), mirroring the S3 lead-nudge sweep convention: it is
  //    invoked directly by the home route + the `briefing_assembly` job, NOT a
  //    Mastra `Workflow` instance, so it is NOT placed in this typed map (which
  //    accepts `AnyWorkflow` only). It is registered through the runtime's
  //    public surface via the re-export below.
  workflows: {},
  // 4. Agent_Memory — durable working + long-term memory (R4.1, R1.3 #4).
  memory: { agentMemory: getAgentMemory() },
  // Model tiering: every agent/tool model call is transported through the
  // existing Cloudflare AI Gateway via this custom gateway (R5.1).
  gateways: { doe: new DoeModelGateway() },
});

// The structural type used to look agents up before the typed `agents` map is
// populated. Once textAgent/adminAgent are registered (5.3/5.4) callers get the
// fully-typed `mastra.getAgent("textAgent")` directly.
type AnyAgent = Agent;
type AgentTurnMessages = Parameters<AnyAgent["generate"]>[0];
type AgentTurnResult = Awaited<ReturnType<AnyAgent["generate"]>>;

/** Options for {@link runAgentTurn}. */
export interface RunAgentTurnOptions {
  /** Per-run cost ceiling; defaults to {@link DEFAULT_RUN_BUDGET} (R5.4). */
  budget?: RunBudget;
}

/**
 * Run a single turn of a registered Mastra agent under the per-run cost ceiling
 * (Requirements 5.4, 5.5). Resolves the agent by name from the single runtime,
 * then runs its generation inside `runWithBudget` so a run that crosses the
 * ceiling returns a structured budget-exceeded result instead of spending more.
 *
 * This is the typed helper the chat entry points consume (Design §Architecture);
 * the deterministic ↔ agent routing wraps it via `serveCapability`
 * (migration-switch.ts, task 5.1).
 *
 * @param agentName The key the agent is registered under in {@link mastra}.
 * @param messages  The turn input (a string or Mastra message list).
 * @param options   Optional per-run budget override.
 * @throws if no agent is registered under `agentName`.
 */
export async function runAgentTurn(
  agentName: string,
  messages: AgentTurnMessages,
  options: RunAgentTurnOptions = {},
): Promise<BudgetedResult<AgentTurnResult>> {
  const runtime = mastra as unknown as Mastra;
  const agent = runtime.getAgent(agentName);
  if (!agent) {
    throw new Error(
      `runAgentTurn: no agent registered under "${agentName}". ` +
        "Agents are registered in lib/cms/agents/runtime.ts " +
        "(see text-agent.ts / admin-agent.ts).",
    );
  }

  const budget = options.budget ?? DEFAULT_RUN_BUDGET;
  return runWithBudget(budget, (signal) =>
    agent.generate(messages, { abortSignal: signal }),
  );
}
