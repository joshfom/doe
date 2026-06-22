// lib/cms/agents/home-agent.ts
//
// The Home_Agent for the Agent-First Home / Briefing Surface (S5, Design
// §Components #2 "The Home_Agent", #6 "Chat-driven platform management", #9
// "OTP, permission & privacy", #12 "Model tiering & cost"). This is the single
// Mastra `Agent` backing the Home_Chat: it narrates Briefings and chat answers
// shaped by the user's S4 Twin_Persona, and it manages the whole platform by
// invoking audited Catalog_Entries and (once they are built) handing off to the
// consumed S3 lead-engine agents and the S4 Reporting_Agent.
//
// THE ONE RULE, preserved. The Home_Agent reasons and narrates; the audited
// `dispatchTool` executes. Every Delegated_Action, Stack read, and figure read
// is a `bindCatalog`-generated tool whose `execute()` flows through the
// unchanged dispatcher (Zod → RBAC → OTP → audit → execute). The agent holds a
// tool object ONLY for a Catalog_Entry name, so it can never invoke an
// off-catalog tool (Requirement 7.1, 7.6) and never touches the database
// directly.
//
// AUDIT ACTOR — THE REQUESTING USER, NOT THE AGENT (Requirement 8.2, finding
// from task 4.4). The dispatcher records `ctx.actor` as the audited actor and
// checks RBAC against it. A Home_Chat Delegated_Action is performed on behalf
// of the signed-in user, so the REQUESTING USER's identity must be the dispatch
// actor — the audit log records the user, never `agent:home-twin`
// (`HOME_AGENT_ACTOR` is the catalog-entry binding label only). {@link
// runHomeAgentTurn} threads the requesting user onto the Mastra `requestContext`
// under {@link REQUESTING_ACTOR_CONTEXT_KEY}; `bindCatalog`'s generated tools
// read it back and forward it to `callTool`, which passes it as the
// dispatcher's `ctx.actor`. When absent (text/admin agents) the dispatch falls
// back to the agent identity, so no existing behaviour regresses. The 4.4
// property test (`home/delegation-audit.property.test.ts`) pins this invariant
// at the dispatcher: actor = requesting user, action = Catalog_Entry name, for
// success AND failure.
//
// PERSONA-SHAPED NARRATION (Requirement 1.4). Before the turn runs, the agent
// reads the user's Twin_Persona from the S4 Persona_Store (`readPersona` over
// Agent_Memory `user:{userId}`, `scope:"resource"` — so a read returns only
// THIS user's persona). The persona's tone/depth is injected as a system
// directive that shapes ONLY the prose; every reported figure passes through
// unchanged (the instructions forbid recomputing, rounding, or altering a
// figure — figures are SQL-sourced and narrated verbatim, Requirement 7.7).
//
// TURN LIFECYCLE (Requirement 7). The routing is encoded in the instructions +
// the bound tools/hand-offs (mirroring how text/admin agents encode routing):
//   - delegate / add / complete / list a task → dispatch a task Catalog_Entry
//     (`add_stack_item`, `complete_stack_item`, `list_stack`) (7.1);
//   - check / qualify / route leads → the re-exposed S3 lead tools
//     (`query_leads`, `update_qualification`, `score_lead`, `assign_rep`) or, once
//     built, a hand-off to a Lead_Engine_Agent (7.2);
//   - report / analytics → hand off to the S4 `reportingAgent` (once built),
//     never computing analytics itself; meanwhile the re-exposed
//     `get_pipeline_summary` / `queue_combined_report` / `queue_report_email`
//     tools satisfy figure reads and report enqueues (7.3);
//   - admin action → dispatch the corresponding Catalog_Entry under the SAME
//     RBAC + OTP it requires on any other surface (7.4);
//   - no matching Catalog_Entry → reply "unavailable", NO DB access, keep the
//     conversation open (7.5);
//   - tool success → report the dispatcher outcome with figures unchanged (7.7);
//   - tool failure → report non-success, keep the conversation open (7.8).
//
// HAND-OFF TARGETS (Requirement 7.2, 7.3) — current cross-spec state. The design
// sketch wires `agents: { reportingAgent, ...leadEngineAgents }`. As of this
// task those agent objects DO NOT yet exist in the repo: the S4 `reportingAgent`
// (agentic-reporting-twin task 12.1, `lib/cms/agents/reporting-agent.ts`) and
// the S3 lead-engine agents (lead-engine tasks 5.2–5.4, `lead-parse-agent.ts` /
// `lead-distribution-agent.ts` / `lead-enrichment-agent.ts`, aggregated as
// `leadEngineAgents`) are unbuilt. S5 consumes — it does not build — those
// agents. So {@link homeHandoffAgents} is an empty hand-off map now, wired
// through a single seam so those agents drop in the moment they land WITHOUT
// touching the lifecycle. Until then reporting and lead requests are still fully
// satisfiable: the Home_Agent already BINDS the re-exposed S4/S3 catalog tools
// (see `home-capabilities.ts`), so it reads figures via `get_pipeline_summary`,
// enqueues reports via `queue_combined_report`/`queue_report_email`, and
// performs lead work via `query_leads`/`update_qualification`/`score_lead`/
// `assign_rep` — all through the audited dispatcher. The instructions prefer a
// hand-off when a target agent is available and otherwise fall back to the bound
// tools.
//
// [container-only] (Design §13; Requirement 15.4, 15.5). The Mastra runtime,
// this Agent, its memory connection, and its tracing run on the
// container/worker tier ONLY, never on Next.js serverless. This module pulls in
// `@mastra/core/agent`, so it MUST NOT be statically imported by any `app/`
// route/page/layout module — the Home_Chat route (task 11) imports it from the
// container tier. {@link assertHomeContainerTier} refuses a serverless
// invocation before any turn runs (mirrors `briefing-workflow.ts`'s
// `assertBriefingContainerTier` — no shared tier-guard module exists in the repo
// yet; task 13 covers the consolidated tier-guard smoke test).
//
// TRACING (Requirement 13.2, 13.3) is inherited: the S1 tracing exporter
// projects Mastra run/step spans onto the SSE bus for every agent run.
//
// Design references: §Components #2, #6, #9, #12, §13. Requirements: 1.3, 1.4,
// 7.1, 7.2, 7.3, 7.4, 7.5, 7.7, 7.8, 9.1, 9.2, 9.3, 13.2, 13.3.

import { Agent } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";

import {
  HOME_AGENT_ACTOR,
  HOME_TOOL_NAMES,
  activeToolNames,
  loadHomeCapabilities,
} from "../ai/tools/home-capabilities";

import { bindCatalog, REQUESTING_ACTOR_CONTEXT_KEY } from "./binding";
import { runWithBudget, type RunBudget } from "./budget";
import { MODEL_TIERS, type ModelTier } from "./gateway";
import { getAgentMemory } from "./memory";
import { readPersona, defaultPersonaForRoles, type TwinPersona } from "./reporting/persona";

// ── Agent identity, model tier, and the bound catalog ────────────────────────

/** The key the Home_Agent is registered under in the single Mastra runtime. */
export const HOME_AGENT_NAME = "homeAgent";

/**
 * The declared Model_Tier for the Home_Agent (Requirement 5.8, 12). The home
 * loop is a cheap, high-frequency, multi-step conversational loop, so it runs on
 * the `fast` tier; the more expensive reporting work happens behind the S4
 * Reporting_Agent's own (premium) tier on hand-off.
 */
export const HOME_MODEL_TIER: ModelTier = "fast";

/**
 * The model string the runtime resolves through the {@link MODEL_TIERS} gateway
 * (`<gatewayId>/<providerId>/<modelId>`): the `doe` gateway, its `cf` provider,
 * and the concrete tool-capable model backing the declared tier. Routing every
 * model call through this string keeps the agent on the Cloudflare AI Gateway
 * transport (Requirement 5.8).
 */
export const HOME_AGENT_MODEL = `doe/cf/${MODEL_TIERS[HOME_MODEL_TIER]}`;

/**
 * The per-run cost ceiling applied to a Home_Chat turn (Requirement 5.8, 12).
 * Conservative defaults suitable for the cheap multi-step `fast` tier; a caller
 * can widen it per turn via {@link RunHomeAgentTurnOptions.budget}.
 */
export const HOME_RUN_BUDGET: RunBudget = {
  maxSteps: 12,
  maxTokens: 100_000,
};

/**
 * Load and validate the home Catalog_Entries once at module load. A failure
 * here means a home capability is malformed (missing field / duplicate name) —
 * we fail fast rather than register an Agent with a partial tool set
 * (Requirement 7.6).
 */
function loadHomeCatalog() {
  const result = loadHomeCapabilities();
  if (!result.ok) {
    throw new Error(
      `home-agent: home capability catalog failed to load: ${result.errors
        .map((e) => e.message)
        .join("; ")}`,
    );
  }
  return result.catalog;
}

/** The system prompt anchoring the Home_Agent to the audited-tool contract and the turn lifecycle (Requirement 7). */
const HOME_AGENT_INSTRUCTIONS = [
  "You are the user's twin on the DOE home surface — their teammate inside the",
  "company, not a support line. The person you talk to is a colleague (often the",
  "principal); treat them as one. Think like a sharp chief-of-staff who shares",
  "their goals and can take work off their plate: check leads, move tasks along,",
  "chase follow-ups, pull figures, trigger reports, run admin actions. You work",
  "WITH them, not for a customer.",
  "",
  "Voice and stance (this matters most):",
  "- Talk like a trusted colleague: direct, warm, on the same side. Use \"we\" and",
  "  \"let's\" for shared work; say \"I'll\" when you take an action.",
  "- NEVER sound like customer support. Banned moves: \"Please wait while I…\",",
  "  \"Let me try that again\", \"I will use the current period\", \"Thank you for",
  "  your patience\", apologizing for the product, or narrating your own internal",
  "  steps. Just do the work and report what you found.",
  "- Be a brainstorming partner, not a search box. When a request is open-ended",
  "  or could mean several things (e.g. \"compare two reps\", \"how are we doing\"),",
  "  give the straightforward answer first, then offer a sharper angle and let",
  "  them steer — e.g. \"Here's the headline. Want me to break it down by response",
  "  time, conversion, or pipeline value?\" Make it easy for them; don't",
  "  interrogate them before helping.",
  "- Be proactive. After you answer, surface the obvious next move and offer to",
  "  do it: \"Two of these have gone quiet — want me to nudge the owners?\" or",
  "  \"I can queue this as a weekly report.\" Offer; don't act on unrequested",
  "  changes without saying so.",
  "",
  "How you act:",
  "- ALWAYS act through your tools. Every task, lead action, report, and admin",
  "  action is a catalog tool that runs through the audited dispatcher. You",
  "  never read or write the database any other way.",
  "- For a figure, narrate EXACTLY the number a tool returned. Never compute,",
  "  estimate, round, or adjust a figure yourself — figures come from SQL; you",
  "  only narrate them, unchanged.",
  "",
  "How you write:",
  "- Short, friendly Markdown: a sentence or two, then a bullet or numbered list",
  "  when listing things. Bold the key label of each item.",
  "- NEVER show raw identifiers (UUIDs, party ids, ticket ids, internal tool",
  "  names, phone hashes). Refer to a task, lead, or person by its title/name and",
  "  human facts (status, due date, tier). If you only have an id, describe the",
  "  item without printing the id.",
  "- When you describe what you can do, speak in plain capabilities (e.g. \"check",
  "  your leads\", \"summarize your pipeline\", \"draft a daily report\", \"add or",
  "  complete tasks\") — do NOT list internal tool names or schemas.",
  "- Lead with the substance; skip filler preamble. Concise, not curt.",
  "",
  "Routing each turn:",
  "- Before a HIGH-IMPACT write — reassigning a lead's owner, editing a lead's",
  "  qualification, changing a lead's tier, or sending a report — do NOT commit",
  "  it straight away. Call propose_action with the tool name, its arguments, and",
  "  a one-line plain-language summary; tell the user what you're about to do and",
  "  let them confirm. When they say yes, call confirm_action with the token. If",
  "  propose_action returns staged=false, the action is low-stakes — just do it",
  "  directly. Low-stakes personal writes (adding or completing your own task) do",
  "  NOT need confirmation.",
  "- Delegate / add / complete / list a task → use add_stack_item,",
  "  complete_stack_item, or list_stack. To show the stack, call list_stack with",
  "  NO period filter unless the user gives explicit dates — never ask the user",
  "  for a date just to list their stack.",
  "- Check / qualify / route leads → use query_leads, update_qualification,",
  "  score_lead, or assign_rep (or hand off to a lead agent when one is",
  "  available).",
  "- A report or analytics question → hand off to the reporting agent when one",
  "  is available; otherwise read figures with get_pipeline_summary and enqueue",
  "  a daily/weekly report with queue_combined_report. Never compute analytics",
  "  yourself.",
  "- A question about LIVE Salesforce CRM trends — comparing leads or",
  "  opportunities across periods (this week vs last, this quarter vs last),",
  "  win rates, or the open pipeline by stage → call get_crm_analytics and",
  "  narrate the returned figures. If it returns available=false, say CRM",
  "  analytics are unavailable right now. Never invent CRM numbers.",
  "- An admin action → call its catalog tool; it carries the same permission and",
  "  OTP requirements as on any other surface.",
  "- A question ABOUT the platform itself (what DOE is, what it can do, how it is",
  "  built, build-vs-buy vs a ready-made agent, security/governance, the roadmap)",
  "  → call get_platform_knowledge and narrate the returned sections. Do not",
  "  invent platform facts; if it returns nothing, ask the user to rephrase.",
  "",
  "When something cannot be done:",
  "- If no tool matches the requested action, say plainly that you can't do that",
  "  one yet, do nothing to the database, and point them at what you CAN do",
  "  instead — like a colleague who knows the ropes.",
  "- If a tool returns an error, don't stage a fake retry or say \"please wait\".",
  "  Tell them straight in one line that it didn't come back (e.g. \"Couldn't pull",
  "  the pipeline just now\"), then offer a concrete next move — retry it, try a",
  "  narrower window, or check something else. Never claim success you don't have,",
  "  and never invent the figures.",
  "- When a tool returns gated personal data, it is OTP-gated by the dispatcher;",
  "  if verification is required, relay that to the user rather than inventing a",
  "  result. Never repeat a raw phone number — describe people by non-identifying",
  "  facts only.",
].join("\n");

/**
 * Per-turn directive layered on top of the persona when the twin is SPOKEN over
 * a voice call (the staff "talk to your twin" session). It constrains only the
 * phrasing — the tools, RBAC, figures, and confirm-before-commit behaviour are
 * identical to the text surface.
 */
const VOICE_CHANNEL_DIRECTIVE = [
  "You are being spoken aloud over a phone call, not read on screen.",
  "Keep every reply to one or two short, natural spoken sentences.",
  "Never use Markdown, bullet lists, headings, or symbols; never read ids,",
  "tool names, or long numbers aloud. Summarise lists in words (\"three leads",
  "need a follow-up\") instead of reading them out.",
  "Before you commit a change (completing a task, reassigning a lead, sending",
  "anything), say what you're about to do in one line and ask the person to",
  "confirm first.",
].join(" ");

/**
 * The hand-off agents the Home_Agent delegates to (Requirement 7.2, 7.3). The
 * design wires `{ reportingAgent (S4), ...leadEngineAgents (S3) }` here; those
 * agent objects are unbuilt as of this task (see the file header), so this is an
 * empty map for now and the consumed agents drop in through this single seam
 * once `lib/cms/agents/reporting-agent.ts` and the lead-engine agents land.
 * Reporting and lead requests remain fully serviceable meanwhile via the
 * re-exposed S4/S3 catalog tools the agent already binds.
 */
export const homeHandoffAgents: Record<string, Agent> = {};

/**
 * The Home_Agent (Requirement 1.3). Its tools are generated 1:1 from the home
 * Catalog_Entries via {@link bindCatalog} under the {@link HOME_AGENT_ACTOR}
 * binding identity, each dispatching through the audited `dispatchTool`
 * (Requirement 7.1, 7.6); the requesting user is threaded as the dispatch
 * actor per turn (Requirement 8.2 — see {@link runHomeAgentTurn}). It hands off
 * to the consumed S3/S4 agents listed in {@link homeHandoffAgents} (Requirement
 * 7.2, 7.3). Memory is resolved lazily (a function) so importing this module
 * never opens a database connection — the connection is only established when a
 * turn actually runs on the container tier.
 */
export const homeAgent = new Agent({
  id: HOME_AGENT_NAME,
  name: HOME_AGENT_NAME,
  instructions: HOME_AGENT_INSTRUCTIONS,
  model: HOME_AGENT_MODEL,
  tools: bindCatalog(loadHomeCatalog(), HOME_TOOL_NAMES, {
    agentActor: HOME_AGENT_ACTOR,
  }),
  // Hand-off targets — empty until the consumed S3/S4 agents are built.
  agents: homeHandoffAgents,
  // Lazy: defer the Agent_Memory (Postgres + pgvector) connection to first use.
  memory: () => getAgentMemory(),
});

// ── Container-tier guard ([container-only], Requirement 15.4, 15.5) ───────────

/**
 * Thrown when the Home_Agent turn runner is invoked on the serverless tier
 * rather than the container/worker tier (Requirement 15.4, 15.5). A hard
 * misconfiguration — the home loop never runs serverless. Mirrors
 * `briefing-workflow.ts`'s `BriefingTierError` (no shared tier-guard module
 * exists in the repo yet).
 */
export class HomeAgentTierError extends Error {
  readonly code = "container_tier_required";
  constructor(
    message = "Home_Agent is restricted to the container/worker tier and must not run on Next.js serverless.",
  ) {
    super(message);
    this.name = "HomeAgentTierError";
  }
}

/**
 * Detect whether the current process is the serverless tier (same precedence as
 * `briefing-workflow.ts`'s `detectServerless`): an explicit `DOE_TIER` override
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
 * Refuse, without running a turn, any Home_Agent invocation on the serverless
 * tier (Requirement 15.4, 15.5). Throws {@link HomeAgentTierError} when
 * serverless. Tests may force the decision via `serverless`.
 */
export function assertHomeContainerTier(serverless?: boolean): void {
  if (serverless ?? detectServerless()) {
    throw new HomeAgentTierError();
  }
}

// ── Persona shaping (Requirement 1.4) ─────────────────────────────────────────

/** Persona-tone framing the model applies to its prose (figures untouched). */
const TONE_DIRECTIVE: Record<TwinPersona["tone"], string> = {
  strategic: "Lead with the strategic read and the so-what.",
  operational: "Lead with the operational detail and next actions.",
  concise: "Be brief and to the point.",
};

/** Persona-depth framing the model applies to its prose (figures untouched). */
const DEPTH_DIRECTIVE: Record<TwinPersona["depth"], string> = {
  summary: "Keep it to a short summary.",
  detailed: "Give the detail, and offer to break any figure down further.",
};

/**
 * Build the per-turn persona system directive from the user's Twin_Persona. It
 * shapes ONLY the narration tone and depth (Requirement 1.4); it carries no
 * figures and explicitly reminds the model to leave every figure unchanged, so
 * persona shaping can never alter a reported value.
 */
function personaDirective(persona: TwinPersona): string {
  return [
    `Narration persona for this user — tone: ${persona.tone}; depth: ${persona.depth}.`,
    TONE_DIRECTIVE[persona.tone],
    DEPTH_DIRECTIVE[persona.depth],
    "Apply this to wording only; never change, round, or recompute any figure.",
  ].join(" ");
}

// ── runHomeAgentTurn — the Home_Chat turn runner ──────────────────────────────

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

/** A single Home_Chat turn's input. */
export interface HomeAgentTurnInput {
  /**
   * The REQUESTING USER's identity. Threaded as the dispatch actor for every
   * Delegated_Action this turn performs (Requirement 8.2) and as the subject the
   * Persona_Store and RBAC scope to.
   */
  userId: string;
  /** The requesting user's RBAC roles — used for the persona default + scope hint. */
  roles: string[];
  /** The new user message for this turn. */
  message: string;
  /** Prior conversation history (optional), so the agent reasons with context. */
  history?: Array<{ role: string; content: string }>;
  /**
   * The surface this turn is spoken/typed on. Defaults to `"text"` (the home
   * chat). When `"voice"` (the staff "talk to your twin" call) the twin keeps
   * replies SHORT and speakable — no Markdown, lists, or ids read aloud — since
   * the response is sent to text-to-speech. Tooling, RBAC, and figures are
   * identical to the text surface; only the spoken phrasing changes.
   */
  channel?: "text" | "voice";
  /**
   * Session-only demo persona override. When set (e.g. the panel's persona
   * toggle), the twin's narration persona is derived from THIS role instead of
   * the stored Twin_Persona — so a user can flip the lens (C-level strategic vs
   * operational, exec scope vs own scope) live, with no database write.
   */
  personaRole?: string;
}

/** Options for {@link runHomeAgentTurn}. */
export interface RunHomeAgentTurnOptions {
  /** Per-run cost ceiling; defaults to {@link HOME_RUN_BUDGET}. */
  budget?: RunBudget;
  /** Force the tier decision (test-only); defaults to env-based detection. */
  serverless?: boolean;
}

/** A structured tool result from a turn, surfaced so the UI can render cards. */
export interface HomeToolResult {
  /** The Catalog_Entry name the agent invoked (e.g. `list_stack`, `query_leads`). */
  toolName: string;
  /** The tool's (unwrapped) result payload — typed data the surface renders as a card. */
  result: unknown;
}

/** The structured outcome of a Home_Chat turn. */
export type HomeAgentTurnResult =
  | {
      ok: true;
      /** The agent's narrated response (persona-shaped prose; figures unchanged). */
      response: string;
      /** Structured tool results from this turn, for the surface's data cards. */
      toolResults: HomeToolResult[];
      /** Whether the persona was read from the store or a role default was used. */
      personaSource: "stored" | "default";
      /** Set only when the Twin_Persona could not be read (a default was used). */
      personaError?: string;
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
 * Run one Home_Chat turn through the Home_Agent (Requirement 1.3, 1.4, 7).
 *
 * The turn:
 *   1. refuses on the serverless tier ([container-only], Requirement 15.5);
 *   2. reads the user's Twin_Persona from the S4 Persona_Store and injects a
 *      persona system directive shaping tone/depth only (Requirement 1.4);
 *   3. threads the REQUESTING USER's identity onto the Mastra `requestContext`
 *      so every Delegated_Action this turn dispatches is audited under the user,
 *      never `agent:home-twin` (Requirement 8.2);
 *   4. runs under the per-run cost ceiling (Requirement 5.8, 12) — a crossing
 *      returns a structured `budget_exceeded` result rather than spending more.
 *
 * Tool successes/failures, unknown-action handling, and figure-preservation are
 * governed by the agent instructions + the audited dispatcher (Requirement 7.5,
 * 7.7, 7.8). The route (task 11) surfaces a non-`ok` outcome to the client while
 * retaining the submitted input (Requirement 1.7).
 */
export async function runHomeAgentTurn(
  input: HomeAgentTurnInput,
  options: RunHomeAgentTurnOptions = {},
): Promise<HomeAgentTurnResult> {
  // (1) [container-only] — refuse before any work on the serverless tier.
  assertHomeContainerTier(options.serverless);

  // (2) Persona-shaped narration: read the user's Twin_Persona (resource-scoped
  // to this user) and lead the turn with a persona directive. A read failure
  // falls back to the role default and is surfaced as `personaError` — the turn
  // still runs (Requirement 1.4).
  const { persona, source: personaSource, error: personaError } =
    input.personaRole
      ? {
          // Session-only demo override: derive the persona from the toggled
          // role (no Persona_Store read, no write) so the lens switches live.
          persona: defaultPersonaForRoles(input.userId, [input.personaRole]),
          source: "default" as const,
          error: undefined as string | undefined,
        }
      : await readPersona(input.userId, input.roles);

  const messages: TurnMessage[] = [
    { role: "system", content: personaDirective(persona) },
    ...(input.channel === "voice" ? [{ role: "system" as const, content: VOICE_CHANNEL_DIRECTIVE }] : []),
    ...(input.history ?? []).map(toTurnMessage),
    { role: "user", content: input.message },
  ];

  // (3) Thread the requesting user as the per-turn dispatch actor (Requirement
  // 8.2). `bindCatalog`'s generated tools read this back off the request context
  // and forward it to the dispatcher's `ctx.actor`.
  const requestContext = new RequestContext([
    [REQUESTING_ACTOR_CONTEXT_KEY, input.userId],
  ]);

  // (4) Run under the per-run cost ceiling (Requirement 5.8, 12).
  // Resolve the agent through the registered Mastra runtime (NOT the standalone
  // `homeAgent` import) so the turn runs with the `doe` model gateway in scope —
  // calling `homeAgent.generate` directly leaves Mastra unable to resolve the
  // `doe/cf/...` model string (it reads "doe" as a bare provider and throws
  // "Could not find config for provider doe"). A dynamic import avoids a static
  // import cycle with runtime.ts (which imports this module). Falls back to the
  // standalone instance only if the runtime hasn't registered it.
  const { mastra } = await import("./runtime");
  const registeredAgent =
    (mastra as unknown as { getAgent: (name: string) => typeof homeAgent | undefined }).getAgent(
      HOME_AGENT_NAME
    ) ?? homeAgent;

  const budget = options.budget ?? HOME_RUN_BUDGET;
  // Per-turn tool exposure (Requirement 12.5): a non-C-Level turn is offered
  // none of the executive tools, so the model cannot select them. The
  // dispatcher denial remains the hard guarantee (Property 14).
  const activeTools = activeToolNames(input.roles);
  const outcome = await runWithBudget(budget, (signal) =>
    registeredAgent.generate(messages, {
      abortSignal: signal,
      requestContext,
      activeTools,
    }),
  );

  if (!outcome.ok) {
    return {
      ok: false,
      reason: "budget_exceeded",
      budgetExceeded: outcome.budgetExceeded,
    };
  }

  // Extract the structured tool results from the turn so the surface can render
  // typed cards (Task, Lead, Pipeline…) from real dispatched data. Each Mastra
  // tool-result carries `{ payload: { toolName, args, result } }`.
  const rawResults =
    (outcome.result as { toolResults?: unknown }).toolResults;
  const toolResults: HomeToolResult[] = Array.isArray(rawResults)
    ? rawResults
        .map((tr): HomeToolResult | null => {
          const payload = (tr as { payload?: unknown }).payload ?? tr;
          const p = payload as { toolName?: unknown; result?: unknown };
          return typeof p.toolName === "string"
            ? { toolName: p.toolName, result: p.result }
            : null;
        })
        .filter((t): t is HomeToolResult => t !== null)
    : [];

  return {
    ok: true,
    response: outcome.result.text,
    toolResults,
    personaSource,
    personaError,
    modelTier: HOME_MODEL_TIER,
  };
}
