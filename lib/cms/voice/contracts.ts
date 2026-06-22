/**
 * DOE Voice Surface — shared contracts.
 *
 * Single source of truth for the voice surface's request/result shapes,
 * the prefetched {@link CallContext}, and the typed tool I/O schemas. These
 * Zod schemas are validated server-side (voice session + tool dispatch routes)
 * and the derived TypeScript types are shared with every client (widget, agent
 * worker, job runner, Demo Console) through Eden Treaty's `type Api`.
 *
 * Design references: §7.2 (session service), §10 (endpoint signatures),
 * §11 (tool registry), §12 (CallContext contract), §13 (orchestrator).
 * Requirements: 12.1 (contracts shared via Eden `type Api`).
 *
 * Convention: schemas are the source of truth; types are derived via
 * `z.infer`. Where the design shows a hand-written `interface`, an equivalent
 * `interface`/`type` is also exported so consumers can import either form.
 */

import { z } from "zod";

// ── Shared primitives ────────────────────────────────────────────────────────

/** Supported call languages (caller profile, defaults to "en"). */
export const languageSchema = z.enum(["en", "ar"]);
export type Language = z.infer<typeof languageSchema>;

/** Lead tier produced by `score_lead` / mirrored on `leadsMirror.tier`. */
export const tierSchema = z.enum(["HOT", "WARM", "NURTURE"]);
export type Tier = z.infer<typeof tierSchema>;

// ── Voice session service (design §7.2, §10) ─────────────────────────────────

/**
 * Body of `POST /api/voice/sessions`. Re-validated server-side; the widget
 * validates the same shape client-side. `consent` MUST be the literal `true`
 * (a timestamped consent is required — SEC-1 / Req 14.1).
 *
 * Two callers:
 *  • Public pre-call form (lead capture) — supplies `phone` + `email`.
 *  • Authenticated staff "talk to your twin" — sets `staff: true` and supplies
 *    only the signed-in identity (`email`, optional `name`). No `phone` is
 *    collected because it is not a lead; the session connects the operator
 *    directly to the agent.
 */
export const createVoiceSessionInputSchema = z
  .object({
    /** E.164 phone number (e.g. "+9715xxxxxxxx"). Required for lead calls. */
    phone: z.string().trim().min(1, "Phone is required").optional(),
    /** RFC-format email address. */
    email: z.string().trim().email("A valid email is required"),
    /** Optional caller name. */
    name: z.string().trim().min(1).optional(),
    /** Required consent — must be exactly `true`. */
    consent: z.literal(true),
    /** Optional originating page / utm / source passthrough. */
    page: z.string().trim().optional(),
    /**
     * Set by an authenticated staff member connecting to their twin. When true
     * the `phone` requirement is waived and the session is attributed to the
     * operator (a demo-scoped party), not treated as an inbound lead.
     */
    staff: z.boolean().optional(),
  })
  // A phone is mandatory for lead calls but never collected for a staff connect.
  .refine((v) => v.staff === true || (typeof v.phone === "string" && v.phone.length > 0), {
    message: "Phone is required",
    path: ["phone"],
  });

export type CreateVoiceSessionInput = z.infer<
  typeof createVoiceSessionInputSchema
>;

/**
 * Result of a successful session creation. The token is a LiveKit ephemeral,
 * room-scoped credential with a ≤ 10-minute TTL (SEC-3 / Req 14.4).
 */
export const createVoiceSessionResultSchema = z.object({
  /** Room name, formatted `call_{ulid}`. */
  roomName: z.string(),
  /** LiveKit ephemeral participant token. */
  token: z.string(),
  /** LiveKit server URL the widget connects to. */
  livekitUrl: z.string(),
  /** The `aiConversations` row id for this call. */
  conversationId: z.string(),
});

export type CreateVoiceSessionResult = z.infer<
  typeof createVoiceSessionResultSchema
>;

/**
 * Appointment summary surfaced on the widget thank-you card. Mirrors the shape
 * of `AppointmentResult` from `lib/cms/ai/actions.ts` so the booking made
 * in-call can be rendered without a second lookup.
 */
export const appointmentResultSchema = z.object({
  id: z.string(),
  referenceNumber: z.string(),
  appointmentType: z.string(),
  scheduledDate: z.string(),
  scheduledTime: z.string(),
  status: z.string(),
  contactName: z.string(),
});

export type AppointmentResultContract = z.infer<
  typeof appointmentResultSchema
>;

/**
 * Result of `GET /api/voice/sessions/:id` — drives the widget thank-you card
 * (FR-W6 / Req 2.8).
 */
export const getVoiceSessionResultSchema = z.object({
  status: z.string(),
  summary: z.string().optional(),
  appointment: appointmentResultSchema.optional(),
});

export type GetVoiceSessionResult = z.infer<
  typeof getVoiceSessionResultSchema
>;

// ── CallContext (design §12) ─────────────────────────────────────────────────

/** Assigned rep mini-profile embedded in the {@link CallContext}. */
export const callContextRepSchema = z.object({
  id: z.string(),
  name: z.string(),
  available: z.boolean(),
});

/** A pending appointment surfaced to the agent at ring time. */
export const callContextAppointmentSchema = z.object({
  when: z.string(),
  project: z.string(),
});

/**
 * Form-linked identities for an unknown caller (Req 3.10 / FR-S5). When no
 * existing party matches, the `CallContext` is produced with `known === false`
 * carrying the identities supplied on the pre-call form so the in-call lead is
 * attributed to the web form source. `phone` is the normalised E.164 value —
 * it is carried only as transient LiveKit job metadata so the agent never asks
 * for the number (FR-V5); it is never written to the SSE bus or audit log.
 */
export const formIdentitiesSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().optional(),
  name: z.string().optional(),
  /** Originating page / utm / source from the form. */
  source: z.string().optional(),
});

export type FormIdentities = z.infer<typeof formIdentitiesSchema>;

/**
 * The prefetched, mirror-only context block passed to the Voice_Agent as
 * LiveKit job metadata at dispatch — the "ring-time lookup". Built from mirror
 * data only; no Salesforce call ever occurs in this path (FR-S4 / Req 3.5).
 */
export const callContextSchema = z.object({
  partyId: z.string(),
  /** True when an existing party matched the caller. */
  known: z.boolean(),
  name: z.string().optional(),
  /** From profile, defaults to "en". */
  language: languageSchema,
  tier: tierSchema.nullish(),
  projectInterest: z.string().optional(),
  unitInterest: z.string().optional(),
  budgetBand: z.string().optional(),
  /** Short summary of the last interaction (≤ 200 chars). */
  lastInteraction: z.string().max(200).optional(),
  assignedRep: callContextRepSchema.optional(),
  /** utm / page source. */
  source: z.string().optional(),
  openAppointments: z.array(callContextAppointmentSchema).optional(),
  /**
   * Form-supplied identities for an unknown caller (`known === false`). Absent
   * for known callers, whose identities are already resolved from the mirror.
   */
  formIdentities: formIdentitiesSchema.optional(),
  /**
   * Set ONLY for an authenticated staff "talk to your twin" session: the
   * signed-in EMPLOYEE's user id. Its presence flips the call from the public
   * lead-qualification persona to the employee Twin (the Home_Agent), and every
   * Delegated_Action the call dispatches is audited + RBAC-scoped under THIS
   * user (Requirement 8.2) — never the static voice-lead agent. Absent for
   * every public/lead caller, so the public path is unchanged.
   */
  employeeUserId: z.string().optional(),
  /** The signed-in employee's RBAC roles, for the Twin's persona + tool scope. */
  employeeRoles: z.array(z.string()).optional(),
});

export type CallContext = z.infer<typeof callContextSchema>;

// ── Tool registry I/O (design §11, spec §3.4) ────────────────────────────────
//
// Each tool exposes a typed input and output schema. The Tool_Dispatcher
// validates input against these before running a handler (Req 6.1, 6.2).

/** `get_lead_context` — refresh the CallContext (mirror only, Req 6.5). */
export const getLeadContextInputSchema = z.object({ partyId: z.string() });
export type GetLeadContextInput = z.infer<typeof getLeadContextInputSchema>;
export const getLeadContextOutputSchema = callContextSchema;
export type GetLeadContextOutput = z.infer<typeof getLeadContextOutputSchema>;

/** `update_qualification` — partial qualification facts as they emerge. */
export const updateQualificationInputSchema = z.object({
  partyId: z.string(),
  budgetBand: z.string().optional(),
  timeline: z.string().optional(),
  intent: z.string().optional(),
  unitType: z.string().optional(),
});
export type UpdateQualificationInput = z.infer<
  typeof updateQualificationInputSchema
>;
export const updateQualificationOutputSchema = z.object({ ok: z.boolean() });
export type UpdateQualificationOutput = z.infer<
  typeof updateQualificationOutputSchema
>;

/**
 * `score_lead` — rules + LLM rationale. The `reason` is stored on
 * `leadsMirror.scoreReason` and surfaced only to the Demo_Console; it is never
 * read to the caller (Req 6.6).
 */
export const scoreLeadInputSchema = z.object({ partyId: z.string() });
export type ScoreLeadInput = z.infer<typeof scoreLeadInputSchema>;
export const scoreLeadOutputSchema = z.object({
  tier: tierSchema,
  reason: z.string(),
});
export type ScoreLeadOutput = z.infer<typeof scoreLeadOutputSchema>;

/** A viewing slot returned by `check_viewing_slots`. */
export const viewingSlotSchema = z.object({
  id: z.string(),
  project: z.string(),
  startsAt: z.string(),
  repName: z.string().optional(),
});
export type ViewingSlot = z.infer<typeof viewingSlotSchema>;

/** `check_viewing_slots` — read seeded availability (Req 6.7 booking path). */
export const checkViewingSlotsInputSchema = z.object({
  project: z.string(),
  dateHint: z.string().optional(),
});
export type CheckViewingSlotsInput = z.infer<
  typeof checkViewingSlotsInputSchema
>;
export const checkViewingSlotsOutputSchema = z.object({
  slots: z.array(viewingSlotSchema),
});
export type CheckViewingSlotsOutput = z.infer<
  typeof checkViewingSlotsOutputSchema
>;

/**
 * `book_viewing` — creates an `aiAppointments` row linking rep + slot, marks
 * the slot taken, and enqueues a Salesforce `event` to the outbox (Req 6.7).
 */
export const bookViewingInputSchema = z.object({
  partyId: z.string(),
  slotId: z.string(),
});
export type BookViewingInput = z.infer<typeof bookViewingInputSchema>;
export const bookViewingOutputSchema = z.object({
  appointmentId: z.string(),
  when: z.string(),
  repName: z.string(),
});
export type BookViewingOutput = z.infer<typeof bookViewingOutputSchema>;

/**
 * `assign_rep` — selects a rep by project × language × capacity rules and
 * records the routing logic line for the Demo_Console (Req 6.8).
 */
export const assignRepInputSchema = z.object({ partyId: z.string() });
export type AssignRepInput = z.infer<typeof assignRepInputSchema>;
export const assignRepOutputSchema = z.object({
  repId: z.string(),
  repName: z.string(),
});
export type AssignRepOutput = z.infer<typeof assignRepOutputSchema>;

/** `send_whatsapp_brief` — enqueues a `send_whatsapp_brief` job (Req 9.7). */
export const sendWhatsappBriefInputSchema = z.object({
  repId: z.string(),
  partyId: z.string(),
});
export type SendWhatsappBriefInput = z.infer<
  typeof sendWhatsappBriefInputSchema
>;
export const sendWhatsappBriefOutputSchema = z.object({ jobId: z.string() });
export type SendWhatsappBriefOutput = z.infer<
  typeof sendWhatsappBriefOutputSchema
>;

/** `queue_report_email` — enqueues a `compile_and_email_report` job (Req 9.5). */
export const queueReportEmailInputSchema = z.object({
  requesterEmail: z.string().email(),
  scope: z.string(),
  period: z.string(),
});
export type QueueReportEmailInput = z.infer<
  typeof queueReportEmailInputSchema
>;
export const queueReportEmailOutputSchema = z.object({ jobId: z.string() });
export type QueueReportEmailOutput = z.infer<
  typeof queueReportEmailOutputSchema
>;

/** `log_outcome` — LLM structures free text → Salesforce task via outbox. */
export const logOutcomeInputSchema = z.object({
  repId: z.string(),
  partyId: z.string(),
  freeText: z.string(),
});
export type LogOutcomeInput = z.infer<typeof logOutcomeInputSchema>;
export const logOutcomeOutputSchema = z.object({ outboxId: z.string() });
export type LogOutcomeOutput = z.infer<typeof logOutcomeOutputSchema>;

/**
 * `get_pipeline_summary` — figures computed solely from the `metrics_*` SQL
 * views; the LLM narrates and compares but never performs arithmetic
 * (FR-T1 / Req 6.9, 10.1). Either a rep scope (`repId`) or an exec scope.
 */
export const getPipelineSummaryInputSchema = z.object({
  repId: z.string().optional(),
  scope: z.enum(["exec", "rep"]).optional(),
  period: z.string().optional(),
});
export type GetPipelineSummaryInput = z.infer<
  typeof getPipelineSummaryInputSchema
>;
export const getPipelineSummaryOutputSchema = z.object({
  scope: z.string(),
  period: z.string(),
  /** Pre-computed metric figures keyed by metric name (SQL-computed). */
  metrics: z.record(z.string(), z.unknown()),
});
export type GetPipelineSummaryOutput = z.infer<
  typeof getPipelineSummaryOutputSchema
>;

// ── Tool registry index ──────────────────────────────────────────────────────

/**
 * Map of every voice tool name to its input/output schemas. The Tool_Registry
 * (`lib/cms/ai/tools/registry.ts`) and Tool_Dispatcher consume this so input is
 * validated against the correct schema per `toolName` (Req 6.1, 6.4).
 */
export const toolSchemas = {
  get_lead_context: {
    input: getLeadContextInputSchema,
    output: getLeadContextOutputSchema,
  },
  update_qualification: {
    input: updateQualificationInputSchema,
    output: updateQualificationOutputSchema,
  },
  score_lead: {
    input: scoreLeadInputSchema,
    output: scoreLeadOutputSchema,
  },
  check_viewing_slots: {
    input: checkViewingSlotsInputSchema,
    output: checkViewingSlotsOutputSchema,
  },
  book_viewing: {
    input: bookViewingInputSchema,
    output: bookViewingOutputSchema,
  },
  assign_rep: {
    input: assignRepInputSchema,
    output: assignRepOutputSchema,
  },
  send_whatsapp_brief: {
    input: sendWhatsappBriefInputSchema,
    output: sendWhatsappBriefOutputSchema,
  },
  queue_report_email: {
    input: queueReportEmailInputSchema,
    output: queueReportEmailOutputSchema,
  },
  log_outcome: {
    input: logOutcomeInputSchema,
    output: logOutcomeOutputSchema,
  },
  get_pipeline_summary: {
    input: getPipelineSummaryInputSchema,
    output: getPipelineSummaryOutputSchema,
  },
} as const;

/** Union of valid voice tool names. */
export type ToolName = keyof typeof toolSchemas;

/** Ordered list of all voice tool names (Req 6.4). */
export const TOOL_NAMES = Object.keys(toolSchemas) as ToolName[];
