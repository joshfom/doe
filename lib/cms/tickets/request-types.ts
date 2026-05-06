import { z } from "zod";
import type { TicketRequestType } from "../types";

/**
 * Per–request-type validation schemas for `tickets.requestData`.
 *
 * Each request type defines the structured operational fields the
 * Ora Panel and Ora AI need to action the request — independent of
 * the shared ticket lifecycle (status, assignee, audit, CRM sync).
 */

// ── Shared sub-schemas ──────────────────────────────────────────────────────

const isoDateString = z
  .string()
  .trim()
  .min(1)
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "Invalid date" });

const partySchema = z.object({
  name: z.string().trim().min(1),
  phone: z.string().trim().optional(),
  email: z.string().trim().email().optional(),
  emiratesId: z.string().trim().optional(),
  company: z.string().trim().optional(),
});

const vehicleSchema = z.object({
  plateNumber: z.string().trim().min(1),
  emirate: z.string().trim().optional(),
  make: z.string().trim().optional(),
  model: z.string().trim().optional(),
  color: z.string().trim().optional(),
});

// ── Per request type ────────────────────────────────────────────────────────

export const generalInquirySchema = z
  .object({
    notes: z.string().trim().optional(),
  })
  .strict();

export const nocRequestSchema = z
  .object({
    nocType: z.enum([
      "fit_out",
      "renovation",
      "modification",
      "utility_connection",
      "other",
    ]),
    workDescription: z.string().trim().min(1),
    contractor: partySchema.optional(),
    plannedStartDate: isoDateString,
    plannedEndDate: isoDateString,
    estimatedCost: z.number().nonnegative().optional(),
    attachments: z.array(z.string().uuid()).default([]),
  })
  .strict();

export const moveInRequestSchema = z
  .object({
    direction: z.enum(["in", "out"]).default("in"),
    moveDate: isoDateString,
    moveWindow: z
      .object({ start: z.string(), end: z.string() })
      .optional(),
    moverCompany: partySchema.optional(),
    truckPlates: z.array(z.string().trim()).default([]),
    crewSize: z.number().int().positive().optional(),
    accessRoute: z.string().trim().optional(),
    items: z.string().trim().optional(),
  })
  .strict();

export const gatePassSchema = z
  .object({
    passType: z.enum(["visitor", "delivery", "contractor", "vendor"]),
    visitor: partySchema,
    vehicle: vehicleSchema.optional(),
    accompanyingPersons: z.number().int().nonnegative().default(0),
    purpose: z.string().trim().min(1),
    validFrom: isoDateString,
    validUntil: isoDateString,
    multipleEntries: z.boolean().default(false),
  })
  .strict();

export const technicianVisitSchema = z
  .object({
    discipline: z.enum([
      "ac",
      "plumbing",
      "electrical",
      "carpentry",
      "appliance",
      "pest_control",
      "general",
      "other",
    ]),
    issueSummary: z.string().trim().min(1),
    preferredWindow: z
      .object({ start: isoDateString, end: isoDateString })
      .optional(),
    accessInstructions: z.string().trim().optional(),
    photos: z.array(z.string().uuid()).default([]),
  })
  .strict();

export const constructionMaterialDeliverySchema = z
  .object({
    vendor: partySchema,
    materials: z
      .array(
        z.object({
          name: z.string().trim().min(1),
          quantity: z.number().positive().optional(),
          unit: z.string().trim().optional(),
        })
      )
      .min(1),
    deliveryDate: isoDateString,
    deliveryWindow: z
      .object({ start: z.string(), end: z.string() })
      .optional(),
    vehicle: vehicleSchema.optional(),
    requiresLift: z.boolean().default(false),
    notes: z.string().trim().optional(),
  })
  .strict();

export const vendorAccessSchema = z
  .object({
    vendor: partySchema,
    purpose: z.string().trim().min(1),
    crew: z.array(partySchema).default([]),
    vehicles: z.array(vehicleSchema).default([]),
    accessFrom: isoDateString,
    accessUntil: isoDateString,
    insuranceCertificateId: z.string().uuid().optional(),
  })
  .strict();

export const maintenanceRequestSchema = z
  .object({
    area: z.enum([
      "kitchen",
      "bathroom",
      "bedroom",
      "living_room",
      "balcony",
      "common_area",
      "exterior",
      "other",
    ]),
    severity: z.enum(["cosmetic", "minor", "major", "emergency"]),
    description: z.string().trim().min(1),
    photos: z.array(z.string().uuid()).default([]),
    underWarranty: z.boolean().optional(),
  })
  .strict();

// ── Off-plan / pre-handover request types ──────────────────────────
//
// Bayn is still under construction — these flows let Ora AI act as a digital
// employee for sales, project ops, HSE, and pre-handover before any unit is
// occupied. They reuse the same `tickets` lifecycle, audit, and approvals.

export const siteVisitBookingSchema = z
  .object({
    visitor: partySchema,
    party: z.enum(["prospect", "broker", "investor", "booked_client"]).default("prospect"),
    interestedProjects: z.array(z.string().trim()).default([]),
    preferredDate: isoDateString,
    preferredWindow: z
      .object({ start: z.string(), end: z.string() })
      .optional(),
    partySize: z.number().int().positive().default(1),
    transport: z.enum(["own_car", "chauffeur_required", "taxi"]).optional(),
    language: z.enum(["en", "ar"]).default("en"),
    notes: z.string().trim().optional(),
  })
  .strict();

export const brochureRequestSchema = z
  .object({
    requester: partySchema,
    documents: z
      .array(z.enum(["brochure", "floor_plan", "payment_plan", "factsheet", "masterplan"]))
      .min(1),
    projectSlug: z.string().trim().optional(),
    unitType: z.string().trim().optional(),
    language: z.enum(["en", "ar"]).default("en"),
    deliveryChannel: z.enum(["email", "whatsapp"]).default("email"),
  })
  .strict();

export const paymentMilestoneSchema = z
  .object({
    milestoneLabel: z.string().trim().min(1),
    milestonePct: z.number().nonnegative().max(100).optional(),
    dueDate: isoDateString,
    amount: z.number().nonnegative().optional(),
    currency: z.string().trim().default("AED"),
    proofUploadId: z.string().uuid().optional(),
    paymentReference: z.string().trim().optional(),
    status: z.enum(["upcoming", "due", "paid", "overdue", "disputed"]).default("upcoming"),
    notes: z.string().trim().optional(),
  })
  .strict();

export const oqoodAssistanceSchema = z
  .object({
    requestKind: z.enum(["register", "status", "transfer", "correction"]),
    spaReference: z.string().trim().min(1),
    buyerName: z.string().trim().min(1),
    coBuyerName: z.string().trim().optional(),
    passportNumber: z.string().trim().optional(),
    emiratesId: z.string().trim().optional(),
    attachments: z.array(z.string().uuid()).default([]),
    notes: z.string().trim().optional(),
  })
  .strict();

export const mortgageNocSchema = z
  .object({
    bankName: z.string().trim().min(1),
    loanReference: z.string().trim().optional(),
    spaReference: z.string().trim().min(1),
    buyerName: z.string().trim().min(1),
    requestedAmount: z.number().nonnegative().optional(),
    currency: z.string().trim().default("AED"),
    purpose: z
      .enum(["pre_approval", "final_disbursement", "refinance", "other"])
      .default("pre_approval"),
    requiredBy: isoDateString.optional(),
    attachments: z.array(z.string().uuid()).default([]),
  })
  .strict();

export const constructionProgressInquirySchema = z
  .object({
    projectSlug: z.string().trim().optional(),
    unitNumber: z.string().trim().optional(),
    asOfMonth: z.string().trim().optional(), // e.g. "2026-04"
    requestedFormat: z.enum(["summary", "photos", "video_walkthrough"]).default("summary"),
    notes: z.string().trim().optional(),
  })
  .strict();

export const snagSubmissionSchema = z
  .object({
    walkthroughDate: isoDateString.optional(),
    items: z
      .array(
        z.object({
          location: z.string().trim().min(1), // e.g. "Master bath"
          category: z.enum([
            "cosmetic",
            "mep",
            "joinery",
            "tiling",
            "paint",
            "door_window",
            "appliance",
            "other",
          ]),
          description: z.string().trim().min(1),
          photos: z.array(z.string().uuid()).default([]),
          severity: z.enum(["low", "medium", "high"]).default("medium"),
        })
      )
      .min(1),
    accompaniedBy: z.string().trim().optional(),
  })
  .strict();

export const handoverAppointmentSchema = z
  .object({
    appointmentDate: isoDateString,
    appointmentWindow: z
      .object({ start: z.string(), end: z.string() })
      .optional(),
    attendees: z.array(partySchema).min(1),
    documentsReady: z
      .object({
        finalPaymentCleared: z.boolean().default(false),
        oqoodIssued: z.boolean().default(false),
        serviceChargeSettled: z.boolean().default(false),
        idVerified: z.boolean().default(false),
      })
      .default({
        finalPaymentCleared: false,
        oqoodIssued: false,
        serviceChargeSettled: false,
        idVerified: false,
      }),
    powerOfAttorney: z.string().uuid().optional(),
    notes: z.string().trim().optional(),
  })
  .strict();

export const hotWorksPermitSchema = z
  .object({
    contractor: partySchema,
    workDescription: z.string().trim().min(1),
    location: z.string().trim().min(1), // e.g. "Tower B — Level 12 north slab"
    workTypes: z
      .array(z.enum(["welding", "grinding", "cutting", "soldering", "open_flame", "other"]))
      .min(1),
    validFrom: isoDateString,
    validUntil: isoDateString,
    fireWatchAssigned: z.boolean().default(false),
    nearbyHazards: z.string().trim().optional(),
    extinguisherCount: z.number().int().nonnegative().default(2),
    permitToWorkRef: z.string().trim().optional(),
  })
  .strict();

export const workAtHeightPermitSchema = z
  .object({
    contractor: partySchema,
    workDescription: z.string().trim().min(1),
    location: z.string().trim().min(1),
    heightMeters: z.number().positive(),
    accessMethod: z.enum([
      "scaffold",
      "mewp",
      "ladder",
      "rope_access",
      "cradle",
      "other",
    ]),
    crewSize: z.number().int().positive(),
    fallProtection: z.array(z.string().trim()).default([]),
    validFrom: isoDateString,
    validUntil: isoDateString,
    rescuePlan: z.string().trim().optional(),
  })
  .strict();

export const liftUsageBookingSchema = z
  .object({
    requester: partySchema,
    purpose: z.enum(["material_lift", "hoist_personnel", "equipment_move", "other"]),
    tower: z.string().trim().min(1),
    floors: z.array(z.string().trim()).default([]),
    startAt: isoDateString,
    endAt: isoDateString,
    weightKg: z.number().nonnegative().optional(),
    requiresProtection: z.boolean().default(true),
  })
  .strict();

export const inspectionRequestSchema = z
  .object({
    inspectionType: z.enum([
      "consultant",
      "civil_defence",
      "dewa",
      "trakhees",
      "municipality",
      "client_walkthrough",
      "snag_clearance",
      "other",
    ]),
    location: z.string().trim().min(1),
    requestedDate: isoDateString,
    requestedWindow: z
      .object({ start: z.string(), end: z.string() })
      .optional(),
    inspectorParty: partySchema.optional(),
    scope: z.string().trim().min(1),
    attachments: z.array(z.string().uuid()).default([]),
  })
  .strict();

// ── Sales / lead capture ────────────────────────────────────────────────────

/**
 * Lead inquiry — a visitor (not yet a client) who has expressed interest in
 * a project / brochure / investment and consented to being contacted by
 * sales. Stored as a ticket so it inherits status workflow, assignee,
 * audit, and the ORA panel UI; surfaced to the lead with a cosmetic
 * `LEAD-NNNNNN` reference (see `formatLeadReference`).
 */
export const leadInquirySchema = z
  .object({
    // What pulled them in — usually the project they're asking about.
    projectInterest: z.string().trim().optional(),
    projectId: z.string().uuid().optional(),
    // Where the lead came from (chat is the default for Ora AI).
    source: z
      .enum(["chat", "web", "broker", "event", "referral", "other"])
      .default("chat"),
    // Free-form summary of the visitor's intent ("wants 2BR brochure", etc).
    notes: z.string().trim().optional(),
    locale: z.enum(["en", "ar"]).optional(),
    consentToContact: z.boolean().default(true),
  })
  .strict();

// ── Registry ────────────────────────────────────────────────────────────────

export const requestDataSchemas = {
  general_inquiry: generalInquirySchema,
  noc: nocRequestSchema,
  move_in: moveInRequestSchema,
  move_out: moveInRequestSchema,
  gate_pass: gatePassSchema,
  technician_visit: technicianVisitSchema,
  construction_material_delivery: constructionMaterialDeliverySchema,
  vendor_access: vendorAccessSchema,
  maintenance_request: maintenanceRequestSchema,
  // Off-plan / pre-handover
  site_visit_booking: siteVisitBookingSchema,
  brochure_request: brochureRequestSchema,
  payment_milestone: paymentMilestoneSchema,
  oqood_assistance: oqoodAssistanceSchema,
  mortgage_noc: mortgageNocSchema,
  construction_progress_inquiry: constructionProgressInquirySchema,
  snag_submission: snagSubmissionSchema,
  handover_appointment: handoverAppointmentSchema,
  hot_works_permit: hotWorksPermitSchema,
  work_at_height_permit: workAtHeightPermitSchema,
  lift_usage_booking: liftUsageBookingSchema,
  inspection_request: inspectionRequestSchema,
  // Sales / lead capture
  lead_inquiry: leadInquirySchema,
} as const satisfies Record<TicketRequestType, z.ZodTypeAny>;

export type RequestDataMap = {
  [K in TicketRequestType]: z.infer<(typeof requestDataSchemas)[K]>;
};

/**
 * Validate `requestData` against the schema bound to `requestType`.
 * Returns parsed data, or null when no data was supplied.
 * Throws ZodError when invalid.
 */
export function validateRequestData(
  requestType: TicketRequestType,
  data: unknown
): Record<string, unknown> | null {
  if (data === null || data === undefined) {
    // general_inquiry permits empty data
    if (requestType === "general_inquiry") return null;
    // For typed requests, fall through to schema (most require fields)
  }
  const schema = requestDataSchemas[requestType];
  return schema.parse(data ?? {}) as Record<string, unknown>;
}

export const REQUEST_TYPES: ReadonlyArray<TicketRequestType> = [
  "general_inquiry",
  "noc",
  "move_in",
  "move_out",
  "gate_pass",
  "technician_visit",
  "construction_material_delivery",
  "vendor_access",
  "maintenance_request",
  "site_visit_booking",
  "brochure_request",
  "payment_milestone",
  "oqood_assistance",
  "mortgage_noc",
  "construction_progress_inquiry",
  "snag_submission",
  "handover_appointment",
  "hot_works_permit",
  "work_at_height_permit",
  "lift_usage_booking",
  "inspection_request",
  "lead_inquiry",
];

export const REQUEST_TYPE_LABELS: Record<TicketRequestType, string> = {
  general_inquiry: "General inquiry",
  noc: "NOC (No Objection Certificate)",
  move_in: "Move-in",
  move_out: "Move-out",
  gate_pass: "Gate pass",
  technician_visit: "Technician visit",
  construction_material_delivery: "Construction material delivery",
  vendor_access: "Vendor access",
  maintenance_request: "Maintenance request",
  site_visit_booking: "Site visit booking",
  brochure_request: "Brochure / floor plan request",
  payment_milestone: "Payment milestone",
  oqood_assistance: "Oqood / DLD assistance",
  mortgage_noc: "Mortgage NOC",
  construction_progress_inquiry: "Construction progress inquiry",
  snag_submission: "Snag list submission",
  handover_appointment: "Handover appointment",
  hot_works_permit: "Hot works permit",
  work_at_height_permit: "Work-at-height permit",
  lift_usage_booking: "Lift / hoist usage booking",
  inspection_request: "Inspection request",
  lead_inquiry: "Lead inquiry (sales)",
};
