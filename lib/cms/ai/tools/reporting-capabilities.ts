/**
 * Agentic Reporting & C-Level Twin (S4) — reporting capabilities as unified
 * Catalog_Entries (Design §Components #1 "The Reporting_Agent", #9 "Dispatcher
 * boundary, audit, and phone privacy").
 *
 * This module is the audited boundary the Reporting_Agent binds to. It does NOT
 * invent a new dispatcher, RBAC engine, OTP gate, or audit path (Requirement
 * 16.4) — every entry here is a `CatalogEntry` that, when invoked, still flows
 * through the unchanged `dispatchTool` (Zod → RBAC → OTP → audit → execute).
 *
 * Task 1 scaffolds the catalog by RE-EXPOSING three existing, already-audited
 * tools under the report RBAC identity `agent:reporting-twin`, so the
 * Reporting_Agent can bind them without redefining any logic:
 *
 *   - `get_pipeline_summary` — aggregate analytics figures read verbatim from
 *                              the `metrics_*` SQL views for a Report_Scope; the
 *                              single source of figures (Requirement 1.1, 1.2).
 *   - `queue_report_email`   — validate the recipient list (1–50) at the tool
 *                              boundary, derive the idempotency `jobKey`, and
 *                              enqueue the durable `compile_and_email_report`
 *                              job; the email export path (Requirement 7.1,
 *                              7.3, 7.9, 10.7).
 *   - `get_lead_context`     — the OTP-gated personal-data read behind
 *                              record-level ask and prediction flows
 *                              (Requirement 9.5).
 *
 * The `get_pipeline_summary` and `get_lead_context` entries REFERENCE the
 * existing `registry.ts` handler and Zod schemas unchanged — no figure
 * computation and no DB access is redefined here; only the audit actor and the
 * RBAC permission string are rebound to the report identity, mirroring how
 * `lead-capabilities.ts` re-exposes `update_qualification` / `score_lead` under
 * the lead identities. The `queue_report_email` entry keeps the SAME email/PDF
 * spine (it enqueues the unchanged `compile_and_email_report` job — Requirement
 * 16.3) but adds a recipient-list validation + `jobKey` derivation at the tool
 * input boundary; it defines no new email or PDF rendering path.
 *
 * The one new tool S4 introduces (`query_leads`) lands in task 2; this file is
 * the scaffold it slots into.
 *
 * Design references: §Components #1 (the Reporting_Agent + its bound catalog),
 * §Components #9 (dispatcher boundary consumed unchanged).
 * Requirements: 1.1, 11.1, 16.4.
 */

import { z } from "zod";
import { createHash } from "node:crypto";
import { and, asc, eq, lt } from "drizzle-orm";

import { leadsMirror, partyIdentities } from "../../schema";
import {
  hasPermission,
  loadUserRoles,
  resolvePermissions,
} from "../../rbac/engine";
import { enqueueJob } from "../../jobs";
import { toolRegistry } from "./registry";
import {
  loadCatalog,
  type CatalogEntry,
  type CatalogLoadResult,
} from "./catalog";

// ── Report agent identity & permissions ──────────────────────────────────────

/**
 * The RBAC identity (and audit actor) the Reporting_Agent dispatches under
 * (Design §Components #1). Every reporting figure read, record read, and side
 * effect is audited under this single agent identity through the unchanged
 * dispatcher; it is never a user session and never a backdoor around RBAC, OTP,
 * or audit (Requirement 11.1, 16.4).
 */
export const REPORTING_AGENT_ACTOR = "agent:reporting-twin";

/** Prefix for per-tool RBAC permission strings, e.g. `report:tool:get_pipeline_summary`. */
export const REPORTING_TOOL_PERMISSION_PREFIX = "report:tool";

/**
 * The RBAC permission string a given reporting capability requires, in the
 * existing `resource:action` format the RBAC engine already understands
 * (Requirement 16.4 — no new permission scheme). Mirrors the `toolPermission` /
 * `leadToolPermission` convention so the unchanged dispatcher's RBAC check
 * resolves these the same way it resolves every other catalog permission.
 */
export function reportToolPermission(name: string): string {
  return `${REPORTING_TOOL_PERMISSION_PREFIX}:${name}`;
}

// ── entry() helper (mirrors lead-capabilities.ts) ────────────────────────────

/**
 * Keep per-entry input/output typing intact (the handler is checked against the
 * entry's Zod schemas) while collecting heterogeneous entries into one
 * `CatalogEntry[]` for {@link loadCatalog}.
 */
function entry<I, O>(e: CatalogEntry<I, O>): CatalogEntry {
  return e as unknown as CatalogEntry;
}

// ── Re-exposed S1/S2 Catalog_Entries under the report identity ────────────────
//
// These three tools are NOT redefined: each references the existing
// `registry.ts` handler and Zod schemas verbatim, rebinding only the audit
// actor and the RBAC permission to the report identity so the Reporting_Agent
// can bind them through the audited dispatcher (Requirement 1.1, 11.1, 16.4).

/**
 * `get_pipeline_summary` — the single source of analytics figures. Reads the
 * `metrics_*` SQL views verbatim for the requested Report_Scope and leaves all
 * narration to the model; performs no arithmetic in JS (Requirement 1.1, 1.2).
 */
const pipelineSummaryEntry = entry({
  name: "get_pipeline_summary",
  description:
    "Return aggregate pipeline analytics figures read verbatim from the " +
    "metrics_* SQL views for a Report_Scope ({ scope, period }). The single " +
    "source of every figure the agent narrates, charts, or exports — SQL " +
    "computes, the agent only narrates; never compute or estimate a figure.",
  inputSchema: toolRegistry.get_pipeline_summary.inputSchema,
  outputSchema: toolRegistry.get_pipeline_summary.outputSchema,
  requiresOtp: toolRegistry.get_pipeline_summary.requiresOtp,
  permission: reportToolPermission("get_pipeline_summary"),
  auditActor: REPORTING_AGENT_ACTOR,
  // Reference the existing registry handler — no logic redefined here.
  handler: toolRegistry.get_pipeline_summary.handler,
});

// ── queue_report_email — recipient-validated boundary (Design §Components #5) ─
//
// The email export path REUSES the existing spine unchanged (Requirement 16.3):
// this entry enqueues the durable `compile_and_email_report` job via the shared
// `enqueueJob`; the worker reads the same `metrics_*` views, renders the PDF
// through the injected `PdfRenderer`, and sends via Microsoft Graph. S4's only
// adaptation is at THIS tool input boundary — it validates the recipient list
// and derives the idempotency `jobKey` (Requirement 7.9, 7.3, 10.7). It defines
// NO new email/PDF path and renders/sends nothing inline (Requirement 7.1).

/** Recipient-count guardrail: 0 or >50 recipients are rejected (Requirement 7.9). */
const REPORT_RECIPIENT_MIN = 1;
const REPORT_RECIPIENT_MAX = 50;

/**
 * Report-identity input for `queue_report_email`. Unlike the voice contract's
 * single-`requesterEmail` shape, the reporting boundary accepts a validated
 * recipient list (`.min(1).max(50)`) so the agent can email a report to a team;
 * a zero or >50 recipient list fails Zod at the dispatcher and enqueues nothing
 * (Requirement 7.9).
 */
const queueReportEmailInput = z.object({
  scope: z.string(),
  period: z.string(),
  recipients: z
    .array(z.string().email())
    .min(REPORT_RECIPIENT_MIN)
    .max(REPORT_RECIPIENT_MAX),
});

/**
 * The reporting boundary returns the assigned idempotency `jobKey` (Requirement
 * 7.1), not the opaque job-row id — the agent surfaces this key to the user and
 * a retried request under the same key is a no-op.
 */
const queueReportEmailOutput = z.object({ jobKey: z.string() });

/**
 * Derive the idempotency key `report:{scope}:{period}:{sha(sorted recipients)}`
 * (Design §Components #5; Requirement 7.3, 10.7). Recipients are sorted before
 * hashing so the SAME scope + period + recipient SET maps to one `jobKey`
 * regardless of the order they were supplied — guaranteeing at most one job and
 * one sent email per logical report (CC-Idem).
 */
function deriveReportJobKey(
  scope: string,
  period: string,
  recipients: readonly string[]
): string {
  const sorted = [...recipients].sort();
  const sha = createHash("sha256").update(sorted.join("\n")).digest("hex");
  return `report:${scope}:${period}:${sha}`;
}

const queueReportEmailEntry = entry({
  name: "queue_report_email",
  description:
    "Enqueue the durable compile_and_email_report job idempotently by jobKey " +
    "for a Report_Scope ({ scope, period }) and a recipient list (1–50 email " +
    "addresses), returning the assigned jobKey. Never renders or sends the " +
    "report inline; the worker reads the same metrics_* views, renders the " +
    "PDF, and sends it via Microsoft Graph off the loop.",
  inputSchema: queueReportEmailInput,
  outputSchema: queueReportEmailOutput,
  requiresOtp: toolRegistry.queue_report_email.requiresOtp,
  permission: reportToolPermission("queue_report_email"),
  auditActor: REPORTING_AGENT_ACTOR,
  // Enqueue-only (no inline render/send — Requirement 7.1) on the SAME spine as
  // the voice path (Requirement 16.3). `enqueueJob` is idempotent by jobKey
  // (ON CONFLICT DO NOTHING), so the same scope+period+recipient set enqueues
  // exactly one job (Requirement 7.3, 10.7); the assigned jobKey is returned.
  handler: async (db, _ctx, input) => {
    const recipients = [...input.recipients].sort();
    const jobKey = deriveReportJobKey(input.scope, input.period, recipients);
    await enqueueJob(
      db,
      "compile_and_email_report",
      {
        // The unmodified job reads `requesterEmail`; carry the full recipient
        // list alongside it (the first sorted recipient as the primary mailbox)
        // without redefining the email/PDF path (Requirement 16.3).
        requesterEmail: recipients[0],
        recipients,
        scope: input.scope,
        period: input.period,
      },
      jobKey
    );
    return { jobKey };
  },
});

/**
 * `get_lead_context` — the OTP-gated personal-data read behind record-level ask
 * and prediction flows. Returns the lead's CallContext from the local mirror
 * only (never Salesforce); phones only ever leave as a salted hash. OTP/RBAC is
 * enforced by the unchanged dispatcher before any data is returned
 * (Requirement 9.5).
 */
const leadContextEntry = entry({
  name: "get_lead_context",
  description:
    "Return a single lead's qualification context (tier, stage, budget band, " +
    "last interaction, assigned rep) from the local mirror for record-grounded " +
    "answers and predictions. OTP-gated personal-data read; no raw phone is " +
    "ever returned.",
  inputSchema: toolRegistry.get_lead_context.inputSchema,
  outputSchema: toolRegistry.get_lead_context.outputSchema,
  requiresOtp: toolRegistry.get_lead_context.requiresOtp,
  permission: reportToolPermission("get_lead_context"),
  auditActor: REPORTING_AGENT_ACTOR,
  // Reference the existing registry handler — mirror-only, no Salesforce call.
  handler: toolRegistry.get_lead_context.handler,
});

// ── query_leads — the one NEW tool S4 introduces (Design §Components #2) ──────
//
// A role-scoped, bounded, oldest-first read over `leads_mirror` matching a
// structured filter (tier, stage, staleness). It is the record-level read
// behind the conversational ask/delegate flows (Requirement 1.4, 10.1). Like
// every catalog entry it still flows through the unchanged `dispatchTool`
// (Zod → RBAC → OTP → audit → execute); the handler below is the "execute" step
// only and is the ONLY place DB access happens for this read.
//
// Privacy invariant (Requirement 10.2, 12.2): a returned record carries only
// qualification facts (tier, stage, last-interaction date, assigned rep) plus
// the salted `phone_hash` — NEVER a raw phone number.

/**
 * Org-wide reporting permission string. Mirrors `EXEC_SCOPE_PERMISSION` in
 * `lib/cms/agents/reporting/scope.ts`; duplicated here as a plain constant so
 * this catalog module does not take a reverse dependency on the agents layer.
 * A requesting user holding this permission may read leads across all reps and
 * honour an explicit `filter.repId`; a user without it is a rep-level caller and
 * is clamped to its own rep id (Requirement 3.1, 3.4).
 */
const EXEC_REPORTING_PERMISSION = "report:scope:exec";

/** The hard ceiling on returned records, enforced regardless of `limit` (Req 1.4, 10.1). */
const QUERY_LEADS_HARD_LIMIT = 100;

/**
 * The structured filter the ask flow expresses (Design §Components #2). Every
 * field is optional; an empty filter reads the whole role-scoped set (still
 * bounded + oldest-first). `staleDaysOlderThan` is the staleness threshold as a
 * whole number of days, 1–365 (Requirement 10.1).
 */
const leadQueryFilter = z.object({
  tier: z.enum(["HOT", "WARM", "NURTURE"]).optional(),
  stage: z.string().optional(),
  /** Staleness threshold: whole days, 1–365 (Requirement 10.1). Coerced so a
   *  tool-calling model that emits the number as a string still validates. */
  staleDaysOlderThan: z.coerce.number().int().min(1).max(365).optional(),
  /**
   * Caller-supplied rep filter. The handler clamps it to the role's permission:
   * a rep-level role only ever reads its own `assignedRepId` rows regardless of
   * this value (Requirement 3.4); a mismatching explicit `repId` is denied
   * upstream at the dispatcher (Requirement 3.6).
   */
  repId: z.string().optional(),
});

const queryLeadsInput = z.object({
  filter: leadQueryFilter,
  /** At most 100 (Requirement 1.4, 10.1); the handler hard-caps regardless.
   *  Coerced so a model emitting the number as a string still validates. */
  limit: z.coerce.number().int().min(1).max(QUERY_LEADS_HARD_LIMIT).default(QUERY_LEADS_HARD_LIMIT),
});

/**
 * A single returned lead record. Qualification facts only, plus the salted
 * `phone_hash` — never a raw phone number (Requirement 10.2, 12.2).
 */
const leadRecord = z.object({
  partyId: z.string(),
  tier: z.string().nullable(),
  stage: z.string().nullable(),
  lastInteractionAt: z.string().nullable(),
  assignedRepId: z.string().nullable(),
  phoneHash: z.string().nullable(), // NEVER a raw phone (Requirement 12.2)
});

const queryLeadsOutput = z.object({
  leads: z.array(leadRecord),
  /** The effective hard cap applied to this read (Requirement 1.4, 10.1). */
  truncatedAt: z.number(),
});

const queryLeadsEntry = entry({
  name: "query_leads",
  description:
    "Return role-scoped leads matching a structured filter (tier, stage, " +
    "staleness in days), ordered oldest last-interaction first, at most 100 " +
    "records. Describes leads by qualification facts only (tier, stage, " +
    "last-interaction date, assigned rep) and the salted phone hash — never a " +
    "raw phone number.",
  inputSchema: queryLeadsInput,
  outputSchema: queryLeadsOutput,
  requiresOtp: true, // gated personal-data read (Requirement 9.5, CC-OTP)
  permission: reportToolPermission("query_leads"),
  auditActor: REPORTING_AGENT_ACTOR,
  // The only DB access for the record-level read. Role-clamped WHERE, ordered
  // oldest-first, hard-capped at 100; returns only qualification facts + the
  // salted phone_hash (Requirement 1.4, 3.4, 10.1, 10.2, 12.2).
  handler: async (db, ctx, input) => {
    // Hard cap regardless of the requested limit (Requirement 1.4, 10.1).
    const limit = Math.min(input.limit ?? QUERY_LEADS_HARD_LIMIT, QUERY_LEADS_HARD_LIMIT);

    // Role-clamp the rep dimension (Requirement 3.4). Resolve the requesting
    // user's reporting permissions: an org-wide (exec) role may read across reps
    // and honour an explicit `filter.repId`; a rep-level role with no org-wide
    // permission is clamped to its OWN rep id, regardless of the `repId` in the
    // filter. (Cross-rep and no-permission denials are the dispatcher's job —
    // Requirement 3.6, 16.4 — this is the scope-bound handler clamp.)
    let canReadOrgWide = false;
    if (ctx.userId) {
      const requesterRoles = await loadUserRoles(db, ctx.userId);
      const perms = await resolvePermissions(db, requesterRoles);
      canReadOrgWide = hasPermission(perms, EXEC_REPORTING_PERMISSION);
    }
    const repIdClamp = canReadOrgWide ? input.filter.repId : ctx.userId;

    // Build the role-clamped WHERE. Each present filter narrows the set; an
    // empty filter reads the whole role-scoped board (still bounded + ordered).
    const conditions = [];
    if (input.filter.tier) {
      conditions.push(eq(leadsMirror.tier, input.filter.tier));
    }
    if (input.filter.stage) {
      conditions.push(eq(leadsMirror.stage, input.filter.stage));
    }
    if (repIdClamp) {
      conditions.push(eq(leadsMirror.assignedRepId, repIdClamp));
    }
    if (input.filter.staleDaysOlderThan !== undefined) {
      // "last interaction older than N days" → last_interaction_at strictly
      // before (now − N days). A null last-interaction does not satisfy the
      // comparison, so never-interacted rows are not surfaced by a stale ask.
      const threshold = new Date(
        Date.now() - input.filter.staleDaysOlderThan * 24 * 60 * 60 * 1000
      );
      conditions.push(lt(leadsMirror.lastInteractionAt, threshold));
    }

    // Read qualification facts from the mirror, joined to the party's
    // `phone_hash` identity ONLY (never the raw phone — Requirement 12.2).
    const rows = await db
      .select({
        partyId: leadsMirror.partyId,
        tier: leadsMirror.tier,
        stage: leadsMirror.stage,
        lastInteractionAt: leadsMirror.lastInteractionAt,
        assignedRepId: leadsMirror.assignedRepId,
        phoneHash: partyIdentities.value,
      })
      .from(leadsMirror)
      .leftJoin(
        partyIdentities,
        and(
          eq(partyIdentities.partyId, leadsMirror.partyId),
          eq(partyIdentities.kind, "phone_hash")
        )
      )
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      // Oldest last-interaction first, so the most overdue lead surfaces first
      // (Requirement 10.1).
      .orderBy(asc(leadsMirror.lastInteractionAt))
      .limit(limit);

    const leads = rows.map((r) => ({
      partyId: r.partyId,
      tier: r.tier ?? null,
      stage: r.stage ?? null,
      lastInteractionAt:
        r.lastInteractionAt instanceof Date
          ? r.lastInteractionAt.toISOString()
          : (r.lastInteractionAt ?? null),
      assignedRepId: r.assignedRepId ?? null,
      phoneHash: r.phoneHash ?? null,
    }));

    return { leads, truncatedAt: limit };
  },
});

// ── The reporting catalog contributor set ─────────────────────────────────────

/**
 * The reporting Catalog_Entries contributed to the Tool_Catalog and bound to
 * the Reporting_Agent via `bindCatalog` (one Mastra tool per name, each
 * dispatching through the unchanged `dispatchTool`). Includes the one new
 * `query_leads` entry — the record-level read behind the ask/delegate flows.
 */
export const reportingCapabilityEntries: CatalogEntry[] = [
  pipelineSummaryEntry,
  queueReportEmailEntry,
  leadContextEntry,
  queryLeadsEntry,
];

/** The names of the reporting capabilities the Reporting_Agent may bind. */
export const REPORTING_TOOL_NAMES: string[] = reportingCapabilityEntries.map(
  (e) => e.name
);

/**
 * Validate and assemble just the reporting capabilities through
 * {@link loadCatalog}. Surfaces `incomplete_entry` / `duplicate_name` errors the
 * same way the full catalog load does, so this module can be self-checked in
 * isolation and the Reporting_Agent can fail fast rather than bind a partial
 * tool set (Requirement 1.1).
 */
export function loadReportingCapabilities(): CatalogLoadResult {
  return loadCatalog(reportingCapabilityEntries);
}
