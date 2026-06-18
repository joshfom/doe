// lib/cms/agents/admin-agent.ts
//
// The migrated admin Agent (Design §Components #6 "Migrated admin capabilities
// + HITL", "Where the switch is wired"). This is the Mastra `Agent` that serves
// the staff/admin capabilities once the Migration_Switch routes a capability to
// the agent path: the six read-only SQL-backed reports plus the
// human-in-the-loop confirmation flow (`propose_admin_action` /
// `confirm_admin_action`). It is constructed with `bindCatalog` over the
// canonical admin Catalog_Entries (ADMIN_CAPABILITY_NAMES) under the
// ADMIN_AGENT_ACTOR identity and a declared model tier (MODEL_TIERS), so every
// tool the agent can call is a 1:1 binding onto a Catalog_Entry whose
// `execute()` flows through the audited `dispatchTool` (Mastra is the brain;
// the dispatcher is the hands — Requirements 2.3, 3.1, 10.3).
//
// `runAdminAgentTurn` runs a single turn through the runtime (`runAgentTurn`)
// under the per-run cost ceiling, then adapts the Mastra result into the same
// `AdminAgentResult` shape the deterministic `runAdminAgent` returns — so the
// Migration_Switch can swap the two paths transparently behind `runAdminAgent`
// without changing the `ai-admin.ts` route signature (CC-NoRegress, Req 14.1).
//
// Durable confirmation store (Req 9.3–9.5): this module installs the durable,
// `admin_confirmations`-backed confirmation-token store at load time via
// `setAdminConfirmationStore(createDurableAdminConfirmationStore())`. Because
// this module is loaded ONLY on the container/worker tier (it pulls in
// `@mastra/core/agent`), the durable store is installed exactly where the
// Admin_Confirmation_Flow runs, while the in-memory default the catalog ships
// with (and tests use) is left untouched on every other tier.
//
// [container-only] The Mastra runtime, this Agent, its memory connection, and
// its tracing run on the container/worker tier ONLY, never on Next.js
// serverless (Requirement 15.3). This module pulls in `@mastra/core/agent`, so
// it MUST NOT be statically imported by any `app/` route/page/layout module —
// the admin chat flow (`lib/cms/ai/admin-agent.ts` → `ai-admin.ts` route)
// imports it lazily (dynamic `import()` inside the Migration_Switch's agent
// branch) so Mastra is never bundled onto the serverless route.
//
// [deps] Depends on the pinned Mastra packages and the Cloudflare AI Gateway
// env (gateway.ts) for the declared model tier.
//
// Design references: §Components #6 (Migrated admin capabilities + HITL, Where
// the switch is wired). Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 10.3, 14.1.

import { Agent } from "@mastra/core/agent";

import type { Database } from "../db";
import type { AdminAgentInput, AdminAgentResult } from "../ai/admin-agent";
import {
  ADMIN_AGENT_ACTOR,
  ADMIN_CAPABILITY_NAMES,
  createDurableAdminConfirmationStore,
  loadAdminCapabilities,
  setAdminConfirmationStore,
} from "../ai/tools/admin-capabilities";

import { bindCatalog } from "./binding";
import { MODEL_TIERS, type ModelTier } from "./gateway";
import { getAgentMemory } from "./memory";
// Type-only import (erased at build) so there is NO static import cycle with
// runtime.ts — runtime.ts imports `adminAgent` from this module to register it,
// while this module reaches `runAgentTurn` lazily (dynamic import in the turn
// runner below). The two modules therefore never form a runtime import cycle.
import type { RunAgentTurnOptions } from "./runtime";
import type { Capability } from "./migration-switch";

// ── Durable confirmation-token store (Req 9.3–9.5) ───────────────────────────

// Install the durable, `admin_confirmations`-backed confirmation-token store as
// the active store the moment this (container-only) module loads. The
// propose/confirm catalog entries resolve the store lazily through
// `getAdminConfirmationStore()`, so swapping it here makes the
// Admin_Confirmation_Flow durable and user-bound across requests and worker
// invocations (Req 9.3–9.5) WITHOUT touching the catalog entries. The in-memory
// default the catalog ships with — used by unit tests that never load this
// Mastra module — is left untouched everywhere else.
setAdminConfirmationStore(createDurableAdminConfirmationStore());

// ── Agent identity, model tier, and the bound catalog ────────────────────────

/** The key the admin Agent is registered under in the single Mastra runtime. */
export const ADMIN_AGENT_NAME = "adminAgent";

/**
 * The declared Model_Tier for the admin Agent (Requirement 5.3). Staff
 * operations (report narration, destructive-action confirmation) are
 * lower-frequency, higher-stakes turns, so the admin path runs on the `premium`
 * tier; the runtime selects this tier for every admin-agent run.
 */
export const ADMIN_AGENT_MODEL_TIER: ModelTier = "premium";

/**
 * The model string the runtime resolves through the {@link MODEL_TIERS} gateway
 * (`<gatewayId>/<providerId>/<modelId>`): the `doe` gateway, its `cf` provider,
 * and the concrete tool-capable model backing the declared tier. Routing every
 * model call through this string keeps the agent on the Cloudflare AI Gateway
 * transport (Requirement 5.1).
 */
export const ADMIN_AGENT_MODEL = `doe/cf/${MODEL_TIERS[ADMIN_AGENT_MODEL_TIER]}`;

/**
 * Load and validate the admin Catalog_Entries once at module load. A failure
 * here means an admin capability is malformed (missing field / duplicate name)
 * — we fail fast rather than register an Agent with a partial tool set.
 */
function loadAdminCatalog() {
  const result = loadAdminCapabilities();
  if (!result.ok) {
    throw new Error(
      `admin-agent: admin capability catalog failed to load: ${result.errors
        .map((e) => e.message)
        .join("; ")}`,
    );
  }
  return result.catalog;
}

/** The system prompt anchoring the admin Agent to the audited-tool contract. */
const ADMIN_AGENT_INSTRUCTIONS = [
  "You are ORA's staff/admin operations assistant for DOE.",
  "You help authenticated staff operate the platform through your tools:",
  "pulling read-only reports (overview, projects, clients, leads, tickets,",
  "appointments) and performing destructive admin actions behind a",
  "human-in-the-loop confirmation flow.",
  "",
  "Rules:",
  "- For any figure you report, call the matching report_* tool and narrate",
  "  EXACTLY the numbers it returns. Never compute, estimate, or adjust a",
  "  figure yourself — the figures are computed in SQL, you only narrate them.",
  "- NEVER perform a destructive action directly. To change a ticket's status,",
  "  cancel / reschedule / complete an appointment, or run any bulk operation,",
  "  first call propose_admin_action to obtain a confirmation token, present",
  "  the proposal to the operator, and only run confirm_admin_action once the",
  "  operator confirms with that token.",
  "- A confirmation token is single-use, short-lived, and bound to the",
  "  requesting operator. If confirm_admin_action reports the token was",
  "  expired, already used, or not theirs, ask the operator to re-run the",
  "  request to get a fresh confirmation.",
  "- If a tool returns a structured error, explain it plainly and offer a next",
  "  step; do not retry blindly.",
].join("\n");

/**
 * The migrated admin Agent (Requirement 9.1). Its tools are generated 1:1 from
 * the canonical admin Catalog_Entries via {@link bindCatalog}, each dispatching
 * through the audited `dispatchTool` under the {@link ADMIN_AGENT_ACTOR}
 * identity (Requirements 2.3, 3.1, 10.3). Memory is resolved lazily (a
 * function) so importing this module never opens a database connection — the
 * connection is only established when a turn actually runs on the container tier.
 */
export const adminAgent = new Agent({
  id: ADMIN_AGENT_NAME,
  name: ADMIN_AGENT_NAME,
  instructions: ADMIN_AGENT_INSTRUCTIONS,
  model: ADMIN_AGENT_MODEL,
  tools: bindCatalog(loadAdminCatalog(), [...ADMIN_CAPABILITY_NAMES], {
    agentActor: ADMIN_AGENT_ACTOR,
  }),
  // Lazy: defer the Agent_Memory (Postgres + pgvector) connection to first use.
  memory: () => getAgentMemory(),
});

// ── runAdminAgentTurn — the agent path behind the Migration_Switch ────────────

/** Options for {@link runAdminAgentTurn} (forwarded to {@link runAgentTurn}). */
export interface RunAdminAgentTurnOptions extends RunAgentTurnOptions {}

/**
 * A single, concretely role-typed message for a Mastra turn. Mapping the turn
 * input to one of these discriminated members keeps the assembled list
 * assignable to Mastra's message-list input.
 */
type TurnMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | { role: "system"; content: string };

/**
 * Run one admin-agent turn through the single Mastra runtime and adapt the
 * result into the deterministic {@link AdminAgentResult} shape so the
 * Migration_Switch can serve it interchangeably with `runAdminAgent`
 * (Requirement 14.1).
 *
 * The turn runs under the per-run cost ceiling (Requirements 5.4, 5.5) via
 * {@link runAgentTurn}; if the run crosses its budget we throw, so
 * `serveCapability` falls back to the deterministic path for that capability
 * (Requirements 7.3, 14.3) rather than returning a half-finished answer.
 *
 * Reports and destructive actions the agent performs go through its bound tools
 * → `dispatchTool` (Zod → RBAC → OTP → audit → execute) under the
 * {@link ADMIN_AGENT_ACTOR} identity, so a migrated capability records the same
 * actor attribution semantics as the deterministic path (Requirement 10.3) and
 * destructive actions remain gated by the durable confirmation flow
 * (Requirements 9.3–9.5).
 *
 * @param _db        The active database handle (threaded for parity with
 *                   `runAdminAgent`; the bound tools dispatch through their own
 *                   audited seam).
 * @param input      The admin turn input (userId, message, optional token).
 * @param capability The capability this turn is serving (recorded on metadata).
 * @param options    Optional per-run budget override.
 */
export async function runAdminAgentTurn(
  _db: Database,
  input: AdminAgentInput,
  capability: Capability,
  options: RunAdminAgentTurnOptions = {},
): Promise<AdminAgentResult> {
  // A confirmation turn echoes the token back; surface that to the agent as a
  // system note alongside the operator's message so it can drive
  // confirm_admin_action. Otherwise the turn is just the operator's message.
  const messages: TurnMessage[] = input.confirmationToken
    ? [
        {
          role: "system",
          content: `The operator is confirming a previously proposed action with token ${input.confirmationToken}. Call confirm_admin_action with this token.`,
        },
        { role: "user", content: input.message },
      ]
    : [{ role: "user", content: input.message }];

  // Run through the single Mastra runtime under the per-run cost ceiling.
  // Imported lazily to keep runtime.ts ↔ admin-agent.ts free of a static cycle
  // (runtime.ts statically imports `adminAgent` from here to register it).
  const { runAgentTurn } = await import("./runtime");
  const outcome = await runAgentTurn(ADMIN_AGENT_NAME, messages, options);

  if (!outcome.ok) {
    // Budget crossed before the run could complete — let the Migration_Switch
    // fall back to the deterministic path (Req 5.5, 7.3).
    throw new Error(
      `admin-agent: run for "${capability}" exceeded its budget ` +
        `(${outcome.budgetExceeded.reason}: tokens=${outcome.budgetExceeded.usedTokens}, ` +
        `steps=${outcome.budgetExceeded.usedSteps})`,
    );
  }

  return {
    response: outcome.result.text,
    metadata: {
      intent: capability,
      agent: true,
      viaAgent: true,
      modelTier: ADMIN_AGENT_MODEL_TIER,
    },
  };
}
