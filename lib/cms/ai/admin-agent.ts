/**
 * Admin / staff-facing AI assistant for the ORA panel.
 *
 * This is intentionally a SEPARATE orchestrator from the visitor-facing
 * `agent.ts`. The visitor agent is conservative (OTP-gated, anti-hallucination,
 * never speaks beyond confirmed scope). This admin agent assumes the caller
 * is already authenticated as a staff member and is here to *operate* the
 * platform via natural language: pull reports, change ticket status, cancel
 * or reschedule appointments, bulk-mark bookings as completed, etc.
 *
 * Design choices:
 *  • Deterministic, rule-based intent detection (regex / keywords). No LLM
 *    call in v1 — staff want predictable answers, not paraphrased SQL.
 *  • Reports return real numbers from the database in a single round-trip.
 *  • Destructive operations return a `pendingAction` object instead of
 *    executing immediately. The UI renders a confirmation card; on confirm
 *    the client posts the opaque `confirmationToken` back and the action
 *    runs server-side. Tokens are server-issued, single-use, 5-min TTL,
 *    bound to the requesting user.
 *  • Every executed action goes through the existing service layer so
 *    audit logging / lifecycle validation is honoured.
 */
import { randomUUID } from "node:crypto";
import { eq, and, gte, lte, sql, desc, inArray } from "drizzle-orm";
import type { Database } from "../db";
import {
  tickets,
  aiAppointments,
  aiClients,
  aiConversations,
  projects,
  communities,
} from "../schema";
import type { TicketStatus } from "../types";
import { transitionTicketStatus } from "../tickets/lifecycle";
import { logAudit } from "../audit";

// ── Types ────────────────────────────────────────────────────────────────────

export type AdminMessageRole = "user" | "assistant";

export interface AdminMessage {
  role: AdminMessageRole;
  content: string;
  /** Pending action attached to an assistant message (rendered as a card). */
  pendingAction?: PendingActionPayload | null;
}

export interface AdminAgentInput {
  userId: string;
  message: string;
  /** Optional confirmation token — when present, executes the bound action. */
  confirmationToken?: string;
}

export interface PendingActionPayload {
  /** Opaque token the UI echoes back to confirm. */
  token: string;
  /** Short human-readable summary of what will happen. */
  summary: string;
  /** Approximate count of affected rows (for the confirmation UI). */
  affectedCount: number;
  /** Discriminator for the UI to decide labels / icons. */
  kind: PendingActionKind;
  /** Soft preview lines the UI may render under the summary. */
  preview?: string[];
}

export type PendingActionKind =
  | "bulk_complete_bookings"
  | "bulk_cancel_bookings"
  | "bulk_close_tickets"
  | "cancel_appointment"
  | "reschedule_appointment"
  | "change_ticket_status";

export interface AdminAgentResult {
  /** The assistant's reply (always present). */
  response: string;
  /** When the agent needs human approval before doing anything destructive. */
  pendingAction?: PendingActionPayload;
  /** When an action was executed in this turn, a structured success payload. */
  executed?: {
    kind: PendingActionKind;
    affected: number;
    detail?: Record<string, unknown>;
  };
  metadata?: Record<string, unknown>;
}

// ── Pending-action store (in-memory, single-process) ─────────────────────────

interface PendingActionRecord {
  userId: string;
  kind: PendingActionKind;
  args: Record<string, unknown>;
  expiresAt: number;
}

const PENDING_TTL_MS = 5 * 60_000;
const pendingActions = new Map<string, PendingActionRecord>();

function pruneExpired(): void {
  const now = Date.now();
  for (const [token, rec] of pendingActions) {
    if (rec.expiresAt < now) pendingActions.delete(token);
  }
}

function issuePendingToken(
  userId: string,
  kind: PendingActionKind,
  args: Record<string, unknown>
): string {
  pruneExpired();
  const token = randomUUID();
  pendingActions.set(token, {
    userId,
    kind,
    args,
    expiresAt: Date.now() + PENDING_TTL_MS,
  });
  return token;
}

function consumePendingToken(
  token: string,
  userId: string
): PendingActionRecord | null {
  pruneExpired();
  const rec = pendingActions.get(token);
  if (!rec) return null;
  if (rec.userId !== userId) return null;
  if (rec.expiresAt < Date.now()) {
    pendingActions.delete(token);
    return null;
  }
  pendingActions.delete(token); // single-use
  return rec;
}

/** Test-only helper to clear pending state between unit tests. */
export function _resetPendingActionsForTests(): void {
  pendingActions.clear();
}

// ── Intent detection ─────────────────────────────────────────────────────────

export type AdminIntent =
  | "report_overview"
  | "report_projects"
  | "report_clients"
  | "report_leads"
  | "report_tickets"
  | "report_appointments"
  | "list_open_tickets"
  | "list_recent_leads"
  | "list_recent_appointments"
  | "bulk_complete_bookings"
  | "bulk_cancel_bookings"
  | "bulk_close_tickets"
  | "cancel_appointment"
  | "reschedule_appointment"
  | "change_ticket_status"
  | "help"
  | "unknown";

function lower(s: string): string {
  return s.toLowerCase().trim();
}

function any(s: string, words: string[]): boolean {
  const l = lower(s);
  return words.some((w) => l.includes(w));
}

const APT_REF_RE = /\bORA-APT-[A-Z0-9]{6}\b/i;
const TICKET_REF_RE = /\bORA-\d{6}\b/i;

export function detectAdminIntent(message: string): AdminIntent {
  const l = lower(message);

  if (any(l, ["help", "what can you do", "commands", "menu"])) return "help";

  // Bulk operations are matched first (they contain "bookings"/"tickets" + a
  // verb that would otherwise trip a report intent).
  if (
    any(l, ["mark all", "mark every", "complete all", "complete every"]) &&
    any(l, ["booking", "appointment", "visit"])
  ) {
    return "bulk_complete_bookings";
  }
  if (
    any(l, ["cancel all", "cancel every"]) &&
    any(l, ["booking", "appointment", "visit"])
  ) {
    return "bulk_cancel_bookings";
  }
  if (any(l, ["close all", "close every", "resolve all"]) && l.includes("ticket")) {
    return "bulk_close_tickets";
  }

  // Single-record actions — referenced by their ID
  if (APT_REF_RE.test(message)) {
    if (any(l, ["cancel"])) return "cancel_appointment";
    if (any(l, ["reschedule", "move", "change time", "change date"]))
      return "reschedule_appointment";
  }
  if (TICKET_REF_RE.test(message) && any(l, [
    "set status",
    "change status",
    "mark as",
    "move to",
    "transition",
    "close",
    "resolve",
    "assign",
  ])) {
    return "change_ticket_status";
  }

  // Reports
  if (any(l, ["overview", "dashboard", "summary", "report"]))
    return "report_overview";

  if (l.includes("project")) {
    if (
      any(l, ["list", "show", "recent"]) ||
      any(l, ["how many", "count"])
    )
      return "report_projects";
  }
  if (l.includes("client")) {
    if (any(l, ["list", "show", "recent", "how many", "count"]))
      return "report_clients";
  }
  if (l.includes("lead")) {
    if (any(l, ["list", "show", "recent"])) return "list_recent_leads";
    if (any(l, ["how many", "count"])) return "report_leads";
  }
  if (l.includes("ticket")) {
    if (any(l, ["open", "list", "show", "recent"])) return "list_open_tickets";
    if (any(l, ["how many", "count"])) return "report_tickets";
  }
  if (any(l, ["appointment", "booking"])) {
    if (any(l, ["list", "show", "recent", "today", "this week"]))
      return "list_recent_appointments";
    if (any(l, ["how many", "count"])) return "report_appointments";
  }

  return "unknown";
}

// ── Time-window parsing ──────────────────────────────────────────────────────

export interface DateWindow {
  start: Date;
  end: Date;
  label: string;
}

/**
 * Parse a coarse natural-language time window from a message.
 * Handles: "today", "yesterday", "this week", "last week", "this month".
 * Returns null when no window phrase is present (caller decides default).
 */
export function parseDateWindow(message: string, now: Date = new Date()): DateWindow | null {
  const l = lower(message);
  const startOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const endOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  };

  if (l.includes("today")) {
    return { start: startOfDay(now), end: endOfDay(now), label: "today" };
  }
  if (l.includes("yesterday")) {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    return { start: startOfDay(y), end: endOfDay(y), label: "yesterday" };
  }
  if (l.includes("this week")) {
    const start = startOfDay(now);
    // Week starts Monday locally
    const day = start.getDay(); // 0 = Sun .. 6 = Sat
    const offsetToMonday = (day + 6) % 7;
    start.setDate(start.getDate() - offsetToMonday);
    return { start, end: endOfDay(now), label: "this week" };
  }
  if (l.includes("last week")) {
    const start = startOfDay(now);
    const day = start.getDay();
    const offsetToMonday = (day + 6) % 7;
    start.setDate(start.getDate() - offsetToMonday - 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { start, end: endOfDay(end), label: "last week" };
  }
  if (l.includes("this month")) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    return { start, end: endOfDay(now), label: "this month" };
  }
  return null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── Reports ──────────────────────────────────────────────────────────────────

async function reportOverview(db: Database): Promise<string> {
  const [
    [{ projectsCount }],
    [{ clientsCount }],
    [{ leadsCount }],
    [{ openTicketsCount }],
    [{ confirmedAppointmentsCount }],
  ] = await Promise.all([
    db.select({ projectsCount: sql<number>`count(*)::int` }).from(projects),
    db.select({ clientsCount: sql<number>`count(*)::int` }).from(aiClients),
    db
      .select({ leadsCount: sql<number>`count(*)::int` })
      .from(tickets)
      .where(eq(tickets.requestType, "lead_inquiry")),
    db
      .select({ openTicketsCount: sql<number>`count(*)::int` })
      .from(tickets)
      .where(sql`${tickets.status} IN ('open', 'assigned', 'in_progress')`),
    db
      .select({
        confirmedAppointmentsCount: sql<number>`count(*)::int`,
      })
      .from(aiAppointments)
      .where(sql`${aiAppointments.status} IN ('confirmed', 'rescheduled')`),
  ]);

  return [
    "Here's the current snapshot:",
    `• Projects: ${projectsCount}`,
    `• Clients in CRM: ${clientsCount}`,
    `• Leads (lead_inquiry tickets): ${leadsCount}`,
    `• Open / in-progress tickets: ${openTicketsCount}`,
    `• Active appointments (confirmed or rescheduled): ${confirmedAppointmentsCount}`,
  ].join("\n");
}

async function reportProjects(db: Database): Promise<string> {
  const rows = await db
    .select({
      nameEn: projects.nameEn,
      status: projects.status,
      community: communities.nameEn,
    })
    .from(projects)
    .leftJoin(communities, eq(projects.communityId, communities.id))
    .orderBy(desc(projects.createdAt))
    .limit(20);
  if (rows.length === 0) return "No projects found.";
  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(counts)
    .map(([s, n]) => `${s}: ${n}`)
    .join(", ");
  const list = rows
    .slice(0, 8)
    .map((r) => `• ${r.nameEn} — ${r.status}${r.community ? ` (${r.community})` : ""}`)
    .join("\n");
  return `Showing the most recent ${rows.length} project(s). By status: ${summary}.\n${list}`;
}

async function reportClients(db: Database): Promise<string> {
  const [{ clientsCount }] = await db
    .select({ clientsCount: sql<number>`count(*)::int` })
    .from(aiClients);
  return `There are ${clientsCount} client(s) in the AI CRM.`;
}

async function reportLeads(db: Database, window: DateWindow | null): Promise<string> {
  const conds = [eq(tickets.requestType, "lead_inquiry")];
  if (window) {
    conds.push(gte(tickets.createdAt, window.start));
    conds.push(lte(tickets.createdAt, window.end));
  }
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tickets)
    .where(and(...conds));
  const suffix = window ? ` from ${window.label}` : "";
  return `${count} lead(s)${suffix}.`;
}

async function listRecentLeads(db: Database): Promise<string> {
  const rows = await db
    .select({
      ticketNumber: tickets.ticketNumber,
      subject: tickets.subject,
      contactName: tickets.contactName,
      status: tickets.status,
      createdAt: tickets.createdAt,
    })
    .from(tickets)
    .where(eq(tickets.requestType, "lead_inquiry"))
    .orderBy(desc(tickets.createdAt))
    .limit(10);
  if (rows.length === 0) return "No leads yet.";
  const lines = rows
    .map(
      (r) =>
        `• ${r.ticketNumber.replace(/^ORA-/, "LEAD-")} — ${r.contactName} (${r.status}) — ${r.subject}`
    )
    .join("\n");
  return `Most recent ${rows.length} lead(s):\n${lines}`;
}

async function reportTickets(db: Database): Promise<string> {
  const rows = await db
    .select({
      status: tickets.status,
      count: sql<number>`count(*)::int`,
    })
    .from(tickets)
    .groupBy(tickets.status);
  const total = rows.reduce((acc, r) => acc + r.count, 0);
  const breakdown = rows.map((r) => `${r.status}: ${r.count}`).join(", ");
  return `${total} ticket(s) total. By status: ${breakdown || "none"}.`;
}

async function listOpenTickets(db: Database): Promise<string> {
  const rows = await db
    .select({
      ticketNumber: tickets.ticketNumber,
      subject: tickets.subject,
      contactName: tickets.contactName,
      status: tickets.status,
      priority: tickets.priority,
    })
    .from(tickets)
    .where(sql`${tickets.status} IN ('open', 'assigned', 'in_progress')`)
    .orderBy(desc(tickets.updatedAt))
    .limit(10);
  if (rows.length === 0) return "No open tickets right now.";
  const lines = rows
    .map(
      (r) =>
        `• ${r.ticketNumber} [${r.status}/${r.priority}] — ${r.subject} (${r.contactName})`
    )
    .join("\n");
  return `Top ${rows.length} active ticket(s):\n${lines}`;
}

async function reportAppointments(
  db: Database,
  window: DateWindow | null
): Promise<string> {
  const conds = [];
  if (window) {
    conds.push(gte(aiAppointments.scheduledDate, isoDate(window.start)));
    conds.push(lte(aiAppointments.scheduledDate, isoDate(window.end)));
  }
  const rows = await db
    .select({
      status: aiAppointments.status,
      count: sql<number>`count(*)::int`,
    })
    .from(aiAppointments)
    .where(conds.length ? and(...conds) : undefined)
    .groupBy(aiAppointments.status);
  const total = rows.reduce((acc, r) => acc + r.count, 0);
  const breakdown = rows.map((r) => `${r.status}: ${r.count}`).join(", ");
  const suffix = window ? ` for ${window.label}` : "";
  return `${total} appointment(s)${suffix}. By status: ${breakdown || "none"}.`;
}

async function listRecentAppointments(
  db: Database,
  window: DateWindow | null
): Promise<string> {
  const conds = [];
  if (window) {
    conds.push(gte(aiAppointments.scheduledDate, isoDate(window.start)));
    conds.push(lte(aiAppointments.scheduledDate, isoDate(window.end)));
  }
  const rows = await db
    .select({
      ref: aiAppointments.referenceNumber,
      type: aiAppointments.appointmentType,
      date: aiAppointments.scheduledDate,
      time: aiAppointments.scheduledTime,
      status: aiAppointments.status,
      contact: aiAppointments.contactName,
    })
    .from(aiAppointments)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(aiAppointments.scheduledDate))
    .limit(10);
  if (rows.length === 0) return "No appointments in that window.";
  const lines = rows
    .map(
      (r) =>
        `• ${r.ref} ${r.date} ${r.time} — ${r.type} for ${r.contact} (${r.status})`
    )
    .join("\n");
  return `Showing ${rows.length} appointment(s):\n${lines}`;
}

// ── Bulk-action proposers (NEVER execute; they propose) ──────────────────────

async function proposeBulkCompleteBookings(
  db: Database,
  userId: string,
  window: DateWindow | null
): Promise<AdminAgentResult> {
  if (!window) {
    return {
      response:
        "I can mark bookings as completed in bulk, but I need a time window. Try: \"mark all bookings from this week as completed\" or \"… from today\".",
    };
  }
  const rows = await db
    .select({
      ref: aiAppointments.referenceNumber,
      date: aiAppointments.scheduledDate,
      time: aiAppointments.scheduledTime,
      contact: aiAppointments.contactName,
    })
    .from(aiAppointments)
    .where(
      and(
        gte(aiAppointments.scheduledDate, isoDate(window.start)),
        lte(aiAppointments.scheduledDate, isoDate(window.end)),
        sql`${aiAppointments.status} IN ('confirmed', 'rescheduled')`
      )
    )
    .orderBy(desc(aiAppointments.scheduledDate))
    .limit(50);

  if (rows.length === 0) {
    return {
      response: `No active bookings found for ${window.label}. Nothing to mark.`,
    };
  }

  const token = issuePendingToken(userId, "bulk_complete_bookings", {
    startDate: isoDate(window.start),
    endDate: isoDate(window.end),
  });
  const preview = rows.slice(0, 5).map((r) => `${r.ref} • ${r.date} ${r.time} • ${r.contact}`);
  return {
    response: `I found ${rows.length} active booking(s) for ${window.label}. Confirm to mark them all as completed.`,
    pendingAction: {
      token,
      kind: "bulk_complete_bookings",
      summary: `Mark ${rows.length} booking(s) from ${window.label} as completed`,
      affectedCount: rows.length,
      preview,
    },
  };
}

async function proposeBulkCancelBookings(
  db: Database,
  userId: string,
  window: DateWindow | null
): Promise<AdminAgentResult> {
  if (!window) {
    return {
      response:
        "I can cancel bookings in bulk, but I need a time window. Try: \"cancel all bookings for today\".",
    };
  }
  const rows = await db
    .select({
      ref: aiAppointments.referenceNumber,
      date: aiAppointments.scheduledDate,
      time: aiAppointments.scheduledTime,
      contact: aiAppointments.contactName,
    })
    .from(aiAppointments)
    .where(
      and(
        gte(aiAppointments.scheduledDate, isoDate(window.start)),
        lte(aiAppointments.scheduledDate, isoDate(window.end)),
        sql`${aiAppointments.status} IN ('confirmed', 'rescheduled')`
      )
    )
    .limit(50);
  if (rows.length === 0) {
    return { response: `No active bookings to cancel in ${window.label}.` };
  }
  const token = issuePendingToken(userId, "bulk_cancel_bookings", {
    startDate: isoDate(window.start),
    endDate: isoDate(window.end),
  });
  const preview = rows.slice(0, 5).map((r) => `${r.ref} • ${r.date} ${r.time} • ${r.contact}`);
  return {
    response: `${rows.length} booking(s) match ${window.label}. Confirm to cancel all of them.`,
    pendingAction: {
      token,
      kind: "bulk_cancel_bookings",
      summary: `Cancel ${rows.length} booking(s) from ${window.label}`,
      affectedCount: rows.length,
      preview,
    },
  };
}

async function proposeBulkCloseTickets(
  db: Database,
  userId: string,
  window: DateWindow | null
): Promise<AdminAgentResult> {
  // For tickets we close *resolved* tickets. Closing arbitrary statuses
  // would violate the lifecycle (open → resolved → closed).
  const conds = [eq(tickets.status, "resolved" as TicketStatus)];
  if (window) {
    conds.push(gte(tickets.resolvedAt, window.start));
    conds.push(lte(tickets.resolvedAt, window.end));
  }
  const rows = await db
    .select({ id: tickets.id, ticketNumber: tickets.ticketNumber, subject: tickets.subject })
    .from(tickets)
    .where(and(...conds))
    .limit(50);
  if (rows.length === 0) {
    return {
      response: window
        ? `No resolved tickets to close from ${window.label}.`
        : "No resolved tickets to close.",
    };
  }
  const token = issuePendingToken(userId, "bulk_close_tickets", {
    ticketIds: rows.map((r) => r.id),
  });
  const preview = rows.slice(0, 5).map((r) => `${r.ticketNumber} — ${r.subject}`);
  return {
    response: `${rows.length} resolved ticket(s) ready to close. Confirm to proceed.`,
    pendingAction: {
      token,
      kind: "bulk_close_tickets",
      summary: window
        ? `Close ${rows.length} resolved ticket(s) from ${window.label}`
        : `Close ${rows.length} resolved ticket(s)`,
      affectedCount: rows.length,
      preview,
    },
  };
}

async function proposeCancelAppointment(
  db: Database,
  userId: string,
  message: string
): Promise<AdminAgentResult> {
  const ref = message.match(APT_REF_RE)?.[0]?.toUpperCase();
  if (!ref) {
    return { response: "Please include the appointment reference, e.g. ORA-APT-ABC123." };
  }
  const [row] = await db
    .select({
      id: aiAppointments.id,
      ref: aiAppointments.referenceNumber,
      date: aiAppointments.scheduledDate,
      time: aiAppointments.scheduledTime,
      status: aiAppointments.status,
      contact: aiAppointments.contactName,
    })
    .from(aiAppointments)
    .where(eq(aiAppointments.referenceNumber, ref))
    .limit(1);
  if (!row) return { response: `No appointment found with reference ${ref}.` };
  if (row.status === "cancelled") {
    return { response: `${ref} is already cancelled.` };
  }
  const token = issuePendingToken(userId, "cancel_appointment", { referenceNumber: ref });
  return {
    response: `Found ${ref} (${row.date} ${row.time}, ${row.contact}, status: ${row.status}). Confirm to cancel.`,
    pendingAction: {
      token,
      kind: "cancel_appointment",
      summary: `Cancel appointment ${ref}`,
      affectedCount: 1,
      preview: [`${row.date} ${row.time} — ${row.contact}`],
    },
  };
}

const NEW_DATETIME_RE =
  /\b(\d{4}-\d{2}-\d{2})\b(?:[^0-9]+\b([0-2]?\d:[0-5]\d)\b)?/;

async function proposeRescheduleAppointment(
  db: Database,
  userId: string,
  message: string
): Promise<AdminAgentResult> {
  const ref = message.match(APT_REF_RE)?.[0]?.toUpperCase();
  if (!ref) {
    return {
      response:
        "Please include the appointment reference and a new date/time, e.g. \"reschedule ORA-APT-ABC123 to 2026-05-12 14:00\".",
    };
  }
  const dt = message.match(NEW_DATETIME_RE);
  if (!dt) {
    return {
      response: `What date and time should I move ${ref} to? Use YYYY-MM-DD HH:MM.`,
    };
  }
  const newDate = dt[1];
  const newTime = dt[2] ?? "10:00";
  const [row] = await db
    .select({
      ref: aiAppointments.referenceNumber,
      date: aiAppointments.scheduledDate,
      time: aiAppointments.scheduledTime,
      status: aiAppointments.status,
      contact: aiAppointments.contactName,
    })
    .from(aiAppointments)
    .where(eq(aiAppointments.referenceNumber, ref))
    .limit(1);
  if (!row) return { response: `No appointment found with reference ${ref}.` };
  if (row.status === "cancelled") {
    return { response: `${ref} is cancelled — restore it before rescheduling.` };
  }
  const token = issuePendingToken(userId, "reschedule_appointment", {
    referenceNumber: ref,
    newDate,
    newTime,
  });
  return {
    response: `Reschedule ${ref} from ${row.date} ${row.time} → ${newDate} ${newTime}? Confirm to apply.`,
    pendingAction: {
      token,
      kind: "reschedule_appointment",
      summary: `Reschedule ${ref} to ${newDate} ${newTime}`,
      affectedCount: 1,
      preview: [`Was ${row.date} ${row.time} — ${row.contact}`],
    },
  };
}

const TICKET_STATUS_TARGETS: TicketStatus[] = [
  "open",
  "assigned",
  "in_progress",
  "resolved",
  "closed",
];

function extractTargetStatus(message: string): TicketStatus | null {
  const l = lower(message);
  if (any(l, ["close", "closed"])) return "closed";
  if (any(l, ["resolve", "resolved", "complete", "completed", "done"]))
    return "resolved";
  if (any(l, ["in progress", "in-progress", "start", "working"]))
    return "in_progress";
  if (any(l, ["assign", "assigned"])) return "assigned";
  if (l.includes("reopen")) return "in_progress";
  for (const s of TICKET_STATUS_TARGETS) if (l.includes(s)) return s;
  return null;
}

async function proposeChangeTicketStatus(
  db: Database,
  userId: string,
  message: string
): Promise<AdminAgentResult> {
  const ref = message.match(TICKET_REF_RE)?.[0]?.toUpperCase();
  if (!ref) return { response: "Please include the ticket number, e.g. ORA-000042." };
  const target = extractTargetStatus(message);
  if (!target) {
    return {
      response: `What status should ${ref} move to? (open, assigned, in_progress, resolved, closed)`,
    };
  }
  const [row] = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      status: tickets.status,
      subject: tickets.subject,
    })
    .from(tickets)
    .where(eq(tickets.ticketNumber, ref))
    .limit(1);
  if (!row) return { response: `No ticket found with number ${ref}.` };
  if (row.status === target) {
    return { response: `${ref} is already ${target}. Nothing to do.` };
  }
  const token = issuePendingToken(userId, "change_ticket_status", {
    ticketId: row.id,
    ticketNumber: row.ticketNumber,
    targetStatus: target,
  });
  return {
    response: `Move ${ref} from ${row.status} → ${target}? Confirm to apply (this is audited).`,
    pendingAction: {
      token,
      kind: "change_ticket_status",
      summary: `${ref}: ${row.status} → ${target}`,
      affectedCount: 1,
      preview: [row.subject],
    },
  };
}

// ── Confirmed-action executors ───────────────────────────────────────────────

async function executeBulkCompleteBookings(
  db: Database,
  userId: string,
  args: Record<string, unknown>
): Promise<AdminAgentResult> {
  const startDate = String(args.startDate);
  const endDate = String(args.endDate);
  const updated = await db
    .update(aiAppointments)
    .set({ status: "completed", updatedAt: new Date() })
    .where(
      and(
        gte(aiAppointments.scheduledDate, startDate),
        lte(aiAppointments.scheduledDate, endDate),
        sql`${aiAppointments.status} IN ('confirmed', 'rescheduled')`
      )
    )
    .returning({ id: aiAppointments.id, ref: aiAppointments.referenceNumber });
  await logAudit(db, {
    userId,
    action: "ai_appointment_create",
    entityType: "ai_appointment",
    entityId: userId,
    summary: `Admin chat: marked ${updated.length} booking(s) as completed (${startDate} → ${endDate})`,
    changes: { references: { old: null, new: updated.map((r) => r.ref) } },
  });
  return {
    response: `Done — marked ${updated.length} booking(s) as completed.`,
    executed: { kind: "bulk_complete_bookings", affected: updated.length },
  };
}

async function executeBulkCancelBookings(
  db: Database,
  userId: string,
  args: Record<string, unknown>
): Promise<AdminAgentResult> {
  const startDate = String(args.startDate);
  const endDate = String(args.endDate);
  const updated = await db
    .update(aiAppointments)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        gte(aiAppointments.scheduledDate, startDate),
        lte(aiAppointments.scheduledDate, endDate),
        sql`${aiAppointments.status} IN ('confirmed', 'rescheduled')`
      )
    )
    .returning({ id: aiAppointments.id, ref: aiAppointments.referenceNumber });
  await logAudit(db, {
    userId,
    action: "ai_appointment_cancel",
    entityType: "ai_appointment",
    entityId: userId,
    summary: `Admin chat: cancelled ${updated.length} booking(s) (${startDate} → ${endDate})`,
    changes: { references: { old: null, new: updated.map((r) => r.ref) } },
  });
  return {
    response: `Done — cancelled ${updated.length} booking(s).`,
    executed: { kind: "bulk_cancel_bookings", affected: updated.length },
  };
}

async function executeBulkCloseTickets(
  db: Database,
  userId: string,
  args: Record<string, unknown>
): Promise<AdminAgentResult> {
  const ids = (args.ticketIds as string[]) ?? [];
  if (ids.length === 0) {
    return {
      response: "No tickets to close.",
      executed: { kind: "bulk_close_tickets", affected: 0 },
    };
  }
  let success = 0;
  const failures: string[] = [];
  for (const id of ids) {
    try {
      await transitionTicketStatus(db, id, "closed", userId);
      success++;
    } catch (err) {
      failures.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return {
    response:
      failures.length === 0
        ? `Closed ${success} ticket(s).`
        : `Closed ${success} ticket(s). ${failures.length} could not be closed.`,
    executed: {
      kind: "bulk_close_tickets",
      affected: success,
      detail: failures.length ? { failures } : undefined,
    },
  };
}

async function executeCancelAppointmentAction(
  db: Database,
  userId: string,
  args: Record<string, unknown>
): Promise<AdminAgentResult> {
  const ref = String(args.referenceNumber);
  const [updated] = await db
    .update(aiAppointments)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(aiAppointments.referenceNumber, ref))
    .returning({ id: aiAppointments.id });
  if (!updated) {
    return { response: `Couldn't find ${ref} — it may have been removed.` };
  }
  await logAudit(db, {
    userId,
    action: "ai_appointment_cancel",
    entityType: "ai_appointment",
    entityId: updated.id,
    summary: `Admin chat: cancelled appointment ${ref}`,
  });
  return {
    response: `Cancelled ${ref}.`,
    executed: { kind: "cancel_appointment", affected: 1, detail: { ref } },
  };
}

async function executeRescheduleAppointmentAction(
  db: Database,
  userId: string,
  args: Record<string, unknown>
): Promise<AdminAgentResult> {
  const ref = String(args.referenceNumber);
  const newDate = String(args.newDate);
  const newTime = String(args.newTime);
  const [updated] = await db
    .update(aiAppointments)
    .set({
      scheduledDate: newDate,
      scheduledTime: newTime,
      status: "rescheduled",
      updatedAt: new Date(),
    })
    .where(eq(aiAppointments.referenceNumber, ref))
    .returning({ id: aiAppointments.id });
  if (!updated) {
    return { response: `Couldn't find ${ref}.` };
  }
  await logAudit(db, {
    userId,
    action: "ai_appointment_create",
    entityType: "ai_appointment",
    entityId: updated.id,
    summary: `Admin chat: rescheduled ${ref} to ${newDate} ${newTime}`,
  });
  return {
    response: `Rescheduled ${ref} to ${newDate} ${newTime}.`,
    executed: {
      kind: "reschedule_appointment",
      affected: 1,
      detail: { ref, newDate, newTime },
    },
  };
}

async function executeChangeTicketStatusAction(
  db: Database,
  userId: string,
  args: Record<string, unknown>
): Promise<AdminAgentResult> {
  const ticketId = String(args.ticketId);
  const ticketNumber = String(args.ticketNumber);
  const target = args.targetStatus as TicketStatus;
  try {
    await transitionTicketStatus(db, ticketId, target, userId);
    return {
      response: `${ticketNumber} is now ${target}.`,
      executed: {
        kind: "change_ticket_status",
        affected: 1,
        detail: { ticketNumber, status: target },
      },
    };
  } catch (err) {
    return {
      response: `Couldn't change ${ticketNumber}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ── Public entry point ───────────────────────────────────────────────────────

const HELP_TEXT = [
  "I can help you operate ORA from chat. Try:",
  "• \"give me an overview\" / \"how many tickets are open?\"",
  "• \"list recent leads\" / \"how many leads this week\"",
  "• \"show appointments today\" / \"this week\"",
  "• \"mark all bookings from this week as completed\" (asks to confirm)",
  "• \"cancel ORA-APT-ABC123\" / \"reschedule ORA-APT-ABC123 to 2026-05-12 14:00\"",
  "• \"set ORA-000042 to in_progress\" / \"close ORA-000042\"",
  "Destructive actions always ask you to confirm first.",
].join("\n");

export async function runAdminAgent(
  db: Database,
  input: AdminAgentInput
): Promise<AdminAgentResult> {
  // Confirmation path: execute a previously-issued pending action.
  if (input.confirmationToken) {
    const rec = consumePendingToken(input.confirmationToken, input.userId);
    if (!rec) {
      return {
        response:
          "That confirmation has expired or wasn't yours — please re-run the request.",
      };
    }
    switch (rec.kind) {
      case "bulk_complete_bookings":
        return executeBulkCompleteBookings(db, input.userId, rec.args);
      case "bulk_cancel_bookings":
        return executeBulkCancelBookings(db, input.userId, rec.args);
      case "bulk_close_tickets":
        return executeBulkCloseTickets(db, input.userId, rec.args);
      case "cancel_appointment":
        return executeCancelAppointmentAction(db, input.userId, rec.args);
      case "reschedule_appointment":
        return executeRescheduleAppointmentAction(db, input.userId, rec.args);
      case "change_ticket_status":
        return executeChangeTicketStatusAction(db, input.userId, rec.args);
    }
  }

  const intent = detectAdminIntent(input.message);
  const window = parseDateWindow(input.message);

  switch (intent) {
    case "help":
      return { response: HELP_TEXT };
    case "report_overview":
      return { response: await reportOverview(db) };
    case "report_projects":
      return { response: await reportProjects(db) };
    case "report_clients":
      return { response: await reportClients(db) };
    case "report_leads":
      return { response: await reportLeads(db, window) };
    case "list_recent_leads":
      return { response: await listRecentLeads(db) };
    case "report_tickets":
      return { response: await reportTickets(db) };
    case "list_open_tickets":
      return { response: await listOpenTickets(db) };
    case "report_appointments":
      return { response: await reportAppointments(db, window) };
    case "list_recent_appointments":
      return { response: await listRecentAppointments(db, window) };
    case "bulk_complete_bookings":
      return proposeBulkCompleteBookings(db, input.userId, window);
    case "bulk_cancel_bookings":
      return proposeBulkCancelBookings(db, input.userId, window);
    case "bulk_close_tickets":
      return proposeBulkCloseTickets(db, input.userId, window);
    case "cancel_appointment":
      return proposeCancelAppointment(db, input.userId, input.message);
    case "reschedule_appointment":
      return proposeRescheduleAppointment(db, input.userId, input.message);
    case "change_ticket_status":
      return proposeChangeTicketStatus(db, input.userId, input.message);
    default:
      return {
        response:
          "I didn't catch that. Type \"help\" to see what I can do, or ask for an overview.",
      };
  }
}

// Re-export types for the API + UI layers
export { inArray };
