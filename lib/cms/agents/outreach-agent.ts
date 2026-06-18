// lib/cms/agents/outreach-agent.ts
//
// The Outreach_Agent — the grounded drafter of the outbound Prospecting
// Workspace (S7, Design §Components #7 "Grounded outreach + human-in-the-loop
// send"). This is the single Mastra `Agent` that composes an editable,
// multi-channel, UNSENT outreach draft for a researched Target: in the rep's
// voice, in the requested language (EN/AR), shaped for the requested channel
// (email / WhatsApp / message), and pinned to real SQL records by a grounding
// manifest (Requirements 6.1, 6.2). The draft is returned editable and is never
// sent as part of drafting (Requirement 6.3); a send always requires a separate
// human Approval_Flow token via `send_outreach` (Design §7, never agent
// grantable). The register is understated, discreet luxury — never a
// growth-hack spam pattern (Requirement 6.4).
//
// THE ONE RULE, preserved (Design §Architecture, Requirement 8.1). The agent
// reasons and writes prose; the audited `dispatchTool` executes. The single
// effect it can produce — persisting the draft — is the `bindCatalog`-generated
// `draft_outreach` tool whose `execute()` flows through the unchanged dispatcher
// (Zod → RBAC → OTP → audit → execute) under the `agent:outreach` identity. The
// agent holds a tool object ONLY for `draft_outreach`, so it can never invoke an
// off-catalog tool, never reads or writes the database directly, and is NOT
// granted `send_outreach` (the human-gated send) nor any of the navigator's
// market/search/promotion tools.
//
// EVERY FACTUAL CLAIM IS SQL-GROUNDED (Requirement 6.2, CC-SQL). The agent
// composes prose only; every price, comparable, or area-trend figure it states
// must be pinned by the draft's `grounding` manifest to a real record in a named
// SQL source (`market_transactions` / `market_price_index` / `leads_mirror` /
// `parties`) with its `asOf` stamp. The model narrates the figures the
// navigator's tools surfaced — it never invents or recomputes one. A claim the
// agent cannot pin to a SQL record carries NO source: it is OMITTED from the
// draft and FLAGGED back to the rep ({@link filterGroundedClaims}) rather than
// shipped as an unsourced assertion.
//
// EVENT EMISSION IS THE TOOL'S JOB, NOT THE AGENT'S. The agent's reasoning core
// reaches the world only through `draft_outreach`; that Catalog_Entry publishes
// `prospecting.outreach.drafted` from inside the audited dispatcher when the
// draft is persisted. This module's turn runner does not touch the event bus
// directly (it has no database handle of its own) — mirroring how the send
// path's approval/sent events are owned by `send_outreach`.
//
// [container-only] (Requirement 11/CC-Next16). The Mastra runtime, this Agent,
// its memory connection, and its tracing run on the container/worker tier ONLY,
// never on Next.js serverless. This module pulls in `@mastra/core/agent`, so it
// MUST NOT be statically imported by any `app/` route/page/layout module — the
// workspace surface (task 8.4) reaches it from the container tier.
// {@link assertOutreachContainerTier} refuses a serverless invocation before any
// turn runs (mirrors `prospecting-agent.ts`'s `assertProspectingContainerTier`).
//
// [deps] Depends on the pinned Mastra packages and the Cloudflare AI Gateway env
// (gateway.ts) for the declared `premium` model tier; tests mock the model
// gateway, the dispatcher, and the memory store, so no live credentials are
// required.
//
// Design references: §Components #7; §Architecture (agent identities and RBAC).
// Requirements: 6.1, 6.2, 6.3, 6.4, 8.1.

import { Agent } from "@mastra/core/agent";

import {
  PROSPECTING_OUTREACH_AGENT_ACTOR,
  createDurableOutreachApprovalStore,
  loadProspectingCapabilities,
  setOutreachApprovalStore,
} from "../ai/tools/prospecting-capabilities";
import { outreachDraftSchema, type OutreachDraft } from "../prospecting/outreach";

import { bindCatalog } from "./binding";
import { runWithBudget, type RunBudget } from "./budget";
import { MODEL_TIERS, type ModelTier } from "./gateway";
import { getAgentMemory } from "./memory";

// ── Durable Approval_Flow store (Req 7.1, 7.4) ────────────────────────────────
// Install the durable, `admin_confirmations`-backed Approval_Flow token store at
// load time — the REUSED S1 admin confirmation mechanism that gates
// `approve_outreach` / `send_outreach` (single-use, short-TTL, user-AND-draft
// bound). This mirrors how `admin-agent.ts` installs the durable admin store.
// Because this module is loaded ONLY on the container/worker tier (it pulls in
// `@mastra/core/agent`), the durable store is installed exactly where the
// outreach flow runs; the in-memory default the catalog ships with — used by
// unit tests that never load this Mastra module — is left untouched elsewhere.
setOutreachApprovalStore(createDurableOutreachApprovalStore());

// ── Agent identity, model tier, and the granted tool set ──────────────────────

/** The key the Outreach_Agent is registered under in the single Mastra runtime. */
export const OUTREACH_AGENT_NAME = "outreachAgent";

/**
 * The declared Model_Tier for the Outreach_Agent (Design §Components #7).
 * Composing a grounded, brand-sensitive approach in the rep's voice (and in
 * Arabic) is a higher-stakes, lower-frequency writing step, so the drafter runs
 * on the `premium` tier — the same tier the Prospecting_Agent's hypothesis
 * reasoning uses.
 */
export const OUTREACH_AGENT_MODEL_TIER: ModelTier = "premium";

/**
 * The model string the runtime resolves through the {@link MODEL_TIERS} gateway
 * (`<gatewayId>/<providerId>/<modelId>`): the `doe` gateway, its `cf` provider,
 * and the concrete tool-capable model backing the declared tier. Routing every
 * model call through this string keeps the agent on the Cloudflare AI Gateway
 * transport.
 */
export const OUTREACH_AGENT_MODEL = `doe/cf/${MODEL_TIERS[OUTREACH_AGENT_MODEL_TIER]}`;

/**
 * The catalog tools the `agent:outreach` identity may call (Design
 * §Architecture, "Agent identities and RBAC"). EXACTLY one — the grounded,
 * editable drafting tool. It deliberately EXCLUDES `send_outreach` (human-gated,
 * never agent grantable) and every navigator tool (the market reads, people
 * search/enrich, the Target write, and the promotion handoff). The seeded RBAC
 * role grants exactly this name, so the dispatcher denies anything else even if
 * it were bound.
 */
export const OUTREACH_AGENT_TOOL_NAMES = ["draft_outreach"] as const;

/**
 * The per-run cost ceiling applied to an Outreach_Agent turn (mirrored from the
 * navigator/home runners). Drafting is a short, bounded loop (compose → persist
 * one draft); a caller can widen it per turn via
 * {@link RunOutreachAgentTurnOptions.budget}.
 */
export const OUTREACH_AGENT_RUN_BUDGET: RunBudget = {
  maxSteps: 8,
  maxTokens: 80_000,
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
      `outreach-agent: prospecting capability catalog failed to load: ${result.errors
        .map((e) => e.message)
        .join("; ")}`,
    );
  }
  return result.catalog;
}

/** The system prompt anchoring the Outreach_Agent to the grounded-draft + audited-tool contract. */
const OUTREACH_AGENT_INSTRUCTIONS = [
  "You are the outreach drafter for a Dubai luxury real-estate team. A rep has",
  "researched a Target (a prospective buyer or partner) and asks you to compose",
  "a discreet, data-grounded approach they can edit before they decide to send.",
  "",
  "How you act (this is non-negotiable):",
  "- You ONLY draft. You compose the message and persist it as an editable,",
  "  UNSENT draft by calling draft_outreach. You never send anything: sending is",
  "  a separate, human-approved step you have no tool for.",
  "- draft_outreach is your only tool and runs through the audited dispatcher.",
  "  You never read or write the database any other way.",
  "",
  "Grounding (every figure must trace to a real record):",
  "- Write prose only. For any factual claim — a price, a price/sqft, an area",
  "  trend, a comparable sale — use EXACTLY the figure the rep's research and the",
  "  market tools surfaced. Never invent, estimate, round, or recompute a figure.",
  "- For every factual claim you make in the body, add a grounding entry that",
  "  pins it to its SQL source: the source table (market_transactions,",
  "  market_price_index, leads_mirror, or parties), the record id, and the",
  "  as-of date of the figure.",
  "- If you cannot pin a claim to a real record, DO NOT state it. Leave it out of",
  "  the body and flag it for the rep instead of shipping an unsourced figure.",
  "",
  "Language and channel:",
  "- Write in the requested language: English (en) or Arabic (ar). For Arabic,",
  "  write natural, native Arabic — do not transliterate.",
  "- Shape the message for the requested channel: a subject + longer body for",
  "  email; a short, warm, paragraph-light message for WhatsApp or message.",
  "",
  "Voice and register:",
  "- Write in the rep's voice, understated and discreet — a private, luxury",
  "  register. Lead with relevance to the recipient, not with a pitch.",
  "- No growth-hack spam patterns: no urgency tricks, no false scarcity, no",
  "  exclamation-heavy hype, no mass-mail phrasing. One quiet, credible approach.",
  "- NEVER print raw identifiers (UUIDs, party ids, phone hashes) or internal",
  "  tool names in the message body.",
  "",
  "When something cannot be done:",
  "- If you have no grounded substance to write from, say so plainly, do not",
  "  persist an empty or ungrounded draft, and keep the conversation open.",
  "- If draft_outreach returns an error, say the draft was not saved, do not",
  "  claim success, and keep the conversation open.",
].join("\n");

/**
 * The Outreach_Agent (Design §Components #7). Its single tool is generated 1:1
 * from the granted `draft_outreach` Catalog_Entry via {@link bindCatalog} under
 * the {@link PROSPECTING_OUTREACH_AGENT_ACTOR} identity, dispatching through the
 * audited `dispatchTool` (Requirement 8.1). Memory is resolved lazily (a
 * function) so importing this module never opens a database connection — the
 * connection is only established when a turn actually runs on the container tier.
 */
export const outreachAgent = new Agent({
  id: OUTREACH_AGENT_NAME,
  name: OUTREACH_AGENT_NAME,
  instructions: OUTREACH_AGENT_INSTRUCTIONS,
  model: OUTREACH_AGENT_MODEL,
  tools: bindCatalog(loadProspectingCatalog(), [...OUTREACH_AGENT_TOOL_NAMES], {
    agentActor: PROSPECTING_OUTREACH_AGENT_ACTOR,
  }),
  // Lazy: defer the Agent_Memory (Postgres + pgvector) connection to first use.
  memory: () => getAgentMemory(),
});

// ── Container-tier guard ([container-only]) ───────────────────────────────────

/**
 * Thrown when the Outreach_Agent turn runner is invoked on the serverless tier
 * rather than the container/worker tier (Requirement 11/CC-Next16). A hard
 * misconfiguration — the drafter never runs serverless. Mirrors
 * `prospecting-agent.ts`'s `ProspectingAgentTierError`.
 */
export class OutreachAgentTierError extends Error {
  readonly code = "container_tier_required";
  constructor(
    message = "Outreach_Agent is restricted to the container/worker tier and must not run on Next.js serverless.",
  ) {
    super(message);
    this.name = "OutreachAgentTierError";
  }
}

/**
 * Detect whether the current process is the serverless tier (same precedence as
 * `prospecting-agent.ts`'s `detectServerless`): an explicit `DOE_TIER` override
 * first, then known serverless platform signals / the Next.js edge runtime,
 * defaulting to not-serverless (a standalone container/worker process or tests).
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
 * Refuse, without running a turn, any Outreach_Agent invocation on the
 * serverless tier. Throws {@link OutreachAgentTierError} when serverless. Tests
 * may force the decision via `serverless`.
 */
export function assertOutreachContainerTier(serverless?: boolean): void {
  if (serverless ?? detectServerless()) {
    throw new OutreachAgentTierError();
  }
}

// ── Grounding manifest filtering (Requirement 6.2) ────────────────────────────

/**
 * Is a grounding entry actually pinned to a SQL record? An entry counts as
 * grounded only when it names a non-empty record id in a SQL source table. The
 * `sourceTable` enum is guaranteed by {@link outreachDraftSchema}; a blank
 * `recordId` is the model's signal that it could not find a real record for the
 * claim, so the claim has NO SQL source (Requirement 6.2).
 */
function isGrounded(entry: OutreachDraft["grounding"][number]): boolean {
  return typeof entry.recordId === "string" && entry.recordId.trim() !== "";
}

/** The result of separating a draft's grounded claims from its unsourced ones. */
export interface GroundingPartition {
  /** The grounding entries that resolve to a real SQL record — kept in the draft. */
  grounding: OutreachDraft["grounding"];
  /**
   * The claims that carry no SQL source — OMITTED from the draft and flagged
   * back to the rep rather than shipped as unsourced assertions (Requirement
   * 6.2). Empty when every claim is grounded.
   */
  flaggedClaims: string[];
}

/**
 * Partition a draft's grounding manifest into the claims that resolve to a real
 * SQL record (kept) and the claims that do not (flagged + omitted). This is the
 * agent-layer enforcement of "any claim with no SQL source must be omitted and
 * flagged" (Requirement 6.2): only grounded entries survive into the persisted
 * draft's manifest, and the dropped claims are surfaced to the rep. Pure: no
 * I/O. (The deeper guarantee — that each kept entry's record actually exists in
 * its named table — is the grounded-outreach property test, task 6.4.)
 */
export function filterGroundedClaims(
  grounding: OutreachDraft["grounding"],
): GroundingPartition {
  const kept: OutreachDraft["grounding"] = [];
  const flaggedClaims: string[] = [];
  for (const entry of grounding) {
    if (isGrounded(entry)) {
      kept.push(entry);
    } else {
      flaggedClaims.push(entry.claim);
    }
  }
  return { grounding: kept, flaggedClaims };
}

/**
 * Pull a validated {@link OutreachDraft} out of a Mastra turn result. The drafter
 * is asked to return its composed draft as structured output (Mastra surfaces it
 * on `result.object`); we validate it against {@link outreachDraftSchema} so a
 * malformed or partial draft is treated as "no draft" rather than persisted.
 * Returns `null` when no valid draft is present. Pure: no I/O.
 */
export function extractDraft(result: unknown): OutreachDraft | null {
  const candidate = (result as { object?: unknown } | null | undefined)?.object;
  if (candidate === undefined || candidate === null) return null;
  const parsed = outreachDraftSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

// ── runOutreachAgentTurn — the drafter turn runner ────────────────────────────

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
export interface OutreachAgentLike {
  generate(
    messages: TurnMessage[],
    options: { abortSignal?: AbortSignal; output?: unknown },
  ): Promise<unknown>;
}

/** The channel an outreach draft is shaped for. */
export type OutreachChannel = OutreachDraft["channel"];
/** The language an outreach draft is written in. */
export type OutreachLanguage = OutreachDraft["language"];

/** A single outreach drafting turn's input. */
export interface OutreachAgentTurnInput {
  /** The new rep instruction for this turn (e.g. "draft an intro for this villa"). */
  message: string;
  /** The researched Target the draft is for (Requirement 6.1). */
  targetId: string;
  /** The channel to shape the message for (Requirement 6.1). */
  channel: OutreachChannel;
  /** The language to write in — EN or AR (Requirement 6.1). */
  language: OutreachLanguage;
  /** Optional Prospecting_Brief the draft relates to. */
  briefId?: string;
  /**
   * The grounded research context the agent must write from: the Target's
   * enriched attributes and the SQL-sourced market figures (with their source
   * record ids + as-of) the navigator surfaced. Loosely typed — the agent
   * narrates it and pins each figure via the draft's grounding manifest.
   */
  context?: unknown;
  /** Prior conversation history (optional), so the agent reasons with context. */
  history?: Array<{ role: string; content: string }>;
}

/** Options for {@link runOutreachAgentTurn}. */
export interface RunOutreachAgentTurnOptions {
  /** Per-run cost ceiling; defaults to {@link OUTREACH_AGENT_RUN_BUDGET}. */
  budget?: RunBudget;
  /** Force the tier decision (test-only); defaults to env-based detection. */
  serverless?: boolean;
  /**
   * The agent to run (test seam). Defaults to the registered runtime agent so
   * the turn runs with the `doe` model gateway in scope; falls back to the
   * standalone {@link outreachAgent} instance only if the runtime has not
   * registered it.
   */
  agent?: OutreachAgentLike;
}

/** A structured tool result from a turn, surfaced so the UI can render cards. */
export interface OutreachToolResult {
  /** The Catalog_Entry name the agent invoked (e.g. `draft_outreach`). */
  toolName: string;
  /** The tool's (unwrapped) result payload. */
  result: unknown;
}

/** The structured outcome of an outreach drafting turn. */
export type OutreachAgentTurnResult =
  | {
      ok: true;
      /** The agent's narrated response. */
      response: string;
      /**
       * The composed, editable, UNSENT draft (Requirement 6.3), with its
       * grounding manifest reduced to only the claims that resolve to a SQL
       * record (Requirement 6.2), or `null` when the agent produced no valid
       * draft.
       */
      draft: OutreachDraft | null;
      /**
       * The claims the agent could not pin to a SQL record: OMITTED from the
       * draft's manifest and flagged for the rep (Requirement 6.2). Empty when
       * every claim is grounded or no draft was produced.
       */
      flaggedClaims: string[];
      /** The persisted draft id, when `draft_outreach` ran and returned one. */
      draftId: string | null;
      /** Structured tool results from this turn, for the surface's cards. */
      toolResults: OutreachToolResult[];
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
 * `doe` model gateway is in scope (calling the standalone `outreachAgent`
 * directly leaves Mastra unable to resolve the `doe/cf/...` model string). A
 * dynamic import avoids a static import cycle with runtime.ts.
 */
async function resolveRegisteredAgent(): Promise<OutreachAgentLike> {
  const { mastra } = await import("./runtime");
  const registered = (
    mastra as unknown as {
      getAgent: (name: string) => OutreachAgentLike | undefined;
    }
  ).getAgent(OUTREACH_AGENT_NAME);
  return registered ?? (outreachAgent as unknown as OutreachAgentLike);
}

/** Pull the persisted draft id out of a `draft_outreach` tool result, if present. */
function resolveDraftId(toolResults: OutreachToolResult[]): string | null {
  for (const tr of toolResults) {
    if (tr.toolName !== "draft_outreach") continue;
    const id = (tr.result as { draftId?: unknown } | null | undefined)?.draftId;
    if (typeof id === "string") return id;
  }
  return null;
}

/**
 * Run one outreach drafting turn through the Outreach_Agent (Requirements 6.1,
 * 6.2, 6.3, 6.4).
 *
 * The turn:
 *   1. refuses on the serverless tier ([container-only]);
 *   2. frames the requested channel, language, and the researched Target +
 *      grounded context as a system directive so the agent composes in the rep's
 *      voice, in the requested language, shaped for the channel, grounding every
 *      figure in a SQL record;
 *   3. runs under the per-run cost ceiling — a crossing returns a structured
 *      `budget_exceeded` result rather than spending more;
 *   4. extracts the agent's structured draft, validates it, and reduces its
 *      grounding manifest to ONLY the claims that resolve to a SQL record —
 *      flagging (and omitting) any claim with no SQL source (Requirement 6.2).
 *
 * The draft is returned editable and UNSENT (Requirement 6.3); persistence (and
 * the `prospecting.outreach.drafted` event) is owned by the `draft_outreach`
 * Catalog_Entry behind the audited dispatcher (Requirement 8.1). The agent never
 * sends — it holds no send tool.
 */
export async function runOutreachAgentTurn(
  input: OutreachAgentTurnInput,
  options: RunOutreachAgentTurnOptions = {},
): Promise<OutreachAgentTurnResult> {
  // (1) [container-only] — refuse before any work on the serverless tier.
  assertOutreachContainerTier(options.serverless);

  // (2) Frame the channel / language / target / grounded context as a system
  // directive. The agent narrates the supplied context and pins each figure to a
  // SQL record via the draft's grounding manifest; draft_outreach validates the
  // draft against its Zod schema at dispatch time.
  const directives: string[] = [
    `Compose an editable, unsent outreach draft for target ${input.targetId} ` +
      `in language "${input.language}" for the "${input.channel}" channel. ` +
      `Persist it by calling draft_outreach. Ground every factual claim in a ` +
      `SQL record via the draft's grounding manifest; omit and flag any claim ` +
      `you cannot pin to a real record. Do not send.`,
  ];
  if (input.briefId !== undefined) {
    directives.push(`Related brief: ${input.briefId}`);
  }
  if (input.context !== undefined) {
    directives.push(
      `Grounded research and market figures to write from (use these figures ` +
        `verbatim; do not invent any other figure): ${JSON.stringify(input.context)}`,
    );
  }

  const messages: TurnMessage[] = [
    ...directives.map((content): TurnMessage => ({ role: "system", content })),
    ...(input.history ?? []).map(toTurnMessage),
    { role: "user", content: input.message },
  ];

  // (3) Run under the per-run cost ceiling, requesting the draft as structured
  // output so we can validate and ground-filter it.
  const agent = options.agent ?? (await resolveRegisteredAgent());
  const budget = options.budget ?? OUTREACH_AGENT_RUN_BUDGET;

  const outcome = await runWithBudget(budget, (signal) =>
    agent.generate(messages, {
      abortSignal: signal,
      output: outreachDraftSchema,
    }),
  );

  if (!outcome.ok) {
    return {
      ok: false,
      reason: "budget_exceeded",
      budgetExceeded: outcome.budgetExceeded,
    };
  }

  const result = outcome.result as { text?: string; toolResults?: unknown };

  // Extract the structured tool results so the surface can render typed cards.
  const rawResults = result.toolResults;
  const toolResults: OutreachToolResult[] = Array.isArray(rawResults)
    ? rawResults
        .map((tr): OutreachToolResult | null => {
          const payload = (tr as { payload?: unknown }).payload ?? tr;
          const p = payload as { toolName?: unknown; result?: unknown };
          return typeof p.toolName === "string"
            ? { toolName: p.toolName, result: p.result }
            : null;
        })
        .filter((t): t is OutreachToolResult => t !== null)
    : [];

  // (4) Extract + validate the structured draft, then reduce its grounding
  // manifest to only the claims that resolve to a SQL record (Requirement 6.2).
  const rawDraft = extractDraft(outcome.result);
  let draft: OutreachDraft | null = null;
  let flaggedClaims: string[] = [];
  if (rawDraft !== null) {
    const partition = filterGroundedClaims(rawDraft.grounding);
    draft = { ...rawDraft, grounding: partition.grounding };
    flaggedClaims = partition.flaggedClaims;
  }

  return {
    ok: true,
    response: result.text ?? "",
    draft,
    flaggedClaims,
    draftId: resolveDraftId(toolResults),
    toolResults,
    modelTier: OUTREACH_AGENT_MODEL_TIER,
  };
}
