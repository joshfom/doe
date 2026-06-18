/**
 * Agent-First Home / Briefing Surface (S5) — home capabilities as unified
 * Catalog_Entries (Design §Components #2 "The Home_Agent", #6 "Chat-driven
 * platform management").
 *
 * This module is the audited boundary the Home_Agent binds to. Like S4's
 * `reporting-capabilities.ts` and S3's `lead-capabilities.ts`, it does NOT
 * invent a new dispatcher, RBAC engine, OTP gate, or audit path (Requirement
 * 16.1, 16.2, 16.3) — every entry here is a `CatalogEntry` that, when invoked,
 * still flows through the unchanged `dispatchTool` (Zod → RBAC → OTP → audit →
 * execute). The one rule, preserved: the Home_Agent reasons and narrates; the
 * audited dispatcher executes.
 *
 * Task 4.1 (this file) is the SCAFFOLD + re-exposure of the consumed tools. It
 * RE-EXPOSES, under the single home RBAC identity `agent:home-twin`, the tools
 * the Home_Agent delegates through (Design §Components #6 mapping table):
 *
 *   S4 reporting/analytics tools (sourced from the S4 reporting catalog so the
 *   S4 definitions are reused verbatim, never redefined — Requirement 7.3,
 *   16.3):
 *     - `query_leads`            — role-scoped, bounded, oldest-first leads read
 *                                  behind the conversational lead ask/delegate
 *                                  flow (Requirement 7.2).
 *     - `get_pipeline_summary`   — aggregate analytics figures read verbatim
 *                                  from the `metrics_*` SQL views; the single
 *                                  source of every figure the Home_Agent
 *                                  narrates (Requirement 7.3, 14.1).
 *     - `queue_report_email`     — enqueue the durable compile_and_email_report
 *                                  job idempotently by jobKey; the Combined_Report
 *                                  spine, reused unchanged (Requirement 4.1, 16.3).
 *
 *   S3 lead-engine tools (sourced from the existing `registry.ts` handlers, the
 *   same function objects the voice surface and S3 agents use — Requirement
 *   7.2, 16.2):
 *     - `update_qualification`   — persist partial qualification facts.
 *     - `score_lead`             — score a Lead's tier from mirror signals.
 *     - `assign_rep`             — route/assign the owning rep by
 *                                  project × language × capacity.
 *
 * Each re-exposed entry REFERENCES the existing source Catalog_Entry / registry
 * handler and Zod schemas unchanged — no figure computation, no DB access, and
 * no routing logic is redefined here; only the audit actor and the RBAC
 * permission string are rebound to the home identity, exactly mirroring how
 * `reporting-capabilities.ts` re-exposes `get_pipeline_summary` and how
 * `lead-capabilities.ts` re-exposes `update_qualification` / `score_lead` under
 * their own identities (Requirement 7.1, 7.6, 16.1).
 *
 * The NEW task Catalog_Entries the Home_Agent introduces — `add_stack_item`,
 * `complete_stack_item`, `list_stack` — are TASK 4.2's job. This file leaves a
 * clean seam for them: their names are already listed in {@link HOME_TOOL_NAMES}
 * (so the binding contract is ready), and {@link homeTaskToolEntries} is the
 * (currently empty) array task 4.2 fills. {@link homeCapabilityEntries} splices
 * it in, so once 4.2 lands the assembled catalog's entry names equal
 * {@link HOME_TOOL_NAMES} with no further change here.
 *
 * Design references: §Components #2 (the Home_Agent + its bound catalog),
 * §Components #6 (chat-driven platform management mapping). Requirements: 7.1,
 * 7.2, 7.3, 7.6, 16.1, 16.2, 16.3.
 */

import { z } from "zod";
import { and, or, eq, gte, lte, desc, inArray } from "drizzle-orm";

import { toolRegistry, isToolName, toolPermission } from "./registry";
import {
  loadCatalog,
  type CatalogEntry,
  type CatalogLoadResult,
} from "./catalog";
import { loadReportingCapabilities } from "./reporting-capabilities";
import {
  platformCapabilityEntries,
  PLATFORM_TOOL_NAMES,
} from "./platform-capabilities";
import {
  crmAnalyticsCapabilityEntries,
  CRM_ANALYTICS_TOOL_NAMES,
} from "./crm-analytics-capability";
import { tickets, partyIdentities } from "../../schema";
import type { TicketRequestType, TicketStatus } from "../../types";
import { createTicket, getTicketById } from "../../tickets/service";
import { transitionTicketStatus } from "../../tickets/lifecycle";
import { redactHomeContent } from "../../agents/home/redact";
import { enqueueJob } from "../../jobs";
import {
  combinedReportJobKey,
  resolveReportPeriodDate,
} from "../../agents/home/jobkey";

// ── Home agent identity & permissions ─────────────────────────────────────────

/**
 * The RBAC identity (and audit actor) the Home_Agent dispatches under (Design
 * §Components #2). Every Delegated_Action, Stack read, and figure read on the
 * Home_Surface is audited under this single agent identity through the
 * unchanged dispatcher; it is never a user session and never a backdoor around
 * RBAC, OTP, or audit (Requirement 7.6, 16.1). The dispatcher records the
 * REQUESTING USER as the audit actor for a Delegated_Action (Requirement 8.2);
 * this constant is the catalog-entry actor the home capabilities are bound
 * under, mirroring `REPORTING_AGENT_ACTOR` / the lead-engine actors.
 */
export const HOME_AGENT_ACTOR = "agent:home-twin";

/** Prefix for per-tool RBAC permission strings, e.g. `home:tool:list_stack`. */
export const HOME_TOOL_PERMISSION_PREFIX = "home:tool";

/**
 * The RBAC permission string a given home capability requires, in the existing
 * `resource:action` format the RBAC engine already understands (Requirement
 * 16.1 — no new permission scheme). Mirrors the `reportToolPermission` /
 * `leadToolPermission` convention so the unchanged dispatcher's RBAC check
 * resolves these the same way it resolves every other catalog permission.
 */
export function homeToolPermission(name: string): string {
  return `${HOME_TOOL_PERMISSION_PREFIX}:${name}`;
}

// ── Home tool name contract ───────────────────────────────────────────────────

/**
 * The consumed S4 reporting + S3 lead tool names the Home_Agent re-exposes and
 * binds (Design §Components #6). Each is RE-EXPOSED below from its existing
 * source definition under the home identity — none is redefined.
 */
export const HOME_CONSUMED_TOOL_NAMES = [
  // S4 reporting/analytics (sourced from the reporting capabilities catalog)
  "query_leads",
  "get_pipeline_summary",
  "queue_report_email",
  // S3 lead-engine (sourced from the registry handlers)
  "update_qualification",
  "score_lead",
  "assign_rep",
] as const;

/**
 * The NEW task Catalog_Entry names the Home_Agent introduces (the Stack tools).
 * Their entries are implemented by TASK 4.2; their names are listed here now so
 * the binding contract ({@link HOME_TOOL_NAMES}) is ready for the Home_Agent
 * (task 9.1) the moment 4.2 fills {@link homeTaskToolEntries}.
 */
export const HOME_TASK_TOOL_NAMES = [
  "add_stack_item",
  "complete_stack_item",
  "list_stack",
] as const;

/**
 * The NEW Combined_Report Catalog_Entry name the Home_Agent introduces (the
 * daily/weekly report enqueue, task 8.1). This is a NEW entry defined in this
 * file — distinct from the re-exposed S4 `queue_report_email`
 * ({@link HOME_CONSUMED_TOOL_NAMES}) — because it derives its idempotency
 * `jobKey` per (userId, periodType, periodDate) via {@link combinedReportJobKey}
 * (Requirement 4.2), whereas the re-exposed `queue_report_email` keys by
 * `report:{scope}:{period}`. It still REUSES the existing
 * `compile_and_email_report` job spine unchanged (Requirement 16.3).
 */
export const HOME_REPORT_TOOL_NAMES = ["queue_combined_report"] as const;

/**
 * The Platform_Brain tool name(s) the Home_Agent introduces (the C-level twin
 * surface answering questions ABOUT the platform). Sourced from
 * `platform-capabilities.ts` so the entry is defined once and reused here.
 */
export const HOME_PLATFORM_TOOL_NAMES = [...PLATFORM_TOOL_NAMES] as const;

/**
 * The live-CRM analytics tool name(s) the Home_Agent introduces (the C-level
 * twin brainstorming on Salesforce data). Sourced from
 * `crm-analytics-capability.ts` so the entry is defined once and reused here.
 */
export const HOME_CRM_TOOL_NAMES = [...CRM_ANALYTICS_TOOL_NAMES] as const;

/**
 * The full set of tool names the Home_Agent binds via `bindCatalog` (Design
 * §Components #2). Lists the consumed tools (re-exposed in this file), the task
 * tools (task 4.2), the Combined_Report tool (task 8.1), the Platform_Brain
 * tool, and the live-CRM analytics tool. The assembled catalog from
 * {@link loadHomeCapabilities} carries exactly these names.
 */
export const HOME_TOOL_NAMES: string[] = [
  ...HOME_CONSUMED_TOOL_NAMES,
  ...HOME_TASK_TOOL_NAMES,
  ...HOME_REPORT_TOOL_NAMES,
  ...HOME_PLATFORM_TOOL_NAMES,
  ...HOME_CRM_TOOL_NAMES,
];

/**
 * The in-process RBAC permission grant for the Home_Agent identity
 * (`agent:home-twin`), mirroring the voice agent's `AGENT_VOICE_LEAD_PERMISSIONS`
 * (`registry.ts`). The Home_Agent is a well-known static agent identity, so the
 * dispatcher resolves its permissions from this set (registered in
 * `STATIC_AGENT_PERMISSIONS`, `dispatch.ts`) rather than from seeded RBAC roles.
 *
 * IMPORTANT — the dispatcher (`dispatchTool`) resolves each tool from the shared
 * `toolRegistry` and checks THAT tool's `permission` (a `voice:tool:<name>`
 * string), NOT the home catalog's re-bound `home:tool:<name>` permission. So for
 * the re-exposed registry tools (`get_pipeline_summary`, `query_leads`, …) we
 * must grant the registry's `voice:tool:<name>` permission, or the dispatch is
 * denied. We grant both the registry permission (for any home tool name that is
 * a real registry tool) and the `home:tool:<name>` permission (harmless, and
 * future-proofs a catalog-aware dispatch). Per-row clamps in each handler still
 * scope reads to the requesting `userId`, so this grant never widens what a
 * given user can see.
 */
export const AGENT_HOME_PERMISSIONS: ReadonlySet<string> = new Set([
  ...HOME_TOOL_NAMES.map((name) => homeToolPermission(name)),
  // The actual permission the dispatcher checks for each re-exposed registry tool.
  ...HOME_TOOL_NAMES.filter((name) => isToolName(name)).map((name) =>
    toolPermission(name as Parameters<typeof toolPermission>[0])
  ),
]);

// ── entry()/re-expose helpers (mirror reporting-capabilities.ts) ──────────────

/**
 * Keep per-entry input/output typing intact (the handler is checked against the
 * entry's Zod schemas) while collecting heterogeneous entries into one
 * `CatalogEntry[]` for {@link loadCatalog}.
 */
function entry<I, O>(e: CatalogEntry<I, O>): CatalogEntry {
  return e as unknown as CatalogEntry;
}

/**
 * Re-expose an existing source {@link CatalogEntry} under the home identity:
 * carry its description, Zod schemas, OTP flag, and handler VERBATIM, rebinding
 * ONLY the RBAC permission and the audit actor to the home capability (Design
 * §Components #2; Requirement 7.1, 16.1). No logic is redefined here.
 */
function reExpose(source: CatalogEntry): CatalogEntry {
  return entry({
    name: source.name,
    description: source.description,
    inputSchema: source.inputSchema,
    outputSchema: source.outputSchema,
    requiresOtp: source.requiresOtp,
    permission: homeToolPermission(source.name),
    auditActor: HOME_AGENT_ACTOR,
    // Reference the source handler — never re-implemented (Requirement 16.x).
    handler: source.handler,
  });
}

// ── Source the consumed S4 Catalog_Entries (reuse, don't redefine) ────────────
//
// The S4 reporting tools the Home_Agent delegates through are the canonical S4
// Catalog_Entries from `reporting-capabilities.ts` — including `query_leads`,
// which exists ONLY as an S4 catalog entry (it is not a `registry.ts` handler).
// We load the validated S4 catalog and pull the exact entries to re-expose, so
// nothing is re-implemented here (Requirement 7.2, 7.3, 16.3).

const reportingCatalog = loadReportingCapabilities().catalog;

/** Resolve a required S4 source entry, failing fast if the S4 catalog drifts. */
function requireReportingEntry(name: string): CatalogEntry {
  const source = reportingCatalog.get(name);
  if (!source) {
    throw new Error(
      `home-capabilities: expected S4 catalog entry "${name}" was not found ` +
        `in the reporting capabilities catalog`
    );
  }
  return source;
}

// ── The re-exposed S3 lead-engine Catalog_Entries (registry handlers) ─────────
//
// The `registry.ts` handlers have no `description` field of their own, so each
// entry references the registry's Zod schemas, OTP flag, and handler VERBATIM
// (literal property access narrows each to its specific ToolDef) and provides a
// model-facing description. Only the RBAC permission and the audit actor are
// rebound to the home identity — exactly how `lead-capabilities.ts` re-exposes
// `update_qualification` / `score_lead` (Requirement 7.2, 16.2).

const updateQualificationEntry = entry({
  name: "update_qualification",
  description:
    "Persist partial qualification facts (budget band, unit type) onto the " +
    "Lead's mirror as they emerge in conversation. Upserts by party id; a " +
    "partial update never clobbers a previously-captured fact.",
  inputSchema: toolRegistry.update_qualification.inputSchema,
  outputSchema: toolRegistry.update_qualification.outputSchema,
  requiresOtp: toolRegistry.update_qualification.requiresOtp,
  permission: homeToolPermission("update_qualification"),
  auditActor: HOME_AGENT_ACTOR,
  // Reference the existing registry handler — no logic redefined here.
  handler: toolRegistry.update_qualification.handler,
});

const scoreLeadEntry = entry({
  name: "score_lead",
  description:
    "Score a Lead's tier (HOT/WARM/NURTURE) from the qualification signals on " +
    "its mirror via deterministic thresholds, with an LLM-written rationale " +
    "stored for the Console only.",
  inputSchema: toolRegistry.score_lead.inputSchema,
  outputSchema: toolRegistry.score_lead.outputSchema,
  requiresOtp: toolRegistry.score_lead.requiresOtp,
  permission: homeToolPermission("score_lead"),
  auditActor: HOME_AGENT_ACTOR,
  // Reference the existing registry handler — no logic redefined here.
  handler: toolRegistry.score_lead.handler,
});

const assignRepEntry = entry({
  name: "assign_rep",
  description:
    "Select and persist the owning rep for a Lead by project × language × " +
    "capacity (deterministic tie-break), and record the routing rationale to " +
    "the event bus.",
  inputSchema: toolRegistry.assign_rep.inputSchema,
  outputSchema: toolRegistry.assign_rep.outputSchema,
  requiresOtp: toolRegistry.assign_rep.requiresOtp,
  permission: homeToolPermission("assign_rep"),
  auditActor: HOME_AGENT_ACTOR,
  // Reference the existing registry handler — no logic redefined here.
  handler: toolRegistry.assign_rep.handler,
});

// ── The re-exposed consumed Catalog_Entries under the home identity ───────────

/**
 * The consumed S4 + S3 tools, re-exposed under `agent:home-twin`. Each
 * references its existing source definition; only the RBAC permission and audit
 * actor are rebound to the home capability (Requirement 7.1, 7.2, 7.3, 16.1).
 */
const reExposedConsumedEntries: CatalogEntry[] = [
  // S4 reporting/analytics (canonical S4 entries, reused verbatim)
  reExpose(requireReportingEntry("query_leads")),
  reExpose(requireReportingEntry("get_pipeline_summary")),
  reExpose(requireReportingEntry("queue_report_email")),
  // S3 lead-engine (existing registry handlers, descriptions provided here)
  updateQualificationEntry,
  scoreLeadEntry,
  assignRepEntry,
];

// ── The NEW Stack task Catalog_Entries (task 4.2) ─────────────────────────────
//
// Kept separate from {@link reExposedConsumedEntries} so the re-exposure
// scaffold and the new task tools have a clean boundary;
// {@link homeCapabilityEntries} splices {@link homeTaskToolEntries} in after the
// consumed tools, so the assembled catalog's entry names equal
// {@link HOME_TOOL_NAMES}.
//
// `add_stack_item`, `complete_stack_item`, and `list_stack` are the three task
// tools the Home_Agent introduces (Design §Components #3 "Briefing_Workflow",
// #6 "Chat-driven platform management"). Each is a `CatalogEntry` that still
// flows through the unchanged `dispatchTool` (Zod → RBAC → OTP → audit →
// execute), so this file invents NO new dispatcher/RBAC/OTP/audit path.
//
// PERSISTENCE — the audited boundary, reused not reinvented. A Stack_Item is a
// Ticket: the schema documents a Ticket whose `lead_party_id` is set as a
// "Lead_Task" (a sales activity), and the tickets layer already exposes the
// audited services these handlers execute through — `createTicket` and
// `transitionTicketStatus`/`getTicketById` each write their own `logAudit`
// trail. The mutating handlers (`add_stack_item`, `complete_stack_item`) call
// ONLY those services; they touch no raw DB beyond what the service wraps
// (Requirement 8.2). The read handler (`list_stack`) is the one role-clamped
// read; it follows the EXACT pattern of the sibling catalog read
// `query_leads` (reporting-capabilities.ts) — a role-clamped, bounded Drizzle
// SELECT joined to `party_identities` for the salted `phone_hash` only — because
// no service exposes an owner-scoped, period-bounded, hash-projected stack read
// and the design requires fail-closed, role-clamped reads (Requirement 6.1,
// 6.2). It is still the audited boundary: it runs only inside `dispatchTool`.
//
// PRIVACY — results carry only ids / qualification facts + `phone_hash`, NEVER
// a raw phone (Requirement 2.7, 9.1, 9.4). `list_stack` never selects the
// ticket `contact_phone` column, resolves a lead reference to its salted
// `phone_hash` only (exactly as `query_leads` does), and passes every assembled
// item through the shared home redaction helper as defence-in-depth over the
// user-authored title text.
//
// OTP — none of the three is OTP-gated (`requiresOtp: false`). `list_stack`
// returns ONLY the requesting user's own role-clamped stack (task metadata,
// status, due date, and salted lead hashes) — not another party's gated
// client/tenant/lead personal data — and it is the normal home-load path the
// Briefing_Workflow dispatches to assemble the Stack (Requirement 2.2), which
// must not be blocked behind an OTP challenge on every briefing. The two
// mutations return only an id/status ack. Each still RBAC-checks (the per-tool
// `home:tool:*` permission) and is audited by the dispatcher. This mirrors the
// `requiresOtp: false` posture of `update_qualification` / `assign_rep`, while
// the genuinely gated personal-data read the Home_Agent uses (`query_leads`)
// stays `requiresOtp: true` via its re-exposed entry above.

/** Stack_Item kinds (mirrors `lib/cms/agents/home/types.ts`'s `StackItem.kind`). */
const STACK_ITEM_KINDS = ["task", "lead_followup", "appointment"] as const;

/** Hard ceiling on returned Stack_Items, enforced regardless of `limit`. */
const LIST_STACK_HARD_LIMIT = 100;

/** Ticket statuses that present as a completed ("done") Stack_Item. */
const DONE_TICKET_STATUSES = ["resolved", "closed"] as const satisfies readonly TicketStatus[];
/** Ticket statuses that present as an open Stack_Item. */
const OPEN_TICKET_STATUSES = [
  "open",
  "assigned",
  "in_progress",
] as const satisfies readonly TicketStatus[];

/**
 * Map a Stack_Item kind onto the existing ticket `request_type` enum so the
 * audited `createTicket` service persists the item without overloading any new
 * column (Requirement 16.1 — no new schema). A lead follow-up is the existing
 * `lead_inquiry` Lead_Task; an appointment is the existing `site_visit_booking`;
 * a plain task is a `general_inquiry`.
 */
function kindToRequestType(kind: (typeof STACK_ITEM_KINDS)[number]): TicketRequestType {
  switch (kind) {
    case "lead_followup":
      return "lead_inquiry";
    case "appointment":
      return "site_visit_booking";
    case "task":
    default:
      return "general_inquiry";
  }
}

/**
 * Classify a persisted ticket back into a Stack_Item kind for presentation: a
 * lead-linked ticket is a `lead_followup`; a scheduled ticket is an
 * `appointment`; everything else is a `task`.
 */
function ticketToStackKind(row: {
  leadPartyId: string | null;
  scheduledStart: Date | null;
}): (typeof STACK_ITEM_KINDS)[number] {
  if (row.leadPartyId) return "lead_followup";
  if (row.scheduledStart) return "appointment";
  return "task";
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

/** A single presented Stack_Item — ids/facts + salted hash only (Req 9.4). */
const stackItemSchema = z.object({
  id: z.string(),
  kind: z.enum(STACK_ITEM_KINDS),
  /** Already phone-redacted user-authored title (Req 2.7, 9.4). */
  title: z.string(),
  status: z.enum(["open", "done"]),
  /** ISO timestamp, or null when the item has no due date. */
  dueAt: z.string().nullable(),
  /** A lead reference carries the salted hash only — never a raw phone (Req 9.4). */
  leadPhoneHash: z.string().nullable(),
});

const listStackInput = z.object({
  /** Optional ISO date (YYYY-MM-DD) lower bound on creation; OMIT to read the
   *  user's current stack. */
  periodStart: z.string().optional(),
  /** Optional ISO date (YYYY-MM-DD) upper bound on creation; OMIT to read the
   *  user's current stack. */
  periodEnd: z.string().optional(),
  /** Filter to open or done items; `all` (default) returns both. */
  status: z.enum(["open", "done", "all"]).default("all"),
  /** At most 100 (the handler hard-caps regardless). Coerced so a model that
   *  emits the number as a string (common via tool-calling) still validates. */
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIST_STACK_HARD_LIMIT)
    .default(LIST_STACK_HARD_LIMIT),
});

const listStackOutput = z.object({
  items: z.array(stackItemSchema),
  /** The effective hard cap applied to this read. */
  truncatedAt: z.number(),
});

const addStackItemInput = z.object({
  /** The item title (becomes the ticket subject + description). */
  title: z.string().min(1).max(500),
  /** The kind of Stack_Item to create (defaults to a plain task). */
  kind: z.enum(STACK_ITEM_KINDS).default("task"),
  /** Optional due date (ISO) → the ticket's scheduled start. */
  dueAt: z.string().nullable().optional(),
  /** Optional longer description; defaults to the title. */
  description: z.string().max(2000).optional(),
});

const addStackItemOutput = z.object({
  id: z.string(),
  ticketNumber: z.string(),
});

const completeStackItemInput = z.object({
  /** The id of the Stack_Item (ticket) to mark done. */
  id: z.string().min(1),
});

const completeStackItemOutput = z.object({
  id: z.string(),
  status: z.literal("done"),
});

// ── add_stack_item ────────────────────────────────────────────────────────────

const addStackItemEntry = entry({
  name: "add_stack_item",
  description:
    "Create a Stack_Item (a task, lead follow-up, or appointment) for the " +
    "requesting user via the audited tickets service. Returns the created " +
    "item id and number; never reads or writes the database outside the " +
    "audited service.",
  inputSchema: addStackItemInput,
  outputSchema: addStackItemOutput,
  requiresOtp: false, // mutation returning only an id/number ack — not gated data
  permission: homeToolPermission("add_stack_item"),
  auditActor: HOME_AGENT_ACTOR,
  // Execute via the existing audited `createTicket` service (it writes its own
  // ticket_create audit row); the dispatcher additionally audits the dispatch
  // under the requesting user (Requirement 8.1, 8.2). No raw DB here.
  handler: async (db, ctx, input) => {
    const createdBy = ctx.userId ?? null;
    const { ticketId, ticketNumber } = await createTicket(db, {
      subject: input.title,
      description: input.description ?? input.title,
      // Internal stack items carry no external contact; use stable, non-personal
      // placeholders for the tickets service's required contact fields.
      contactName: "Home Stack",
      contactEmail: "home-stack@doe.local",
      source: "manual",
      createdBy,
      requestType: kindToRequestType(input.kind),
      scheduledStart: input.dueAt ?? null,
    });
    return { id: ticketId, ticketNumber };
  },
});

// ── complete_stack_item ───────────────────────────────────────────────────────

const completeStackItemEntry = entry({
  name: "complete_stack_item",
  description:
    "Mark one of the requesting user's Stack_Items done by advancing its " +
    "ticket to resolved through the audited lifecycle service. Idempotent: an " +
    "already-completed item returns done. Denies items the user does not own.",
  inputSchema: completeStackItemInput,
  outputSchema: completeStackItemOutput,
  requiresOtp: false, // mutation returning only a status ack — not gated data
  permission: homeToolPermission("complete_stack_item"),
  auditActor: HOME_AGENT_ACTOR,
  // Ownership is row-clamped here (Req 6.1): only an item the requesting user
  // created or is assigned to may be completed. Completion walks the audited
  // lifecycle (`transitionTicketStatus`, which writes its own audit trail) to
  // the terminal "resolved" state; the dispatcher audits the dispatch itself.
  handler: async (db, ctx, input) => {
    const actorId = ctx.userId ?? HOME_AGENT_ACTOR;

    const found = await getTicketById(db, input.id);
    if (!found) {
      throw new Error(`complete_stack_item: stack item "${input.id}" not found`);
    }

    // Role-clamp at the row: a user may only complete their own Stack_Items
    // (Requirement 6.1, 6.6). Indeterminate ownership is treated as denied.
    const owns =
      (ctx.userId != null && found.ticket.createdBy === ctx.userId) ||
      (ctx.userId != null && found.ticket.assigneeId === ctx.userId);
    if (!owns) {
      throw new Error(
        `complete_stack_item: stack item "${input.id}" is not owned by the requesting user`
      );
    }

    // Idempotent: an already-done item needs no transition.
    let current = found.ticket.status as TicketStatus;
    if (current === "resolved" || current === "closed") {
      return { id: input.id, status: "done" as const };
    }

    // Advance through the valid lifecycle path to "resolved":
    //   open|assigned → in_progress → resolved
    if (current === "open" || current === "assigned") {
      await transitionTicketStatus(db, input.id, "in_progress", actorId);
      current = "in_progress";
    }
    if (current === "in_progress") {
      await transitionTicketStatus(db, input.id, "resolved", actorId);
    }

    return { id: input.id, status: "done" as const };
  },
});

// ── list_stack ────────────────────────────────────────────────────────────────

const listStackEntry = entry({
  name: "list_stack",
  description:
    "Return the requesting user's Stack_Items (tasks, lead follow-ups, " +
    "appointments) for a period, role-clamped to items the user owns. " +
    "Describes each item by id, kind, title, status, due date, and the salted " +
    "lead phone hash only — never a raw phone number.",
  inputSchema: listStackInput,
  outputSchema: listStackOutput,
  requiresOtp: false, // the user's own role-clamped stack metadata — not gated data
  permission: homeToolPermission("list_stack"),
  auditActor: HOME_AGENT_ACTOR,
  // The one role-clamped read. Follows the sibling `query_leads` catalog-handler
  // pattern: a role-clamped, bounded Drizzle SELECT joined to `party_identities`
  // for the salted `phone_hash` ONLY (never the raw `contact_phone`). Fail-closed
  // — with no requesting user there is nothing the role permits, so it returns an
  // empty Stack (Requirement 6.1, 6.2, 6.4).
  handler: async (db, ctx, input) => {
    const limit = Math.min(input.limit ?? LIST_STACK_HARD_LIMIT, LIST_STACK_HARD_LIMIT);

    // Fail-closed role clamp: only the requesting user's own items (created by
    // or assigned to them). No identity → no permitted records (Requirement 6.4).
    if (!ctx.userId) {
      return { items: [], truncatedAt: limit };
    }

    const conditions = [
      or(eq(tickets.createdBy, ctx.userId), eq(tickets.assigneeId, ctx.userId))!,
    ];
    if (input.periodStart) {
      const d = new Date(input.periodStart);
      if (!Number.isNaN(d.getTime())) conditions.push(gte(tickets.createdAt, d));
    }
    if (input.periodEnd) {
      const d = new Date(input.periodEnd);
      if (!Number.isNaN(d.getTime())) conditions.push(lte(tickets.createdAt, d));
    }
    if (input.status === "open") {
      conditions.push(inArray(tickets.status, [...OPEN_TICKET_STATUSES]));
    } else if (input.status === "done") {
      conditions.push(inArray(tickets.status, [...DONE_TICKET_STATUSES]));
    }

    // Read task facts joined to the lead party's `phone_hash` identity ONLY —
    // the raw `contact_phone` column is never selected (Requirement 9.4).
    const rows = await db
      .select({
        id: tickets.id,
        subject: tickets.subject,
        status: tickets.status,
        scheduledStart: tickets.scheduledStart,
        leadPartyId: tickets.leadPartyId,
        createdAt: tickets.createdAt,
        phoneHash: partyIdentities.value,
      })
      .from(tickets)
      .leftJoin(
        partyIdentities,
        and(
          eq(partyIdentities.partyId, tickets.leadPartyId),
          eq(partyIdentities.kind, "phone_hash")
        )
      )
      .where(and(...conditions))
      .orderBy(desc(tickets.createdAt))
      .limit(limit);

    const items = rows.map((r) => {
      const status = r.status as TicketStatus;
      const done = status === "resolved" || status === "closed";
      const scheduledStart =
        r.scheduledStart instanceof Date ? r.scheduledStart : null;
      return {
        id: r.id,
        kind: ticketToStackKind({
          leadPartyId: r.leadPartyId ?? null,
          scheduledStart,
        }),
        title: r.subject,
        status: done ? ("done" as const) : ("open" as const),
        dueAt: scheduledStart ? scheduledStart.toISOString() : null,
        leadPhoneHash: r.phoneHash ?? null,
      };
    });

    // Defence-in-depth: scrub any raw phone a user may have typed into a title
    // before it leaves the surface (Requirement 2.7, 9.4). The salted
    // `leadPhoneHash` is not a raw phone and passes through unchanged.
    const redacted = redactHomeContent(items);

    return { items: redacted, truncatedAt: limit };
  },
});

/**
 * The NEW task Catalog_Entries — `add_stack_item`, `complete_stack_item`,
 * `list_stack` — implemented by TASK 4.2. {@link homeCapabilityEntries} splices
 * this array in after the re-exposed consumed tools, so the assembled catalog's
 * entry names equal {@link HOME_TOOL_NAMES}.
 */
export const homeTaskToolEntries: CatalogEntry[] = [
  addStackItemEntry,
  completeStackItemEntry,
  listStackEntry,
];

// ── queue_combined_report (task 8.1) — Combine tasks into a daily/weekly report
//
// Design §Components #5 ("Combine tasks into daily/weekly reports"): "A
// Combined_Report REUSES the existing `compile_and_email_report` job spine
// unchanged (no new report/PDF/email path). The Home_Agent dispatches a
// `queue_report_email`-style Catalog_Entry that
// `enqueueJob('compile_and_email_report', payload, jobKey)`; the worker compiles
// from `metrics_*` and delivers."
//
// This entry is the S5 Combined_Report enqueue path. It REUSES, never reinvents:
//   • the idempotency `jobKey` is the pure `combinedReportJobKey(userId,
//     periodType, periodDate)` (`report:{userId}:{periodType}:{periodDate}`),
//     with `periodDate` derived by the pure `resolveReportPeriodDate` — the
//     calendar day for a daily report, the week's first calendar day for a
//     weekly report (Requirement 4.2);
//   • the durable job is the EXISTING `compile_and_email_report` handler, whose
//     worker reads the `metrics_*` views in SQL and renders/sends the report —
//     NO inline compile/send happens here (Requirement 4.1, 16.3);
//   • `enqueueJob`'s `ON CONFLICT (job_key) DO NOTHING` guarantees exactly one
//     job row and at-most-one report side effect per `jobKey`; a duplicate
//     enqueue returns the EXISTING job id as a success ack (Requirement 4.3,
//     10.2, 10.3, 10.4, 10.5).
//
// RBAC SCOPE + PRIVACY (Requirement 4.5, 9.4): a `rep`-scoped report is clamped
// to the requesting user's own records (`repId` defaults to the requesting
// user); the payload is passed through the shared home redaction helper as
// defence-in-depth so nothing bound for the job (or its `job.queued` event)
// carries a raw phone, full or partial. The handler itself sources every figure
// from SQL and excludes raw phones (Requirement 4.4, 4.5).
//
// OTP: `requiresOtp: false` — this returns only a job-id/jobKey acknowledgement
// (not gated personal data), mirroring the re-exposed `queue_report_email`.
//
// FAIL-CLOSED: without a requesting user there is no identity to scope the
// report to, so the handler refuses rather than enqueue an unscoped job
// (Requirement 4.2, 4.5).
//
// EMPTY-PERIOD (Requirement 4.7) and METRICS-FAIL (Requirement 4.6) are
// behaviours of the `compile_and_email_report` WORKER, not of this enqueue —
// see the task report for the finding on the reused handler.

/** A Combined_Report period type (Requirement 4.2). */
const REPORT_PERIOD_TYPES = ["daily", "weekly"] as const;

/** Report scopes the requesting user may request (RBAC-scoped, Req 4.5). */
const REPORT_SCOPES = ["exec", "rep"] as const;

const queueCombinedReportInput = z.object({
  /** Daily or weekly Combined_Report (Requirement 4.2). */
  periodType: z.enum(REPORT_PERIOD_TYPES),
  /**
   * The reference calendar day (`YYYY-MM-DD`, local to the requesting user) the
   * report is for. `resolveReportPeriodDate` derives the canonical period date
   * from it (the day itself for daily; the week's first day for weekly).
   */
  referenceDay: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u, "referenceDay must be a YYYY-MM-DD calendar day"),
  /** Destination mailbox for the compiled report. */
  requesterEmail: z.string().email(),
  /** Report scope; `rep` (default) is clamped to the requesting user's records. */
  scope: z.enum(REPORT_SCOPES).default("rep"),
  /** Explicit rep id for a rep-scoped report; defaults to the requesting user. */
  repId: z.string().optional(),
});

const queueCombinedReportOutput = z.object({
  /** The enqueued (or pre-existing, on duplicate) job id — the success ack. */
  jobId: z.string(),
  /** The derived idempotency key (`report:{userId}:{periodType}:{periodDate}`). */
  jobKey: z.string(),
  /** The canonical period date the report covers (`YYYY-MM-DD`). */
  periodDate: z.string(),
});

const queueCombinedReportEntry = entry({
  name: "queue_combined_report",
  description:
    "Enqueue exactly one daily or weekly Combined_Report job for the requesting " +
    "user. Derives an idempotency jobKey from the user, period type, and period " +
    "date, then enqueues the durable compile_and_email_report job (which reads " +
    "metrics_* in SQL and emails the report off the chat loop). Never compiles " +
    "or sends inline; returns the job id (a duplicate request returns the " +
    "existing job id as a success ack).",
  inputSchema: queueCombinedReportInput,
  outputSchema: queueCombinedReportOutput,
  requiresOtp: false, // returns only a job-id/jobKey ack — not gated personal data
  permission: homeToolPermission("queue_combined_report"),
  auditActor: HOME_AGENT_ACTOR,
  // Enqueue-only, exactly one (Requirement 4.1): no inline compile/send. The
  // worker (`compile_and_email_report`) does the SQL read + render + deliver.
  handler: async (db, ctx, input) => {
    const userId = ctx.userId;
    // Fail-closed: the jobKey is scoped per user (Requirement 4.2); without a
    // requesting user there is nothing to scope, so refuse rather than enqueue
    // an unscoped report (Requirement 4.5).
    if (!userId) {
      throw new Error(
        "queue_combined_report: a requesting user is required to scope the Combined_Report"
      );
    }

    // Pure period-date derivation: the calendar day (daily) or the week's first
    // calendar day (weekly) (Requirement 4.2).
    const periodDate = resolveReportPeriodDate(input.periodType, input.referenceDay);

    // Pure idempotency key per (userId, periodType, periodDate) (Requirement 4.2).
    const jobKey = combinedReportJobKey(userId, input.periodType, periodDate);

    // RBAC-scoped payload (Requirement 4.5): a rep-scoped report is clamped to
    // the requesting user's own records; exec scope is left to the worker's
    // metrics read (still RBAC-gated at the dispatcher by this tool's permission).
    const repId =
      input.scope === "rep" ? input.repId ?? userId : input.repId;

    // The reused `compile_and_email_report` payload shape, unchanged. The period
    // label encodes the canonical period so the worker reads the right window.
    const rawPayload: {
      requesterEmail: string;
      scope: string;
      period: string;
      repId?: string;
    } = {
      requesterEmail: input.requesterEmail,
      scope: input.scope,
      period: `${input.periodType}:${periodDate}`,
    };
    if (repId) {
      rawPayload.repId = repId;
    }

    // Phone-redacted payload as defence-in-depth (Requirement 4.5, 9.4): nothing
    // bound for the job (or its `job.queued` event) carries a raw phone.
    const payload = redactHomeContent(rawPayload);

    // Exactly one enqueue; ON CONFLICT (job_key) DO NOTHING gives idempotency —
    // a duplicate returns the existing job id as a success ack (Requirement 4.1,
    // 4.3, 10.2, 10.3, 10.4, 10.5).
    const jobId = await enqueueJob(db, "compile_and_email_report", payload, jobKey);

    return { jobId, jobKey, periodDate };
  },
});

/**
 * The NEW Combined_Report Catalog_Entry (task 8.1). Kept separate from the
 * task tools and the re-exposed consumed tools so each contributor set has a
 * clean boundary; {@link homeCapabilityEntries} splices it in so the assembled
 * catalog's entry names equal {@link HOME_TOOL_NAMES}.
 */
export const homeReportToolEntries: CatalogEntry[] = [queueCombinedReportEntry];

// ── The home catalog contributor set ──────────────────────────────────────────

/**
 * The home Catalog_Entries contributed to the Tool_Catalog and bound to the
 * Home_Agent via `bindCatalog` (one Mastra tool per name, each dispatching
 * through the unchanged `dispatchTool`). The re-exposed consumed tools first,
 * then the task tools task 4.2 adds. Once 4.2 lands, the set of entry names
 * here equals {@link HOME_TOOL_NAMES}.
 */
export const homeCapabilityEntries: CatalogEntry[] = [
  ...reExposedConsumedEntries,
  ...homeTaskToolEntries,
  ...homeReportToolEntries,
  ...platformCapabilityEntries,
  ...crmAnalyticsCapabilityEntries,
];

/**
 * Validate and assemble just the home capabilities through {@link loadCatalog}.
 * Surfaces `incomplete_entry` / `duplicate_name` errors the same way the full
 * catalog load does, so this module can be self-checked in isolation and the
 * Home_Agent can fail fast rather than bind a partial tool set (Requirement
 * 7.6). The Home_Agent reads `loadHomeCapabilities().catalog` and binds
 * {@link HOME_TOOL_NAMES} from it (task 9.1).
 */
export function loadHomeCapabilities(): CatalogLoadResult {
  return loadCatalog(homeCapabilityEntries);
}
