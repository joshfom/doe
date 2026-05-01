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
};
