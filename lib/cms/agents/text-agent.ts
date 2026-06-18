// lib/cms/agents/text-agent.ts
//
// The migrated text Agent (Design §Components #6 "Migrated text capabilities",
// "Where the switch is wired"). This is the Mastra `Agent` that serves the ten
// public text-agent capabilities once the Migration_Switch routes a capability
// to the agent path. It is constructed with `bindCatalog` over the canonical
// text Catalog_Entries (TEXT_CAPABILITY_NAMES) and a declared model tier
// (MODEL_TIERS), so every tool the agent can call is a 1:1 binding onto a
// Catalog_Entry whose `execute()` flows through the audited `dispatchTool`
// (Mastra is the brain; the dispatcher is the hands — Requirements 2.3, 3.1).
//
// `runTextAgentTurn` runs a single turn through the runtime (`runAgentTurn`)
// under the per-run cost ceiling, then adapts the Mastra result into the same
// `AgentResult` shape the deterministic `runAgent` returns — so the
// Migration_Switch can swap the two paths transparently behind
// `handleChatMessage` without changing any caller (CC-NoRegress, Requirement
// 14.1).
//
// [container-only] The Mastra runtime, this Agent, its memory connection, and
// its tracing run on the container/worker tier ONLY, never on Next.js
// serverless (Requirement 15.3). This module pulls in `@mastra/core/agent`, so
// it MUST NOT be statically imported by any `app/` route/page/layout module —
// the public chat flow (`lib/cms/ai/chat.ts`) imports it lazily (dynamic
// `import()` inside the Migration_Switch's agent branch) so Mastra is never
// bundled onto the serverless route.
//
// [deps] Depends on the pinned Mastra packages and the Cloudflare AI Gateway
// env (gateway.ts) for the declared model tier.
//
// Design references: §Components #6 (Migrated text capabilities, Where the
// switch is wired). Requirements: 5.3, 7.1, 8.1, 8.2, 8.3, 8.4, 8.5, 14.1, 14.2.

import { Agent } from "@mastra/core/agent";

import type { Database } from "../db";
import type { AgentResult, ConversationContact } from "../ai/agent";
import type { IdentityResult } from "../ai/identity";
import {
  TEXT_AGENT_ACTOR,
  TEXT_CAPABILITY_NAMES,
  loadTextCapabilities,
} from "../ai/tools/text-capabilities";

import { bindCatalog } from "./binding";
import { MODEL_TIERS, type ModelTier } from "./gateway";
import { getAgentMemory } from "./memory";
// Type-only import (erased at build) so there is NO static import cycle with
// runtime.ts — runtime.ts imports `textAgent` from this module to register it,
// while this module reaches `runAgentTurn` lazily (dynamic import in the turn
// runner below). The two modules therefore never form a runtime import cycle.
import type { RunAgentTurnOptions } from "./runtime";
import type { Capability } from "./migration-switch";

// ── Agent identity, model tier, and the bound catalog ────────────────────────

/** The key the text Agent is registered under in the single Mastra runtime. */
export const TEXT_AGENT_NAME = "textAgent";

/**
 * The declared Model_Tier for the text Agent (Requirement 5.3). The text path
 * is a cheap, high-frequency multi-step loop, so it runs on the `fast` tier;
 * the runtime selects this tier for every text-agent run.
 */
export const TEXT_AGENT_MODEL_TIER: ModelTier = "fast";

/**
 * The model string the runtime resolves through the {@link MODEL_TIERS} gateway
 * (`<gatewayId>/<providerId>/<modelId>`): the `doe` gateway, its `cf` provider,
 * and the concrete tool-capable model backing the declared tier. Routing every
 * model call through this string keeps the agent on the Cloudflare AI Gateway
 * transport (Requirement 5.1).
 */
export const TEXT_AGENT_MODEL = `doe/cf/${MODEL_TIERS[TEXT_AGENT_MODEL_TIER]}`;

/**
 * Load and validate the text Catalog_Entries once at module load. A failure
 * here means a text capability is malformed (missing field / duplicate name) —
 * we fail fast rather than register an Agent with a partial tool set.
 */
function loadTextCatalog() {
  const result = loadTextCapabilities();
  if (!result.ok) {
    throw new Error(
      `text-agent: text capability catalog failed to load: ${result.errors
        .map((e) => e.message)
        .join("; ")}`,
    );
  }
  return result.catalog;
}

/** The system prompt anchoring the text Agent to the audited-tool contract. */
const TEXT_AGENT_INSTRUCTIONS = [
  "You are ORA's public website assistant for DOE.",
  "You help website visitors by taking concrete actions through your tools:",
  "capturing leads, registering third-party clients, opening support tickets,",
  "booking / cancelling / rescheduling appointments, issuing verification (OTP)",
  "codes, handing the conversation to a human, navigating to site pages, and",
  "persisting the contact details a visitor shares.",
  "",
  "Rules:",
  "- ALWAYS act through your tools. Never claim a ticket, booking, lead, OTP, or",
  "  handover happened unless the corresponding tool returned success.",
  "- Never invent reference numbers, figures, or account details — only report",
  "  what a tool returned.",
  "- Ask for any missing required fields (e.g. name, email, phone) before",
  "  calling a tool that needs them.",
  "- Reply in the visitor's language (English or Arabic), matching their turn.",
  "- If a tool returns a structured error, explain it plainly and offer a next",
  "  step; do not retry blindly.",
].join("\n");

/**
 * The migrated text Agent (Requirement 8.1). Its tools are generated 1:1 from
 * the canonical text Catalog_Entries via {@link bindCatalog}, each dispatching
 * through the audited `dispatchTool` (Requirements 2.3, 3.1, 8.2). Memory is
 * resolved lazily (a function) so importing this module never opens a database
 * connection — the connection is only established when a turn actually runs on
 * the container tier.
 */
export const textAgent = new Agent({
  id: TEXT_AGENT_NAME,
  name: TEXT_AGENT_NAME,
  instructions: TEXT_AGENT_INSTRUCTIONS,
  model: TEXT_AGENT_MODEL,
  tools: bindCatalog(loadTextCatalog(), TEXT_CAPABILITY_NAMES, {
    agentActor: TEXT_AGENT_ACTOR,
  }),
  // Lazy: defer the Agent_Memory (Postgres + pgvector) connection to first use.
  memory: () => getAgentMemory(),
});

// ── runTextAgentTurn — the agent path behind the Migration_Switch ─────────────

/** A single text-agent turn's input, mirroring the deterministic `AgentInput`. */
export interface TextAgentTurnInput {
  conversationId: string;
  message: string;
  history: Array<{ role: string; content: string }>;
  identity: IdentityResult;
  language: "en" | "ar";
  contact: ConversationContact;
}

/** Options for {@link runTextAgentTurn} (forwarded to {@link runAgentTurn}). */
export interface RunTextAgentTurnOptions extends RunAgentTurnOptions {}

/**
 * A single, concretely role-typed message for a Mastra turn. Mapping each
 * history item to one of these discriminated members (rather than an object
 * with a union `role`) keeps the assembled list assignable to Mastra's
 * message-list input.
 */
type TurnMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | { role: "system"; content: string };

/** Map a stored conversation message onto a concrete role-typed turn message. */
function toTurnMessage(m: { role: string; content: string }): TurnMessage {
  if (m.role === "assistant") return { role: "assistant", content: m.content };
  if (m.role === "system") return { role: "system", content: m.content };
  return { role: "user", content: m.content };
}

/**
 * Run one text-agent turn through the single Mastra runtime and adapt the
 * result into the deterministic {@link AgentResult} shape so the
 * Migration_Switch can serve it interchangeably with `runAgent`
 * (Requirement 14.1).
 *
 * The turn runs under the per-run cost ceiling (Requirements 5.4, 5.5) via
 * {@link runAgentTurn}; if the run crosses its budget we throw, so
 * `serveCapability` falls back to the deterministic path for that capability
 * (Requirements 7.3, 14.3) rather than returning a half-finished answer.
 *
 * Mutations and personal-data reads the agent performs go through its bound
 * tools → `dispatchTool` (Zod → RBAC → OTP → audit → execute), so a migrated
 * capability produces the same audited side effect as the deterministic path
 * for an equivalent request (Requirements 8.2, 8.3, 14.1).
 *
 * @param _db        The active database handle (threaded for parity with
 *                   `runAgent`; the bound tools dispatch through their own
 *                   audited seam).
 * @param input      The turn input (message, history, identity, language).
 * @param capability The capability this turn is serving (recorded on metadata).
 * @param options    Optional per-run budget override.
 */
export async function runTextAgentTurn(
  _db: Database,
  input: TextAgentTurnInput,
  capability: Capability,
  options: RunTextAgentTurnOptions = {},
): Promise<AgentResult> {
  // Build the turn as the prior conversation history plus the new user message,
  // so the agent reasons with context exactly as the deterministic path does.
  // Each item is mapped to a concrete role-typed message so the array is a
  // valid Mastra message-list input.
  const messages: TurnMessage[] = [
    ...input.history.map(toTurnMessage),
    { role: "user", content: input.message },
  ];

  // Run through the single Mastra runtime under the per-run cost ceiling.
  // Imported lazily to keep runtime.ts ↔ text-agent.ts free of a static cycle
  // (runtime.ts statically imports `textAgent` from here to register it).
  const { runAgentTurn } = await import("./runtime");
  const outcome = await runAgentTurn(TEXT_AGENT_NAME, messages, options);

  if (!outcome.ok) {
    // Budget crossed before the run could complete — let the Migration_Switch
    // fall back to the deterministic path (Req 5.5, 7.3).
    throw new Error(
      `text-agent: run for "${capability}" exceeded its budget ` +
        `(${outcome.budgetExceeded.reason}: tokens=${outcome.budgetExceeded.usedTokens}, ` +
        `steps=${outcome.budgetExceeded.usedSteps})`,
    );
  }

  const response = outcome.result.text;

  return {
    handled: true,
    response,
    identity: input.identity,
    contact: input.contact,
    metadata: {
      intent: capability,
      agent: true,
      viaAgent: true,
      modelTier: TEXT_AGENT_MODEL_TIER,
    },
  };
}
