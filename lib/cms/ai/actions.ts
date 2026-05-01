import { eq, and, sql, count } from "drizzle-orm";
import type { Database } from "../db";
import { aiAppointments, aiClients, aiTenants, aiUnits } from "../schema";
import { logAudit } from "../audit";
import type { IdentityResult, UnitRecord } from "./identity";
import type { AppointmentType, AppointmentStatus } from "../types";

// ── Types ────────────────────────────────────────────────────────────────────

export interface BookAppointmentInput {
  conversationId?: string;
  clientId?: string;
  tenantId?: string;
  contactName: string;
  contactEmail?: string;
  contactPhone?: string;
  appointmentType: AppointmentType;
  scheduledDate: string; // YYYY-MM-DD
  scheduledTime: string; // HH:MM
  notes?: string;
}

export interface AppointmentResult {
  id: string;
  referenceNumber: string;
  appointmentType: AppointmentType;
  scheduledDate: string;
  scheduledTime: string;
  status: AppointmentStatus;
  contactName: string;
}

export interface TimeSlot {
  date: string;
  time: string;
}

export interface AccountSummary {
  type: "client" | "tenant" | "visitor";
  clientId?: string;
  tenantId?: string;
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  units: UnitRecord[];
  leaseInfo?: {
    unitId: string | null;
    leaseStartDate: string | null;
    leaseEndDate: string | null;
    rentAmount: number | null;
    paymentFrequency: string | null;
  };
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Business hours: 1-hour slots from 09:00 to 17:00 (last slot starts at 16:00). */
const BUSINESS_HOURS_START = 9;
const BUSINESS_HOURS_END = 17;

const ALL_TIME_SLOTS: string[] = [];
for (let h = BUSINESS_HOURS_START; h < BUSINESS_HOURS_END; h++) {
  ALL_TIME_SLOTS.push(`${String(h).padStart(2, "0")}:00`);
}

// System user ID for audit logging from AI actions
const AI_SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generate the next reference number in the format ORA-APT-XXXXXX.
 * Uses a simple count of existing appointments + 1.
 */
async function generateReferenceNumber(db: Database): Promise<string> {
  const [result] = await db
    .select({ total: count() })
    .from(aiAppointments);

  const seq = (result?.total ?? 0) + 1;
  return `ORA-APT-${String(seq).padStart(6, "0")}`;
}

/**
 * Check if a time slot is already booked on the given date.
 * A conflict exists when another confirmed/rescheduled appointment occupies the same date+time.
 */
async function hasConflict(
  db: Database,
  date: string,
  time: string,
  excludeId?: string
): Promise<boolean> {
  const conditions = [
    eq(aiAppointments.scheduledDate, date),
    eq(aiAppointments.scheduledTime, time),
    sql`${aiAppointments.status} IN ('confirmed', 'rescheduled')`,
  ];

  if (excludeId) {
    conditions.push(sql`${aiAppointments.id} != ${excludeId}`);
  }

  const [result] = await db
    .select({ total: count() })
    .from(aiAppointments)
    .where(and(...conditions));

  return (result?.total ?? 0) > 0;
}

/**
 * Get booked time slots for a given date (only confirmed/rescheduled).
 */
async function getBookedSlots(db: Database, date: string): Promise<string[]> {
  const rows = await db
    .select({ time: aiAppointments.scheduledTime })
    .from(aiAppointments)
    .where(
      and(
        eq(aiAppointments.scheduledDate, date),
        sql`${aiAppointments.status} IN ('confirmed', 'rescheduled')`
      )
    );

  return rows.map((r) => r.time);
}

// ── bookAppointment ──────────────────────────────────────────────────────────

/**
 * Book a new appointment. Validates required fields, checks for time slot
 * conflicts, creates the appointment record, and logs to audit.
 */
export async function bookAppointment(
  db: Database,
  input: BookAppointmentInput
): Promise<AppointmentResult> {
  // Validate required fields
  if (!input.contactName?.trim()) {
    throw new Error("Contact name is required");
  }
  if (!input.scheduledDate?.trim()) {
    throw new Error("Scheduled date is required");
  }
  if (!input.scheduledTime?.trim()) {
    throw new Error("Scheduled time is required");
  }
  if (!input.appointmentType?.trim()) {
    throw new Error("Appointment type is required");
  }

  // Check for time slot conflict
  const conflict = await hasConflict(db, input.scheduledDate, input.scheduledTime);
  if (conflict) {
    throw new Error(
      `Time slot ${input.scheduledDate} ${input.scheduledTime} is already booked`
    );
  }

  // Generate reference number
  const referenceNumber = await generateReferenceNumber(db);

  // Create appointment record
  const [appointment] = await db
    .insert(aiAppointments)
    .values({
      referenceNumber,
      conversationId: input.conversationId ?? null,
      clientId: input.clientId ?? null,
      tenantId: input.tenantId ?? null,
      contactName: input.contactName,
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
      appointmentType: input.appointmentType,
      scheduledDate: input.scheduledDate,
      scheduledTime: input.scheduledTime,
      status: "confirmed",
      notes: input.notes ?? null,
    })
    .returning({
      id: aiAppointments.id,
      referenceNumber: aiAppointments.referenceNumber,
      appointmentType: aiAppointments.appointmentType,
      scheduledDate: aiAppointments.scheduledDate,
      scheduledTime: aiAppointments.scheduledTime,
      status: aiAppointments.status,
      contactName: aiAppointments.contactName,
    });

  // Log to audit
  await logAudit(db, {
    userId: AI_SYSTEM_USER_ID,
    action: "ai_appointment_create",
    entityType: "ai_appointment",
    entityId: appointment.id,
    summary: `AI booked appointment ${referenceNumber} for ${input.contactName} on ${input.scheduledDate} at ${input.scheduledTime}`,
  });

  return appointment as AppointmentResult;
}

// ── cancelAppointment ────────────────────────────────────────────────────────

/**
 * Cancel an existing appointment by reference number.
 * Updates the status to "cancelled" and logs to audit.
 */
export async function cancelAppointment(
  db: Database,
  referenceNumber: string,
  conversationId: string
): Promise<void> {
  const [existing] = await db
    .select({ id: aiAppointments.id, status: aiAppointments.status })
    .from(aiAppointments)
    .where(eq(aiAppointments.referenceNumber, referenceNumber))
    .limit(1);

  if (!existing) {
    throw new Error(`Appointment ${referenceNumber} not found`);
  }

  if (existing.status === "cancelled") {
    throw new Error(`Appointment ${referenceNumber} is already cancelled`);
  }

  await db
    .update(aiAppointments)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(aiAppointments.referenceNumber, referenceNumber));

  await logAudit(db, {
    userId: AI_SYSTEM_USER_ID,
    action: "ai_appointment_cancel",
    entityType: "ai_appointment",
    entityId: existing.id,
    summary: `AI cancelled appointment ${referenceNumber} via conversation ${conversationId}`,
  });
}

// ── rescheduleAppointment ────────────────────────────────────────────────────

/**
 * Reschedule an existing appointment to a new date/time.
 * Checks the new slot availability, updates the appointment, and logs to audit.
 */
export async function rescheduleAppointment(
  db: Database,
  referenceNumber: string,
  newDate: string,
  newTime: string
): Promise<AppointmentResult> {
  const [existing] = await db
    .select({
      id: aiAppointments.id,
      status: aiAppointments.status,
      contactName: aiAppointments.contactName,
    })
    .from(aiAppointments)
    .where(eq(aiAppointments.referenceNumber, referenceNumber))
    .limit(1);

  if (!existing) {
    throw new Error(`Appointment ${referenceNumber} not found`);
  }

  if (existing.status === "cancelled") {
    throw new Error(`Cannot reschedule a cancelled appointment`);
  }

  // Check new slot availability (exclude current appointment from conflict check)
  const conflict = await hasConflict(db, newDate, newTime, existing.id);
  if (conflict) {
    throw new Error(
      `Time slot ${newDate} ${newTime} is already booked`
    );
  }

  const [updated] = await db
    .update(aiAppointments)
    .set({
      scheduledDate: newDate,
      scheduledTime: newTime,
      status: "rescheduled",
      updatedAt: new Date(),
    })
    .where(eq(aiAppointments.referenceNumber, referenceNumber))
    .returning({
      id: aiAppointments.id,
      referenceNumber: aiAppointments.referenceNumber,
      appointmentType: aiAppointments.appointmentType,
      scheduledDate: aiAppointments.scheduledDate,
      scheduledTime: aiAppointments.scheduledTime,
      status: aiAppointments.status,
      contactName: aiAppointments.contactName,
    });

  await logAudit(db, {
    userId: AI_SYSTEM_USER_ID,
    action: "ai_appointment_create",
    entityType: "ai_appointment",
    entityId: existing.id,
    summary: `AI rescheduled appointment ${referenceNumber} to ${newDate} at ${newTime}`,
  });

  return updated as AppointmentResult;
}

// ── suggestAlternativeSlots ──────────────────────────────────────────────────

/**
 * Find the nearest available time slots for a given date and appointment type.
 * Returns up to `count` available slots (default 3), starting from the
 * requested date and expanding to subsequent days if needed.
 */
export async function suggestAlternativeSlots(
  db: Database,
  date: string,
  _appointmentType: string,
  slotCount: number = 3
): Promise<TimeSlot[]> {
  const available: TimeSlot[] = [];
  let currentDate = new Date(date + "T00:00:00");

  // Search up to 14 days ahead to find enough slots
  const maxDaysToSearch = 14;

  for (let dayOffset = 0; dayOffset < maxDaysToSearch && available.length < slotCount; dayOffset++) {
    const dateStr = currentDate.toISOString().split("T")[0];
    const bookedSlots = await getBookedSlots(db, dateStr);
    const bookedSet = new Set(bookedSlots);

    for (const slot of ALL_TIME_SLOTS) {
      if (!bookedSet.has(slot) && available.length < slotCount) {
        available.push({ date: dateStr, time: slot });
      }
    }

    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return available;
}

// ── lookupClientAccount ──────────────────────────────────────────────────────

/**
 * Retrieve client or tenant records with associated units based on the
 * resolved identity.
 */
export async function lookupClientAccount(
  db: Database,
  identityResult: IdentityResult
): Promise<AccountSummary> {
  if (identityResult.type === "visitor") {
    return {
      type: "visitor",
      units: identityResult.units,
    };
  }

  if (identityResult.type === "client" && identityResult.clientId) {
    const [client] = await db
      .select({
        id: aiClients.id,
        firstName: aiClients.firstName,
        lastName: aiClients.lastName,
        email: aiClients.email,
        phone: aiClients.phone,
      })
      .from(aiClients)
      .where(eq(aiClients.id, identityResult.clientId))
      .limit(1);

    if (!client) {
      return { type: "visitor", units: [] };
    }

    // Fetch associated units
    const units = await db
      .select({
        id: aiUnits.id,
        projectName: aiUnits.projectName,
        unitNumber: aiUnits.unitNumber,
        unitType: aiUnits.unitType,
        floorNumber: aiUnits.floorNumber,
        areaSqm: aiUnits.areaSqm,
        status: aiUnits.status,
        constructionProgress: aiUnits.constructionProgress,
        estimatedHandoverDate: aiUnits.estimatedHandoverDate,
      })
      .from(aiUnits)
      .where(eq(aiUnits.clientId, client.id));

    return {
      type: "client",
      clientId: client.id,
      firstName: client.firstName,
      lastName: client.lastName,
      email: client.email,
      phone: client.phone,
      units,
    };
  }

  if (identityResult.type === "tenant" && identityResult.tenantId) {
    const [tenant] = await db
      .select({
        id: aiTenants.id,
        firstName: aiTenants.firstName,
        lastName: aiTenants.lastName,
        email: aiTenants.email,
        phone: aiTenants.phone,
        unitId: aiTenants.unitId,
        leaseStartDate: aiTenants.leaseStartDate,
        leaseEndDate: aiTenants.leaseEndDate,
        rentAmount: aiTenants.rentAmount,
        paymentFrequency: aiTenants.paymentFrequency,
      })
      .from(aiTenants)
      .where(eq(aiTenants.id, identityResult.tenantId))
      .limit(1);

    if (!tenant) {
      return { type: "visitor", units: [] };
    }

    // Fetch associated units
    const units = await db
      .select({
        id: aiUnits.id,
        projectName: aiUnits.projectName,
        unitNumber: aiUnits.unitNumber,
        unitType: aiUnits.unitType,
        floorNumber: aiUnits.floorNumber,
        areaSqm: aiUnits.areaSqm,
        status: aiUnits.status,
        constructionProgress: aiUnits.constructionProgress,
        estimatedHandoverDate: aiUnits.estimatedHandoverDate,
      })
      .from(aiUnits)
      .where(eq(aiUnits.tenantId, tenant.id));

    return {
      type: "tenant",
      tenantId: tenant.id,
      firstName: tenant.firstName,
      lastName: tenant.lastName,
      email: tenant.email,
      phone: tenant.phone,
      units,
      leaseInfo: {
        unitId: tenant.unitId,
        leaseStartDate: tenant.leaseStartDate,
        leaseEndDate: tenant.leaseEndDate,
        rentAmount: tenant.rentAmount,
        paymentFrequency: tenant.paymentFrequency,
      },
    };
  }

  return { type: "visitor", units: [] };
}
