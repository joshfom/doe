import { Elysia } from "elysia";
import { z } from "zod";
import { db } from "../../db";
import {
  identityGuard,
  requirePermission,
} from "../../rbac/middleware";
import { aiAppointments } from "../../schema";
import { eq, and, sql, count, desc } from "drizzle-orm";
import {
  bookAppointment,
  cancelAppointment,
  rescheduleAppointment,
} from "../../ai/actions";

// ── Request validation schemas ───────────────────────────────────────────────

const createAppointmentSchema = z.object({
  contactName: z.string().min(1, "Contact name is required"),
  contactEmail: z.string().email("Invalid email").nullable().optional(),
  contactPhone: z.string().nullable().optional(),
  appointmentType: z.enum([
    "site_visit",
    "consultation",
    "payment_discussion",
    "maintenance_request",
  ]),
  scheduledDate: z.string().min(1, "Scheduled date is required"),
  scheduledTime: z.string().min(1, "Scheduled time is required"),
  notes: z.string().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  tenantId: z.string().uuid().nullable().optional(),
});

const rescheduleSchema = z.object({
  newDate: z.string().min(1, "New date is required"),
  newTime: z.string().min(1, "New time is required"),
});

// ── Appointments routes (auth required) ──────────────────────────────────────

export const aiAppointmentsRoutes = new Elysia({ name: "ai-appointments" })
  .use(identityGuard)
  .use(requirePermission("ai:appointments:manage"))

  // GET /ai/appointments — list appointments with filtering
  .get("/ai/appointments", async ({ query }) => {
    const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(query.limit ?? "20", 10) || 20)
    );
    const offset = (page - 1) * limit;

    const conditions = [];

    if (query.status) {
      conditions.push(
        eq(
          aiAppointments.status,
          query.status as "confirmed" | "cancelled" | "rescheduled" | "completed"
        )
      );
    }

    if (query.type) {
      conditions.push(
        eq(
          aiAppointments.appointmentType,
          query.type as
            | "site_visit"
            | "consultation"
            | "payment_discussion"
            | "maintenance_request"
        )
      );
    }

    if (query.dateFrom) {
      conditions.push(
        sql`${aiAppointments.scheduledDate} >= ${query.dateFrom}`
      );
    }

    if (query.dateTo) {
      conditions.push(
        sql`${aiAppointments.scheduledDate} <= ${query.dateTo}`
      );
    }

    if (query.search) {
      const term = `%${query.search}%`;
      conditions.push(
        sql`(
          ${aiAppointments.contactName} ILIKE ${term}
          OR ${aiAppointments.referenceNumber} ILIKE ${term}
          OR ${aiAppointments.contactEmail} ILIKE ${term}
          OR ${aiAppointments.contactPhone} ILIKE ${term}
        )`
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db
      .select({ total: count() })
      .from(aiAppointments)
      .where(whereClause);

    const total = totalResult?.total ?? 0;

    const appointments = await db
      .select()
      .from(aiAppointments)
      .where(whereClause)
      .orderBy(desc(aiAppointments.scheduledDate))
      .limit(limit)
      .offset(offset);

    return {
      data: appointments,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  })

  // POST /ai/appointments — create appointment (admin-initiated)
  .post("/ai/appointments", async ({ body, set }) => {
    const parsed = createAppointmentSchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path.join(".");
        fieldErrors[field] = issue.message;
      }
      return { error: "Validation failed", details: fieldErrors };
    }

    const data = parsed.data;

    try {
      const result = await bookAppointment(db, {
        contactName: data.contactName,
        contactEmail: data.contactEmail ?? undefined,
        contactPhone: data.contactPhone ?? undefined,
        appointmentType: data.appointmentType,
        scheduledDate: data.scheduledDate,
        scheduledTime: data.scheduledTime,
        notes: data.notes ?? undefined,
        clientId: data.clientId ?? undefined,
        tenantId: data.tenantId ?? undefined,
      });

      set.status = 201;
      return { data: result };
    } catch (error) {
      set.status = 409;
      return {
        error: error instanceof Error ? error.message : "Failed to book appointment",
      };
    }
  })

  // PATCH /ai/appointments/:id/cancel — cancel appointment
  .patch("/ai/appointments/:id/cancel", async ({ params, set }) => {
    const { id } = params;

    // Look up the appointment to get its reference number
    const [appointment] = await db
      .select({
        referenceNumber: aiAppointments.referenceNumber,
      })
      .from(aiAppointments)
      .where(eq(aiAppointments.id, id))
      .limit(1);

    if (!appointment) {
      set.status = 404;
      return { error: "Appointment not found" };
    }

    try {
      await cancelAppointment(db, appointment.referenceNumber, "admin");
      return { data: { success: true } };
    } catch (error) {
      set.status = 400;
      return {
        error: error instanceof Error ? error.message : "Failed to cancel appointment",
      };
    }
  })

  // PATCH /ai/appointments/:id/reschedule — reschedule appointment
  .patch("/ai/appointments/:id/reschedule", async ({ params, body, set }) => {
    const { id } = params;

    const parsed = rescheduleSchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path.join(".");
        fieldErrors[field] = issue.message;
      }
      return { error: "Validation failed", details: fieldErrors };
    }

    // Look up the appointment to get its reference number
    const [appointment] = await db
      .select({
        referenceNumber: aiAppointments.referenceNumber,
      })
      .from(aiAppointments)
      .where(eq(aiAppointments.id, id))
      .limit(1);

    if (!appointment) {
      set.status = 404;
      return { error: "Appointment not found" };
    }

    try {
      const result = await rescheduleAppointment(
        db,
        appointment.referenceNumber,
        parsed.data.newDate,
        parsed.data.newTime
      );
      return { data: result };
    } catch (error) {
      set.status = 409;
      return {
        error: error instanceof Error
          ? error.message
          : "Failed to reschedule appointment",
      };
    }
  });

export default aiAppointmentsRoutes;
