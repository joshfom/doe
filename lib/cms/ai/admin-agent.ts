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
import { eq, and, gte, lte, sql, desc, inArray, like } from "drizzle-orm";
import type { Database } from "../db";
import {
  tickets,
  ticketNotes,
  aiAppointments,
  aiClients,
  aiConversations,
  projects,
  communities,
  users,
  auditLog,
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
  | "bulk_close_tickets_by_ids"
  | "bulk_close_tickets_by_status"
  | "complete_appointment"
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
  | "list_tickets_by_status"
  | "list_tickets_by_priority"
  | "list_recent_leads"
  | "list_recent_appointments"
  | "show_ticket"
  | "show_appointment"
  | "bulk_complete_bookings"
  | "bulk_cancel_bookings"
  | "bulk_close_tickets"
  | "bulk_close_tickets_by_ids"
  | "bulk_close_tickets_by_status"
  | "complete_appointment"
  | "cancel_appointment"
  | "reschedule_appointment"
  | "change_ticket_status"
  | "my_tickets"
  | "my_top_priority"
  | "my_appointments"
  | "my_ai_actions"
  | "help"
  | "unknown";

function lower(s: string): string {
  return s.toLowerCase().trim();
}

function any(s: string, words: string[]): boolean {
  const l = lower(s);
  return words.some((w) => l.includes(w));
}

const APT_REF_STRICT_RE = /\bORA-APT-[A-Z0-9]{6}\b/i;
// Loose appointment ref: ORA-APT-DEMO-1006, ORA-APT-XYZ123, or bare digits
// when paired with "booking" / "appointment" / "apt".
const APT_REF_LOOSE_RE = /\b(?:ORA-APT(?:-[A-Z0-9]+)+|APT-\d+|#\d{3,}|\d{3,})\b/i;

function extractAppointmentRef(message: string): string | null {
  const strict = message.match(APT_REF_STRICT_RE);
  if (strict) return strict[0].toUpperCase();
  // Only accept a bare-digit loose ref when the message clearly references
  // an appointment. "complete booking 1023" → "1023". Also accept when
  // the verb is appointment-only (reschedule / move / book) and the message
  // doesn't mention tickets, e.g. "reschedule 1006 to friday 3pm".
  const hasAptKeyword = /\b(?:appointment|booking|apt|visit)\b|ORA-APT/i.test(message);
  const hasTicketKeyword = /\bticket|TKT|ORA-\d/i.test(message);
  const hasAptVerb = /\b(?:reschedule|rebook|book|move|change\s+(?:time|date))\b/i.test(message);
  if (!hasAptKeyword && !(hasAptVerb && !hasTicketKeyword)) return null;
  const loose = message.match(APT_REF_LOOSE_RE);
  if (!loose) return null;
  return loose[0].replace(/^#/, "").toUpperCase();
}

// Real ticket numbers: ORA-NNNNNN. Demo tickets: TKT-DEMO-NNNN. Also accept
// the loose forms operators actually type: "TKT-1001", "#1001", or just
// "1001" when paired with the word "ticket".
const TICKET_REF_STRICT_RE = /\bORA-\d{6}\b/i;
const TICKET_REF_LOOSE_RE =
  /\b(?:ORA-\d{3,}|TKT(?:-[A-Z0-9]+)?-\d{3,}|#\d{3,}|\d{3,})\b/i;

/** Pull the best ticket reference candidate out of a message. */
function extractTicketRef(message: string): string | null {
  const strict = message.match(TICKET_REF_STRICT_RE);
  if (strict) return strict[0].toUpperCase();
  // Only accept a loose ref when the message is clearly about tickets,
  // otherwise a number like "2026" would be treated as a ticket id.
  if (!/\bticket|TKT|ORA-/i.test(message)) return null;
  const loose = message.match(TICKET_REF_LOOSE_RE);
  if (!loose) return null;
  return loose[0].replace(/^#/, "").toUpperCase();
}

// Status / priority phrases (with the misspellings operators actually type).
const STATUS_PHRASES: Array<{ status: TicketStatus; words: string[] }> = [
  { status: "in_progress", words: ["in progress", "in-progress", "in_progress", "inprogress", "working on", "wip"] },
  { status: "open", words: ["open", "new"] },
  { status: "assigned", words: ["assigned"] },
  { status: "resolved", words: ["resolved", "done", "completed"] },
  { status: "closed", words: ["closed"] },
];

function extractTicketStatusFilter(message: string): TicketStatus | null {
  const l = lower(message);
  for (const { status, words } of STATUS_PHRASES) {
    if (words.some((w) => l.includes(w))) return status;
  }
  return null;
}

const PRIORITY_PHRASES: Array<{ priority: "low" | "medium" | "high" | "urgent"; words: string[] }> = [
  { priority: "urgent", words: ["urgent", "critical", "emergency"] },
  { priority: "high", words: ["high"] },
  // Tolerate common misspellings of "medium".
  { priority: "medium", words: ["medium", "mendium", "med"] },
  { priority: "low", words: ["low"] },
];

function extractTicketPriorityFilter(
  message: string
): "low" | "medium" | "high" | "urgent" | null {
  const l = lower(message);
  // Only treat as priority when the user explicitly mentions priority
  // (or the misspelling "periority"), to avoid "high level overview" etc.
  if (!/\bpr?[ie]ority|periority\b/.test(l)) return null;
  for (const { priority, words } of PRIORITY_PHRASES) {
    if (words.some((w) => l.includes(w))) return priority;
  }
  return null;
}

// Loose word match — tolerates a single missing or transposed letter, so
// "rojects" still resolves to "project".
function looseWord(haystack: string, needle: string): boolean {
  const l = lower(haystack);
  if (l.includes(needle)) return true;
  // Drop one character from the needle at each position and try.
  for (let i = 0; i < needle.length; i++) {
    const variant = needle.slice(0, i) + needle.slice(i + 1);
    if (variant.length >= 4 && l.includes(variant)) return true;
  }
  return false;
}

// Helpers shared by intent + executors -----------------------------------

/**
 * Extract a free-text note from a message. Recognises:
 *   with note "..."
 *   with internal note - ...
 *   note: ...
 *   note - ...
 * Returns null when no note is present.
 */
export function extractNote(message: string): string | null {
  const quoted = message.match(/\bnote[s]?\s*[:\-]?\s*"([^"]+)"/i);
  if (quoted) return quoted[1].trim();
  const dashed = message.match(/\b(?:internal\s+)?note[s]?\s*[:\-]\s*(.+)$/i);
  if (dashed) return dashed[1].trim().replace(/^["']|["']$/g, "");
  // "with note <free text>" — capture to end of string
  const withNote = message.match(/\bwith\s+(?:internal\s+)?note[s]?\s+(.+)$/i);
  if (withNote) {
    let txt = withNote[1].trim();
    if (txt.startsWith("\"") || txt.startsWith("'")) txt = txt.replace(/^["']|["']$/g, "");
    return txt;
  }
  return null;
}

/** Pull a list of ticket refs from a message: "1003, 1004, 1014" / "TKT-1001 and 1002". */
export function extractTicketRefList(message: string): string[] {
  const out = new Set<string>();
  const re = /\b(?:ORA-\d{3,}|TKT(?:-[A-Z0-9]+)?-\d{3,}|#?\d{3,})\b/gi;
  for (const m of message.matchAll(re)) {
    out.add(m[0].replace(/^#/, "").toUpperCase());
  }
  return Array.from(out);
}

/**
 * Loose natural-language date/time parser used for reschedules.
 * Handles: explicit "YYYY-MM-DD HH:MM"; "tomorrow", "today", "monday"…"sunday"
 * with optional "at HH(:MM)? am/pm" or "HH:MM".
 * Returns { date: "YYYY-MM-DD", time: "HH:MM" } or null.
 */
export function parseNaturalDateTime(
  message: string,
  now: Date = new Date()
): { date: string; time: string } | null {
  const l = lower(message);
  const iso = message.match(/\b(\d{4}-\d{2}-\d{2})(?:[^0-9]+([0-2]?\d:[0-5]\d))?/);
  if (iso) return { date: iso[1], time: iso[2] ?? "10:00" };

  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  let target: Date | null = null;
  if (l.includes("tomorrow")) {
    target = new Date(now);
    target.setDate(target.getDate() + 1);
  } else if (l.includes("today")) {
    target = new Date(now);
  } else {
    for (let i = 0; i < dayNames.length; i++) {
      if (new RegExp(`\\b${dayNames[i]}\\b`).test(l)) {
        target = new Date(now);
        const diff = ((i - target.getDay()) + 7) % 7 || 7;
        target.setDate(target.getDate() + diff);
        break;
      }
    }
  }
  if (!target) return null;

  // Time: "5pm", "5:30 pm", "17:00", "at 5"
  let hh = 10;
  let mm = 0;
  const ampm = message.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  const military = message.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (ampm) {
    hh = Number(ampm[1]) % 12;
    if (ampm[3].toLowerCase() === "pm") hh += 12;
    mm = Number(ampm[2] ?? 0);
  } else if (military) {
    hh = Number(military[1]);
    mm = Number(military[2]);
  }

  const date = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${String(target.getDate()).padStart(2, "0")}`;
  const time = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  return { date, time };
}

export function detectAdminIntent(message: string): AdminIntent {
  const l = lower(message);

  if (any(l, ["help", "what can you do", "commands", "menu"])) return "help";

  // ── Personal / sentiment queries (must beat the generic report intents) ──
  // Examples: "how many tickets do i have today", "tickets assigned to me",
  // "my open tickets", "do i have appointments today", "my top priority",
  // "what did the ai do today", "ai audit".
  const isPersonal =
    /\bassigned to me\b/.test(l) ||
    /\bdo i have\b/.test(l) ||
    /\bi have\b/.test(l) ||
    /\bmy\b/.test(l);

  // AI action audit ("what did the AI do", "ai actions", "ai audit").
  if (
    (l.includes("ai") &&
      any(l, ["audit", "actions", "history", "changes"])) ||
    (l.includes("ai") && /\b(did|do)\b/.test(l) && /\b(today|this week|yesterday)\b/.test(l)) ||
    (isPersonal && l.includes("ai") && any(l, ["actions", "history", "did", "do"]))
  ) {
    return "my_ai_actions";
  }

  if (isPersonal) {
    if (any(l, ["appointment", "booking", "visit", "meeting"])) {
      return "my_appointments";
    }
    if (
      any(l, [
        "most important",
        "top priority",
        "highest priority",
        "urgent",
        "top ticket",
      ]) &&
      l.includes("ticket")
    ) {
      return "my_top_priority";
    }
    if (l.includes("ticket")) {
      return "my_tickets";
    }
  }

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
  // "close all open tickets for today" / "close all in-progress tickets"
  if (
    any(l, ["close all", "close every", "resolve all"]) &&
    l.includes("ticket")
  ) {
    const statusFilter = extractTicketStatusFilter(message);
    // "close all resolved tickets" → original safe path (resolved → closed only).
    if (statusFilter && statusFilter !== "resolved") return "bulk_close_tickets_by_status";
    if (!statusFilter && parseDateWindow(message)) return "bulk_close_tickets_by_status";
    return "bulk_close_tickets";
  }
  // "close tickets 1003, 1004, 1014" — multi-id list (≥2 refs)
  if (
    any(l, ["close", "resolve"]) &&
    l.includes("ticket")
  ) {
    const refs = extractTicketRefList(message);
    if (refs.length >= 2) return "bulk_close_tickets_by_ids";
  }

  // Single-record appointment actions
  const aptRef = extractAppointmentRef(message);
  if (aptRef) {
    if (any(l, ["cancel"])) return "cancel_appointment";
    if (any(l, ["reschedule", "move", "change time", "change date"]))
      return "reschedule_appointment";
    if (any(l, ["complete", "completed", "mark complete", "mark as complete", "done"]))
      return "complete_appointment";
    if (any(l, ["show", "tell me about", "details", "view", "about"]))
      return "show_appointment";
  }
  const ticketRef = extractTicketRef(message);
  const ticketActionVerb = any(l, [
    "set status",
    "change status",
    "mark as",
    "move to",
    "transition",
    "close",
    "resolve",
    "assign",
    "reopen",
  ]);
  if (ticketRef && ticketActionVerb) return "change_ticket_status";
  // "close a ticket in progress" — verb without ref, but a status filter is
  // present. Treat as a request to list tickets so the operator can pick.
  if (ticketActionVerb && l.includes("ticket") && extractTicketStatusFilter(message)) {
    return "list_tickets_by_status";
  }
  // "tell me about ticket ORA-000042" / "show ticket 1001" — single record.
  if (ticketRef && any(l, ["show", "tell me about", "details", "open", "view", "about"])) {
    return "show_ticket";
  }

  // Reports
  if (any(l, ["overview", "dashboard", "summary", "report"]))
    return "report_overview";

  if (looseWord(l, "project")) {
    if (
      any(l, ["list", "show", "recent"]) ||
      any(l, ["how many", "count", "we have", "do we have"])
    )
      return "report_projects";
  }
  if (looseWord(l, "client")) {
    if (any(l, ["list", "show", "recent", "how many", "count"]))
      return "report_clients";
  }
  if (l.includes("lead")) {
    if (any(l, ["list", "show", "recent"])) return "list_recent_leads";
    if (any(l, ["how many", "count"])) return "report_leads";
  }
  if (l.includes("ticket")) {
    // Priority filter wins ("tickets with high priority").
    if (extractTicketPriorityFilter(message)) return "list_tickets_by_priority";
    // Status filter ("how many tickets in progress", "tickets resolved").
    // "open" is special-cased to the broader list_open_tickets view
    // (open + assigned + in_progress) for backwards compatibility.
    const statusFilter = extractTicketStatusFilter(message);
    if (statusFilter && statusFilter !== "open") return "list_tickets_by_status";
    if (any(l, ["open", "list", "show", "recent"])) return "list_open_tickets";
    if (any(l, ["how many", "count"])) return "report_tickets";
  }
  if (/\bapp?ointments?\b|\bbookings?\b/.test(l)) {
    if (any(l, ["list", "show", "recent", "today", "tomorrow", "this week", "next week", "scheduled"]))
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
  if (l.includes("tomorrow")) {
    const t = new Date(now);
    t.setDate(t.getDate() + 1);
    return { start: startOfDay(t), end: endOfDay(t), label: "tomorrow" };
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
  if (l.includes("next week")) {
    const start = startOfDay(now);
    const day = start.getDay();
    const offsetToMonday = (day + 6) % 7;
    start.setDate(start.getDate() - offsetToMonday + 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { start, end: endOfDay(end), label: "next week" };
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
  // Format the date in *local* time. Using toISOString() would shift the
  // calendar day in any non-UTC timezone (e.g. local-midnight tomorrow in
  // GST/UTC+4 serializes back to today's UTC date), making "tomorrow"
  // window queries leak today's rows.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
    .orderBy(window ? aiAppointments.scheduledDate : desc(aiAppointments.scheduledDate))
    .limit(10);
  if (rows.length === 0) {
    return window ? `No appointments for ${window.label}.` : "No appointments in that window.";
  }
  const lines = rows
    .map(
      (r) =>
        `• ${r.ref} ${r.date} ${r.time} — ${r.type} for ${r.contact} (${r.status})`
    )
    .join("\n");
  return `Showing ${rows.length} appointment(s)${window ? ` for ${window.label}` : ""}:\n${lines}`;
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

async function resolveAppointmentByRef(
  db: Database,
  ref: string
): Promise<{ id: string; ref: string; date: string; time: string; status: string; contact: string } | null> {
  const exact = await db
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
  if (exact[0]) return exact[0] as never;
  const digits = ref.match(/\d+/)?.[0];
  if (!digits) return null;
  const matches = await db
    .select({
      id: aiAppointments.id,
      ref: aiAppointments.referenceNumber,
      date: aiAppointments.scheduledDate,
      time: aiAppointments.scheduledTime,
      status: aiAppointments.status,
      contact: aiAppointments.contactName,
    })
    .from(aiAppointments)
    .where(like(aiAppointments.referenceNumber, `%-${digits}`))
    .limit(2);
  if (matches.length === 1) return matches[0] as never;
  return null;
}

async function proposeCancelAppointment(
  db: Database,
  userId: string,
  message: string
): Promise<AdminAgentResult> {
  const ref = extractAppointmentRef(message);
  if (!ref) {
    return { response: "Please include the appointment reference, e.g. ORA-APT-ABC123 or just 1023." };
  }
  const row = await resolveAppointmentByRef(db, ref);
  if (!row) return { response: `No appointment found matching "${ref}".` };
  if (row.status === "cancelled") {
    return { response: `${row.ref} is already cancelled.` };
  }
  const note = extractNote(message);
  const token = issuePendingToken(userId, "cancel_appointment", {
    referenceNumber: row.ref,
    note,
  });
  return {
    response: `Found ${row.ref} (${row.date} ${row.time}, ${row.contact}, status: ${row.status})${note ? ` with note: "${note}"` : ""}. Confirm to cancel.`,
    pendingAction: {
      token,
      kind: "cancel_appointment",
      summary: `Cancel appointment ${row.ref}`,
      affectedCount: 1,
      preview: [`${row.date} ${row.time} — ${row.contact}`],
    },
  };
}

async function proposeCompleteAppointment(
  db: Database,
  userId: string,
  message: string
): Promise<AdminAgentResult> {
  const ref = extractAppointmentRef(message);
  if (!ref) {
    return { response: "Please include the appointment reference, e.g. ORA-APT-DEMO-1006 or just 1006." };
  }
  const row = await resolveAppointmentByRef(db, ref);
  if (!row) return { response: `No appointment found matching "${ref}".` };
  if (row.status === "completed") {
    return { response: `${row.ref} is already completed.` };
  }
  const note = extractNote(message);
  const token = issuePendingToken(userId, "complete_appointment", {
    referenceNumber: row.ref,
    note,
  });
  return {
    response: `Mark ${row.ref} (${row.date} ${row.time}, ${row.contact}) as completed${note ? ` with note: "${note}"` : ""}? Confirm to apply.`,
    pendingAction: {
      token,
      kind: "complete_appointment",
      summary: `Complete appointment ${row.ref}`,
      affectedCount: 1,
      preview: [`${row.date} ${row.time} — ${row.contact}`],
    },
  };
}

async function proposeRescheduleAppointment(
  db: Database,
  userId: string,
  message: string
): Promise<AdminAgentResult> {
  const ref = extractAppointmentRef(message);
  if (!ref) {
    return {
      response:
        "Please include the appointment reference and a new date/time, e.g. \"reschedule ORA-APT-DEMO-1006 to tomorrow 5pm\".",
    };
  }
  const dt = parseNaturalDateTime(message);
  if (!dt) {
    return {
      response: `What date and time should I move ${ref} to? Try \"tomorrow 5pm\" or \"2026-05-12 14:00\".`,
    };
  }
  const row = await resolveAppointmentByRef(db, ref);
  if (!row) return { response: `No appointment found matching "${ref}".` };
  if (row.status === "cancelled") {
    return { response: `${row.ref} is cancelled — restore it before rescheduling.` };
  }
  const note = extractNote(message);
  const token = issuePendingToken(userId, "reschedule_appointment", {
    referenceNumber: row.ref,
    newDate: dt.date,
    newTime: dt.time,
    note,
  });
  return {
    response: `Reschedule ${row.ref} from ${row.date} ${row.time} → ${dt.date} ${dt.time}${note ? ` (note: "${note}")` : ""}? Confirm to apply.`,
    pendingAction: {
      token,
      kind: "reschedule_appointment",
      summary: `Reschedule ${row.ref} to ${dt.date} ${dt.time}`,
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

async function resolveTicketByRef(
  db: Database,
  ref: string
): Promise<{ id: string; ticketNumber: string; status: TicketStatus; subject: string; priority: string; contactName: string } | null> {
  // Try exact match first.
  const exact = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      status: tickets.status,
      subject: tickets.subject,
      priority: tickets.priority,
      contactName: tickets.contactName,
    })
    .from(tickets)
    .where(eq(tickets.ticketNumber, ref))
    .limit(1);
  if (exact[0]) return exact[0] as never;
  // Fall back to suffix match (e.g. user typed "1001" → "TKT-DEMO-1001").
  const digits = ref.match(/\d+/)?.[0];
  if (!digits) return null;
  const suffix = `%-${digits}`;
  const matches = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      status: tickets.status,
      subject: tickets.subject,
      priority: tickets.priority,
      contactName: tickets.contactName,
    })
    .from(tickets)
    .where(like(tickets.ticketNumber, suffix))
    .limit(2);
  if (matches.length === 1) return matches[0] as never;
  return null;
}

async function proposeChangeTicketStatus(
  db: Database,
  userId: string,
  message: string
): Promise<AdminAgentResult> {
  const ref = extractTicketRef(message);
  if (!ref) {
    return {
      response:
        "Please include the ticket number, e.g. ORA-000042, TKT-DEMO-1001, or just the digits like 1001.",
    };
  }
  const target = extractTargetStatus(message);
  if (!target) {
    return {
      response: `What status should ${ref} move to? (open, assigned, in_progress, resolved, closed)`,
    };
  }
  const row = await resolveTicketByRef(db, ref);
  if (!row) return { response: `No ticket found matching "${ref}".` };
  if (row.status === target) {
    return { response: `${row.ticketNumber} is already ${target}. Nothing to do.` };
  }
  const note = extractNote(message);
  const token = issuePendingToken(userId, "change_ticket_status", {
    ticketId: row.id,
    ticketNumber: row.ticketNumber,
    targetStatus: target,
    note,
  });
  return {
    response: `Move ${row.ticketNumber} from ${row.status} → ${target}${note ? ` with note: "${note}"` : ""}? Confirm to apply (this is audited).`,
    pendingAction: {
      token,
      kind: "change_ticket_status",
      summary: `${row.ticketNumber}: ${row.status} → ${target}`,
      affectedCount: 1,
      preview: note ? [row.subject, `Note: ${note}`] : [row.subject],
    },
  };
}

/** "close tickets 1003, 1004, 1014" — by explicit id list. */
async function proposeBulkCloseTicketsByIds(
  db: Database,
  userId: string,
  message: string
): Promise<AdminAgentResult> {
  const refs = extractTicketRefList(message);
  if (refs.length === 0) {
    return { response: "I didn't see any ticket numbers — try \"close tickets 1003, 1004, 1014\"." };
  }
  const resolved = await Promise.all(refs.map((r) => resolveTicketByRef(db, r)));
  const found = resolved.filter((r): r is NonNullable<typeof r> => r !== null);
  const missing = refs.filter((_, i) => resolved[i] === null);
  if (found.length === 0) {
    return { response: `No tickets found for: ${refs.join(", ")}.` };
  }
  const note = extractNote(message);
  const token = issuePendingToken(userId, "bulk_close_tickets_by_ids", {
    ticketIds: found.map((r) => r.id),
    ticketNumbers: found.map((r) => r.ticketNumber),
    note,
  });
  const preview = found.slice(0, 5).map((r) => `${r.ticketNumber} [${r.status}] — ${r.subject}`);
  if (note) preview.push(`Note: ${note}`);
  const missingSuffix = missing.length ? ` (${missing.length} not found: ${missing.join(", ")})` : "";
  return {
    response: `Close ${found.length} ticket(s)${note ? ` with note: "${note}"` : ""}?${missingSuffix} Confirm to apply.`,
    pendingAction: {
      token,
      kind: "bulk_close_tickets_by_ids",
      summary: `Close ${found.length} ticket(s): ${found.map((r) => r.ticketNumber).join(", ")}`,
      affectedCount: found.length,
      preview,
    },
  };
}

/** "close all open tickets for today" — status filter (+ optional window). */
async function proposeBulkCloseTicketsByStatus(
  db: Database,
  userId: string,
  message: string,
  window: DateWindow | null
): Promise<AdminAgentResult> {
  const status = extractTicketStatusFilter(message);
  if (!status) {
    return { response: "Which status should I close? Try \"close all in_progress tickets\"." };
  }
  if (status === "closed") {
    return { response: "Those tickets are already closed." };
  }
  const conds = [eq(tickets.status, status)];
  if (window) {
    conds.push(gte(tickets.createdAt, window.start));
    conds.push(lte(tickets.createdAt, window.end));
  }
  const rows = await db
    .select({ id: tickets.id, ticketNumber: tickets.ticketNumber, subject: tickets.subject, status: tickets.status })
    .from(tickets)
    .where(and(...conds))
    .limit(50);
  if (rows.length === 0) {
    return { response: window ? `No ${status} tickets from ${window.label}.` : `No ${status} tickets to close.` };
  }
  const note = extractNote(message);
  const token = issuePendingToken(userId, "bulk_close_tickets_by_status", {
    ticketIds: rows.map((r) => r.id),
    ticketNumbers: rows.map((r) => r.ticketNumber),
    note,
  });
  const preview = rows.slice(0, 5).map((r) => `${r.ticketNumber} — ${r.subject}`);
  if (note) preview.push(`Note: ${note}`);
  return {
    response: `Close ${rows.length} ${status} ticket(s)${window ? ` from ${window.label}` : ""}${note ? ` with note: "${note}"` : ""}? Confirm to apply.`,
    pendingAction: {
      token,
      kind: "bulk_close_tickets_by_status",
      summary: window
        ? `Close ${rows.length} ${status} ticket(s) from ${window.label}`
        : `Close ${rows.length} ${status} ticket(s)`,
      affectedCount: rows.length,
      preview,
    },
  };
}

async function showTicket(db: Database, message: string): Promise<string> {
  const ref = extractTicketRef(message);
  if (!ref) return "Please include the ticket number.";
  const row = await resolveTicketByRef(db, ref);
  if (!row) return `No ticket found matching "${ref}".`;
  return [
    `${row.ticketNumber} — ${row.subject}`,
    `Status: ${row.status} • Priority: ${row.priority}`,
    `Contact: ${row.contactName}`,
  ].join("\n");
}

async function showAppointment(db: Database, message: string): Promise<string> {
  const ref = extractAppointmentRef(message);
  if (!ref) return "Please include the appointment reference.";
  const rows = await db
    .select({
      ref: aiAppointments.referenceNumber,
      type: aiAppointments.appointmentType,
      date: aiAppointments.scheduledDate,
      time: aiAppointments.scheduledTime,
      status: aiAppointments.status,
      contact: aiAppointments.contactName,
      contactEmail: aiAppointments.contactEmail,
    })
    .from(aiAppointments)
    .where(eq(aiAppointments.referenceNumber, ref))
    .limit(1);
  let row = rows[0];
  if (!row) {
    const digits = ref.match(/\d+/)?.[0];
    if (digits) {
      const fallback = await db
        .select({
          ref: aiAppointments.referenceNumber,
          type: aiAppointments.appointmentType,
          date: aiAppointments.scheduledDate,
          time: aiAppointments.scheduledTime,
          status: aiAppointments.status,
          contact: aiAppointments.contactName,
          contactEmail: aiAppointments.contactEmail,
        })
        .from(aiAppointments)
        .where(like(aiAppointments.referenceNumber, `%-${digits}`))
        .limit(2);
      if (fallback.length === 1) row = fallback[0];
    }
  }
  if (!row) return `No appointment found matching "${ref}".`;
  return [
    `${row.ref} — ${row.type} for ${row.contact}`,
    `Scheduled: ${row.date} ${row.time}`,
    `Status: ${row.status}`,
    row.contactEmail ? `Contact: ${row.contactEmail}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

async function listTicketsByStatus(
  db: Database,
  message: string
): Promise<string> {
  const status = extractTicketStatusFilter(message);
  if (!status) return "Which status? (open, assigned, in_progress, resolved, closed)";
  const rows = await db
    .select({
      ticketNumber: tickets.ticketNumber,
      subject: tickets.subject,
      contactName: tickets.contactName,
      priority: tickets.priority,
    })
    .from(tickets)
    .where(eq(tickets.status, status))
    .orderBy(desc(tickets.updatedAt))
    .limit(10);
  if (rows.length === 0) return `No tickets in status "${status}".`;
  const lines = rows
    .map(
      (r) =>
        `• ${r.ticketNumber} [${r.priority}] — ${r.subject} (${r.contactName})`
    )
    .join("\n");
  return `${rows.length} ticket(s) in "${status}":\n${lines}`;
}

async function listTicketsByPriority(
  db: Database,
  message: string
): Promise<string> {
  const priority = extractTicketPriorityFilter(message);
  if (!priority) return "Which priority? (low, medium, high, urgent)";
  const rows = await db
    .select({
      ticketNumber: tickets.ticketNumber,
      subject: tickets.subject,
      contactName: tickets.contactName,
      status: tickets.status,
    })
    .from(tickets)
    .where(eq(tickets.priority, priority))
    .orderBy(desc(tickets.updatedAt))
    .limit(10);
  if (rows.length === 0) return `No tickets at "${priority}" priority.`;
  const lines = rows
    .map(
      (r) =>
        `• ${r.ticketNumber} [${r.status}] — ${r.subject} (${r.contactName})`
    )
    .join("\n");
  return `${rows.length} ${priority}-priority ticket(s):\n${lines}`;
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

async function addInternalNote(
  db: Database,
  ticketId: string,
  authorId: string,
  content: string
): Promise<void> {
  try {
    await db.insert(ticketNotes).values({
      ticketId,
      authorId,
      content,
      isInternal: true,
    });
  } catch {
    // Notes are best-effort — never block the action they accompany.
  }
}

/**
 * Close a ticket, bridging through "resolved" if necessary.
 * Lifecycle: open → assigned → in_progress → resolved → closed.
 * Operators saying "close ticket 1001" expect the final state regardless
 * of where it currently sits — we walk it forward through the legal
 * transitions.
 */
async function closeTicketViaLifecycle(
  db: Database,
  ticketId: string,
  actorId: string
): Promise<void> {
  const [t] = await db.select({ status: tickets.status }).from(tickets).where(eq(tickets.id, ticketId));
  if (!t) throw new Error("Ticket not found");
  let current = t.status as TicketStatus;
  const path: TicketStatus[] = [];
  if (current === "open" || current === "assigned") path.push("in_progress");
  if (current !== "resolved" && current !== "closed") path.push("resolved");
  path.push("closed");
  for (const next of path) {
    if (current === next) continue;
    await transitionTicketStatus(db, ticketId, next, actorId);
    current = next;
  }
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
  const note = args.note ? String(args.note) : null;
  let success = 0;
  const failures: string[] = [];
  for (const id of ids) {
    try {
      await closeTicketViaLifecycle(db, id, userId);
      if (note) await addInternalNote(db, id, userId, note);
      success++;
    } catch (err) {
      failures.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return {
    response:
      failures.length === 0
        ? `Closed ${success} ticket(s)${note ? " (note attached)" : ""}.`
        : `Closed ${success} ticket(s). ${failures.length} could not be closed.`,
    executed: {
      kind: "bulk_close_tickets",
      affected: success,
      detail: failures.length ? { failures } : undefined,
    },
  };
}

async function executeBulkCloseTicketsByIds(
  db: Database,
  userId: string,
  args: Record<string, unknown>
): Promise<AdminAgentResult> {
  const r = await executeBulkCloseTickets(db, userId, args);
  return { ...r, executed: r.executed ? { ...r.executed, kind: "bulk_close_tickets_by_ids" } : undefined };
}

async function executeBulkCloseTicketsByStatus(
  db: Database,
  userId: string,
  args: Record<string, unknown>
): Promise<AdminAgentResult> {
  const r = await executeBulkCloseTickets(db, userId, args);
  return { ...r, executed: r.executed ? { ...r.executed, kind: "bulk_close_tickets_by_status" } : undefined };
}

async function executeCancelAppointmentAction(
  db: Database,
  userId: string,
  args: Record<string, unknown>
): Promise<AdminAgentResult> {
  const ref = String(args.referenceNumber);
  const note = args.note ? String(args.note) : null;
  const updateValues: Record<string, unknown> = { status: "cancelled", updatedAt: new Date() };
  if (note) updateValues.notes = note;
  const [updated] = await db
    .update(aiAppointments)
    .set(updateValues)
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
    summary: `Admin chat: cancelled appointment ${ref}${note ? ` (note: ${note})` : ""}`,
  });
  return {
    response: `Cancelled ${ref}${note ? " with note attached" : ""}.`,
    executed: { kind: "cancel_appointment", affected: 1, detail: { ref } },
  };
}

async function executeCompleteAppointmentAction(
  db: Database,
  userId: string,
  args: Record<string, unknown>
): Promise<AdminAgentResult> {
  const ref = String(args.referenceNumber);
  const note = args.note ? String(args.note) : null;
  const updateValues: Record<string, unknown> = { status: "completed", updatedAt: new Date() };
  if (note) updateValues.notes = note;
  const [updated] = await db
    .update(aiAppointments)
    .set(updateValues)
    .where(eq(aiAppointments.referenceNumber, ref))
    .returning({ id: aiAppointments.id });
  if (!updated) return { response: `Couldn't find ${ref}.` };
  await logAudit(db, {
    userId,
    action: "ai_appointment_create",
    entityType: "ai_appointment",
    entityId: updated.id,
    summary: `Admin chat: completed appointment ${ref}${note ? ` (note: ${note})` : ""}`,
  });
  return {
    response: `Marked ${ref} as completed${note ? " with note attached" : ""}.`,
    executed: { kind: "complete_appointment", affected: 1, detail: { ref } },
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
  const note = args.note ? String(args.note) : null;
  const updateValues: Record<string, unknown> = {
    scheduledDate: newDate,
    scheduledTime: newTime,
    status: "rescheduled",
    updatedAt: new Date(),
  };
  if (note) updateValues.notes = note;
  const [updated] = await db
    .update(aiAppointments)
    .set(updateValues)
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
    summary: `Admin chat: rescheduled ${ref} to ${newDate} ${newTime}${note ? ` (note: ${note})` : ""}`,
  });
  return {
    response: `Rescheduled ${ref} to ${newDate} ${newTime}${note ? " with note attached" : ""}.`,
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
  const note = args.note ? String(args.note) : null;
  try {
    if (target === "closed") {
      await closeTicketViaLifecycle(db, ticketId, userId);
    } else {
      await transitionTicketStatus(db, ticketId, target, userId);
    }
    if (note) await addInternalNote(db, ticketId, userId, note);
    return {
      response: `${ticketNumber} is now ${target}${note ? " (note attached)" : ""}.`,
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

// ── Personal / sentiment reports ─────────────────────────────────────────────

async function getUserEmail(db: Database, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.email ?? null;
}

async function reportMyTickets(
  db: Database,
  userId: string,
  window: DateWindow | null
): Promise<string> {
  const conds = [eq(tickets.assigneeId, userId)];
  // Only include active tickets unless the user explicitly asks about all.
  conds.push(sql`${tickets.status} IN ('open', 'assigned', 'in_progress')`);
  if (window) {
    conds.push(gte(tickets.createdAt, window.start));
    conds.push(lte(tickets.createdAt, window.end));
  }
  const rows = await db
    .select({
      ticketNumber: tickets.ticketNumber,
      subject: tickets.subject,
      status: tickets.status,
      priority: tickets.priority,
      contactName: tickets.contactName,
    })
    .from(tickets)
    .where(and(...conds))
    .orderBy(desc(tickets.updatedAt))
    .limit(15);
  if (rows.length === 0) {
    return window
      ? `You have no active tickets assigned${window.label === "today" ? " today" : ` for ${window.label}`}.`
      : "You have no active tickets assigned right now. 🎉";
  }
  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.priority] = (acc[r.priority] ?? 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(counts)
    .map(([p, n]) => `${p}: ${n}`)
    .join(", ");
  const lines = rows
    .slice(0, 8)
    .map(
      (r) =>
        `• ${r.ticketNumber} [${r.status}/${r.priority}] — ${r.subject} (${r.contactName})`
    )
    .join("\n");
  const head = window
    ? `You have ${rows.length} active ticket(s) assigned${window.label === "today" ? " today" : ` for ${window.label}`}`
    : `You have ${rows.length} active ticket(s) assigned`;
  return `${head}. By priority: ${summary}.\n${lines}`;
}

async function reportMyTopPriority(
  db: Database,
  userId: string
): Promise<string> {
  // Order: urgent > high > medium > low, then oldest first.
  const rows = await db
    .select({
      ticketNumber: tickets.ticketNumber,
      subject: tickets.subject,
      status: tickets.status,
      priority: tickets.priority,
      contactName: tickets.contactName,
      createdAt: tickets.createdAt,
    })
    .from(tickets)
    .where(
      and(
        eq(tickets.assigneeId, userId),
        sql`${tickets.status} IN ('open', 'assigned', 'in_progress')`
      )
    )
    .orderBy(
      sql`CASE ${tickets.priority}
            WHEN 'urgent' THEN 0
            WHEN 'high' THEN 1
            WHEN 'medium' THEN 2
            WHEN 'low' THEN 3
            ELSE 4 END`,
      tickets.createdAt
    )
    .limit(1);
  if (rows.length === 0) {
    return "You have no active tickets — nothing to prioritise.";
  }
  const r = rows[0];
  return [
    `Your top-priority ticket is ${r.ticketNumber} [${r.priority}].`,
    `Subject: ${r.subject}`,
    `Status: ${r.status} • Contact: ${r.contactName}`,
  ].join("\n");
}

async function reportMyAppointments(
  db: Database,
  userId: string,
  window: DateWindow | null
): Promise<string> {
  const email = await getUserEmail(db, userId);
  if (!email) {
    return "I couldn't find your user record to look up your appointments.";
  }
  const conds = [
    eq(aiAppointments.contactEmail, email),
    sql`${aiAppointments.status} IN ('confirmed', 'rescheduled')`,
  ];
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
      contact: aiAppointments.contactName,
      status: aiAppointments.status,
    })
    .from(aiAppointments)
    .where(and(...conds))
    .orderBy(aiAppointments.scheduledDate, aiAppointments.scheduledTime)
    .limit(10);
  const suffix = window
    ? window.label === "today"
      ? " today"
      : ` for ${window.label}`
    : "";
  if (rows.length === 0) {
    return `You have no upcoming appointments${suffix}.`;
  }
  const lines = rows
    .map(
      (r) =>
        `• ${r.ref} ${r.date} ${r.time} — ${r.type} with ${r.contact} (${r.status})`
    )
    .join("\n");
  return `You have ${rows.length} appointment(s)${suffix}:\n${lines}`;
}

async function reportMyAiActions(
  db: Database,
  userId: string,
  window: DateWindow | null
): Promise<string> {
  const conds = [
    eq(auditLog.userId, userId),
    sql`${auditLog.summary} LIKE 'Admin chat:%'`,
  ];
  if (window) {
    conds.push(gte(auditLog.createdAt, window.start));
    conds.push(lte(auditLog.createdAt, window.end));
  }
  const rows = await db
    .select({
      summary: auditLog.summary,
      action: auditLog.action,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(and(...conds))
    .orderBy(desc(auditLog.createdAt))
    .limit(15);
  const suffix = window ? ` for ${window.label}` : "";
  if (rows.length === 0) {
    return `No AI actions recorded${suffix}.`;
  }
  const lines = rows
    .map((r) => {
      const stamp = new Date(r.createdAt).toISOString().slice(0, 16).replace("T", " ");
      // Strip the "Admin chat: " prefix in the display.
      const text = r.summary.replace(/^Admin chat:\s*/i, "");
      return `• ${stamp} — ${text}`;
    })
    .join("\n");
  return `${rows.length} AI action(s)${suffix}:\n${lines}`;
}

// ── Public entry point ───────────────────────────────────────────────────────

const HELP_TEXT = [
  "I can help you operate ORA from chat. Try:",
  "• \"give me an overview\" / \"how many tickets are open?\"",
  "• \"how many tickets do i have today?\" / \"my tickets assigned to me\"",
  "• \"what's my most important ticket?\" / \"do i have appointments today?\"",
  "• \"what did the AI do today?\" — your AI action history",
  "• \"list tickets in progress\" / \"tickets with high priority\"",
  "• \"show ticket TKT-DEMO-1001\" / \"tell me about ticket 1001\"",
  "• \"close ticket 1001 with note \\\"customer confirmed\\\"\"",
  "• \"close tickets 1003, 1004, 1014\" — multi-id bulk",
  "• \"close all open tickets for today\" — bulk by status + window",
  "• \"complete booking 1023 with note \\\"sales team will follow up\\\"\"",
  "• \"reschedule ORA-APT-DEMO-1006 to tomorrow 5pm\"",
  "• \"list recent leads\" / \"how many leads this week\"",
  "• \"show appointments today\" / \"this week\"",
  "• \"mark all bookings from this week as completed\" (asks to confirm)",
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
      case "bulk_close_tickets_by_ids":
        return executeBulkCloseTicketsByIds(db, input.userId, rec.args);
      case "bulk_close_tickets_by_status":
        return executeBulkCloseTicketsByStatus(db, input.userId, rec.args);
      case "complete_appointment":
        return executeCompleteAppointmentAction(db, input.userId, rec.args);
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
    case "list_tickets_by_status":
      return { response: await listTicketsByStatus(db, input.message) };
    case "list_tickets_by_priority":
      return { response: await listTicketsByPriority(db, input.message) };
    case "show_ticket":
      return { response: await showTicket(db, input.message) };
    case "show_appointment":
      return { response: await showAppointment(db, input.message) };
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
    case "bulk_close_tickets_by_ids":
      return proposeBulkCloseTicketsByIds(db, input.userId, input.message);
    case "bulk_close_tickets_by_status":
      return proposeBulkCloseTicketsByStatus(db, input.userId, input.message, window);
    case "complete_appointment":
      return proposeCompleteAppointment(db, input.userId, input.message);
    case "cancel_appointment":
      return proposeCancelAppointment(db, input.userId, input.message);
    case "reschedule_appointment":
      return proposeRescheduleAppointment(db, input.userId, input.message);
    case "change_ticket_status":
      return proposeChangeTicketStatus(db, input.userId, input.message);
    case "my_tickets":
      return { response: await reportMyTickets(db, input.userId, window) };
    case "my_top_priority":
      return { response: await reportMyTopPriority(db, input.userId) };
    case "my_appointments":
      return { response: await reportMyAppointments(db, input.userId, window) };
    case "my_ai_actions":
      return { response: await reportMyAiActions(db, input.userId, window) };
    default:
      return {
        response:
          "I didn't catch that. I can pull reports, list/show/close tickets (try \"list tickets in progress\" or \"close ticket 1001\"), and manage appointments. Type \"help\" for examples.",
      };
  }
}

// Re-export types for the API + UI layers
export { inArray };
