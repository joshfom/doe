/**
 * Migrated text-agent capabilities as unified Catalog_Entries (Agentic
 * Foundation S1, Design §Components #6 "Migrated text capabilities", §Components
 * #7 "Idempotency").
 *
 * These ten entries expose the capabilities the deterministic text agent
 * (`lib/cms/ai/agent.ts`) serves today — `create_lead`, `register_lead`,
 * `create_ticket`, `create_booking`, `cancel_appointment`,
 * `reschedule_appointment`, `request_otp`, `request_handover`, `navigate`, and
 * `provide_contact` (Requirement 8.1) — as `CatalogEntry` objects in the single
 * canonical Tool_Catalog (`./catalog.ts`).
 *
 * The one rule, preserved: **every handler reuses the existing audited service
 * rather than reimplementing the business rule** (Requirement 8.2). Bookings go
 * through `bookAppointment` (slot-conflict validation intact), cancel/reschedule
 * through `cancelAppointment`/`rescheduleAppointment` (lifecycle validation
 * intact — Requirement 8.5), tickets/leads through `createTicket`, OTP issuance
 * through the existing OTP machinery (`generateOtp`/`createOtpRecord`/
 * `sendOtpEmail` — Requirement 8.4), and handover through `initiateHandoff`.
 * No handler touches Drizzle to re-derive a rule a service already owns.
 *
 * Agent-triggered Salesforce / background side effects are **never written
 * inline**: they are enqueued through `enqueueOutbox`/`enqueueJob` with a
 * deterministic `jobKey` (e.g. `appt:{id}`), so a retried tool call yields at
 * most one external side effect (Requirements 12.1, 12.2; Design §Components #7).
 *
 * These entries are *defined* here; they are validated and assembled into the
 * runnable catalog by `loadCatalog` (see `loadTextCapabilities` below) and bound
 * to a Mastra agent + wired behind the Migration_Switch in later tasks. Each
 * mutation still flows through `dispatchTool` (Zod → RBAC → OTP → audit →
 * execute) when invoked — the handlers here are the "execute" step only.
 *
 * Design references: §Components #6 (Migrated text capabilities), §Components #7
 * (Idempotency). Requirements: 8.1, 8.2, 8.4, 8.5, 12.1, 12.2.
 */

import { z } from "zod";
import { and, eq, ilike, or } from "drizzle-orm";

import { aiConversations, pages } from "../../schema";
import { enqueueOutbox } from "../../outbox";
import { createTicket } from "../../tickets/service";
import { formatLeadReference } from "../../tickets/ticket-number";
import {
  bookAppointment,
  cancelAppointment,
  rescheduleAppointment,
} from "../actions";
import { generateOtp, createOtpRecord, maskEmail } from "../otp";
import { sendLeadEmail, sendOtpEmail } from "../email";
import { initiateHandoff } from "../handoff";
import {
  loadCatalog,
  type CatalogEntry,
  type CatalogLoadResult,
} from "./catalog";

// ── Agent identity & permissions ─────────────────────────────────────────────

/**
 * The RBAC identity and audit actor recorded for every text-capability dispatch
 * (Requirement 10.2). It is seeded as an RBAC role carrying exactly the
 * `text:tool:*` permissions below in a later wiring task; the dispatcher
 * resolves it through the RBAC engine.
 */
export const TEXT_AGENT_ACTOR = "agent:text-lead";

/** Prefix for per-tool RBAC permission strings, e.g. `text:tool:create_lead`. */
export const TEXT_TOOL_PERMISSION_PREFIX = "text:tool";

/** The RBAC permission string a given text capability requires (Req 2.2, 3.4). */
export function textToolPermission(name: string): string {
  return `${TEXT_TOOL_PERMISSION_PREFIX}:${name}`;
}

// ── Shared schema fragments ──────────────────────────────────────────────────

const languageSchema = z.enum(["en", "ar"]).default("en");
const emailSchema = z.string().trim().email();
const phoneSchema = z.string().trim().min(3);
/** Appointment reference as minted by `bookAppointment`, e.g. `ORA-APT-000042`. */
const appointmentRefSchema = z
  .string()
  .trim()
  .regex(/^ORA-APT-[A-Z0-9]{6}$/i, "Expected an ORA-APT-XXXXXX reference");
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");
const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected an HH:MM time");
const appointmentTypeSchema = z.enum([
  "site_visit",
  "consultation",
  "payment_discussion",
  "maintenance_request",
]);

/**
 * Keep per-entry input/output typing intact (the handler is checked against the
 * entry's Zod schemas) while collecting heterogeneous entries into one
 * `CatalogEntry[]` for {@link loadCatalog}.
 */
function entry<I, O>(e: CatalogEntry<I, O>): CatalogEntry {
  return e as unknown as CatalogEntry;
}

// ── create_lead ──────────────────────────────────────────────────────────────

const createLeadInput = z.object({
  contactName: z.string().trim().min(1),
  contactEmail: emailSchema,
  contactPhone: phoneSchema.optional(),
  projectInterest: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  language: languageSchema,
});
const createLeadOutput = z.object({
  ticketId: z.string(),
  ticketNumber: z.string(),
  leadReference: z.string(),
  emailSent: z.boolean(),
});

const createLeadEntry = entry({
  name: "create_lead",
  description:
    "Register a website visitor's own sales interest as a tracked lead and " +
    "email them an acknowledgement. Use when the visitor expresses interest " +
    "in buying/investing or asks for a brochure, price list, or floor plans.",
  inputSchema: createLeadInput,
  outputSchema: createLeadOutput,
  requiresOtp: false,
  permission: textToolPermission("create_lead"),
  auditActor: TEXT_AGENT_ACTOR,
  // Reuses the audited createTicket(requestType: "lead_inquiry") + sendLeadEmail,
  // exactly as the deterministic executeCreateLead does — no rule re-derived.
  handler: async (db, _ctx, input) => {
    const subject = input.projectInterest
      ? `Lead — ${input.contactName} (interest: ${input.projectInterest})`
      : `Lead — ${input.contactName}`;
    const description =
      input.notes?.trim() ||
      `Lead captured by ${TEXT_AGENT_ACTOR} via chat for ${input.contactName}.`;

    const { ticketId, ticketNumber } = await createTicket(db, {
      subject,
      description,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      priority: "medium",
      source: "api",
      createdBy: null,
      requestType: "lead_inquiry",
      requestData: {
        projectInterest: input.projectInterest,
        source: "chat",
        notes: input.notes?.slice(0, 500),
        locale: input.language,
        consentToContact: true,
      },
    });

    const leadReference = formatLeadReference(ticketNumber);

    // The lead acknowledgement email is best-effort: a delivery failure must
    // not undo the (audited) lead creation, matching the deterministic path.
    let emailSent = false;
    try {
      const result = await sendLeadEmail({
        recipientEmail: input.contactEmail,
        recipientName: input.contactName,
        leadReference,
        ticketNumber,
        projectInterest: input.projectInterest,
        notes: input.notes?.slice(0, 240),
        language: input.language,
      });
      emailSent = result.success;
    } catch {
      emailSent = false;
    }

    return { ticketId, ticketNumber, leadReference, emailSent };
  },
});

// ── register_lead (broker / staff registers a third party) ───────────────────

const registerLeadInput = z.object({
  clientName: z.string().trim().min(1),
  clientEmail: emailSchema,
  clientPhone: phoneSchema.optional(),
  projectInterest: z.string().trim().optional(),
  /** The broker/staff registering the client, recorded on the lead. */
  registeredBy: z.string().trim().optional(),
  registeredByEmail: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  language: languageSchema,
});
const registerLeadOutput = z.object({
  ticketId: z.string(),
  ticketNumber: z.string(),
  leadReference: z.string(),
});

const registerLeadEntry = entry({
  name: "register_lead",
  description:
    "Register a third-party client/lead on behalf of a broker or staff " +
    "member. Use when the requester is registering someone else (e.g. " +
    "'register my client'), not capturing their own interest.",
  inputSchema: registerLeadInput,
  outputSchema: registerLeadOutput,
  requiresOtp: false,
  permission: textToolPermission("register_lead"),
  auditActor: TEXT_AGENT_ACTOR,
  // Reuses the audited createTicket(requestType: "lead_inquiry"); broker
  // attribution is recorded in the description/notes (the lead_inquiry
  // requestData schema is strict), never by re-implementing lead creation.
  handler: async (db, _ctx, input) => {
    const broker = input.registeredBy?.trim() || "broker";
    const brokerEmail = input.registeredByEmail?.trim() || "(unknown)";
    const subject = input.projectInterest
      ? `Lead — ${input.clientName} (via ${broker}, interest: ${input.projectInterest})`
      : `Lead — ${input.clientName} (via ${broker})`;
    const description = `Registered on behalf of ${broker} <${brokerEmail}> via ${TEXT_AGENT_ACTOR}.

Client: ${input.clientName} <${input.clientEmail}>${
      input.clientPhone ? ` / ${input.clientPhone}` : ""
    }
Project interest: ${input.projectInterest ?? "(unspecified)"}
${input.notes?.trim() ? `\nNotes: ${input.notes.trim()}` : ""}`;

    const { ticketId, ticketNumber } = await createTicket(db, {
      subject,
      description,
      contactName: input.clientName,
      contactEmail: input.clientEmail,
      contactPhone: input.clientPhone,
      priority: "medium",
      source: "api",
      createdBy: null,
      requestType: "lead_inquiry",
      requestData: {
        projectInterest: input.projectInterest,
        source: "broker",
        notes: `Registered by ${broker} <${brokerEmail}>`.slice(0, 500),
        locale: input.language,
        consentToContact: true,
      },
    });

    return {
      ticketId,
      ticketNumber,
      leadReference: formatLeadReference(ticketNumber),
    };
  },
});

// ── create_ticket ─────────────────────────────────────────────────────────────

const createTicketInput = z.object({
  contactName: z.string().trim().min(1),
  contactEmail: emailSchema,
  contactPhone: phoneSchema.optional(),
  description: z.string().trim().min(1),
  subject: z.string().trim().optional(),
  requestType: z
    .enum([
      "general_inquiry",
      "noc",
      "move_in",
      "construction_material_delivery",
      "vendor_access",
      "maintenance_request",
      "brochure_request",
    ])
    .default("general_inquiry"),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
});
const createTicketOutput = z.object({
  ticketId: z.string(),
  ticketNumber: z.string(),
  requestType: z.string(),
});

const createTicketEntry = entry({
  name: "create_ticket",
  description:
    "Open a support ticket (move-in permit, NOC, construction material " +
    "delivery, general inquiry, etc.). Use when the visitor asks to raise/" +
    "open/submit a ticket or request.",
  inputSchema: createTicketInput,
  outputSchema: createTicketOutput,
  requiresOtp: false,
  permission: textToolPermission("create_ticket"),
  auditActor: TEXT_AGENT_ACTOR,
  // Reuses the audited createTicket service; request-type-specific rules
  // (approval routing, CRM sync) stay inside the service.
  handler: async (db, _ctx, input) => {
    const { ticketId, ticketNumber } = await createTicket(db, {
      subject: input.subject?.trim() || `Support request — ${input.contactName}`,
      description: input.description,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      priority: input.priority,
      source: "api",
      createdBy: null,
      requestType: input.requestType,
    });
    return { ticketId, ticketNumber, requestType: input.requestType };
  },
});

// ── create_booking (appointment) ──────────────────────────────────────────────

const createBookingInput = z.object({
  contactName: z.string().trim().min(1),
  contactEmail: emailSchema.optional(),
  contactPhone: phoneSchema.optional(),
  appointmentType: appointmentTypeSchema,
  scheduledDate: dateSchema,
  scheduledTime: timeSchema,
  notes: z.string().trim().optional(),
});
const createBookingOutput = z.object({
  appointmentId: z.string(),
  referenceNumber: z.string(),
  scheduledDate: z.string(),
  scheduledTime: z.string(),
  status: z.string(),
  contactName: z.string(),
});

const createBookingEntry = entry({
  name: "create_booking",
  description:
    "Book an appointment (site visit, consultation, payment discussion, or " +
    "maintenance visit) at a specific date and time. Slot-conflict and " +
    "business-hours validation are enforced by the booking service.",
  inputSchema: createBookingInput,
  outputSchema: createBookingOutput,
  requiresOtp: false,
  permission: textToolPermission("create_booking"),
  auditActor: TEXT_AGENT_ACTOR,
  // Reuses the audited bookAppointment (slot-conflict validation intact — Req
  // 8.5). The Salesforce-bound Event sync is ENQUEUED idempotently to the
  // outbox keyed `appt:{id}` (Req 12.1) — never written inline.
  handler: async (db, ctx, input) => {
    const appointment = await bookAppointment(db, {
      conversationId: ctx.conversationId,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      appointmentType: input.appointmentType,
      scheduledDate: input.scheduledDate,
      scheduledTime: input.scheduledTime,
      notes: input.notes,
    });

    // Idempotent by appointment id: a retried booking never doubles the synced
    // Salesforce Event (Design §Components #7; Requirement 12.1).
    await enqueueOutbox(
      db,
      "event",
      {
        appointmentId: appointment.id,
        when: `${input.scheduledDate}T${input.scheduledTime}`,
        subject: `Appointment — ${input.appointmentType}`,
        description: `Chat-booked ${input.appointmentType} for ${input.contactName}`,
        contactName: appointment.contactName,
      },
      `appt:${appointment.id}`
    );

    return {
      appointmentId: appointment.id,
      referenceNumber: appointment.referenceNumber,
      scheduledDate: appointment.scheduledDate,
      scheduledTime: appointment.scheduledTime,
      status: appointment.status,
      contactName: appointment.contactName,
    };
  },
});

// ── cancel_appointment ────────────────────────────────────────────────────────

const cancelAppointmentInput = z.object({
  referenceNumber: appointmentRefSchema,
  /** Optional override; the dispatcher normally threads `ctx.conversationId`. */
  conversationId: z.string().optional(),
});
const cancelAppointmentOutput = z.object({
  referenceNumber: z.string(),
  cancelled: z.literal(true),
});

const cancelAppointmentEntry = entry({
  name: "cancel_appointment",
  description:
    "Cancel an existing appointment by its ORA-APT reference. Lifecycle " +
    "validation (e.g. already-cancelled) is enforced by the service.",
  inputSchema: cancelAppointmentInput,
  outputSchema: cancelAppointmentOutput,
  requiresOtp: false,
  permission: textToolPermission("cancel_appointment"),
  auditActor: TEXT_AGENT_ACTOR,
  // Reuses the audited cancelAppointment (lifecycle validation intact — Req 8.5).
  handler: async (db, ctx, input) => {
    const conversationId = ctx.conversationId ?? input.conversationId ?? "";
    await cancelAppointment(db, input.referenceNumber, conversationId);
    return { referenceNumber: input.referenceNumber, cancelled: true as const };
  },
});

// ── reschedule_appointment ────────────────────────────────────────────────────

const rescheduleAppointmentInput = z.object({
  referenceNumber: appointmentRefSchema,
  newDate: dateSchema,
  newTime: timeSchema,
});
const rescheduleAppointmentOutput = z.object({
  referenceNumber: z.string(),
  scheduledDate: z.string(),
  scheduledTime: z.string(),
  status: z.string(),
  contactName: z.string(),
});

const rescheduleAppointmentEntry = entry({
  name: "reschedule_appointment",
  description:
    "Move an existing appointment (by its ORA-APT reference) to a new date " +
    "and time. Slot-conflict and lifecycle validation are enforced by the " +
    "service.",
  inputSchema: rescheduleAppointmentInput,
  outputSchema: rescheduleAppointmentOutput,
  requiresOtp: false,
  permission: textToolPermission("reschedule_appointment"),
  auditActor: TEXT_AGENT_ACTOR,
  // Reuses the audited rescheduleAppointment (slot-conflict + lifecycle intact).
  handler: async (db, _ctx, input) => {
    const updated = await rescheduleAppointment(
      db,
      input.referenceNumber,
      input.newDate,
      input.newTime
    );
    return {
      referenceNumber: updated.referenceNumber,
      scheduledDate: updated.scheduledDate,
      scheduledTime: updated.scheduledTime,
      status: updated.status,
      contactName: updated.contactName,
    };
  },
});

// ── request_otp ────────────────────────────────────────────────────────────────

const requestOtpInput = z.object({
  /** The registered account email the code is sent to. */
  email: emailSchema,
  recipientName: z.string().trim().optional(),
  language: languageSchema,
  /** Optional override; the dispatcher normally threads `ctx.conversationId`. */
  conversationId: z.string().optional(),
});
const requestOtpOutput = z.object({
  sent: z.boolean(),
  maskedEmail: z.string(),
  error: z.string().optional(),
});

const requestOtpEntry = entry({
  name: "request_otp",
  description:
    "Issue a 6-digit verification code to a recognised account's registered " +
    "email so the visitor can verify their identity. Use when the visitor " +
    "asks to be sent a code / verified.",
  inputSchema: requestOtpInput,
  outputSchema: requestOtpOutput,
  requiresOtp: false,
  permission: textToolPermission("request_otp"),
  auditActor: TEXT_AGENT_ACTOR,
  // Reuses the existing OTP machinery (generateOtp + createOtpRecord +
  // sendOtpEmail) — the same primitives the deterministic path and the OTP gate
  // use (Requirement 8.4). It never mints or stores codes by hand.
  handler: async (db, ctx, input) => {
    const conversationId = ctx.conversationId ?? input.conversationId;
    if (!conversationId) {
      throw new Error("request_otp requires a conversation id");
    }

    const otp = generateOtp();
    await createOtpRecord(db, conversationId, input.email, otp.hash, otp.expiresAt);

    const result = await sendOtpEmail({
      recipientEmail: input.email,
      otpCode: otp.code,
      recipientName: input.recipientName ?? "",
      language: input.language,
    });

    return {
      sent: result.success,
      maskedEmail: maskEmail(input.email),
      error: result.success ? undefined : result.error,
    };
  },
});

// ── request_handover ────────────────────────────────────────────────────────

const requestHandoverInput = z.object({
  reason: z.string().trim().optional(),
  /** Optional override; the dispatcher normally threads `ctx.conversationId`. */
  conversationId: z.string().optional(),
});
const requestHandoverOutput = z.object({
  handedOff: z.literal(true),
  conversationId: z.string(),
});

const requestHandoverEntry = entry({
  name: "request_handover",
  description:
    "Transfer the conversation to a human agent. Use when the visitor asks " +
    "to talk to a person / live agent or to be transferred.",
  inputSchema: requestHandoverInput,
  outputSchema: requestHandoverOutput,
  requiresOtp: false,
  permission: textToolPermission("request_handover"),
  auditActor: TEXT_AGENT_ACTOR,
  // Reuses the existing initiateHandoff service (status update + summary +
  // system message + analytics) — no handover logic re-implemented.
  handler: async (db, ctx, input) => {
    const conversationId = ctx.conversationId ?? input.conversationId;
    if (!conversationId) {
      throw new Error("request_handover requires a conversation id");
    }
    await initiateHandoff(
      db,
      conversationId,
      input.reason?.trim() || "Visitor requested a human agent"
    );
    return { handedOff: true as const, conversationId };
  },
});

// ── navigate (read-only page lookup) ─────────────────────────────────────────

const navigateInput = z.object({
  query: z.string().trim().min(1),
  language: languageSchema,
});
const navigateOutput = z.object({
  found: z.boolean(),
  url: z.string().nullable(),
  label: z.string().nullable(),
});

const navigateEntry = entry({
  name: "navigate",
  description:
    "Resolve a published CMS page (contact, about, communities, projects, " +
    "blog, etc.) to a locale-prefixed URL the visitor can open. Non-mutating.",
  inputSchema: navigateInput,
  outputSchema: navigateOutput,
  requiresOtp: false,
  permission: textToolPermission("navigate"),
  auditActor: TEXT_AGENT_ACTOR,
  // Non-mutating read against published pages — no business rule, no audit
  // side effect beyond the dispatcher's own audit row.
  handler: async (db, _ctx, input) => {
    const pattern = `%${input.query}%`;
    const rows = await db
      .select({ title: pages.title, slug: pages.slug })
      .from(pages)
      .where(
        and(
          eq(pages.locale, input.language),
          eq(pages.status, "published"),
          or(ilike(pages.title, pattern), ilike(pages.slug, pattern))
        )
      )
      .limit(1);

    if (rows.length === 0) {
      return { found: false, url: null, label: null };
    }

    const localePrefix = input.language === "ar" ? "/ar" : "/en";
    const url = `${localePrefix}/${rows[0].slug.replace(/^\//, "")}`;
    return { found: true, url, label: rows[0].title };
  },
});

// ── provide_contact (conversation contact persistence) ───────────────────────

const provideContactInput = z
  .object({
    name: z.string().trim().optional(),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    /** Optional override; the dispatcher normally threads `ctx.conversationId`. */
    conversationId: z.string().optional(),
  })
  .refine((v) => v.name || v.email || v.phone, {
    message: "At least one of name, email, or phone is required",
  });
const provideContactOutput = z.object({
  persisted: z.boolean(),
});

const provideContactEntry = entry({
  name: "provide_contact",
  description:
    "Persist contact details (name / email / phone) the visitor shared onto " +
    "the conversation so later turns and follow-ups have them. Non-mutating " +
    "of any business entity.",
  inputSchema: provideContactInput,
  outputSchema: provideContactOutput,
  requiresOtp: false,
  permission: textToolPermission("provide_contact"),
  auditActor: TEXT_AGENT_ACTOR,
  // Mirrors the deterministic path's conversation-contact persistence: it only
  // updates the aiConversations participant fields — no business rule re-derived.
  handler: async (db, ctx, input) => {
    const conversationId = ctx.conversationId ?? input.conversationId;
    if (!conversationId) {
      throw new Error("provide_contact requires a conversation id");
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name) updates.participantName = input.name;
    if (input.email) updates.participantEmail = input.email;
    if (input.phone) updates.participantPhone = input.phone;

    if (Object.keys(updates).length === 1) {
      return { persisted: false };
    }

    await db
      .update(aiConversations)
      .set(updates)
      .where(eq(aiConversations.id, conversationId));

    return { persisted: true };
  },
});

// ── The text-capability catalog ──────────────────────────────────────────────

/**
 * The ten migrated text-agent capabilities (Requirement 8.1), in the order the
 * deterministic agent detects them. Consumed by {@link loadTextCapabilities}
 * and, in later tasks, merged with the voice and admin entries to form the
 * single canonical Tool_Catalog.
 */
export const textCapabilityEntries: CatalogEntry[] = [
  createLeadEntry,
  registerLeadEntry,
  createTicketEntry,
  createBookingEntry,
  cancelAppointmentEntry,
  rescheduleAppointmentEntry,
  requestOtpEntry,
  requestHandoverEntry,
  navigateEntry,
  provideContactEntry,
];

/** The names of the text capabilities exposed by this module (Requirement 8.1). */
export const TEXT_CAPABILITY_NAMES = textCapabilityEntries.map((e) => e.name);

/**
 * Validate and assemble just the text capabilities through {@link loadCatalog}
 * (Requirement 8.1). Surfaces `incomplete_entry`/`duplicate_name` errors the
 * same way the full catalog load does, so this module can be self-checked in
 * isolation.
 */
export function loadTextCapabilities(): CatalogLoadResult {
  return loadCatalog(textCapabilityEntries);
}
