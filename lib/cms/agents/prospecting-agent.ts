// lib/cms/agents/prospecting-agent.ts
//
// The Prospecting_Agent — the "navigator" of the outbound Prospecting Workspace
// (S7, Design §Components #1 "Prospecting_Brief + Buyer_Hypothesis"). This is
// the single Mastra `Agent` that drives the property-led hero flow: given a
// Prospecting_Brief it pulls comparable competitor projects + their SQL-sourced
// transaction stats FIRST (show stats before searching, Requirement 10.2),
// derives an evidence-backed, editable Buyer_Hypothesis whose every numeric
// claim is grounded in the market mirror (the model narrates, never computes —
// Requirements 10.3, 10.4), and proposes it for rep edit (Requirement 10.6)
// before any people search runs. An ICP-led entry (a direct filter, no brief)
// skips the comparables step and goes straight to `prospect_search`
// (Requirement 10.5).
//
// THE ONE RULE, preserved (Design §Architecture, Requirement 8.1). The agent
// reasons and plans; the audited `dispatchTool` executes. Every market read,
// provider call, and mutation is a `bindCatalog`-generated tool whose
// `execute()` flows through the unchanged dispatcher (Zod → RBAC → OTP → audit
// → execute) under the `agent:prospecting` identity. The agent holds a tool
// object ONLY for a Catalog_Entry name it is granted, so it can never invoke an
// off-catalog tool and never touches the database or a provider API directly.
// It is NOT granted `draft_outreach` (the Outreach_Agent's tool) nor
// `send_outreach` (human-gated, never agent-grantable — Design §5, §7).
//
// BUYER_HYPOTHESIS IS SQL-GROUNDED (Requirement 10.4, CC-SQL). The agent derives
// the hypothesis from the comparables' stats returned by `find_comparables` /
// `market_comps`; every `evidence` item names the SQL `sourceTable`
// (`market_transactions` / `market_price_index`) and the `asOf` of the figure
// it relied on. The figure itself is read from `market_*` by the tool — the
// model only narrates it. The derived hypothesis is validated against
// {@link buyerHypothesisSchema} and emitted as an editable proposal
// (`prospecting.hypothesis.proposed`) the rep adjusts before Target_Search runs.
//
// EVENT EMISSION IS ORCHESTRATION, NOT AGENT DB ACCESS. The agent's reasoning
// core reaches the world only through its bound catalog tools. The lifecycle
// event `prospecting.hypothesis.proposed` is published by the turn runner
// ({@link runProspectingAgentTurn}) — the container-tier orchestration around
// the run — via the existing `publishEvent` bus, exactly as the Home_Agent's
// runner reads persona memory around its run. The `prospecting.brief.received`
// / `comparables.found` / `search.completed` / `target.*` lifecycle events are
// published by the `prospecting-run` workflow (task 5.2); this agent owns only
// the hypothesis proposal.
//
// [container-only] (Requirement 11/CC-Next16). The Mastra runtime, this Agent,
// its memory connection, and its tracing run on the container/worker tier ONLY,
// never on Next.js serverless. This module pulls in `@mastra/core/agent`, so it
// MUST NOT be statically imported by any `app/` route/page/layout module — the
// workspace surface (task 8.4) reaches it from the container tier.
// {@link assertProspectingContainerTier} refuses a serverless invocation before
// any turn runs (mirrors `home-agent.ts`'s `assertHomeContainerTier`).
//
// [deps] Depends on the pinned Mastra packages and the Cloudflare AI Gateway env
// (gateway.ts) for the declared `premium` model tier; tests mock the model
// gateway, the dispatcher, and the memory store, so no live credentials are
// required.
//
// Design references: §Components #1; §Architecture (agent identities and RBAC).
// Requirements: 10.2, 10.3, 10.4, 10.5, 10.6, 8.1.

import { Agent } from "@mastra/core/agent";

import type { Database } from "../db";
import {
  PROSPECTING_AGENT_ACTOR,
  loadProspectingCapabilities,
} from "../ai/tools/prospecting-capabilities";
import { publishEvent } from "../realtime/events";
import {
  buyerHypothesisSchema,
  type BuyerHypothesis,
} from "../prospecting/hypothesis";
import type { ProspectingBrief } from "../prospecting/brief";

import { bindCatalog } from "./binding";
import { runWithBudget, type RunBudget } from "./budget";
import { MODEL_TIERS, type ModelTier } from "./gateway";
import { getAgentMemory } from "./memory";

// ── Agent identity, model tier, and the granted tool set ──────────────────────

/** The key the Prospecting_Agent is registered under in the single Mastra runtime. */
export const PROSPECTING_AGENT_NAME = "prospectingAgent";

/**
 * The declared Model_Tier for the Prospecting_Agent (Design §Components #1).
 * Deriving a buyer hypothesis from market comparables is a higher-stakes,
 * lower-frequency reasoning step, so the navigator runs on the `premium` tier —
 * the same tier the Outreach_Agent's grounded drafting uses.
 */
export const PROSPECTING_AGENT_MODEL_TIER: ModelTier = "premium";

/**
 * The model string the runtime resolves through the {@link MODEL_TIERS} gateway
 * (`<gatewayId>/<providerId>/<modelId>`): the `doe` gateway, its `cf` provider,
 * and the concrete tool-capable model backing the declared tier. Routing every
 * model call through this string keeps the agent on the Cloudflare AI Gateway
 * transport.
 */
export const PROSPECTING_AGENT_MODEL = `doe/cf/${MODEL_TIERS[PROSPECTING_AGENT_MODEL_TIER]}`;

/**
 * The catalog tools the `agent:prospecting` identity may call (Design
 * §Architecture, "Agent identities and RBAC"). EXACTLY the navigator's grant —
 * the market reads, the people search/enrich, the Target write, and the
 * promotion handoff. It deliberately EXCLUDES `draft_outreach` (the
 * Outreach_Agent's tool) and `send_outreach` (human-gated, never agent
 * grantable). The seeded RBAC role grants exactly these names, so the dispatcher
 * denies anything else even if it were bound.
 */
export const PROSPECTING_AGENT_TOOL_NAMES = [
  "find_comparables",
  "market_comps",
  "prospect_search",
  "enrich_target",
  "record_target",
  "promote_target_to_lead",
] as const;

/**
 * The per-run cost ceiling applied to a Prospecting_Agent turn (Requirement
 * 5.4-style budget, mirrored from the home/admin runners). The navigator runs a
 * bounded multi-step loop (comparables → stats → hypothesis); a caller can
 * widen it per turn via {@link RunProspectingAgentTurnOptions.budget}.
 */
export const PROSPECTING_AGENT_RUN_BUDGET: RunBudget = {
  maxSteps: 16,
  maxTokens: 120_000,
};

/**
 * Load and validate the prospecting Catalog_Entries once at module load. A
 * failure here means a prospecting capability is malformed (missing field /
 * duplicate name) — we fail fast rather than register an Agent with a partial
 * tool set.
 */
function loadProspectingCatalog() {
  const result = loadProspectingCapabilities();
  if (!result.ok) {
    throw new Error(
      `prospecting-agent: prospecting capability catalog failed to load: ${result.errors
        .map((e) => e.message)
        .join("; ")}`,
    );
  }
  return result.catalog;
}

/** The system prompt anchoring the Prospecting_Agent to the property-led flow + the audited-tool contract. */
const PROSPECTING_AGENT_INSTRUCTIONS = [
  "You are the prospecting navigator for a Dubai luxury real-estate team.",
  "A rep tells you what they want to sell (a Prospecting_Brief: an own project",
  "or unit, and/or a free-form spec — area, price band, unit type, bedrooms,",
  "features) and you find who is most likely to buy it, grounded in real market",
  "data.",
  "",
  "How you act (this is non-negotiable):",
  "- ALWAYS act through your tools. Every market read, people search, target",
  "  write, and promotion is a catalog tool that runs through the audited",
  "  dispatcher. You never read or write the database, and you never call a data",
  "  provider, any other way.",
  "- For any market figure (a price, a price/sqft, a velocity, a buyer-segment",
  "  share), use EXACTLY the number a tool returned. Never compute, estimate,",
  "  round, or invent a figure yourself — figures come from SQL; you only",
  "  narrate them, unchanged.",
  "",
  "The property-led flow (the hero path):",
  "1. When given a brief, FIRST call find_comparables to pull comparable",
  "   competitor projects and their transaction stats. Present those comparables",
  "   and their stats to the rep as context BEFORE you search for any people.",
  "   Use market_comps to pull additional area/segment comps or price-index",
  "   figures when you need them.",
  "2. From the comparables and their stats, derive a Buyer_Hypothesis: the buyer",
  "   segments, feeder markets, titles, and wealth signals most likely to buy",
  "   this brief. Ground every numeric claim in a comparable's stats — each",
  "   evidence item must name the SQL source table (market_transactions or",
  "   market_price_index) and the as-of date of the figure it relied on. If the",
  "   market catalog returned no comparables, say so and propose a low-confidence",
  "   hypothesis from the brief alone.",
  "3. Present the Buyer_Hypothesis as an EDITABLE PROPOSAL. Do NOT run a people",
  "   search until the rep has reviewed (and possibly adjusted) it.",
  "4. Once the rep is happy with the hypothesis, call prospect_search against it,",
  "   then record_target and enrich_target for the candidates, and",
  "   promote_target_to_lead when a target qualifies.",
  "",
  "The ICP-led flow (the inverse entry):",
  "- If the rep gives you a direct ICP filter with no brief (e.g. \"find me",
  "  family offices in DIFC\"), skip the comparables and hypothesis steps and go",
  "  straight to prospect_search with that filter.",
  "",
  "How you write:",
  "- Write for a busy rep. Lead with the answer; keep it concise and discreet,",
  "  in an understated luxury register — never growth-hack spam.",
  "- NEVER print raw identifiers (UUIDs, party ids, phone hashes) or internal",
  "  tool names. Refer to a target, project, or person by name and human facts.",
  "",
  "When something cannot be done:",
  "- If no tool matches the request, say plainly that it is unavailable, do",
  "  nothing to the database, and keep the conversation open.",
  "- If a tool returns an error, say the action did not complete, do not claim",
  "  success, and keep the conversation open.",
].join("\n");

/**
 * The Prospecting_Agent (Design §Components #1). Its tools are generated 1:1
 * from the granted prospecting Catalog_Entries via {@link bindCatalog} under the
 * {@link PROSPECTING_AGENT_ACTOR} identity, each dispatching through the audited
 * `dispatchTool` (Requirement 8.1). Memory is resolved lazily (a function) so
 * importing this module never opens a database connection — the connection is
 * only established when a turn actually runs on the container tier.
 */
export const prospectingAgent = new Agent({
  id: PROSPECTING_AGENT_NAME,
  name: PROSPECTING_AGENT_NAME,
  instructions: PROSPECTING_AGENT_INSTRUCTIONS,
  model: PROSPECTING_AGENT_MODEL,
  tools: bindCatalog(loadProspectingCatalog(), [...PROSPECTING_AGENT_TOOL_NAMES], {
    agentActor: PROSPECTING_AGENT_ACTOR,
  }),
  // Lazy: defer the Agent_Memory (Postgres + pgvector) connection to first use.
  memory: () => getAgentMemory(),
});

// ── Container-tier guard ([container-only]) ───────────────────────────────────

/**
 * Thrown when the Prospecting_Agent turn runner is invoked on the serverless
 * tier rather than the container/worker tier (Requirement 11/CC-Next16). A hard
 * misconfiguration — the navigator never runs serverless. Mirrors
 * `home-agent.ts`'s `HomeAgentTierError`.
 */
export class ProspectingAgentTierError extends Error {
  readonly code = "container_tier_required";
  constructor(
    message = "Prospecting_Agent is restricted to the container/worker tier and must not run on Next.js serverless.",
  ) {
    super(message);
    this.name = "ProspectingAgentTierError";
  }
}

/**
 * Detect whether the current process is the serverless tier (same precedence as
 * `home-agent.ts`'s `detectServerless`): an explicit `DOE_TIER` override first,
 * then known serverless platform signals / the Next.js edge runtime, defaulting
 * to not-serverless (a standalone container/worker process or tests).
 */
function detectServerless(): boolean {
  const tier = process.env.DOE_TIER?.toLowerCase();
  if (tier === "container" || tier === "worker") return false;
  if (tier === "serverless") return true;
  if (
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.LAMBDA_TASK_ROOT
  ) {
    return true;
  }
  if (process.env.NEXT_RUNTIME === "edge") return true;
  return false;
}

/**
 * Refuse, without running a turn, any Prospecting_Agent invocation on the
 * serverless tier. Throws {@link ProspectingAgentTierError} when serverless.
 * Tests may force the decision via `serverless`.
 */
export function assertProspectingContainerTier(serverless?: boolean): void {
  if (serverless ?? detectServerless()) {
    throw new ProspectingAgentTierError();
  }
}

// ── Entry-mode resolution (property-led hero vs ICP-led inverse) ──────────────

/**
 * The resolved entry mode for a prospecting turn (Requirements 10.2, 10.5):
 *   - `brief` — a Prospecting_Brief is present: the agent pulls comparables +
 *     stats FIRST and proposes a Buyer_Hypothesis before searching people.
 *   - `icp`   — a direct ICP filter (no brief): the agent skips comparables and
 *     goes straight to `prospect_search`.
 *   - `chat`  — neither: a free-form conversational turn (clarify / follow-up).
 */
export type ProspectingEntryMode = "brief" | "icp" | "chat";

/** A single prospecting turn's input. */
export interface ProspectingAgentTurnInput {
  /** The new rep message for this turn. */
  message: string;
  /** The property-led entry point: what the rep wants to sell (Requirement 10.1). */
  brief?: ProspectingBrief;
  /**
   * The ICP-led entry point: a direct filter with no brief (Requirement 10.5).
   * Loosely typed here — the bound `prospect_search` tool validates it against
   * its own Zod schema at dispatch time.
   */
  icp?: unknown;
  /** Prior conversation history (optional), so the agent reasons with context. */
  history?: Array<{ role: string; content: string }>;
}

/**
 * Decide the entry mode for a turn (Requirements 10.2, 10.5). A brief always
 * takes precedence (the property-led hero flow); a bare ICP filter is the
 * inverse entry; neither is a conversational turn. Pure: no I/O.
 */
export function resolveProspectingEntry(
  input: Pick<ProspectingAgentTurnInput, "brief" | "icp">,
): ProspectingEntryMode {
  if (input.brief !== undefined) return "brief";
  if (input.icp !== undefined) return "icp";
  return "chat";
}

// ── Hypothesis extraction + the proposed-hypothesis event ─────────────────────

/**
 * Pull a validated {@link BuyerHypothesis} out of a Mastra turn result. The
 * navigator is asked to return its hypothesis as structured output (Mastra
 * surfaces it on `result.object`); we validate it against
 * {@link buyerHypothesisSchema} so a malformed or partial proposal is treated as
 * "no hypothesis" rather than emitted. Returns `null` when no valid hypothesis
 * is present (e.g. an ICP-led / conversational turn, or the catalog was empty).
 * Pure: no I/O.
 */
export function extractHypothesis(result: unknown): BuyerHypothesis | null {
  const candidate = (result as { object?: unknown } | null | undefined)?.object;
  if (candidate === undefined || candidate === null) return null;
  const parsed = buyerHypothesisSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/** A lightweight reference to the brief a proposed hypothesis was derived for. */
export interface HypothesisBriefRef {
  projectId?: string;
  aiUnitId?: string;
}

/**
 * Publish the `prospecting.hypothesis.proposed` lifecycle event (Requirement
 * 10.6) for an editable Buyer_Hypothesis the rep can adjust before Target_Search
 * runs. The payload carries the hypothesis and a reference to the brief it was
 * derived for; it contains no personal data and no raw phone (CC-Privacy holds
 * trivially — a hypothesis names only aggregate segments).
 */
export async function publishHypothesisProposed(
  db: Database,
  hypothesis: BuyerHypothesis,
  briefRef: HypothesisBriefRef = {},
): Promise<void> {
  await publishEvent(db, {
    type: "prospecting.hypothesis.proposed",
    payload: { hypothesis, brief: briefRef },
  });
}

// ── runProspectingAgentTurn — the navigator turn runner ───────────────────────

/** A single, concretely role-typed message for a Mastra turn. */
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

/** The minimal Mastra agent surface the turn runner needs (a test seam). */
export interface ProspectingAgentLike {
  generate(
    messages: TurnMessage[],
    options: { abortSignal?: AbortSignal; output?: unknown },
  ): Promise<unknown>;
}

/** Options for {@link runProspectingAgentTurn}. */
export interface RunProspectingAgentTurnOptions {
  /** Per-run cost ceiling; defaults to {@link PROSPECTING_AGENT_RUN_BUDGET}. */
  budget?: RunBudget;
  /** Force the tier decision (test-only); defaults to env-based detection. */
  serverless?: boolean;
  /**
   * The database handle used to publish `prospecting.hypothesis.proposed` for a
   * brief-led turn that produced a valid hypothesis. When omitted, the event is
   * not published (the runner still returns the hypothesis to the caller, which
   * is responsible for emitting it — e.g. the `prospecting-run` workflow).
   */
  db?: Database;
  /**
   * The agent to run (test seam). Defaults to the registered runtime agent so
   * the turn runs with the `doe` model gateway in scope; falls back to the
   * standalone {@link prospectingAgent} instance only if the runtime has not
   * registered it.
   */
  agent?: ProspectingAgentLike;
}

/** A structured tool result from a turn, surfaced so the UI can render cards. */
export interface ProspectingToolResult {
  /** The Catalog_Entry name the agent invoked (e.g. `find_comparables`). */
  toolName: string;
  /** The tool's (unwrapped) result payload — typed data the surface renders. */
  result: unknown;
}

/** The structured outcome of a prospecting turn. */
export type ProspectingAgentTurnResult =
  | {
      ok: true;
      /** Which entry path this turn took (Requirements 10.2, 10.5). */
      mode: ProspectingEntryMode;
      /** The agent's narrated response. */
      response: string;
      /** Structured tool results from this turn, for the surface's cards. */
      toolResults: ProspectingToolResult[];
      /**
       * The editable Buyer_Hypothesis the agent proposed (brief-led turns only),
       * or `null` for ICP-led / conversational turns. When non-null and a `db`
       * was supplied, `prospecting.hypothesis.proposed` was published for it.
       */
      hypothesis: BuyerHypothesis | null;
      /** Whether the proposed-hypothesis event was published this turn. */
      hypothesisProposed: boolean;
      /** The Model_Tier the turn ran on. */
      modelTier: ModelTier;
    }
  | {
      ok: false;
      /** The turn crossed its per-run cost ceiling before completing. */
      reason: "budget_exceeded";
      budgetExceeded: {
        reason: "tokens" | "steps";
        usedTokens: number;
        usedSteps: number;
      };
    };

/**
 * Resolve the agent to run a turn through the registered Mastra runtime so the
 * `doe` model gateway is in scope (calling the standalone `prospectingAgent`
 * directly leaves Mastra unable to resolve the `doe/cf/...` model string). A
 * dynamic import avoids a static import cycle with runtime.ts.
 */
async function resolveRegisteredAgent(): Promise<ProspectingAgentLike> {
  const { mastra } = await import("./runtime");
  const registered = (
    mastra as unknown as {
      getAgent: (name: string) => ProspectingAgentLike | undefined;
    }
  ).getAgent(PROSPECTING_AGENT_NAME);
  return registered ?? (prospectingAgent as unknown as ProspectingAgentLike);
}

/**
 * Run one prospecting turn through the Prospecting_Agent (Requirements 10.2,
 * 10.3, 10.4, 10.5, 10.6).
 *
 * The turn:
 *   1. refuses on the serverless tier ([container-only]);
 *   2. frames the entry mode (brief-led vs ICP-led) as a system directive so the
 *      agent pulls comparables + stats FIRST for a brief, or goes straight to
 *      `prospect_search` for an ICP filter;
 *   3. runs under the per-run cost ceiling — a crossing returns a structured
 *      `budget_exceeded` result rather than spending more;
 *   4. for a brief-led turn, extracts the agent's structured Buyer_Hypothesis,
 *      validates it, and (when a `db` is supplied) publishes
 *      `prospecting.hypothesis.proposed` so the rep can edit it before any
 *      people search (Requirement 10.6).
 *
 * Tool successes/failures and figure-preservation are governed by the agent
 * instructions + the audited dispatcher; the agent reaches the DB / providers
 * ONLY through its bound catalog tools (Requirement 8.1).
 */
export async function runProspectingAgentTurn(
  input: ProspectingAgentTurnInput,
  options: RunProspectingAgentTurnOptions = {},
): Promise<ProspectingAgentTurnResult> {
  // (1) [container-only] — refuse before any work on the serverless tier.
  assertProspectingContainerTier(options.serverless);

  const mode = resolveProspectingEntry(input);

  // (2) Frame the entry mode + any structured brief/ICP context as a system
  // directive. The brief/ICP payloads are passed as context the agent forwards
  // to its tools; the tools validate them at dispatch time.
  const directives: string[] = [];
  if (mode === "brief") {
    directives.push(
      "This is a property-led turn. Call find_comparables for the brief FIRST " +
        "and present the comparables and their stats before searching for " +
        "people. Then derive an editable Buyer_Hypothesis grounded in those " +
        "stats and return it as structured output. Do not run prospect_search " +
        "until the rep has reviewed the hypothesis.",
      `Brief: ${JSON.stringify(input.brief)}`,
    );
  } else if (mode === "icp") {
    directives.push(
      "This is an ICP-led turn with a direct filter and no brief. Skip " +
        "comparables and the hypothesis; call prospect_search against the " +
        "filter below.",
      `ICP filter: ${JSON.stringify(input.icp)}`,
    );
  }

  const messages: TurnMessage[] = [
    ...directives.map((content): TurnMessage => ({ role: "system", content })),
    ...(input.history ?? []).map(toTurnMessage),
    { role: "user", content: input.message },
  ];

  // (3) Run under the per-run cost ceiling.
  const agent = options.agent ?? (await resolveRegisteredAgent());
  const budget = options.budget ?? PROSPECTING_AGENT_RUN_BUDGET;

  // Request a structured Buyer_Hypothesis only for brief-led turns; an ICP-led /
  // conversational turn returns prose only.
  const generateOptions =
    mode === "brief" ? { output: buyerHypothesisSchema } : {};

  const outcome = await runWithBudget(budget, (signal) =>
    agent.generate(messages, { abortSignal: signal, ...generateOptions }),
  );

  if (!outcome.ok) {
    return {
      ok: false,
      reason: "budget_exceeded",
      budgetExceeded: outcome.budgetExceeded,
    };
  }

  const result = outcome.result as {
    text?: string;
    toolResults?: unknown;
  };

  // Extract the structured tool results so the surface can render typed cards.
  const rawResults = result.toolResults;
  const toolResults: ProspectingToolResult[] = Array.isArray(rawResults)
    ? rawResults
        .map((tr): ProspectingToolResult | null => {
          const payload = (tr as { payload?: unknown }).payload ?? tr;
          const p = payload as { toolName?: unknown; result?: unknown };
          return typeof p.toolName === "string"
            ? { toolName: p.toolName, result: p.result }
            : null;
        })
        .filter((t): t is ProspectingToolResult => t !== null)
    : [];

  // (4) Brief-led: extract + validate the proposed Buyer_Hypothesis and, when a
  // db handle is available, emit it as an editable proposal (Requirement 10.6).
  const hypothesis = mode === "brief" ? extractHypothesis(outcome.result) : null;
  let hypothesisProposed = false;
  if (hypothesis !== null && options.db !== undefined) {
    await publishHypothesisProposed(options.db, hypothesis, {
      projectId: input.brief?.projectId,
      aiUnitId: input.brief?.aiUnitId,
    });
    hypothesisProposed = true;
  }

  return {
    ok: true,
    mode,
    response: result.text ?? "",
    toolResults,
    hypothesis,
    hypothesisProposed,
    modelTier: PROSPECTING_AGENT_MODEL_TIER,
  };
}
