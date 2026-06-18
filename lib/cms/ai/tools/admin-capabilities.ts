/**
 * Admin capability Catalog_Entries (Agentic Foundation S1, task 4.2).
 *
 * This module contributes the staff/admin agent's capabilities to the single
 * canonical Tool_Catalog (`./catalog.ts`). It exposes two kinds of entry:
 *
 *   1. Read-only **report** entries (`report_overview`, `report_projects`,
 *      `report_clients`, `report_leads`, `report_tickets`,
 *      `report_appointments`). Every figure they return is computed **in SQL**
 *      (`count(*)::int`, `GROUP BY`, windowed `WHERE`) and returned verbatim —
 *      there is ZERO arithmetic in JS or the model. The agent only narrates the
 *      SQL-computed numbers (Requirements 9.1, 9.2, 13.1, 13.2; design
 *      §Components #6/#7). Because the queries are deterministic for a given
 *      window, two reads of the same scope/period return equal figures
 *      (Requirement 13.3).
 *
 *   2. The **human-in-the-loop confirmation flow** for destructive admin
 *      actions (Requirement 9.3–9.5; `decisions.md` Decision 7):
 *        • `propose_admin_action` issues a single-use, short-TTL confirmation
 *          token bound to the requesting user and performs NO mutation in that
 *          step (Requirement 9.3);
 *        • `confirm_admin_action`, given a valid token, executes the bound
 *          destructive action through the existing audited service exactly once
 *          and then invalidates the token (Requirement 9.4); an expired,
 *          already-consumed, or wrong-user token is refused with a re-issue
 *          prompt and performs no action (Requirement 9.5).
 *
 * The reports reuse the same SQL the deterministic admin agent already runs
 * (`lib/cms/ai/admin-agent.ts`), and the confirmation flow reuses that agent's
 * existing audited executors rather than reimplementing any business rule
 * (Requirement 9.2; design "reuse, don't reinvent").
 *
 * ── Seam for task 4.4 ────────────────────────────────────────────────────────
 * The durable, `admin_confirmations`-backed token store is task 4.4. This
 * module defines the token store behind a small {@link AdminConfirmationStore}
 * interface and ships an in-memory default ({@link InMemoryAdminConfirmationStore})
 * so the propose/confirm entries are complete and testable now. Task 4.4 swaps
 * in the durable store via {@link setAdminConfirmationStore} WITHOUT touching
 * the catalog entries. The bound-action executor is likewise injectable via
 * {@link setConfirmedAdminActionExecutor} so the wiring task (5.4) can route it
 * however it needs.
 *
 * Design references: §Components #6 (Migrated admin capabilities + HITL),
 * §Components #7 (Figures from SQL), §Data Models (admin_confirmations).
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 13.1, 13.2.
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, desc, eq, gt, gte, isNull, lte, sql } from "drizzle-orm";
import type { Database } from "../../db";
import {
  adminConfirmations,
  aiAppointments,
  aiClients,
  projects,
  tickets,
} from "../../schema";
import { loadCatalog, type CatalogEntry, type CatalogLoadResult } from "./catalog";
import {
  type AdminAgentResult,
  type PendingActionKind,
  executeBulkCancelBookings,
  executeBulkCloseTickets,
  executeBulkCloseTicketsByIds,
  executeBulkCloseTicketsByStatus,
  executeBulkCompleteBookings,
  executeCancelAppointmentAction,
  executeChangeTicketStatusAction,
  executeCompleteAppointmentAction,
  executeRescheduleAppointmentAction,
} from "../admin-agent";

/**
 * Declare a {@link CatalogEntry} while keeping the handler's `input` strongly
 * typed from its Zod `inputSchema`. The result is widened to the catalog's
 * `unknown`-input entry shape so every entry can live in one `CatalogEntry[]`
 * (the dispatcher re-validates input against `inputSchema` before calling the
 * handler, so the widening is sound).
 */
function defineCatalogEntry<I, O>(entry: CatalogEntry<I, O>): CatalogEntry {
  return entry as unknown as CatalogEntry;
}

// ── Agent identity & permissions ─────────────────────────────────────────────

/**
 * The system-actor recorded on every admin tool audit entry. The admin path is
 * permission-checked under this single agent identity (Design §Components #2 —
 * "ToolContext.actor is the agent's RBAC identity, e.g. `agent:admin`").
 */
export const ADMIN_AGENT_ACTOR = "agent:admin";

/** Prefix for per-tool admin RBAC permission strings, e.g. `admin:tool:report_overview`. */
export const ADMIN_TOOL_PERMISSION_PREFIX = "admin:tool";

/** The RBAC permission string a given admin tool requires. */
export function adminToolPermission(name: string): string {
  return `${ADMIN_TOOL_PERMISSION_PREFIX}:${name}`;
}

// ── Destructive action kinds (decisions.md Decision 7) ───────────────────────

/**
 * The destructive / external-facing admin actions that REQUIRE the
 * Admin_Confirmation_Flow before they execute (`decisions.md` Decision 7).
 * These reuse the deterministic admin agent's {@link PendingActionKind} union
 * exactly, so the bound-action executor maps 1:1 onto its existing audited
 * executors.
 */
export const ADMIN_DESTRUCTIVE_KINDS = [
  "change_ticket_status",
  "cancel_appointment",
  "reschedule_appointment",
  "complete_appointment",
  "bulk_complete_bookings",
  "bulk_cancel_bookings",
  "bulk_close_tickets",
  "bulk_close_tickets_by_ids",
  "bulk_close_tickets_by_status",
] as const satisfies readonly PendingActionKind[];

export type AdminDestructiveKind = (typeof ADMIN_DESTRUCTIVE_KINDS)[number];

const adminDestructiveKindSchema = z.enum(ADMIN_DESTRUCTIVE_KINDS);

/** True when `kind` is a destructive admin action gated by the confirmation flow. */
export function isAdminDestructiveKind(kind: string): kind is AdminDestructiveKind {
  return (ADMIN_DESTRUCTIVE_KINDS as readonly string[]).includes(kind);
}

// ── Confirmation-token store (seam for task 4.4) ─────────────────────────────

/** Single-use, short-TTL confirmation token bound to the requesting user. */
export const ADMIN_CONFIRMATION_TTL_MS = 5 * 60_000;

/** The standard re-issue prompt returned when a token cannot be honoured (Req 9.5). */
export const ADMIN_REISSUE_PROMPT =
  "That confirmation has expired, was already used, or wasn't issued to you — please re-run the request to get a fresh confirmation.";

/** A persisted confirmation token record. */
export interface AdminConfirmationRecord {
  token: string;
  /** The user the token is bound to (Req 9.3). */
  userId: string;
  /** The destructive action this token authorises. */
  kind: AdminDestructiveKind;
  /** The bound action's arguments, replayed verbatim on confirm. */
  args: Record<string, unknown>;
  /** Future expiry — short TTL (Req 9.3). */
  expiresAt: Date;
  /** Set the moment the token is consumed; non-null means single-use spent (Req 9.4). */
  consumedAt: Date | null;
}

/** Why a token could not be consumed — each maps to a re-issue refusal (Req 9.5). */
export type AdminConfirmationRejectReason =
  | "not_found"
  | "wrong_user"
  | "expired"
  | "already_consumed";

export type AdminConfirmationConsumeResult =
  | { ok: true; record: AdminConfirmationRecord }
  | { ok: false; reason: AdminConfirmationRejectReason };

/**
 * The confirmation-token store contract. The in-memory default below makes the
 * propose/confirm entries complete today; task 4.4 supplies a durable
 * `admin_confirmations`-backed implementation via {@link setAdminConfirmationStore}
 * without changing the catalog entries.
 *
 * Both methods receive `db` so the durable implementation can persist/read
 * tokens; the in-memory default simply ignores it.
 */
export interface AdminConfirmationStore {
  /**
   * Issue a single-use token bound to `userId` for `kind`/`args`, expiring
   * `ttlMs` from now. Performs no mutation of business state (Req 9.3).
   */
  issue(
    db: Database,
    userId: string,
    kind: AdminDestructiveKind,
    args: Record<string, unknown>,
    ttlMs: number
  ): Promise<AdminConfirmationRecord>;
  /**
   * Atomically validate and consume a token for `userId`. Returns the record on
   * success (and marks it consumed so it can never be replayed — Req 9.4), or a
   * structured rejection reason for an unknown / wrong-user / expired / already
   * consumed token (Req 9.5). Implementations MUST NOT consume a token they
   * reject.
   */
  consume(
    db: Database,
    token: string,
    userId: string
  ): Promise<AdminConfirmationConsumeResult>;
}

/**
 * Default, in-memory confirmation-token store. Single-process and non-durable —
 * intended only as the seam default until task 4.4 replaces it with the durable
 * `admin_confirmations`-backed store. The single-use + expiry + user-binding
 * semantics it implements are exactly what the durable store must preserve.
 */
export class InMemoryAdminConfirmationStore implements AdminConfirmationStore {
  private readonly tokens = new Map<string, AdminConfirmationRecord>();

  private pruneExpired(now: number): void {
    for (const [token, rec] of this.tokens) {
      if (rec.expiresAt.getTime() < now) this.tokens.delete(token);
    }
  }

  async issue(
    _db: Database,
    userId: string,
    kind: AdminDestructiveKind,
    args: Record<string, unknown>,
    ttlMs: number
  ): Promise<AdminConfirmationRecord> {
    const now = Date.now();
    this.pruneExpired(now);
    const record: AdminConfirmationRecord = {
      token: randomUUID(),
      userId,
      kind,
      args,
      expiresAt: new Date(now + ttlMs),
      consumedAt: null,
    };
    this.tokens.set(record.token, record);
    return record;
  }

  async consume(
    _db: Database,
    token: string,
    userId: string
  ): Promise<AdminConfirmationConsumeResult> {
    const rec = this.tokens.get(token);
    if (!rec) return { ok: false, reason: "not_found" };
    if (rec.userId !== userId) return { ok: false, reason: "wrong_user" };
    if (rec.consumedAt) return { ok: false, reason: "already_consumed" };
    if (rec.expiresAt.getTime() < Date.now()) {
      return { ok: false, reason: "expired" };
    }
    // Single-use: stamp consumed and drop it so it can never be replayed.
    rec.consumedAt = new Date();
    this.tokens.delete(token);
    return { ok: true, record: { ...rec } };
  }

  /** Test-only: clear all issued tokens. */
  _resetForTests(): void {
    this.tokens.clear();
  }
}

let adminConfirmationStore: AdminConfirmationStore =
  new InMemoryAdminConfirmationStore();

/** The active confirmation-token store. */
export function getAdminConfirmationStore(): AdminConfirmationStore {
  return adminConfirmationStore;
}

/**
 * Replace the active confirmation-token store. Task 4.4 calls this with the
 * durable `admin_confirmations`-backed store; tests use it to inject fakes.
 */
export function setAdminConfirmationStore(store: AdminConfirmationStore): void {
  adminConfirmationStore = store;
}

/** Test-only: restore the default in-memory store. */
export function _resetAdminConfirmationStoreForTests(): void {
  adminConfirmationStore = new InMemoryAdminConfirmationStore();
}

// ── Durable confirmation-token store (task 4.4) ──────────────────────────────

/**
 * Matches a canonical RFC-4122 UUID. The `token` column is a Postgres `uuid`
 * primary key, so a non-UUID token can never name an existing row — we treat it
 * as `not_found` rather than letting Postgres raise on an invalid uuid literal.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Map a raw `admin_confirmations` row to the store's {@link AdminConfirmationRecord}.
 * `kind` is stored as free text; it is always one of {@link ADMIN_DESTRUCTIVE_KINDS}
 * because that is the only thing {@link DurableAdminConfirmationStore.issue}
 * writes, so the cast is sound.
 */
function toAdminConfirmationRecord(row: {
  token: string;
  userId: string;
  kind: string;
  args: unknown;
  expiresAt: Date;
  consumedAt: Date | null;
}): AdminConfirmationRecord {
  return {
    token: row.token,
    userId: row.userId,
    kind: row.kind as AdminDestructiveKind,
    args: (row.args ?? {}) as Record<string, unknown>,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
  };
}

/**
 * Durable confirmation-token store backed by the `admin_confirmations` table.
 *
 * This is the production implementation of {@link AdminConfirmationStore}: it
 * persists user-bound, short-TTL, single-use tokens so the
 * Admin_Confirmation_Flow survives across requests and serverless invocations
 * (Req 9.3–9.5). It preserves the exact semantics of the in-memory default:
 *
 *   • {@link issue} writes a token row bound to `userId` with a future
 *     `expiresAt` and a null `consumedAt`, mutating no business state (Req 9.3).
 *   • {@link consume} validates and consumes atomically via a single conditional
 *     `UPDATE … WHERE consumed_at IS NULL AND expires_at > now AND user_id = $u
 *     RETURNING`. Postgres evaluates the predicate and stamps `consumed_at` in
 *     one statement, so two racing confirms can never both succeed — the token
 *     authorises **exactly one** audited execution and can never be replayed
 *     (Req 9.4). A token the predicate rejects is left untouched; a follow-up
 *     read classifies the refusal as `not_found` / `wrong_user` / `expired` /
 *     `already_consumed` for the re-issue prompt (Req 9.5).
 */
export class DurableAdminConfirmationStore implements AdminConfirmationStore {
  async issue(
    db: Database,
    userId: string,
    kind: AdminDestructiveKind,
    args: Record<string, unknown>,
    ttlMs: number
  ): Promise<AdminConfirmationRecord> {
    const expiresAt = new Date(Date.now() + ttlMs);
    const [row] = await db
      .insert(adminConfirmations)
      .values({
        userId,
        kind,
        args,
        expiresAt,
        consumedAt: null,
      })
      .returning();
    return toAdminConfirmationRecord(row);
  }

  async consume(
    db: Database,
    token: string,
    userId: string
  ): Promise<AdminConfirmationConsumeResult> {
    // A non-UUID token can never match the uuid PK; classify without querying
    // (and avoid Postgres raising on an invalid uuid literal).
    if (!UUID_RE.test(token)) {
      return { ok: false, reason: "not_found" };
    }

    const now = new Date();

    // Atomic single-use consume: stamp consumed_at iff the token is currently
    // unconsumed, unexpired, AND bound to this user. Postgres evaluates the
    // predicate and the write in one statement, so the token can be spent at
    // most once even under concurrent confirms (Req 9.4).
    const [consumed] = await db
      .update(adminConfirmations)
      .set({ consumedAt: now })
      .where(
        and(
          eq(adminConfirmations.token, token),
          eq(adminConfirmations.userId, userId),
          isNull(adminConfirmations.consumedAt),
          gt(adminConfirmations.expiresAt, now)
        )
      )
      .returning();

    if (consumed) {
      return { ok: true, record: toAdminConfirmationRecord(consumed) };
    }

    // The conditional update matched nothing — read the row (if any) to explain
    // why, WITHOUT consuming it (Req 9.5). The order matters: a token can be
    // both wrong-user and expired; we report the binding mismatch first so a
    // token presented by the wrong user is never leaked as "expired".
    const [existing] = await db
      .select()
      .from(adminConfirmations)
      .where(eq(adminConfirmations.token, token))
      .limit(1);

    if (!existing) return { ok: false, reason: "not_found" };
    if (existing.userId !== userId) return { ok: false, reason: "wrong_user" };
    if (existing.consumedAt) return { ok: false, reason: "already_consumed" };
    return { ok: false, reason: "expired" };
  }
}

/**
 * Create the durable, `admin_confirmations`-backed confirmation-token store.
 *
 * The wiring task (5.4) installs it as the active store via
 * {@link setAdminConfirmationStore}; the catalog entries are untouched because
 * they resolve the store lazily through {@link getAdminConfirmationStore}.
 */
export function createDurableAdminConfirmationStore(): AdminConfirmationStore {
  return new DurableAdminConfirmationStore();
}

// ── Bound-action executor (seam) ─────────────────────────────────────────────

/**
 * Executes a confirmed destructive action through the existing audited service.
 * `confirm_admin_action` calls this exactly once, AFTER the single-use token
 * has been consumed, so the bound action runs at most once per token (Req 9.4).
 */
export type ConfirmedAdminActionExecutor = (
  db: Database,
  userId: string,
  kind: AdminDestructiveKind,
  args: Record<string, unknown>
) => Promise<AdminAgentResult>;

/**
 * Default executor: dispatch the bound `kind` to the deterministic admin
 * agent's existing audited executor (each reuses the platform service layer and
 * writes its own audit). No business rule is reimplemented here (Req 9.2/9.4).
 */
export const defaultConfirmedAdminActionExecutor: ConfirmedAdminActionExecutor =
  async (db, userId, kind, args) => {
    switch (kind) {
      case "bulk_complete_bookings":
        return executeBulkCompleteBookings(db, userId, args);
      case "bulk_cancel_bookings":
        return executeBulkCancelBookings(db, userId, args);
      case "bulk_close_tickets":
        return executeBulkCloseTickets(db, userId, args);
      case "bulk_close_tickets_by_ids":
        return executeBulkCloseTicketsByIds(db, userId, args);
      case "bulk_close_tickets_by_status":
        return executeBulkCloseTicketsByStatus(db, userId, args);
      case "complete_appointment":
        return executeCompleteAppointmentAction(db, userId, args);
      case "cancel_appointment":
        return executeCancelAppointmentAction(db, userId, args);
      case "reschedule_appointment":
        return executeRescheduleAppointmentAction(db, userId, args);
      case "change_ticket_status":
        return executeChangeTicketStatusAction(db, userId, args);
    }
  };

let confirmedAdminActionExecutor: ConfirmedAdminActionExecutor =
  defaultConfirmedAdminActionExecutor;

/** Replace the bound-action executor (used by the wiring task 5.4 and tests). */
export function setConfirmedAdminActionExecutor(
  executor: ConfirmedAdminActionExecutor
): void {
  confirmedAdminActionExecutor = executor;
}

/** Test-only: restore the default bound-action executor. */
export function _resetConfirmedAdminActionExecutorForTests(): void {
  confirmedAdminActionExecutor = defaultConfirmedAdminActionExecutor;
}

// ── Shared report schemas ────────────────────────────────────────────────────

/** A single SQL-computed status/count pair, returned verbatim from `GROUP BY`. */
const statusCountSchema = z.object({
  status: z.string(),
  count: z.number().int(),
});

/** Optional date window applied IN SQL (`WHERE scheduled_date / created_at`). */
const windowInputSchema = z.object({
  /** Inclusive lower bound, `YYYY-MM-DD`. */
  startDate: z.string().optional(),
  /** Inclusive upper bound, `YYYY-MM-DD`. */
  endDate: z.string().optional(),
});

type WindowInput = z.infer<typeof windowInputSchema>;

const emptyInputSchema = z.object({});

// ── Report figure queries (every figure computed in SQL) ─────────────────────

/**
 * Lead count sourced from the `metrics_leads` SQL view over `leads_mirror`
 * (Salesforce Lead Core S2, task 7.1; design §6.4). Lead figures come from SQL
 * over the canonical Lead world (`parties` + `leads_mirror`), NOT the retired
 * `tickets.request_type = 'lead_inquiry'` shim, and are never computed in a
 * model or in application code beyond summing the view's `lead_count` rows
 * (Req 9.1, 9.2, 13.8, 13.9). An optional inclusive day window is applied in
 * SQL against the view's `day` column.
 *
 * On a query failure (or `metrics_leads`/`leads_mirror` being unavailable) the
 * error is surfaced to the caller; the path never substitutes a figure computed
 * outside the view (Req 9.4).
 */
async function queryLeadCount(
  db: Database,
  window?: WindowInput
): Promise<number> {
  const conds: ReturnType<typeof sql>[] = [];
  if (window?.startDate) conds.push(sql`day >= ${window.startDate}`);
  if (window?.endDate) conds.push(sql`day <= ${window.endDate}`);
  const whereClause = conds.length
    ? sql` WHERE ${sql.join(conds, sql` AND `)}`
    : sql``;
  try {
    const result = (await db.execute(
      sql`SELECT COALESCE(SUM(lead_count), 0)::int AS leads FROM metrics_leads${whereClause}`
    )) as { rows: Array<{ leads: number | string }> };
    return Number(result.rows[0]?.leads ?? 0);
  } catch (err) {
    // Req 9.4 — surface the failure; never fall back to a ticket/model figure.
    throw new Error(
      `metrics_leads lead-count query failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

/**
 * Snapshot counts for the overview report. Each figure is a `count(*)::int`
 * evaluated by Postgres; this function performs no arithmetic itself.
 */
async function queryOverview(db: Database) {
  const [
    [{ projectsCount }],
    [{ clientsCount }],
    leadsCount,
    [{ openTicketsCount }],
    [{ activeAppointmentsCount }],
  ] = await Promise.all([
    db.select({ projectsCount: sql<number>`count(*)::int` }).from(projects),
    db.select({ clientsCount: sql<number>`count(*)::int` }).from(aiClients),
    queryLeadCount(db),
    db
      .select({ openTicketsCount: sql<number>`count(*)::int` })
      .from(tickets)
      .where(sql`${tickets.status} IN ('open', 'assigned', 'in_progress')`),
    db
      .select({ activeAppointmentsCount: sql<number>`count(*)::int` })
      .from(aiAppointments)
      .where(sql`${aiAppointments.status} IN ('confirmed', 'rescheduled')`),
  ]);

  return {
    projects: projectsCount,
    clients: clientsCount,
    leads: leadsCount,
    openTickets: openTicketsCount,
    activeAppointments: activeAppointmentsCount,
  };
}

// ── Report Catalog_Entries ───────────────────────────────────────────────────

const reportOverviewEntry: CatalogEntry = {
  name: "report_overview",
  description:
    "Read-only platform snapshot for staff: counts of projects, CRM clients, " +
    "leads, open/in-progress tickets, and active appointments. " +
    "All figures are computed in SQL; the agent only narrates them.",
  inputSchema: emptyInputSchema,
  outputSchema: z.object({
    projects: z.number().int(),
    clients: z.number().int(),
    leads: z.number().int(),
    openTickets: z.number().int(),
    activeAppointments: z.number().int(),
  }),
  requiresOtp: false,
  permission: adminToolPermission("report_overview"),
  auditActor: ADMIN_AGENT_ACTOR,
  handler: async (db) => queryOverview(db),
};

const reportProjectsEntry: CatalogEntry = {
  name: "report_projects",
  description:
    "Read-only project report for staff: total project count and a per-status " +
    "breakdown, computed in SQL. The agent narrates the figures.",
  inputSchema: emptyInputSchema,
  outputSchema: z.object({
    total: z.number().int(),
    byStatus: z.array(statusCountSchema),
  }),
  requiresOtp: false,
  permission: adminToolPermission("report_projects"),
  auditActor: ADMIN_AGENT_ACTOR,
  handler: async (db) => {
    const [[{ total }], byStatus] = await Promise.all([
      db.select({ total: sql<number>`count(*)::int` }).from(projects),
      db
        .select({
          status: projects.status,
          count: sql<number>`count(*)::int`,
        })
        .from(projects)
        .groupBy(projects.status)
        .orderBy(desc(sql`count(*)`)),
    ]);
    return { total, byStatus };
  },
};

const reportClientsEntry: CatalogEntry = {
  name: "report_clients",
  description:
    "Read-only count of clients in the AI CRM, computed in SQL. The agent " +
    "narrates the figure.",
  inputSchema: emptyInputSchema,
  outputSchema: z.object({ clients: z.number().int() }),
  requiresOtp: false,
  permission: adminToolPermission("report_clients"),
  auditActor: ADMIN_AGENT_ACTOR,
  handler: async (db) => {
    const [{ clients }] = await db
      .select({ clients: sql<number>`count(*)::int` })
      .from(aiClients);
    return { clients };
  },
};

const reportLeadsEntry = defineCatalogEntry({
  name: "report_leads",
  description:
    "Read-only count of leads, optionally within a date window (YYYY-MM-DD " +
    "start/end). Sourced in SQL from the metrics_leads view over leads_mirror; " +
    "the agent narrates the figure.",
  inputSchema: windowInputSchema,
  outputSchema: z.object({ leads: z.number().int() }),
  requiresOtp: false,
  permission: adminToolPermission("report_leads"),
  auditActor: ADMIN_AGENT_ACTOR,
  handler: async (db, _ctx, input) => {
    const leads = await queryLeadCount(db, input);
    return { leads };
  },
});

const reportTicketsEntry: CatalogEntry = {
  name: "report_tickets",
  description:
    "Read-only ticket report for staff: total ticket count and a per-status " +
    "breakdown, computed in SQL. The agent narrates the figures.",
  inputSchema: emptyInputSchema,
  outputSchema: z.object({
    total: z.number().int(),
    byStatus: z.array(statusCountSchema),
  }),
  requiresOtp: false,
  permission: adminToolPermission("report_tickets"),
  auditActor: ADMIN_AGENT_ACTOR,
  handler: async (db) => {
    const [[{ total }], byStatus] = await Promise.all([
      db.select({ total: sql<number>`count(*)::int` }).from(tickets),
      db
        .select({
          status: tickets.status,
          count: sql<number>`count(*)::int`,
        })
        .from(tickets)
        .groupBy(tickets.status)
        .orderBy(desc(sql`count(*)`)),
    ]);
    return { total, byStatus };
  },
};

const reportAppointmentsEntry = defineCatalogEntry({
  name: "report_appointments",
  description:
    "Read-only appointment report for staff: total appointment count and a " +
    "per-status breakdown, optionally within a date window (YYYY-MM-DD " +
    "start/end). Computed in SQL; the agent narrates the figures.",
  inputSchema: windowInputSchema,
  outputSchema: z.object({
    total: z.number().int(),
    byStatus: z.array(statusCountSchema),
  }),
  requiresOtp: false,
  permission: adminToolPermission("report_appointments"),
  auditActor: ADMIN_AGENT_ACTOR,
  handler: async (db, _ctx, input) => {
    const conds = [] as ReturnType<typeof gte>[];
    if (input.startDate) {
      conds.push(gte(aiAppointments.scheduledDate, input.startDate));
    }
    if (input.endDate) {
      conds.push(lte(aiAppointments.scheduledDate, input.endDate));
    }
    const where = conds.length ? and(...conds) : undefined;
    const [[{ total }], byStatus] = await Promise.all([
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(aiAppointments)
        .where(where),
      db
        .select({
          status: aiAppointments.status,
          count: sql<number>`count(*)::int`,
        })
        .from(aiAppointments)
        .where(where)
        .groupBy(aiAppointments.status)
        .orderBy(desc(sql`count(*)`)),
    ]);
    return { total, byStatus };
  },
});

// ── Admin_Confirmation_Flow Catalog_Entries (Req 9.3–9.5) ────────────────────

const proposeAdminActionEntry = defineCatalogEntry({
  name: "propose_admin_action",
  description:
    "Propose a destructive admin action (e.g. change_ticket_status, " +
    "cancel_appointment, bulk_close_tickets). Returns a single-use, short-TTL " +
    "confirmation token bound to the requesting user. Performs NO mutation — " +
    "the operator must confirm via confirm_admin_action before anything runs.",
  inputSchema: z.object({
    /** The destructive action to propose (decisions.md Decision 7). */
    kind: adminDestructiveKindSchema,
    /** Arguments for the bound action, replayed verbatim on confirm. */
    args: z.record(z.string(), z.unknown()).default({}),
    /** Human-readable summary the UI renders on the confirmation card. */
    summary: z.string().optional(),
    /** Approximate count of affected rows, for the confirmation UI. */
    affectedCount: z.number().int().nonnegative().optional(),
  }),
  outputSchema: z.object({
    token: z.string(),
    kind: adminDestructiveKindSchema,
    summary: z.string(),
    affectedCount: z.number().int().nonnegative(),
    /** ISO-8601 future expiry (Req 9.3). */
    expiresAt: z.string(),
    requiresConfirmation: z.literal(true),
  }),
  requiresOtp: false,
  permission: adminToolPermission("propose_admin_action"),
  auditActor: ADMIN_AGENT_ACTOR,
  handler: async (db, ctx, input) => {
    const userId = ctx.userId;
    if (!userId) {
      // The token MUST be bound to a known user (Req 9.3). A handler-thrown
      // error is surfaced to the agent as a structured dispatch error.
      throw new Error(
        "propose_admin_action requires an authenticated user in context"
      );
    }
    const record = await getAdminConfirmationStore().issue(
      db,
      userId,
      input.kind,
      input.args,
      ADMIN_CONFIRMATION_TTL_MS
    );
    return {
      token: record.token,
      kind: input.kind,
      summary: input.summary ?? `Confirm ${input.kind}`,
      affectedCount: input.affectedCount ?? 0,
      expiresAt: record.expiresAt.toISOString(),
      requiresConfirmation: true as const,
    };
  },
});

const confirmAdminActionEntry = defineCatalogEntry({
  name: "confirm_admin_action",
  description:
    "Confirm and execute a previously proposed destructive admin action using " +
    "its confirmation token. Executes the bound action exactly once through the " +
    "existing audited service, then invalidates the token. An expired, " +
    "already-used, or wrong-user token is refused with a re-issue prompt and " +
    "performs no action.",
  inputSchema: z.object({
    /** The single-use token returned by propose_admin_action. */
    token: z.string().min(1),
  }),
  outputSchema: z.object({
    /** True when the bound action executed; false when the token was refused. */
    executed: z.boolean(),
    kind: adminDestructiveKindSchema.optional(),
    /** Set when refused: why the token could not be honoured (Req 9.5). */
    reason: z
      .enum(["not_found", "wrong_user", "expired", "already_consumed"])
      .optional(),
    /** Operator-facing message — the re-issue prompt on refusal (Req 9.5). */
    message: z.string(),
    /** Count of rows affected by the executed action. */
    affected: z.number().int().nonnegative().optional(),
    detail: z.record(z.string(), z.unknown()).optional(),
  }),
  requiresOtp: false,
  permission: adminToolPermission("confirm_admin_action"),
  auditActor: ADMIN_AGENT_ACTOR,
  handler: async (db, ctx, input) => {
    const userId = ctx.userId;
    if (!userId) {
      throw new Error(
        "confirm_admin_action requires an authenticated user in context"
      );
    }

    // Atomically validate + consume the token. A rejected token is NOT consumed
    // and yields a re-issue prompt with no mutation (Req 9.5).
    const consumed = await getAdminConfirmationStore().consume(
      db,
      input.token,
      userId
    );
    if (!consumed.ok) {
      return {
        executed: false,
        reason: consumed.reason,
        message: ADMIN_REISSUE_PROMPT,
      };
    }

    // Token consumed (single-use, Req 9.4): execute the bound action exactly
    // once through the existing audited service.
    const { kind, args } = consumed.record;
    const result = await confirmedAdminActionExecutor(db, userId, kind, args);
    return {
      executed: true,
      kind,
      message: result.response,
      affected: result.executed?.affected,
      detail: result.executed?.detail,
    };
  },
});

// ── Public assembly ──────────────────────────────────────────────────────────

/** The admin read-only report Catalog_Entries (Req 9.1, 13.1, 13.2). */
export const adminReportCapabilities: readonly CatalogEntry[] = [
  reportOverviewEntry,
  reportProjectsEntry,
  reportClientsEntry,
  reportLeadsEntry,
  reportTicketsEntry,
  reportAppointmentsEntry,
];

/** The Admin_Confirmation_Flow Catalog_Entries (Req 9.3–9.5). */
export const adminConfirmationCapabilities: readonly CatalogEntry[] = [
  proposeAdminActionEntry,
  confirmAdminActionEntry,
];

/**
 * Every admin capability Catalog_Entry contributed to the canonical
 * Tool_Catalog: the six read-only reports plus the propose/confirm
 * human-in-the-loop pair (Req 9.1–9.5, 13.1, 13.2).
 */
export const adminCapabilities: readonly CatalogEntry[] = [
  ...adminReportCapabilities,
  ...adminConfirmationCapabilities,
];

/**
 * The names of the admin capabilities exposed by this module: the six read-only
 * reports plus `propose_admin_action` / `confirm_admin_action` (Req 9.1, 9.3–9.5).
 * Consumed by the migrated admin Agent's {@link bindCatalog} call (task 5.4) to
 * generate one Mastra tool per name, each dispatching through `dispatchTool`.
 */
export const ADMIN_CAPABILITY_NAMES: readonly string[] = adminCapabilities.map(
  (e) => e.name
);

/**
 * Validate and assemble just the admin capabilities through {@link loadCatalog}
 * (Req 9.1). Surfaces `incomplete_entry` / `duplicate_name` errors the same way
 * the full catalog load does, so this module can be self-checked in isolation
 * and the admin Agent can fail fast rather than bind a partial tool set.
 */
export function loadAdminCapabilities(): CatalogLoadResult {
  return loadCatalog([...adminCapabilities]);
}
