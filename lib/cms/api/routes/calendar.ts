import { Elysia } from "elysia";
import { and, gte, lte, isNotNull, or } from "drizzle-orm";
import { db } from "../../db";
import { identityGuard, requirePermission } from "../../rbac/middleware";
import { tickets, aiAppointments } from "../../schema";

// ── Types ────────────────────────────────────────────────────────────────────

export type CalendarEventType = "appointment" | "ticket";

export interface CalendarEvent {
  id: string;
  type: CalendarEventType;
  title: string;
  start: string; // ISO
  end: string | null; // ISO
  status: string;
  /** Sub-classification for color coding (e.g. ticket request type, appointment type). */
  category: string | null;
  refUrl: string;
  contactName: string | null;
  contactEmail: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseRange(query: Record<string, string | undefined>): {
  from: Date;
  to: Date;
} {
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const defaultTo = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const from = query.from ? new Date(query.from) : defaultFrom;
  const to = query.to ? new Date(query.to) : defaultTo;

  // Defensive — if parsing failed, fall back to defaults
  return {
    from: Number.isNaN(from.getTime()) ? defaultFrom : from,
    to: Number.isNaN(to.getTime()) ? defaultTo : to,
  };
}

/**
 * Combine an aiAppointments scheduledDate (YYYY-MM-DD) and scheduledTime (HH:mm)
 * into an ISO string. Defaults to 09:00 when time is missing.
 */
function combineDateAndTime(date: string, time: string | null): string {
  const safeTime = time && /^\d{2}:\d{2}/.test(time) ? time.slice(0, 5) : "09:00";
  // Treat as local time; the admin calendar renders in the panel's TZ.
  return new Date(`${date}T${safeTime}:00`).toISOString();
}

// ── Routes ───────────────────────────────────────────────────────────────────

export const calendarRoutes = new Elysia({ name: "calendar" })
  .use(identityGuard)
  .use(requirePermission("tickets:read"))

  // GET /calendar/events?from=ISO&to=ISO
  .get("/calendar/events", async ({ query }) => {
    const { from, to } = parseRange(query);

    // ── Tickets with scheduledStart in range ───────────────────────────────
    const ticketRows = await db
      .select({
        id: tickets.id,
        ticketNumber: tickets.ticketNumber,
        subject: tickets.subject,
        status: tickets.status,
        requestType: tickets.requestType,
        scheduledStart: tickets.scheduledStart,
        scheduledEnd: tickets.scheduledEnd,
        contactName: tickets.contactName,
        contactEmail: tickets.contactEmail,
      })
      .from(tickets)
      .where(
        and(
          isNotNull(tickets.scheduledStart),
          gte(tickets.scheduledStart, from),
          lte(tickets.scheduledStart, to)
        )
      );

    const ticketEvents: CalendarEvent[] = ticketRows.map((row) => ({
      id: `ticket:${row.id}`,
      type: "ticket",
      title: `${row.ticketNumber} — ${row.subject}`,
      start: row.scheduledStart!.toISOString(),
      end: row.scheduledEnd ? row.scheduledEnd.toISOString() : null,
      status: row.status,
      category: row.requestType,
      refUrl: `/ora-panel/tickets/${row.id}`,
      contactName: row.contactName,
      contactEmail: row.contactEmail,
    }));

    // ── AI appointments in range ───────────────────────────────────────────
    // We filter in JS for the date range because scheduledDate is a date string.
    const appointmentRows = await db
      .select({
        id: aiAppointments.id,
        referenceNumber: aiAppointments.referenceNumber,
        appointmentType: aiAppointments.appointmentType,
        scheduledDate: aiAppointments.scheduledDate,
        scheduledTime: aiAppointments.scheduledTime,
        status: aiAppointments.status,
        contactName: aiAppointments.contactName,
        contactEmail: aiAppointments.contactEmail,
      })
      .from(aiAppointments);

    const appointmentEvents: CalendarEvent[] = appointmentRows
      .map((row) => {
        const startIso = combineDateAndTime(
          row.scheduledDate,
          row.scheduledTime
        );
        return {
          id: `appointment:${row.id}`,
          type: "appointment" as const,
          title: `${row.referenceNumber} — ${row.appointmentType.replace(/_/g, " ")}`,
          start: startIso,
          end: null,
          status: row.status,
          category: row.appointmentType,
          refUrl: `/ora-panel/ai/appointments`,
          contactName: row.contactName,
          contactEmail: row.contactEmail,
        };
      })
      .filter((evt) => {
        const t = new Date(evt.start).getTime();
        return t >= from.getTime() && t < to.getTime();
      });

    const events = [...ticketEvents, ...appointmentEvents].sort((a, b) =>
      a.start.localeCompare(b.start)
    );

    return {
      data: events,
      range: { from: from.toISOString(), to: to.toISOString() },
      count: events.length,
    };
  });

// `or` is imported but only used conditionally; keep import to avoid lint nag if extended later.
void or;
