/**
 * DOE Voice Surface — typed tool registry (Design §11, spec §3.4).
 *
 * The single, typed catalogue of every voice tool the lean orchestrator may
 * call. Each entry binds a tool name to its Zod input/output schemas (the
 * source of truth in `lib/cms/voice/contracts.ts`), the permission required to
 * run it, whether it returns personal/account data (and therefore must pass the
 * OTP gate — Req 13.1/13.2), and a handler.
 *
 * The model never executes a mutation directly: every tool call is a
 * Zod-validated, permission-checked, audited dispatch through
 * `dispatchTool` (`./dispatch.ts`) → `POST /api/tools/:toolName`
 * (`lib/cms/api/routes/tools.ts`). See Req 6.1.
 *
 * The registry STRUCTURE is final — names, schemas, `requiresOtp`, and
 * `permission` are wired here so the dispatcher (`./dispatch.ts`) is fully
 * functional. Several handler BODIES are still placeholder stubs that throw;
 * task 9.4 fills them in (reusing `buildCallContext`, `bookAppointment`, the
 * outbox, the job runner, and the metrics views) without changing this
 * structure.
 *
 * Design references: §11 (tool registry), §13 (identity isolation / OTP),
 * §6 mapping (audit actor `agent:voice-lead`).
 * Requirements: 6.1, 6.3, 6.4, 6.5, 6.10, 13.1, 13.2, 13.3, 13.4.
 */

import { z } from "zod";
import { createHash } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Database } from "../../db";
import {
  aiAppointments,
  leadsMirror,
  parties,
  reps,
  viewingSlots,
} from "../../schema";
import type { IdentityResult } from "../identity";
import type { OtpVerificationState } from "../otp";
import { buildCallContext } from "../../voice/prefetch";
import { bookAppointment } from "../actions";
import { generateCompletion, type ChatMessage } from "../gateway";
import { publishEvent } from "../../realtime/events";
import { enqueueJob } from "../../jobs";
import { enqueueOutbox } from "../../outbox";
import {
  toolSchemas,
  TOOL_NAMES,
  type ToolName,
  type Language,
  type Tier,
} from "../../voice/contracts";

// ── Agent identity & permissions ─────────────────────────────────────────────

/**
 * The system-actor string recorded on every voice tool audit entry. The voice
 * path is permission-checked under this single agent identity — it is never a
 * user session and never a backdoor around business rules or audit
 * (Req 6.3, 13.3, 14.2; Design §4, §11).
 */
export const VOICE_AGENT_ACTOR = "agent:voice-lead";

/** Prefix for per-tool RBAC permission strings, e.g. `voice:tool:book_viewing`. */
export const VOICE_TOOL_PERMISSION_PREFIX = "voice:tool";

/** The RBAC permission string a given tool requires. */
export function toolPermission(name: ToolName): string {
  return `${VOICE_TOOL_PERMISSION_PREFIX}:${name}`;
}

/**
 * The full set of tool permissions granted to the `agent:voice-lead` identity.
 * The voice agent is the trusted lead-qualification actor and is granted every
 * voice tool permission; the per-tool `permission` field still flows through
 * the dispatcher's check so individual tools can be locked down later without
 * touching the dispatch path.
 */
export const AGENT_VOICE_LEAD_PERMISSIONS: ReadonlySet<string> = new Set(
  TOOL_NAMES.map(toolPermission)
);

/**
 * Permission check keyed on the agent identity (Design §11). Returns true when
 * the given actor is granted the permission. Only `agent:voice-lead` holds the
 * voice tool permissions.
 */
export function agentHasPermission(actor: string, permission: string): boolean {
  if (actor !== VOICE_AGENT_ACTOR) return false;
  return AGENT_VOICE_LEAD_PERMISSIONS.has(permission);
}

// ── Tool context & handler types ─────────────────────────────────────────────

/**
 * Per-dispatch context threaded into every tool handler and consumed by the
 * OTP gate. Identity is resolved once at session start (prefetch) and passed in
 * — handlers never re-resolve identity per turn (Design §13, Req 5.1).
 */
export interface ToolContext {
  /** Logical actor recorded in the audit log. Always `agent:voice-lead`. */
  actor: string;
  /** The `aiConversations` row id for the active call, when available. */
  conversationId?: string;
  /** Resolved caller identity (client / tenant / visitor). */
  identity?: IdentityResult;
  /** Call language, for OTP-gate prompts. Defaults to "en". */
  language?: Language;
  /** Current OTP verification state on the conversation. */
  otpVerificationState?: OtpVerificationState;
  /**
   * The authenticated platform user on whose behalf the agent is acting, when
   * one exists (e.g. the staff operator behind the admin agent). This is
   * server-controlled context — never supplied by the model — and is used by
   * capabilities that must bind state to the requesting user, such as the admin
   * confirmation flow's single-use, user-bound tokens (Req 9.3, 9.5).
   */
  userId?: string;
  /**
   * OPTIONAL bound-agent identity for a delegated dispatch. When the dispatch
   * `actor` is a requesting user acting THROUGH an agent (e.g. the Home_Agent's
   * Delegated_Actions), this carries the agent's RBAC identity so the dispatcher
   * can authorize the call via the agent's (trusted, delegated) grant when the
   * user does not personally hold the tool permission. Audit still records the
   * `actor` (the user); per-row clamps in handlers keep results user-scoped.
   */
  agentActor?: string;
}

/** A tool handler: validated input in, typed output out. */
export type ToolHandler<I, O> = (
  db: Database,
  ctx: ToolContext,
  input: I
) => Promise<O>;

/** Input/output TS types derived from a tool's Zod schemas. */
type ToolInput<N extends ToolName> = z.infer<(typeof toolSchemas)[N]["input"]>;
type ToolOutput<N extends ToolName> = z.infer<(typeof toolSchemas)[N]["output"]>;

/**
 * A fully-described tool: its schemas, the permission it requires, whether it
 * returns personal/account data (OTP-gated), and its handler.
 */
export interface ToolDef<N extends ToolName> {
  name: N;
  inputSchema: (typeof toolSchemas)[N]["input"];
  outputSchema: (typeof toolSchemas)[N]["output"];
  /**
   * True when the tool returns client / tenant / payment (personal/account)
   * data and must therefore pass the OTP gate before returning it
   * (Req 13.1, 13.2). The dispatcher enforces this before running the handler.
   */
  requiresOtp: boolean;
  /** RBAC permission required to run this tool under the agent identity. */
  permission: string;
  handler: ToolHandler<ToolInput<N>, ToolOutput<N>>;
}

/** The registry shape: one fully-typed entry per tool name. */
export type ToolRegistry = { [N in ToolName]: ToolDef<N> };

// ── score_lead rules engine (Req 6.6) ────────────────────────────────────────
//
// The tier is decided by deterministic RULES over the qualification signals
// mirrored on `leads_mirror`; the LLM only writes the human-readable rationale
// (`reason`) that is stored on `leads_mirror.score_reason` and surfaced to the
// Demo_Console — never read to the caller (Req 6.6). Keeping the tier rule
// purely deterministic is what makes the tier thresholds unit-testable with the
// LLM rationale mocked.

/** The qualification signals score_lead reads from the lead mirror. */
interface ScoreSignals {
  budgetBand?: string | null;
  projectInterest?: string | null;
  unitInterest?: string | null;
}

/**
 * Deterministic tier thresholds. Each present qualification signal (budget
 * band, project interest, unit interest) is worth one point:
 *   • 3 points (fully qualified)      → HOT
 *   • 1–2 points (partially qualified) → WARM
 *   • 0 points (no signals yet)        → NURTURE
 */
export function scoreTier(signals: ScoreSignals | undefined): Tier {
  const points =
    (signals?.budgetBand ? 1 : 0) +
    (signals?.projectInterest ? 1 : 0) +
    (signals?.unitInterest ? 1 : 0);
  if (points >= 3) return "HOT";
  if (points >= 1) return "WARM";
  return "NURTURE";
}

/**
 * Produce the one-line scoring rationale via the LLM (Console-only prose). The
 * tier is already decided by {@link scoreTier}; the model only explains it.
 */
async function buildScoreRationale(
  tier: Tier,
  signals: ScoreSignals | undefined
): Promise<string> {
  const present = [
    signals?.budgetBand ? `budget ${signals.budgetBand}` : null,
    signals?.projectInterest ? `project ${signals.projectInterest}` : null,
    signals?.unitInterest ? `unit ${signals.unitInterest}` : null,
  ].filter(Boolean);
  const summary =
    present.length > 0 ? present.join(", ") : "no qualification signals yet";

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are DOE's lead-scoring assistant. In one short sentence, explain " +
        "why this lead is the given tier. This rationale is for the internal " +
        "Demo Console only and is never read back to the caller.",
    },
    { role: "user", content: `Tier: ${tier}. Signals: ${summary}.` },
  ];

  return generateCompletion(messages, { temperature: 0.2, maxTokens: 80 });
}

// ── assign_rep routing engine (Req 6.8) ──────────────────────────────────────
//
// Selection is project × language × capacity: a rep must serve the caller's
// project of interest AND speak the caller's language to be a candidate; among
// candidates, those with spare capacity (openHotCount < capacity) are preferred,
// then the most spare capacity, then a deterministic name tie-break. When no
// candidate has spare capacity the least-loaded matching rep is still chosen so
// the caller is never left unrouted.

/** A rep row as read for routing. */
export interface RepRoutingRow {
  id: string;
  name: string;
  languages: string[] | null;
  projects: string[] | null;
  capacity: number;
  openHotCount: number;
}

export interface RepSelection {
  rep: RepRoutingRow;
  /** Human-readable routing logic line recorded for the Demo_Console. */
  routing: string;
}

/**
 * Select a rep by project × language × capacity rules (Req 6.8). Returns the
 * chosen rep plus the routing logic line, or `null` when no rep serves the
 * caller's project in their language.
 */
export function selectRep(
  repRows: RepRoutingRow[],
  criteria: { language: Language; projectInterest?: string }
): RepSelection | null {
  const { language, projectInterest } = criteria;

  const candidates = repRows
    .map((rep) => ({
      rep,
      hasCapacity: rep.openHotCount < rep.capacity,
      spare: rep.capacity - rep.openHotCount,
    }))
    .filter(
      ({ rep }) =>
        (rep.languages ?? []).includes(language) &&
        (projectInterest == null ||
          (rep.projects ?? []).includes(projectInterest))
    )
    .sort((a, b) => {
      // Reps with spare capacity first.
      if (a.hasCapacity !== b.hasCapacity) return a.hasCapacity ? -1 : 1;
      // Then the most spare capacity.
      if (b.spare !== a.spare) return b.spare - a.spare;
      // Deterministic tie-break by name.
      return a.rep.name.localeCompare(b.rep.name);
    });

  const top = candidates[0];
  if (!top) return null;

  const routing =
    `Routed to ${top.rep.name}: project=${projectInterest ?? "any"}, ` +
    `language=${language}, capacity ${top.rep.openHotCount}/${top.rep.capacity}` +
    (top.hasCapacity ? "" : " (at capacity — least-loaded match)");

  return { rep: top.rep, routing };
}

// ── get_pipeline_summary: read-only over metrics_* SQL views (Req 6.9, 10.1) ──
//
// CRITICAL INVARIANT (Property 8 / Req 10.1, design "P8"): every figure is
// computed inside the `metrics_*` SQL views. This handler does ZERO arithmetic
// in JS — it only decides WHICH views to read for a given `{ scope, period }`
// and returns their rows verbatim. The LLM narrates and compares; it never
// performs the math. `compile_and_email_report` (task 16.6) reads the very same
// views for the same `{ scope, period }`, which is what guarantees the spoken
// figure equals the PDF figure.
//
// Scoping (per the views built in migration 0030):
//   • exec  + overall period → the `*_overall` single-scope views + deltas
//   • exec  + a week period  → the weekly views filtered to that ISO-week bucket
//   • rep   scope            → that rep's row in `metrics_rep_load`
// The query PLAN is a pure, data-only description (no DB access), so the
// scope/period → view-selection logic is unit-testable even though pg-mem can
// neither materialise views nor run PERCENTILE_CONT.

/** The fixed allow-list of metrics views this tool may read (no injection). */
export const METRICS_VIEWS = [
  "metrics_qualified_leads",
  "metrics_cost_per_qualified_lead",
  "metrics_cost_per_qualified_lead_overall",
  "metrics_tier_funnel",
  "metrics_tier_funnel_overall",
  "metrics_speed_to_lead",
  "metrics_speed_to_lead_overall",
  "metrics_rep_load",
  "metrics_week_over_week",
] as const;

export type MetricsView = (typeof METRICS_VIEWS)[number];

const METRICS_VIEW_SET: ReadonlySet<string> = new Set(METRICS_VIEWS);

/** Period values that mean "all-time / exec single-scope" rather than a week. */
const OVERALL_PERIODS: ReadonlySet<string> = new Set(["", "overall", "all", "all-time"]);

/**
 * Is `s` a real calendar date in strict `YYYY-MM-DD` form? Only such a value is
 * safe to feed the week-bucketed views' `week = $1::date` filter. Any other
 * non-empty period (a natural-language "this week", "June 2026", …) would make
 * the `::date` cast throw at the database and surface to the user as the
 * pipeline summary being "unavailable" — so the planner routes anything that is
 * NOT a valid ISO date to the all-time/overall scope instead (the read then
 * always succeeds; the LLM can still describe the latest week from
 * `metrics_week_over_week`, which is unfiltered).
 */
function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** An equality filter applied to a view read as `WHERE column = value[::cast]`. */
export interface MetricFilter {
  column: string;
  value: string;
  /** Optional SQL cast for the bound value, e.g. "date". */
  cast?: string;
}

/** One view read contributing a single key to the returned `metrics` map. */
export interface MetricSource {
  /** Key under which the row(s) appear in the `metrics` map. */
  key: string;
  /** The metrics_* view to read (must be in {@link METRICS_VIEWS}). */
  view: MetricsView;
  /** "row" returns the first row (or null); "rows" returns all rows. */
  kind: "row" | "rows";
  /** Equality filters AND-ed together; empty means read the whole view. */
  filters: MetricFilter[];
}

/** A pure, data-only description of the views to read for a request. */
export interface PipelineQueryPlan {
  scope: "exec" | "rep";
  /** Normalised period: "overall" or the requested week bucket. */
  period: string;
  sources: MetricSource[];
}

/**
 * Decide which `metrics_*` views to read for a `get_pipeline_summary` request.
 * Pure function — performs no DB access and no arithmetic. This is the unit of
 * logic exercised by the tool's tests (pg-mem cannot run the views themselves).
 */
export function planPipelineSummary(input: {
  repId?: string;
  scope?: "exec" | "rep";
  period?: string;
}): PipelineQueryPlan {
  const scope: "exec" | "rep" =
    input.scope ?? (input.repId ? "rep" : "exec");

  const rawPeriod = (input.period ?? "").trim();
  // Overall when it's an explicit all-time keyword OR not a valid ISO date — the
  // latter guard stops a free-text period (e.g. "this week") from reaching the
  // throwing `week = $1::date` filter (a healthy DB otherwise reports
  // "unavailable"). A genuine `YYYY-MM-DD` still selects the weekly views.
  const isOverall = OVERALL_PERIODS.has(rawPeriod.toLowerCase()) || !isIsoDate(rawPeriod);
  const period = isOverall ? "overall" : rawPeriod;

  if (scope === "rep") {
    // A rep hears only their own load row; if no rep id is supplied we fall
    // back to the whole rep-load board so the tool is never empty.
    const filters: MetricFilter[] = input.repId
      ? [{ column: "rep_id", value: input.repId }]
      : [];
    return {
      scope,
      period,
      sources: [
        {
          key: "repLoad",
          view: "metrics_rep_load",
          kind: input.repId ? "row" : "rows",
          filters,
        },
      ],
    };
  }

  // exec scope.
  if (isOverall) {
    return {
      scope,
      period,
      sources: [
        { key: "tierFunnel", view: "metrics_tier_funnel_overall", kind: "row", filters: [] },
        { key: "speedToLead", view: "metrics_speed_to_lead_overall", kind: "row", filters: [] },
        {
          key: "costPerQualifiedLead",
          view: "metrics_cost_per_qualified_lead_overall",
          kind: "rows",
          filters: [],
        },
        { key: "weekOverWeek", view: "metrics_week_over_week", kind: "row", filters: [] },
        { key: "repLoad", view: "metrics_rep_load", kind: "rows", filters: [] },
      ],
    };
  }

  // exec scope, a specific ISO-week bucket.
  const weekFilter: MetricFilter[] = [{ column: "week", value: period, cast: "date" }];
  return {
    scope,
    period,
    sources: [
      { key: "tierFunnel", view: "metrics_tier_funnel", kind: "row", filters: weekFilter },
      { key: "speedToLead", view: "metrics_speed_to_lead", kind: "row", filters: weekFilter },
      {
        key: "costPerQualifiedLead",
        view: "metrics_cost_per_qualified_lead",
        kind: "rows",
        filters: weekFilter,
      },
      // Week-over-week is inherently "latest vs prior"; it is not week-filtered.
      { key: "weekOverWeek", view: "metrics_week_over_week", kind: "row", filters: [] },
      { key: "repLoad", view: "metrics_rep_load", kind: "rows", filters: [] },
    ],
  };
}

/** Build the parameterised `SELECT` for one source (view allow-listed). */
function buildSourceQuery(source: MetricSource) {
  if (!METRICS_VIEW_SET.has(source.view)) {
    throw new Error(`get_pipeline_summary: refusing to read non-metrics view "${source.view}"`);
  }
  let query = sql`SELECT * FROM ${sql.identifier(source.view)}`;
  if (source.filters.length > 0) {
    const conditions = source.filters.map((f) =>
      f.cast
        ? sql`${sql.identifier(f.column)} = ${f.value}::${sql.raw(f.cast)}`
        : sql`${sql.identifier(f.column)} = ${f.value}`
    );
    query = sql`${query} WHERE ${sql.join(conditions, sql` AND `)}`;
  }
  return query;
}

/**
 * Execute a {@link PipelineQueryPlan} and assemble the `metrics` map. Rows are
 * returned VERBATIM from the views — no value is recomputed or rounded here so
 * the figures the agent speaks are exactly the SQL-computed figures (Req 10.1).
 */
export async function executePipelinePlan(
  db: Database,
  plan: PipelineQueryPlan
): Promise<Record<string, unknown>> {
  const metrics: Record<string, unknown> = {};
  for (const source of plan.sources) {
    const result = await db.execute(buildSourceQuery(source));
    const rows = (result as { rows: Record<string, unknown>[] }).rows ?? [];
    metrics[source.key] = source.kind === "row" ? rows[0] ?? null : rows;
  }
  return metrics;
}

// ── The registry ─────────────────────────────────────────────────────────────
//
// requiresOtp rationale (Req 13.1 — "visitor or unverified returns NO client/
// tenant/payment data"):
//   • get_lead_context RETURNS the caller's personal lead profile (name, tier,
//     budget band, last interaction, assigned rep) → OTP-gated.
//   • All other tools either return non-personal data (availability, routing
//     ids, job ids, aggregate metrics) or are writes that return only an ack /
//     id, so they are not gated on data RETURN. They remain audited and
//     permission-checked. This is a single-line change per tool if the data
//     classification is revisited.

export const toolRegistry: ToolRegistry = {
  get_lead_context: {
    name: "get_lead_context",
    inputSchema: toolSchemas.get_lead_context.input,
    outputSchema: toolSchemas.get_lead_context.output,
    requiresOtp: true, // returns personal lead/account data (Req 13.1/13.2)
    permission: toolPermission("get_lead_context"),
    // Mirror-only refresh of the CallContext (Req 6.5 / Property 4). Thin
    // wrapper over buildCallContext, which reads only the local mirror tables
    // and never imports or invokes the SalesforceAdapter.
    handler: async (db, _ctx, input) => buildCallContext(db, input.partyId),
  },
  update_qualification: {
    name: "update_qualification",
    inputSchema: toolSchemas.update_qualification.input,
    outputSchema: toolSchemas.update_qualification.output,
    requiresOtp: false, // mirror write of qualification facts; returns only { ok }
    permission: toolPermission("update_qualification"),
    // Mirror-only write of the partial qualification facts as they emerge in
    // conversation (Req 6.4, Design §8.2). Upsert by partyId so the first fact
    // creates the mirror row and later turns refine it; only the fields the
    // agent actually supplied this turn are written (a partial update never
    // clobbers a previously-captured fact with undefined). `budgetBand` and
    // `unitType` map onto the mirror's `budgetBand` / `unitInterest` columns
    // (the signals score_lead reads); `timeline` / `intent` are accepted by the
    // contract but have no mirror column yet, so they are not persisted here.
    handler: async (db, _ctx, input) => {
      const set: Partial<typeof leadsMirror.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (input.budgetBand !== undefined) set.budgetBand = input.budgetBand;
      if (input.unitType !== undefined) set.unitInterest = input.unitType;

      await db
        .insert(leadsMirror)
        .values({
          partyId: input.partyId,
          budgetBand: input.budgetBand,
          unitInterest: input.unitType,
        })
        .onConflictDoUpdate({ target: leadsMirror.partyId, set });

      return { ok: true };
    },
  },
  score_lead: {
    name: "score_lead",
    inputSchema: toolSchemas.score_lead.input,
    outputSchema: toolSchemas.score_lead.output,
    requiresOtp: false, // returns tier + rationale (Console-only), not account data
    permission: toolPermission("score_lead"),
    // Rules decide the tier (deterministic thresholds over the mirror's
    // qualification signals); the LLM only writes the rationale. The rationale
    // is stored on leads_mirror.score_reason and surfaced to the Console only,
    // never read to the caller (Req 6.6).
    handler: async (db, _ctx, input) => {
      const [mirror] = await db
        .select({
          budgetBand: leadsMirror.budgetBand,
          projectInterest: leadsMirror.projectInterest,
          unitInterest: leadsMirror.unitInterest,
        })
        .from(leadsMirror)
        .where(eq(leadsMirror.partyId, input.partyId))
        .limit(1);

      const tier = scoreTier(mirror);
      const reason = await buildScoreRationale(tier, mirror);

      await db
        .insert(leadsMirror)
        .values({ partyId: input.partyId, tier, scoreReason: reason })
        .onConflictDoUpdate({
          target: leadsMirror.partyId,
          set: { tier, scoreReason: reason, updatedAt: new Date() },
        });

      return { tier, reason };
    },
  },
  check_viewing_slots: {
    name: "check_viewing_slots",
    inputSchema: toolSchemas.check_viewing_slots.input,
    outputSchema: toolSchemas.check_viewing_slots.output,
    requiresOtp: false, // seeded availability; no personal data
    permission: toolPermission("check_viewing_slots"),
    // Read seeded availability for a project (Design §8.3). Returns only
    // un-taken slots, oldest-first, joined to the rep so the agent can name who
    // the viewing is with. An optional `dateHint` (YYYY-MM or YYYY-MM-DD) narrows
    // the result to slots starting on that day/month; a free-form hint that is
    // not date-shaped is ignored rather than filtering everything out.
    handler: async (db, _ctx, input) => {
      const rows = await db
        .select({
          id: viewingSlots.id,
          project: viewingSlots.project,
          startsAt: viewingSlots.startsAt,
          repName: reps.name,
        })
        .from(viewingSlots)
        .leftJoin(reps, eq(reps.id, viewingSlots.repId))
        .where(
          and(
            eq(viewingSlots.project, input.project),
            eq(viewingSlots.taken, false)
          )
        )
        .orderBy(asc(viewingSlots.startsAt));

      const dateHint = input.dateHint?.trim();
      const isoDateHint =
        dateHint && /^\d{4}-\d{2}(-\d{2})?$/.test(dateHint)
          ? dateHint
          : undefined;

      const slots = rows
        .map((r) => {
          const startsAt =
            r.startsAt instanceof Date ? r.startsAt : new Date(r.startsAt);
          return {
            id: r.id,
            project: r.project,
            startsAt: startsAt.toISOString(),
            repName: r.repName ?? undefined,
          };
        })
        .filter((s) => (isoDateHint ? s.startsAt.startsWith(isoDateHint) : true));

      return { slots };
    },
  },
  book_viewing: {
    name: "book_viewing",
    inputSchema: toolSchemas.book_viewing.input,
    outputSchema: toolSchemas.book_viewing.output,
    requiresOtp: false, // books for the active caller; returns appointment + rep name
    permission: toolPermission("book_viewing"),
    // Reuse the existing audited bookAppointment (Req 13.4) rather than
    // inserting an appointment directly — that keeps the slot-conflict business
    // rule and the audit entry intact. We then link the voice-surface columns
    // (repId, slotId, project) onto the created row, mark the slot taken, and
    // enqueue a Salesforce `event` to the outbox keyed `appt:{id}` so a retried
    // booking never doubles the synced Event (Req 6.7, Design §8.3).
    handler: async (db, ctx, input) => {
      const [slot] = await db
        .select({
          id: viewingSlots.id,
          project: viewingSlots.project,
          startsAt: viewingSlots.startsAt,
          repId: viewingSlots.repId,
          taken: viewingSlots.taken,
        })
        .from(viewingSlots)
        .where(eq(viewingSlots.id, input.slotId))
        .limit(1);

      if (!slot) {
        throw new Error(`book_viewing: slot ${input.slotId} not found`);
      }
      if (slot.taken) {
        throw new Error(`book_viewing: slot ${input.slotId} is already taken`);
      }

      // Resolve the rep (for the spoken confirmation) and the caller's name
      // (bookAppointment requires a contact name).
      const repName = slot.repId
        ? (
            await db
              .select({ name: reps.name })
              .from(reps)
              .where(eq(reps.id, slot.repId))
              .limit(1)
          )[0]?.name ?? ""
        : "";

      const [party] = await db
        .select({ name: parties.name })
        .from(parties)
        .where(eq(parties.id, input.partyId))
        .limit(1);

      const startsAt =
        slot.startsAt instanceof Date ? slot.startsAt : new Date(slot.startsAt);
      const iso = startsAt.toISOString();
      const scheduledDate = iso.slice(0, 10); // YYYY-MM-DD
      const scheduledTime = iso.slice(11, 16); // HH:MM

      // Audited booking through the existing service (Req 13.4).
      const appointment = await bookAppointment(db, {
        conversationId: ctx.conversationId,
        contactName: party?.name?.trim() || "DOE Caller",
        appointmentType: "site_visit",
        scheduledDate,
        scheduledTime,
      });

      // Link the voice-surface columns onto the freshly-created appointment.
      await db
        .update(aiAppointments)
        .set({
          repId: slot.repId,
          slotId: slot.id,
          project: slot.project,
          updatedAt: new Date(),
        })
        .where(eq(aiAppointments.id, appointment.id));

      // Mark the slot taken so it no longer appears in check_viewing_slots.
      await db
        .update(viewingSlots)
        .set({ taken: true })
        .where(eq(viewingSlots.id, slot.id));

      // Enqueue the Salesforce Event sync (idempotent by appt id).
      await enqueueOutbox(
        db,
        "event",
        {
          appointmentId: appointment.id,
          partyId: input.partyId,
          repId: slot.repId,
          project: slot.project,
          when: iso,
          subject: `Viewing — ${slot.project}`,
          description: `Voice-booked viewing for ${slot.project} at ${iso}`,
          contactName: appointment.contactName,
        },
        `appt:${appointment.id}`
      );

      return { appointmentId: appointment.id, when: iso, repName };
    },
  },
  assign_rep: {
    name: "assign_rep",
    inputSchema: toolSchemas.assign_rep.input,
    outputSchema: toolSchemas.assign_rep.output,
    requiresOtp: false, // internal routing; returns rep id/name
    permission: toolPermission("assign_rep"),
    // Select a rep by project × language × capacity rules, persist the
    // assignment on the mirror, and record the routing logic line for the
    // Demo_Console via a decision event (Req 6.8).
    handler: async (db, _ctx, input) => {
      const [profile] = await db
        .select({
          language: parties.language,
          projectInterest: leadsMirror.projectInterest,
        })
        .from(parties)
        .leftJoin(leadsMirror, eq(leadsMirror.partyId, parties.id))
        .where(eq(parties.id, input.partyId))
        .limit(1);

      const language: Language = profile?.language === "ar" ? "ar" : "en";
      const projectInterest = profile?.projectInterest ?? undefined;

      const repRows = await db
        .select({
          id: reps.id,
          name: reps.name,
          languages: reps.languages,
          projects: reps.projects,
          capacity: reps.capacity,
          openHotCount: reps.openHotCount,
        })
        .from(reps);

      const selection = selectRep(repRows, { language, projectInterest });
      if (!selection) {
        throw new Error(
          `assign_rep: no rep serves project="${projectInterest ?? "any"}" in language="${language}"`
        );
      }

      await db
        .insert(leadsMirror)
        .values({ partyId: input.partyId, assignedRepId: selection.rep.id })
        .onConflictDoUpdate({
          target: leadsMirror.partyId,
          set: { assignedRepId: selection.rep.id, updatedAt: new Date() },
        });

      // Record the routing logic line for the Demo_Console (Req 6.8).
      await publishEvent(db, {
        type: "decision.made",
        payload: {
          decision: "assign_rep",
          partyId: input.partyId,
          repId: selection.rep.id,
          repName: selection.rep.name,
          routing: selection.routing,
        },
      });

      return { repId: selection.rep.id, repName: selection.rep.name };
    },
  },
  send_whatsapp_brief: {
    name: "send_whatsapp_brief",
    inputSchema: toolSchemas.send_whatsapp_brief.input,
    outputSchema: toolSchemas.send_whatsapp_brief.output,
    requiresOtp: false, // enqueues a rep-facing job; returns only a job id
    permission: toolPermission("send_whatsapp_brief"),
    // Enqueue the durable `send_whatsapp_brief` job (Req 9.7). The job composes
    // the rep brief and sends it through the ChannelAdapter off the voice loop;
    // here we only enqueue (idempotent by jobKey) and return the job id. The
    // jobKey is rep+party scoped so a retried tool call never doubles a send.
    handler: async (db, _ctx, input) => {
      const jobKey = `whatsapp:${input.repId}:${input.partyId}`;
      const jobId = await enqueueJob(
        db,
        "send_whatsapp_brief",
        { repId: input.repId, partyId: input.partyId },
        jobKey
      );
      return { jobId };
    },
  },
  queue_report_email: {
    name: "queue_report_email",
    inputSchema: toolSchemas.queue_report_email.input,
    outputSchema: toolSchemas.queue_report_email.output,
    requiresOtp: false, // enqueues an aggregate-metrics report job; returns a job id
    permission: toolPermission("queue_report_email"),
    // Enqueue the durable `compile_and_email_report` job (Req 9.5, Design §8.5).
    // The job reads the same metrics_* views get_pipeline_summary reads, renders
    // the PDF, and sends it via Graph mail off the voice loop; here we only
    // enqueue (idempotent by jobKey) and return the job id. The jobKey is
    // scope+period scoped so a retried request for the same report is a no-op.
    handler: async (db, _ctx, input) => {
      const jobKey = `report:${input.scope}:${input.period}`;
      const jobId = await enqueueJob(
        db,
        "compile_and_email_report",
        {
          requesterEmail: input.requesterEmail,
          scope: input.scope,
          period: input.period,
        },
        jobKey
      );
      return { jobId };
    },
  },
  log_outcome: {
    name: "log_outcome",
    inputSchema: toolSchemas.log_outcome.input,
    outputSchema: toolSchemas.log_outcome.output,
    requiresOtp: false, // enqueues a Salesforce task via outbox; returns only an id
    permission: toolPermission("log_outcome"),
    // Enqueue a Salesforce `task` to the outbox capturing the rep's free-text
    // call outcome (Design §8.4 task sync). The jobKey is content-addressed
    // (rep + party + a short hash of the text) so re-logging the identical
    // outcome dedupes, while a genuinely different note enqueues its own task.
    // Returns only the outbox row id — no personal/account data.
    handler: async (db, _ctx, input) => {
      const textHash = createHash("sha256")
        .update(input.freeText)
        .digest("hex")
        .slice(0, 12);
      const jobKey = `task:${input.repId}:${input.partyId}:${textHash}`;

      const outboxId = await enqueueOutbox(
        db,
        "task",
        {
          repId: input.repId,
          partyId: input.partyId,
          freeText: input.freeText,
          subject: `Call outcome — party ${input.partyId}`,
          description: input.freeText,
        },
        jobKey
      );

      return { outboxId };
    },
  },
  get_pipeline_summary: {
    name: "get_pipeline_summary",
    inputSchema: toolSchemas.get_pipeline_summary.input,
    outputSchema: toolSchemas.get_pipeline_summary.output,
    requiresOtp: false, // aggregate figures from metrics_* views; no personal data
    permission: toolPermission("get_pipeline_summary"),
    // SQL computes, the LLM narrates (Req 6.9, 10.1 / Property 8). The handler
    // selects which metrics_* views to read for the requested { scope, period }
    // and returns their rows verbatim — it performs no arithmetic in JS.
    handler: async (db, _ctx, input) => {
      const plan = planPipelineSummary(input);
      const metrics = await executePipelinePlan(db, plan);
      return { scope: plan.scope, period: plan.period, metrics };
    },
  },
};

/** Type guard narrowing an arbitrary string to a known {@link ToolName}. */
export function isToolName(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(toolRegistry, name);
}

/** Look up a tool definition by name, or `undefined` when unknown. */
export function getTool(name: string): ToolDef<ToolName> | undefined {
  return isToolName(name) ? (toolRegistry[name] as ToolDef<ToolName>) : undefined;
}
