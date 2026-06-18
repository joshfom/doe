// lib/cms/agents/workflows/prospecting-run.ts
//
// The `prospecting-run` workflow for the Prospecting Workspace (S7, Design
// §Components #1 "Prospecting_Brief + Buyer_Hypothesis", #3 "Target + per-field
// provenance", #4 "Account/Person enrichment providers"). It ORCHESTRATES the
// property-led hero flow end-to-end:
//
//   brief → comparables → hypothesis (await rep edit) → prospect_search →
//   record_target → enrich_target
//
// and the inverse ICP-led entry (a direct filter, no brief — Requirement 10.5),
// publishing the lifecycle events the Console renders along the way and storing
// each Target's assembled research in Agent_Memory keyed `target:{id}`
// (Requirement 3.4).
//
// THE ONE RULE, preserved (Design §Architecture, Requirement 8.1). This module
// imports NO Drizzle and holds no `db` handle. EVERY market read, provider call,
// and mutation is a `dispatchTool` call through the INJECTED audited dispatcher
// ({@link ProspectingRunDeps.dispatch}) — the same Zod → RBAC → OTP → audit →
// execute boundary every agent step flows through. The Buyer_Hypothesis is
// derived by the Prospecting_Agent through the injected agent-turn seam
// ({@link ProspectingRunDeps.runAgentTurn}); the workflow never calls the model
// or a provider directly. The SSE lifecycle events are published through the
// injected {@link ProspectingRunDeps.publish} seam (the orchestration tier's SSE
// bus, exactly as the lead-nudge sweep and the Prospecting_Agent runner publish
// directly), and research is written through the injected
// {@link ProspectingRunDeps.memory} seam. Production binds the real
// `dispatchTool`, `runProspectingAgentTurn`, `publishEvent`, and
// `getAgentMemory`; the unit test (task 5.2) injects fakes for all four, so the
// suite runs with no live model, dispatcher, database, or memory store.
//
// EVENT OWNERSHIP (Design §Components #1; the Prospecting_Agent module doc).
// The agent owns ONLY `prospecting.hypothesis.proposed` (emitted inside the
// injected agent turn). This workflow owns the rest of the lifecycle:
//   - `prospecting.brief.received`     when a brief-led run starts (Req 10.1)
//   - `prospecting.comparables.found`  after the agent pulled comparables (Req 10.2)
//   - `prospecting.search.completed`   after `prospect_search` (Req 2.1)
//   - `prospecting.target.recorded`    after each `record_target` (Req 1)
//   - `prospecting.target.enriched`    after each `enrich_target` (Req 3.1)
//
// HUMAN-IN-THE-LOOP "await rep edit" (Requirement 10.6). A brief-led run is a
// two-phase, resumable flow: the FIRST invocation (no `hypothesis` supplied)
// runs the comparables + hypothesis-proposal phase and PAUSES, returning
// `{ status: "awaiting_hypothesis", hypothesis }` so the rep can adjust the
// editable proposal; the caller RESUMES by re-invoking with the rep-edited
// `hypothesis`, which advances to `prospect_search` and onward. An ICP-led run
// (a direct `filter`) needs no proposal and runs the search phase immediately.
//
// PRIVACY (CC-Privacy, Requirement 9.2). No raw phone ever reaches an event
// payload or a memory record: `record_target` returns only the salted
// `phoneHash`, and the events/research this workflow emits carry identifiers,
// the hash, attribute KEYS, and provider ids — never a raw number.
//
// [container-only] (Requirement 11/CC-Next16). Like the Prospecting_Agent and
// the Briefing_Workflow, this orchestration runs on the container/worker tier
// only. {@link assertProspectingRunContainerTier} refuses a serverless
// invocation before any work.
//
// Design references: §Components #1, #3, #4; §Architecture.
// Requirements: 2.1, 3.1, 3.4, 10.1, 10.2, 10.5, 10.6, 8.1, 9.2.

import type { DispatchResult } from "../../ai/tools/dispatch";
import type { DoeEventType } from "../../realtime/events";
import type { ProspectingBrief } from "../../prospecting/brief";
import type { BuyerHypothesis } from "../../prospecting/hypothesis";
import type { ProvenancedField } from "../../prospecting/target";
import { TARGET_TYPES } from "../../prospecting/target";
import type { ProspectFilter } from "../../prospecting/providers";
import type { MemoryKey } from "../memory";
import type { ProspectingAgentTurnResult } from "../prospecting-agent";

// ── Container-tier guard ([container-only], Requirement 11/CC-Next16) ──────────

/**
 * Thrown when the `prospecting-run` workflow is invoked on the serverless tier
 * rather than the container/worker tier. A hard misconfiguration, not a
 * {@link ProspectingRunResult} status — the workflow never runs serverless.
 * Mirrors the Prospecting_Agent's / Briefing_Workflow's tier errors.
 */
export class ProspectingRunTierError extends Error {
  readonly code = "container_tier_required";
  constructor(
    message = "prospecting-run workflow is restricted to the container/worker tier and must not run on Next.js serverless.",
  ) {
    super(message);
    this.name = "ProspectingRunTierError";
  }
}

/** Detect the serverless tier (same precedence as the rest of the agent layer). */
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
 * Refuse, without running, any invocation on the serverless tier. Throws
 * {@link ProspectingRunTierError} when serverless. Tests force via `serverless`.
 */
export function assertProspectingRunContainerTier(serverless?: boolean): void {
  if (serverless ?? detectServerless()) {
    throw new ProspectingRunTierError();
  }
}

// ── Agent_Memory key for a Target (scope:"resource", Requirement 3.4) ─────────

/**
 * The single Agent_Memory storage key a Target's research is written under: a
 * cross-conversation `resourceId` `target:{id}` (Mastra `scope:"resource"`).
 * Reusing the resource-key shape from `../memory` keeps Target research isolated
 * exactly the way `lead:{partyId}` / `user:{id}` records are — retrieval for one
 * Target's key can never return another Target's records (Req 3.4, P-NoLeak;
 * verified by task 5.3's Property 9). A Target id is required (a record must be
 * associated with a concrete Target).
 *
 * @throws if `targetId` is empty.
 */
export function targetMemoryKey(targetId: string): MemoryKey {
  const id = targetId?.trim();
  if (!id) {
    throw new Error("targetMemoryKey requires a non-empty target id");
  }
  return { resourceId: `target:${id}` };
}

// ── Injected collaborators (the test seams) ───────────────────────────────────

/**
 * The audited dispatcher seam — the SAME `{ ok, result } | { ok, error }`
 * discriminated union the real `dispatchTool` returns. Production binds
 * `(toolName, input) => dispatchTool(db, toolName, input, { actor:
 * PROSPECTING_AGENT_ACTOR })`; the unit test injects a fake returning canned
 * results per `toolName`. Like the real dispatcher it is expected not to throw,
 * but a thrown rejection is handled defensively here.
 */
export type ProspectingDispatch = (
  toolName: string,
  input: unknown,
) => Promise<DispatchResult>;

/** The brief/ICP/message a single Prospecting_Agent turn is run with. */
export interface ProspectingAgentTurnArgs {
  message: string;
  brief?: ProspectingBrief;
  icp?: unknown;
}

/**
 * The Prospecting_Agent turn seam — derives the editable Buyer_Hypothesis for a
 * brief (and emits `prospecting.hypothesis.proposed`). Production binds
 * `(args) => runProspectingAgentTurn(args, { db, serverless: false })`; the unit
 * test injects a fake returning a canned hypothesis + tool results, so the model
 * gateway is never hit.
 */
export type ProspectingAgentTurn = (
  args: ProspectingAgentTurnArgs,
) => Promise<ProspectingAgentTurnResult>;

/**
 * A Target's assembled research, stored in Agent_Memory keyed `target:{id}`
 * (Req 3.4). Carries the merged provenanced attributes from enrichment plus the
 * provider ids skipped/failed; it carries NO raw phone (CC-Privacy).
 */
export interface TargetResearchRecord {
  /** The Target this research belongs to (its memory key derives from this). */
  targetId: string;
  /** The merged per-field provenance map from enrichment (each field sourced). */
  attributes: Record<string, ProvenancedField>;
  /** Provider ids skipped because their credentials were absent (Req 2.4). */
  unconfiguredProviders: string[];
  /** Provider ids that threw and were skipped. */
  failedProviders: string[];
  /** UTC ISO timestamp the research was assembled. */
  researchedAt: string;
}

/**
 * The Agent_Memory write seam research is persisted through, keyed per Target
 * (scope:"resource"). Production binds a writer over `getAgentMemory()`; the
 * unit test injects an in-memory fake. The key is always a Target resource key
 * from {@link targetMemoryKey}, so a write can only ever be associated with one
 * Target (Req 3.4).
 */
export interface ProspectingMemoryStore {
  saveResearch(key: MemoryKey, record: TargetResearchRecord): Promise<void>;
}

/** A lifecycle event this workflow publishes onto the SSE bus. */
export interface ProspectingRunEvent {
  type: DoeEventType;
  payload: unknown;
}

/**
 * The SSE event publisher seam. Production binds `(e) => publishEvent(db, e)`;
 * the unit test injects a recording fake. Keeping it a seam lets the workflow
 * stay free of Drizzle and a `db` handle, mirroring the Briefing_Workflow.
 */
export type ProspectingEventPublisher = (
  event: ProspectingRunEvent,
) => Promise<void>;

/** The injected collaborators for a run (Design §Components #1, #3, #4). */
export interface ProspectingRunDeps {
  /** The audited dispatcher every market read / provider call / mutation flows through (REQUIRED). */
  dispatch: ProspectingDispatch;
  /** The Prospecting_Agent turn that derives the editable hypothesis (REQUIRED for brief-led runs). */
  runAgentTurn: ProspectingAgentTurn;
  /** The Agent_Memory writer Target research is persisted through (REQUIRED). */
  memory: ProspectingMemoryStore;
  /** The SSE event publisher (REQUIRED). */
  publish: ProspectingEventPublisher;
  /** Clock injection point (defaults to `new Date()`). */
  now?: () => Date;
  /** Force the tier decision (test-only); defaults to env-based detection. */
  serverless?: boolean;
}

// ── Input / output ─────────────────────────────────────────────────────────────

/** A Target type the search filter can be built for. */
export type TargetType = (typeof TARGET_TYPES)[number];

/** A single run's input (Design §Components #1; Requirements 10.1, 10.5, 10.6). */
export interface ProspectingRunInput {
  /**
   * Property-led entry: the Prospecting_Brief to prospect against (Req 10.1).
   * On the FIRST brief-led call (no {@link hypothesis}) the workflow proposes an
   * editable Buyer_Hypothesis and pauses.
   */
  brief?: ProspectingBrief;
  /**
   * ICP-led entry: a direct ICP filter with no brief (Req 10.5). When present
   * the workflow skips comparables + the hypothesis proposal and runs the
   * search phase immediately.
   */
  icp?: ProspectFilter;
  /**
   * The rep-edited Buyer_Hypothesis to run the search against (Req 10.6).
   * Supplied to RESUME a brief-led run past the proposal pause; the search
   * filter is derived from it.
   */
  hypothesis?: BuyerHypothesis;
  /** Target type for a hypothesis-derived search filter (defaults to `person`). */
  searchTargetType?: TargetType;
  /** The originating rep message forwarded to the agent (defaults to a prompt). */
  message?: string;
  /** Max candidates to record + enrich from the search (defaults to 25). */
  maxTargets?: number;
}

/** A Target recorded (and possibly enriched) by a completed run. */
export interface RecordedTarget {
  targetId: string;
  targetType: TargetType;
  /** The salted phone hash the Target was stored under, or null. */
  phoneHash: string | null;
  /** Whether enrichment ran and its research was stored in Agent_Memory. */
  enriched: boolean;
}

/** The structured outcome of a run. */
export type ProspectingRunResult =
  | {
      /** A brief-led run paused for rep edit of the proposed hypothesis (Req 10.6). */
      status: "awaiting_hypothesis";
      /** The editable Buyer_Hypothesis the agent proposed, or null if none. */
      hypothesis: BuyerHypothesis | null;
      /** Comparable market projects the agent surfaced (Req 10.2). */
      comparablesFound: number;
    }
  | {
      /** The full flow ran to completion. */
      status: "completed";
      /** Which entry path completed (property-led vs ICP-led). */
      mode: "brief" | "icp";
      /** Candidate Targets returned by `prospect_search`. */
      candidateCount: number;
      /** The Targets recorded (and enriched) this run. */
      targets: RecordedTarget[];
      /** Provider ids skipped (credentials absent) during the search (Req 2.4). */
      unconfiguredProviders: string[];
      /** Provider ids that failed during the search. */
      failedProviders: string[];
    }
  | {
      /** The run could not proceed. */
      status: "error";
      reason:
        | "no_entry_point"
        | "agent_budget_exceeded"
        | "search_failed";
      message?: string;
    };

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** A non-null object, narrowed for safe field access on an `unknown` result. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/** A non-empty string array from an unknown, else `[]`. */
function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

/**
 * Build a {@link ProspectFilter} from a (rep-edited) Buyer_Hypothesis: feeder
 * markets seed geography, titles seed titles, wealth signals pass through, and
 * segments become free-text keywords. The `targetType` is supplied by the
 * caller (defaults to `person` — the dominant luxury-buyer mode). Empty arrays
 * are dropped so a provider sees only meaningful seeds. Pure: no I/O.
 */
export function hypothesisToFilter(
  hypothesis: BuyerHypothesis,
  targetType: TargetType = "person",
  limit?: number,
): ProspectFilter {
  const nonEmpty = (xs: string[]): string[] | undefined =>
    xs.length > 0 ? [...xs] : undefined;
  return {
    targetType,
    geography: nonEmpty(hypothesis.feederMarkets),
    titles: nonEmpty(hypothesis.titles),
    wealthSignals: nonEmpty(hypothesis.wealthSignals),
    keywords: nonEmpty(hypothesis.segments),
    limit,
  };
}

/** Find the `find_comparables` tool result in an agent turn's tool results. */
function findComparablesResult(
  turn: ProspectingAgentTurnResult,
): Record<string, unknown> | null {
  if (!turn.ok) return null;
  for (const tr of turn.toolResults) {
    if (tr.toolName === "find_comparables") {
      return asRecord(tr.result);
    }
  }
  return null;
}

// ── Phase 1: brief → comparables → hypothesis proposal (await rep edit) ───────

/**
 * Run the property-led proposal phase: publish `prospecting.brief.received`,
 * run the Prospecting_Agent turn (which pulls comparables FIRST, derives the
 * editable hypothesis, and emits `prospecting.hypothesis.proposed`), publish
 * `prospecting.comparables.found` from the agent's `find_comparables` result,
 * then PAUSE for rep edit (Requirements 10.1, 10.2, 10.6).
 */
async function runBriefProposalPhase(
  brief: ProspectingBrief,
  input: ProspectingRunInput,
  deps: ProspectingRunDeps,
): Promise<ProspectingRunResult> {
  // (1) brief.received — a brief carries no personal data, only what's for sale.
  await deps.publish({
    type: "prospecting.brief.received",
    payload: { brief },
  });

  // (2) Derive the editable hypothesis through the agent (it pulls comparables
  //     FIRST and emits prospecting.hypothesis.proposed itself — Req 10.2, 10.6).
  const turn = await deps.runAgentTurn({
    message:
      input.message ??
      "Find the buyers most likely to purchase this property and propose a hypothesis.",
    brief,
  });

  if (!turn.ok) {
    return {
      status: "error",
      reason: "agent_budget_exceeded",
      message: `Prospecting_Agent halted: ${turn.reason}`,
    };
  }

  // (3) comparables.found — surface the comparables the agent pulled (Req 10.2).
  const comps = findComparablesResult(turn);
  const comparables = comps && Array.isArray(comps.comparables)
    ? (comps.comparables as unknown[])
    : [];
  const marketProjectIds = comparables
    .map((c) => asRecord(c)?.marketProjectId)
    .filter((id): id is string => typeof id === "string");

  await deps.publish({
    type: "prospecting.comparables.found",
    payload: {
      count: comparables.length,
      marketProjectIds,
      unconfigured: comps?.unconfigured === true,
    },
  });

  // (4) Pause for rep edit of the editable proposal (Req 10.6).
  return {
    status: "awaiting_hypothesis",
    hypothesis: turn.hypothesis,
    comparablesFound: comparables.length,
  };
}

// ── Phase 2: prospect_search → record_target → enrich_target ──────────────────

/**
 * Run the search phase against a resolved {@link ProspectFilter}: dispatch
 * `prospect_search`, publish `prospecting.search.completed`, then for each
 * candidate dispatch `record_target` (publishing `prospecting.target.recorded`)
 * and `enrich_target` (publishing `prospecting.target.enriched` and storing the
 * research in Agent_Memory keyed `target:{id}`). A per-candidate failure is
 * isolated so one bad candidate never sinks the run (Requirements 2.1, 3.1,
 * 3.4).
 */
async function runSearchPhase(
  filter: ProspectFilter,
  mode: "brief" | "icp",
  input: ProspectingRunInput,
  deps: ProspectingRunDeps,
): Promise<ProspectingRunResult> {
  const now = deps.now ?? (() => new Date());
  const maxTargets = input.maxTargets ?? 25;

  // (1) prospect_search through the audited dispatcher (Req 2.1, 8.1).
  const searchOutcome = await dispatchSafe(deps, "prospect_search", { filter });
  if (!searchOutcome.ok) {
    return {
      status: "error",
      reason: "search_failed",
      message: searchOutcome.error.message,
    };
  }

  const searchResult = asRecord(searchOutcome.result);
  const candidatesRaw = searchResult && Array.isArray(searchResult.candidates)
    ? (searchResult.candidates as unknown[])
    : [];
  const unconfiguredProviders = asStringArray(searchResult?.unconfiguredProviders);
  const failedProviders = asStringArray(searchResult?.failedProviders);

  const candidates = candidatesRaw
    .map(asRecord)
    .filter((c): c is Record<string, unknown> => c !== null)
    .slice(0, maxTargets);

  // (2) search.completed — counts + provider availability only, no PII (Req 2.4).
  await deps.publish({
    type: "prospecting.search.completed",
    payload: {
      mode,
      candidateCount: candidates.length,
      unconfiguredProviders,
      failedProviders,
    },
  });

  // (3) For each candidate: record → enrich → store research. Isolate failures.
  const targets: RecordedTarget[] = [];
  for (const candidate of candidates) {
    const recorded = await recordAndEnrich(candidate, deps, now);
    if (recorded) targets.push(recorded);
  }

  return {
    status: "completed",
    mode,
    candidateCount: candidates.length,
    targets,
    unconfiguredProviders,
    failedProviders,
  };
}

/**
 * Record one candidate as a Target then enrich it, publishing the
 * `prospecting.target.recorded` / `prospecting.target.enriched` events and
 * storing the enrichment research in Agent_Memory keyed `target:{id}`. Returns
 * the recorded Target, or `null` when `record_target` itself fails (the
 * candidate is skipped without sinking the run). A failed enrichment still
 * yields a recorded (un-enriched) Target.
 */
async function recordAndEnrich(
  candidate: Record<string, unknown>,
  deps: ProspectingRunDeps,
  now: () => Date,
): Promise<RecordedTarget | null> {
  // record_target — phone is hashed inside the handler; only the hash returns.
  // The candidate's provider fields (targetType, name, email, phone, country,
  // attributes, sourceProvider, sourceRef, lawfulBasis) pass straight through;
  // the dispatcher's Zod schema strips anything it does not accept.
  const recordOutcome = await dispatchSafe(deps, "record_target", candidate);
  if (!recordOutcome.ok) return null;

  const recordResult = asRecord(recordOutcome.result);
  const targetId = typeof recordResult?.targetId === "string"
    ? recordResult.targetId
    : null;
  if (!targetId) return null;

  const targetType = (typeof candidate.targetType === "string"
    ? candidate.targetType
    : "person") as TargetType;
  const phoneHash = typeof recordResult?.phoneHash === "string"
    ? recordResult.phoneHash
    : null;

  // target.recorded — identifiers + the salted hash only, never a raw phone.
  await deps.publish({
    type: "prospecting.target.recorded",
    payload: { targetId, targetType, phoneHash },
  });

  // enrich_target — assemble provenanced intelligence for this Target.
  const enrichOutcome = await dispatchSafe(deps, "enrich_target", { targetId });
  if (!enrichOutcome.ok) {
    // Enrichment failed/unavailable — keep the recorded Target, no research.
    return { targetId, targetType, phoneHash, enriched: false };
  }

  const enrichResult = asRecord(enrichOutcome.result);
  const attributes = (asRecord(enrichResult?.attributes) ?? {}) as Record<
    string,
    ProvenancedField
  >;
  const enrUnconfigured = asStringArray(enrichResult?.unconfiguredProviders);
  const enrFailed = asStringArray(enrichResult?.failedProviders);

  // Store the research in Agent_Memory keyed `target:{id}` (Req 3.4, P-NoLeak).
  await deps.memory.saveResearch(targetMemoryKey(targetId), {
    targetId,
    attributes,
    unconfiguredProviders: enrUnconfigured,
    failedProviders: enrFailed,
    researchedAt: now().toISOString(),
  });

  // target.enriched — attribute KEYS + provider ids only, never attribute PII.
  await deps.publish({
    type: "prospecting.target.enriched",
    payload: {
      targetId,
      attributeKeys: Object.keys(attributes),
      unconfiguredProviders: enrUnconfigured,
      failedProviders: enrFailed,
    },
  });

  return { targetId, targetType, phoneHash, enriched: true };
}

/**
 * Dispatch a tool defensively: the real dispatcher resolves to a
 * {@link DispatchResult} and is not expected to throw, but a thrown rejection is
 * coerced to a structured `handler_error` so a single bad dispatch never throws
 * out of the workflow.
 */
async function dispatchSafe(
  deps: ProspectingRunDeps,
  toolName: string,
  inputArg: unknown,
): Promise<DispatchResult> {
  try {
    return await deps.dispatch(toolName, inputArg);
  } catch (err) {
    const message = err instanceof Error ? err.message : "dispatch threw";
    return { ok: false, error: { code: "handler_error", message } };
  }
}

// ── runProspectingRun — the workflow entry point ──────────────────────────────

/**
 * Run the `prospecting-run` workflow (Design §Components #1, #3, #4).
 *
 * Routing:
 *   - an `icp` filter → ICP-led: run the search phase immediately (Req 10.5);
 *   - a `brief` WITHOUT a `hypothesis` → property-led phase 1: propose an
 *     editable Buyer_Hypothesis and pause for rep edit (Req 10.1, 10.2, 10.6);
 *   - a `brief` WITH a (rep-edited) `hypothesis` → property-led phase 2: derive
 *     the search filter from the hypothesis and run the search phase;
 *   - neither → `{ status: "error", reason: "no_entry_point" }`.
 *
 * Refuses on the serverless tier before any work ([container-only]).
 *
 * @param input The brief / ICP filter / rep-edited hypothesis for this run.
 * @param deps  The injected dispatcher, agent turn, memory store, and publisher.
 */
export async function runProspectingRun(
  input: ProspectingRunInput,
  deps: ProspectingRunDeps,
): Promise<ProspectingRunResult> {
  // [container-only] — refuse before any work on the serverless tier.
  assertProspectingRunContainerTier(deps.serverless);

  // ICP-led entry: a direct filter, no brief, no proposal (Req 10.5).
  if (input.icp !== undefined) {
    return runSearchPhase(input.icp, "icp", input, deps);
  }

  // Property-led entry.
  if (input.brief !== undefined) {
    // Resume: a rep-edited hypothesis advances to the search phase (Req 10.6).
    if (input.hypothesis !== undefined) {
      const filter = hypothesisToFilter(
        input.hypothesis,
        input.searchTargetType ?? "person",
        input.maxTargets,
      );
      return runSearchPhase(filter, "brief", input, deps);
    }
    // First call: propose the editable hypothesis and pause (Req 10.1, 10.2).
    return runBriefProposalPhase(input.brief, input, deps);
  }

  return { status: "error", reason: "no_entry_point" };
}
