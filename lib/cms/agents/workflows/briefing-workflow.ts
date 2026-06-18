// lib/cms/agents/workflows/briefing-workflow.ts
//
// The Briefing_Workflow for the Agent-First Home / Briefing Surface (S5, Design
// §Components #3 "The Briefing_Workflow" + §11 "Figures come from SQL; the
// agent narrates"). Assembles a Briefing for `(userId, window, periodDate)` by
// invoking Catalog_Entries through the INJECTED audited dispatcher — and by
// composing the already-built pure/assembly home modules.
//
// THE ONE RULE, preserved and load-bearing here: this module imports NO Drizzle,
// holds no `db` handle, and never reads `tickets`/`leads_mirror`/`metrics_*`
// (or any table) directly. EVERY read is a `dispatchTool` call:
//   - the Stack via {@link assembleStack} (dispatches `list_stack`), and
//   - every count/analytics FIGURE via a dispatched `get_pipeline_summary`
//     only — the workflow never computes, recomputes, derives, rounds, or
//     estimates a figure (Req 2.5, 3.4, 14.1, 14.2).
// The dispatcher is INJECTED via {@link BriefingDeps.dispatch} — the SAME
// {@link StackDispatch}/`callTool` seam `stack.ts` uses — so the Stack read and
// the figures read share ONE audited dispatcher, and the unit test (task 7.2)
// can drive `assembleBriefing` over injected fakes with no real database.
//
// PER-WINDOW ELEMENT ASSEMBLY (Design §Components #3 table; Req 2.1, 3.1, 3.2):
//   morning  greeting · recap of the prior day's completed + outstanding
//            Stack_Items · today's Stack · invitation to add (invitesAdd=true)
//   midday   greeting · today's Stack (progress derivable from item status) ·
//            remaining outstanding (empty set ⇒ "none remain", by absence)
//   evening  greeting · today's Stack (completed derivable from item status) ·
//            remaining outstanding (empty sets ⇒ "none completed"/"none remain")
// The "none remain"/"none completed" markers are NOT separate Briefing fields
// (the §Data Models `Briefing` shape is fixed): they are derivable from the
// assembled Stack item statuses (and, for morning, the recap split), so the
// surface/agent narrates them without the workflow computing a figure.
//
// FAILURE / EMPTY (Design §Components #3, §Error Handling; Req 2.6, 3.6, 3.7):
//   - window_unresolved — the route resolves the Briefing_Window (task 1) and
//     passes it in; an invalid/unresolvable window value yields
//     `{ ok:false, reason:"window_unresolved" }` and NO Briefing (Req 3.6).
//   - Stack-retrieval error/timeout — SOFT: today's Stack is `{ unavailable:
//     true }` with NO fabricated items; the Briefing is still assembled with
//     greeting + recap (Req 2.6). `assembleStack` already fails closed here.
//   - Metrics_Views unavailable (the `get_pipeline_summary` dispatch errors /
//     times out / returns malformed data) — HARD: assembly cannot proceed, so
//     `{ ok:false, reason:"assembly_failed" }` with NO partial Briefing
//     (Req 3.7). A single unsourced figure is WITHHELD (`available:false`),
//     never substituted (Req 14.5) — only a total metrics failure fails
//     assembly.
//
// FIGURE SOURCING (Design §11; Req 14.1, 14.2, 14.4, 14.5): figures are built
// ONLY from the values the dispatched `get_pipeline_summary` returns, each
// attributed `{ metricId, scopeId, period }` (Req 14.4) and verified against the
// dispatched facts via the `figures.ts` guards; any figure that is not sourced
// or not fully attributed is withheld (`available:false`), never invented.
//
// PRIVACY (Req 2.7, 9.4): the assembled Briefing is run through the shared home
// redaction helper before it is returned, so no raw phone (full or partial)
// leaves the workflow on the Briefing content path.
//
// [container-only] (Design §13; Req 3.5, 15.5): assembly runs on the
// container/worker tier only. {@link assertBriefingContainerTier} refuses a
// serverless invocation before any work. (No shared tier-guard module exists in
// the repo today — S4's `assertContainerTier` lives inside `chart-generator.ts`
// and carries a Chart_Generator-specific error — so this module mirrors the
// same env-detection convention with its own error; task 13 covers the
// consolidated tier-guard smoke test.)
//
// Design references: §Components #3, §11, §13, §Data Models, §Error Handling.
// Requirements: 2.1, 2.4, 2.5, 3.1, 3.2, 3.4, 3.6, 3.7, 14.1, 14.2, 14.4, 14.5.

import type { DispatchResult } from "../../ai/tools/dispatch";
import type { Briefing, BriefingFigure, BriefingWindow, StackItem } from "../home/types";
import {
  assembleStack,
  isStackUnavailable,
  type StackContext,
  type StackDispatch,
  type StackResult,
} from "../home/stack";
import {
  attribute,
  collectSourcedFacts,
  isSourced,
  type SourcedFacts,
} from "../home/figures";
import { redactHomeContent } from "../home/redact";

// ── Public contract (Design §Components #3) ────────────────────────────────────

/**
 * The request a Briefing is assembled for. The route resolves the
 * Briefing_Window from the requesting user's local time (task 1) and passes the
 * already-resolved {@link window} and the local calendar {@link periodDate}
 * here, along with the requesting user's identity and RBAC {@link roles} (the
 * dispatcher enforces the actual scoping; the roles are forwarded for the
 * Stack/figures read context).
 */
export interface BriefingInput {
  /** The requesting user's identity — the subject every dispatched read scopes to. */
  userId: string;
  /** The already-resolved Briefing_Window (task 1). Invalid value ⇒ `window_unresolved`. */
  window: BriefingWindow;
  /** The local calendar day the Briefing covers, `YYYY-MM-DD`. */
  periodDate: string;
  /** The requesting user's RBAC roles, forwarded to the read context. */
  roles: string[];
}

/**
 * The outcome of an assembly. Either an assembled (and redacted) Briefing, or a
 * structured failure reason — `window_unresolved` (Req 3.6) or `assembly_failed`
 * (Req 3.7). On a failure NO Briefing (partial or otherwise) is returned.
 */
export type BriefingResult =
  | { ok: true; briefing: Briefing }
  | { ok: false; reason: "window_unresolved" | "assembly_failed" };

/**
 * The injected collaborators for an assembly (Design §Components #3). Carries
 * the SAME audited {@link StackDispatch} the Stack assembly uses, so the Stack
 * read (`list_stack`) and every figure read (`get_pipeline_summary`) flow
 * through ONE dispatcher (Zod → RBAC → OTP → audit → execute). Production binds
 * the real `db` handle + home RBAC identity into this closure; the unit test
 * (task 7.2) injects a fake. Either way `assembleBriefing` holds no `db` and
 * imports no Drizzle.
 */
export interface BriefingDeps {
  /** The audited dispatcher the Stack AND the figures are read through (REQUIRED). */
  dispatch: StackDispatch;
  /** Clock injection point (defaults to `Date.now` via `new Date()`). */
  now?: () => Date;
  /**
   * Optional ceiling, in ms, forwarded to {@link assembleStack} so a slow/hung
   * Stack dispatch degrades to the `{ unavailable: true }` marker (Req 2.6).
   */
  timeoutMs?: number;
  /** Force the tier decision (test-only); defaults to env-based detection. */
  serverless?: boolean;
}

// ── Container-tier guard ([container-only], Req 3.5, 15.5) ──────────────────────

/**
 * Thrown when the Briefing_Workflow is invoked on the serverless tier rather
 * than the container/worker tier (Req 3.5, 15.5). A hard misconfiguration, not
 * a {@link BriefingResult} reason — assembly never runs serverless.
 */
export class BriefingTierError extends Error {
  readonly code = "container_tier_required";
  constructor(
    message = "Briefing_Workflow is restricted to the container/worker tier and must not run on Next.js serverless.",
  ) {
    super(message);
    this.name = "BriefingTierError";
  }
}

/**
 * Detect whether the current process is the serverless tier. Mirrors the
 * env-detection precedence used elsewhere in the agent layer:
 *   1. Explicit `DOE_TIER` override (`container`/`worker` ⇒ not serverless;
 *      `serverless` ⇒ serverless).
 *   2. Known serverless platform signals (`VERCEL`, `AWS_LAMBDA_FUNCTION_NAME`,
 *      `LAMBDA_TASK_ROOT`) or the Next.js edge runtime (`NEXT_RUNTIME==="edge"`).
 *   3. Default: not serverless (a standalone container/worker process or tests).
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
 * Refuse, without executing, any assembly running on the serverless tier
 * (Req 3.5, 15.5). Throws {@link BriefingTierError} when serverless. Tests may
 * force the decision via `serverless`.
 */
export function assertBriefingContainerTier(serverless?: boolean): void {
  if (serverless ?? detectServerless()) {
    throw new BriefingTierError();
  }
}

// ── Constants ──────────────────────────────────────────────────────────────────

/** The catalog tool every figure is sourced through — the audited boundary (Req 14.1). */
const PIPELINE_SUMMARY_TOOL = "get_pipeline_summary";

/** The valid Briefing_Window values (task 1's partition codomain). */
const VALID_WINDOWS: ReadonlySet<string> = new Set<BriefingWindow>([
  "morning",
  "midday",
  "evening",
]);

/** Base, persona-neutral greeting per window; the Home_Agent persona-shapes it later. */
const WINDOW_GREETING: Record<BriefingWindow, string> = {
  morning: "Good morning",
  midday: "Good afternoon",
  evening: "Good evening",
};

/** Strict `YYYY-MM-DD` shape for a local calendar day. */
const PERIOD_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Period helpers (pure) ───────────────────────────────────────────────────────

/** True when `periodDate` is a well-formed, real `YYYY-MM-DD` calendar day. */
function isValidPeriodDate(periodDate: string): boolean {
  if (!PERIOD_DATE_RE.test(periodDate)) return false;
  const ms = Date.parse(`${periodDate}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return false;
  // Reject normalized-away values (e.g. 2024-02-31 → Mar 02).
  return new Date(ms).toISOString().slice(0, 10) === periodDate;
}

/** Inclusive UTC instant bounds spanning the whole local calendar day. */
function dayBounds(periodDate: string): { start: string; end: string } {
  return {
    start: `${periodDate}T00:00:00.000Z`,
    end: `${periodDate}T23:59:59.999Z`,
  };
}

/** The calendar day immediately before `periodDate`, as `YYYY-MM-DD`. */
function previousDay(periodDate: string): string {
  const d = new Date(`${periodDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ── Figure mapping (figures come from SQL; never computed — Req 14.x) ───────────

/** A scalar metric value the surface may present verbatim. */
function isScalar(value: unknown): value is number | string {
  return typeof value === "number" || typeof value === "string";
}

/**
 * Map a dispatched `get_pipeline_summary` result into attributed
 * {@link BriefingFigure}s. Every figure value is taken VERBATIM from the
 * dispatched `metrics` map — nothing is computed (Req 14.1, 14.2) — and carries
 * the `{ metricId, scopeId, period }` attribution triple (Req 14.4). Each figure
 * is then verified against the dispatched facts and its attribution; any figure
 * that is not sourced or not fully attributed is WITHHELD (`available:false`),
 * never substituted (Req 14.5). Non-scalar metric entries are not figures and
 * are skipped.
 */
function mapFigures(result: unknown): BriefingFigure[] {
  if (typeof result !== "object" || result === null) return [];
  const r = result as { scope?: unknown; period?: unknown; metrics?: unknown };
  if (typeof r.metrics !== "object" || r.metrics === null) return [];

  const scopeId = typeof r.scope === "string" ? r.scope : "";
  const period = typeof r.period === "string" ? r.period : "";
  const metrics = r.metrics as Record<string, unknown>;

  // The source-membership universe: only the scalar values the dispatcher
  // actually returned (Req 14.1, 14.2). Pure formatting, no arithmetic.
  const scalarMetrics: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(metrics)) {
    if (isScalar(value)) scalarMetrics[key] = value;
  }
  const facts: SourcedFacts = collectSourcedFacts(scalarMetrics);

  const figures: BriefingFigure[] = [];
  for (const [metricId, value] of Object.entries(scalarMetrics)) {
    let figure: BriefingFigure = {
      metricId,
      scopeId,
      period,
      value,
      available: true,
    };
    // Defence in depth: withhold (never substitute) any figure that is not a
    // member of the dispatched facts or lacks a complete attribution triple.
    if (!isSourced(figure, facts) || attribute(figure) === null) {
      figure = { ...figure, available: false };
    }
    figures.push(figure);
  }
  return figures;
}

// ── Figures read (the single source of figures — Req 2.5, 3.4, 14.1) ───────────

/**
 * Derive the `get_pipeline_summary` scope from the requesting user's roles. The
 * dispatcher enforces the ACTUAL RBAC scoping; this only hints the scope the
 * read is requested at (an exec/manager/owner/admin role ⇒ `exec`, otherwise a
 * rep-scoped read keyed to the user).
 */
function summaryScopeInput(
  userId: string,
  roles: readonly string[],
  period: string,
): Record<string, string> {
  const isExec = roles.some((r) => /admin|exec|manager|owner|director/i.test(r));
  return isExec
    ? { scope: "exec", period }
    : { scope: "rep", repId: userId, period };
}

/**
 * Read the Briefing's figures through the dispatched `get_pipeline_summary`
 * (the only figure source, Req 14.1). Returns the attributed figures on
 * success, or `null` when the Metrics_Views are unavailable — the dispatch
 * errors/throws, returns a structured error, or returns malformed data — which
 * the caller maps to `assembly_failed` (Req 3.7).
 */
async function readFigures(
  input: BriefingInput,
  deps: BriefingDeps,
): Promise<BriefingFigure[] | null> {
  let outcome: DispatchResult;
  try {
    outcome = await deps.dispatch(
      PIPELINE_SUMMARY_TOOL,
      summaryScopeInput(input.userId, input.roles, input.periodDate),
    );
  } catch {
    return null; // dispatch threw → Metrics_Views unavailable (Req 3.7)
  }
  if (!outcome.ok) {
    return null; // structured error (incl. RBAC/OTP/validation/handler) (Req 3.7)
  }
  const result = outcome.result;
  if (typeof result !== "object" || result === null) {
    return null; // malformed → did not return the requested figures (Req 3.7)
  }
  if (typeof (result as { metrics?: unknown }).metrics !== "object" ||
    (result as { metrics?: unknown }).metrics === null) {
    return null; // no figures map → Metrics_Views unavailable (Req 3.7)
  }
  return mapFigures(result);
}

// ── Stack read (dispatched, fail-closed — delegates to stack.ts) ────────────────

/** Assemble the user's Stack for a single calendar day via the dispatched `list_stack`. */
function readDayStack(
  input: BriefingInput,
  deps: BriefingDeps,
  periodDate: string,
): Promise<StackResult> {
  const { start, end } = dayBounds(periodDate);
  const ctx: StackContext = {
    userId: input.userId,
    roles: input.roles,
    periodStart: start,
    periodEnd: end,
    status: "all",
  };
  return assembleStack(ctx, {
    dispatch: deps.dispatch,
    now: deps.now,
    timeoutMs: deps.timeoutMs,
  });
}

// ── assembleBriefing ────────────────────────────────────────────────────────────

/**
 * Assemble a Briefing for `(userId, window, periodDate)` by composing the pure
 * home modules over the INJECTED audited dispatcher — never reading the database
 * directly (Design §Components #3).
 *
 * Order of operations is chosen so a partial Briefing can never be returned on a
 * hard failure (Req 3.7):
 *   1. [container-only] tier guard — refuse a serverless invocation (Req 15.5).
 *   2. Window/period validation — an invalid window ⇒ `window_unresolved`
 *      (Req 3.6); a malformed period ⇒ `assembly_failed`.
 *   3. Figures via dispatched `get_pipeline_summary` — a total Metrics_Views
 *      failure short-circuits to `assembly_failed` BEFORE any Briefing is built
 *      (Req 3.7).
 *   4. Today's Stack via dispatched `list_stack` — a soft failure becomes the
 *      `{ unavailable: true }` marker, NOT a hard failure (Req 2.6).
 *   5. (morning only) prior-day recap via a second dispatched `list_stack`.
 *   6. Build the per-window Briefing, redact it, and return it (Req 2.7, 9.4).
 *
 * @param input The requesting user, resolved window, period, and roles.
 * @param deps  The injected audited dispatcher and optional clock/timeout.
 */
export async function assembleBriefing(
  input: BriefingInput,
  deps: BriefingDeps,
): Promise<BriefingResult> {
  // (1) Container-tier guard — refuse before any work ([container-only]).
  assertBriefingContainerTier(deps.serverless);

  const { userId, window, periodDate, roles } = input;

  // (2) Window resolution: the route resolves the window (task 1) and passes it
  // in; an invalid/unresolvable value yields `window_unresolved` with no
  // Briefing (Req 3.6). A missing user or malformed period cannot assemble.
  if (!VALID_WINDOWS.has(window)) {
    return { ok: false, reason: "window_unresolved" };
  }
  if (!userId || !isValidPeriodDate(periodDate)) {
    return { ok: false, reason: "assembly_failed" };
  }

  // (3) Figures FIRST — every count/analytics figure comes from the dispatched
  // `get_pipeline_summary` (Req 2.5, 3.4, 14.1). A total Metrics_Views failure
  // prevents assembly: return `assembly_failed` with NO partial Briefing
  // (Req 3.7). A single unsourced figure is withheld inside `mapFigures`, not a
  // failure (Req 14.5).
  const figures = await readFigures(input, deps);
  if (figures === null) {
    return { ok: false, reason: "assembly_failed" };
  }

  // (4) Today's Stack — a dispatcher error/timeout fails closed to the
  // `{ unavailable: true }` marker with no fabricated items (Req 2.6); the
  // Briefing is still assembled with greeting + recap.
  const stack: StackItem[] | { unavailable: true } = await readDayStack(
    input,
    deps,
    periodDate,
  );

  // (5) Morning recaps the immediately prior day's completed + outstanding
  // Stack_Items (Req 2.1). Midday/evening do not recap a prior period — their
  // progress/completed/remaining views derive from today's Stack item statuses
  // (Req 3.1, 3.2). A failed prior-day read yields a null recap rather than a
  // fabricated one (no inferred items).
  let recap: { completed: StackItem[]; outstanding: StackItem[] } | null = null;
  if (window === "morning") {
    const priorStack = await readDayStack(input, deps, previousDay(periodDate));
    if (!isStackUnavailable(priorStack)) {
      recap = {
        completed: priorStack.filter((item) => item.status === "done"),
        outstanding: priorStack.filter((item) => item.status === "open"),
      };
    }
  }

  // (6) Build the per-window Briefing, then redact before returning (Req 2.7,
  // 9.4). `invitesAdd` is the morning invitation to add Stack_Items (Req 2.1).
  const now = deps.now ?? (() => new Date());
  const briefing: Briefing = {
    userId,
    window,
    periodDate,
    greeting: WINDOW_GREETING[window],
    recap,
    stack,
    figures,
    invitesAdd: window === "morning",
    assembledAt: now().toISOString(),
  };

  return { ok: true, briefing: redactHomeContent(briefing) };
}
