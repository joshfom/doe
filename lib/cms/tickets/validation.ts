import { z } from "zod";

const REQUEST_TYPE_VALUES = [
  "general_inquiry",
  "noc",
  "move_in",
  "move_out",
  "gate_pass",
  "technician_visit",
  "construction_material_delivery",
  "vendor_access",
  "maintenance_request",
] as const;

const requestExtras = {
  requestType: z.enum(REQUEST_TYPE_VALUES).optional(),
  communityId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  unitNumber: z.string().trim().max(64).optional().nullable(),
  requestData: z.unknown().optional(),
  scheduledStart: z.string().optional().nullable(),
  scheduledEnd: z.string().optional().nullable(),
};

/**
 * Schema for creating a ticket via the authenticated API or admin panel.
 * Validates all required contact fields, email format, and provides
 * sensible defaults for optional fields like priority.
 */
export const createTicketSchema = z.object({
  subject: z.string().trim().min(1, "Subject is required"),
  description: z.string().trim().min(1, "Description is required"),
  contactName: z.string().trim().min(1, "Contact name is required"),
  contactEmail: z.string().trim().min(1, "Contact email is required").email("Invalid email format"),
  contactPhone: z.string().optional(),
  priority: z
    .enum(["low", "medium", "high", "urgent"])
    .optional()
    .default("medium"),
  category: z.string().optional(),
  source: z.enum(["manual", "api", "form"]),
  ...requestExtras,
});

/**
 * Schema for the public ticket submission form.
 * Same validation as createTicketSchema but without the source field —
 * the handler sets source to "form" automatically.
 */
export const publicTicketSchema = z.object({
  subject: z.string().trim().min(1, "Subject is required"),
  description: z.string().trim().min(1, "Description is required"),
  contactName: z.string().trim().min(1, "Contact name is required"),
  contactEmail: z.string().trim().min(1, "Contact email is required").email("Invalid email format"),
  contactPhone: z.string().optional(),
  priority: z
    .enum(["low", "medium", "high", "urgent"])
    .optional()
    .default("medium"),
  category: z.string().optional(),
  ...requestExtras,
});

/**
 * Schema for updating a ticket's request-type fields and structured data.
 * All fields are optional; `requestData` is validated by the per-type
 * schema in `request-types.ts` at the service layer.
 */
export const updateTicketRequestSchema = z
  .object({
    ...requestExtras,
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    category: z.string().optional().nullable(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });

/**
 * Schema for transitioning a ticket's status.
 * newStatus must be one of the five valid statuses.
 * assigneeId is optional — required only when transitioning to "assigned".
 */
export const transitionStatusSchema = z.object({
  newStatus: z.enum(["open", "assigned", "in_progress", "resolved", "closed"]),
  assigneeId: z.string().uuid("Invalid assignee ID format").optional(),
});

/**
 * Schema for assigning a ticket to an employee.
 * assigneeId is required and must be a valid UUID.
 */
export const assignTicketSchema = z.object({
  assigneeId: z.string().uuid("Invalid assignee ID format"),
});

/**
 * Schemas for ticket approval flow.
 */
export const requestTicketApprovalSchema = z.object({
  scope: z.enum([
    "noc",
    "move_in",
    "vendor_access",
    "construction_material_delivery",
  ]),
});

export const decideTicketApprovalSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  comment: z.string().trim().max(2000).optional(),
});

export const cancelTicketApprovalSchema = z.object({
  reason: z.string().trim().max(2000).optional(),
});

/**
 * Schema for adding a note to a ticket.
 * content is required; isInternal defaults to true (internal notes).
 */
export const addNoteSchema = z.object({
  content: z.string().trim().min(1, "Note content is required"),
  isInternal: z.boolean().optional().default(true),
});

/**
 * Schema for filtering and paginating the ticket list.
 * All fields are optional — an empty object returns the first page of all tickets.
 */
export const ticketFiltersSchema = z.object({
  status: z.enum(["open", "assigned", "in_progress", "resolved", "closed"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  category: z.string().optional(),
  assigneeId: z.string().uuid("Invalid assignee ID format").optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  source: z.enum(["manual", "api", "form"]).optional(),
  requestType: z.enum(REQUEST_TYPE_VALUES).optional(),
  communityId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

/**
 * Schema for creating a ticket category.
 * name and displayName are required; description is optional.
 */
export const createCategorySchema = z.object({
  name: z.string().trim().min(1, "Category name is required"),
  displayName: z.string().trim().min(1, "Display name is required"),
  description: z.string().optional(),
});

/**
 * Schema for updating a ticket category.
 * All fields are optional — only provided fields are updated.
 */
export const updateCategorySchema = z.object({
  name: z.string().trim().min(1, "Category name is required").optional(),
  displayName: z.string().trim().min(1, "Display name is required").optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
});
