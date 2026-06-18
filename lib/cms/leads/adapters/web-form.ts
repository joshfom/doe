/**
 * Lead Engine (S3) — `web_form` ingestion adapter.
 *
 * This adapter **reuses the existing public web-form/ticket intake path** and
 * introduces **no second web-form entry point** (Req 1.6). The platform's
 * public form already POSTs to `/tickets/public`, where the submission is
 * validated by {@link publicTicketSchema} and the `ora_attribution` cookie is
 * read into {@link AttributionData}. This adapter does not receive HTTP; it
 * maps that *already-captured* submission into the canonical
 * {@link InboundLead}, binding the lead pipeline to the same contract the
 * existing intake path uses.
 *
 * Determinism (Req 2.4): every field of the produced {@link InboundLead} is a
 * pure function of the Raw_Payload, including {@link InboundLead.capturedAt}
 * (taken from the payload, never the wall clock) and the
 * {@link InboundLead.idempotencyKey} (the source plus a stable identity of the
 * payload — the created ticket identifier when present, else a content hash of
 * the captured submission). Re-normalizing the same Raw_Payload therefore
 * yields a field-equal lead with an identical key.
 *
 * Attribution (Req 1.4, 1.5): when the captured submission carries
 * `ora_attribution` data the adapter flattens it into the lead's `attribution`
 * record; when it carries none the adapter leaves `attribution` unset and still
 * produces the lead.
 *
 * Design references: §Components #1 (Canonical InboundLead + Ingestion
 * adapters). Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.4.
 *
 * NOTE: This module touches no Next.js route, page, or layout. The existing
 * catch-all route (`app/api/[...slugs]/route.ts`, `runtime = "nodejs"`,
 * `dynamic = "force-dynamic"`) is left entirely unchanged.
 */

import { createHash } from "node:crypto";

import { z } from "zod";

import type { AttributionData } from "@/lib/analytics/types";
import { publicTicketSchema } from "../../tickets/validation";
import {
  inboundLeadSchema,
  type IngestionAdapter,
  type InboundLead,
  type NormalizeResult,
} from "../inbound";

// ── Raw payload captured by the existing public-form/ticket intake path ───────

/**
 * A single `ora_attribution` touch record, the shape persisted on tickets and
 * stored in the `ora_attribution` cookie. All fields are optional strings, so
 * the touch can be flattened directly into the lead's string-valued
 * `attribution` record.
 */
const touchRecordSchema = z
  .object({
    utm_source: z.string().optional(),
    utm_medium: z.string().optional(),
    utm_campaign: z.string().optional(),
    utm_term: z.string().optional(),
    utm_content: z.string().optional(),
    gclid: z.string().optional(),
    fbclid: z.string().optional(),
    ttclid: z.string().optional(),
    msclkid: z.string().optional(),
    li_fat_id: z.string().optional(),
    referrer: z.string().optional(),
    landing_path: z.string().optional(),
    timestamp: z.string().optional(),
  })
  .passthrough();

const attributionDataSchema = z.object({
  first_touch: touchRecordSchema,
  last_touch: touchRecordSchema,
  touches: z.array(touchRecordSchema).optional(),
});

/**
 * The Raw_Payload the `web_form` adapter consumes: the submission already
 * validated and captured by the existing public-form/ticket intake path,
 * the moment it was captured, the `ora_attribution` data read at capture, and
 * the ticket identifiers the intake path produced (used as the stable identity
 * for the idempotency key when present).
 *
 * `submission` reuses {@link publicTicketSchema} verbatim — the exact contract
 * the existing entry point validates — so the adapter never re-defines the
 * web-form input shape (Req 1.6).
 */
export const webFormRawPayloadSchema = z.object({
  submission: publicTicketSchema,
  /** ISO 8601 UTC instant the intake path captured the submission (Req 2.4). */
  capturedAt: z.iso.datetime(),
  /** `ora_attribution` data read at capture, when marketing consent allowed it. */
  attribution: attributionDataSchema.nullish(),
  /** Identifiers the intake path produced; the stable identity for the key. */
  ticketId: z.string().min(1).optional(),
  ticketNumber: z.string().min(1).optional(),
});

/** The Raw_Payload shape the `web_form` adapter consumes. */
export type WebFormRawPayload = z.infer<typeof webFormRawPayloadSchema>;

// ── Shared deterministic helpers (reused by sibling adapters) ─────────────────

/**
 * Deterministically serialize a value with object keys in sorted order, so two
 * structurally-equal payloads always serialize to the identical string. Arrays
 * keep their order; primitives serialize as JSON. Used to derive a stable
 * content hash for the idempotency key when no provider identifier is supplied.
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalStringify(v)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalStringify(v)}`)
    .join(",")}}`;
}

/**
 * Derive a deterministic idempotency key from the {@link LeadSource} plus a
 * stable identity of the Raw_Payload (Req 2.4, 3.2): a provider/record
 * identifier when one is supplied, otherwise a SHA-256 content hash of the
 * payload's stable identity. Bounded well within the schema's 255-char limit.
 */
export function deriveIdempotencyKey(
  source: string,
  identity: { providerId?: string | null; contentIdentity: unknown }
): string {
  if (identity.providerId) {
    return `${source}:id:${identity.providerId}`;
  }
  const hash = createHash("sha256")
    .update(canonicalStringify(identity.contentIdentity))
    .digest("hex");
  return `${source}:hash:${hash}`;
}

/**
 * Flatten `ora_attribution` data into the lead's string-valued `attribution`
 * record (Req 1.4). First- and last-touch fields are namespaced
 * (`first_touch_*` / `last_touch_*`) so both are preserved without collision.
 * Returns `undefined` when there is no attribution data to carry, so the
 * adapter leaves the field unset and still produces the lead (Req 1.5).
 */
export function flattenAttribution(
  attribution: AttributionData | null | undefined
): Record<string, string> | undefined {
  if (!attribution) return undefined;

  const out: Record<string, string> = {};
  const add = (prefix: string, touch: Record<string, unknown> | undefined) => {
    if (!touch) return;
    for (const [key, raw] of Object.entries(touch)) {
      if (typeof raw === "string" && raw.length > 0) {
        out[`${prefix}_${key}`] = raw;
      }
    }
  };
  add("first_touch", attribution.first_touch as unknown as Record<string, unknown>);
  add("last_touch", attribution.last_touch as unknown as Record<string, unknown>);

  return Object.keys(out).length > 0 ? out : undefined;
}

// ── The web_form adapter ──────────────────────────────────────────────────────

/** Bounds matching the canonical schema, applied before validation. */
const NAME_MAX = 255;
const CONTENT_MAX = 10_000;

/**
 * Build the free-text `content` from the captured submission's subject and
 * description, bounded to the canonical 10,000-character limit (Req 2.1). The
 * unmodified submission is always retained on `rawPayload`, so bounding here
 * never loses data.
 */
function buildContent(submission: { subject: string; description: string }): string {
  const combined = `${submission.subject}\n\n${submission.description}`.trim();
  return combined.slice(0, CONTENT_MAX);
}

/**
 * The `web_form` Ingestion_Adapter. Maps an already-captured public-form/ticket
 * submission into the canonical {@link InboundLead}, reusing the existing
 * intake contract and adding no second entry point (Req 1.6).
 */
export const webFormAdapter: IngestionAdapter = {
  source: "web_form",

  normalize(raw: unknown): NormalizeResult {
    const parsed = webFormRawPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        code: "invalid_payload",
        message: `web_form payload did not match the captured-submission shape: ${parsed.error.message}`,
        raw,
      };
    }

    const { submission, capturedAt, attribution, ticketId, ticketNumber } =
      parsed.data;

    // Stable identity for the idempotency key: prefer the ticket identifier the
    // intake path produced (its "provider message id"); else a content hash of
    // the captured contact identity + content (Req 2.4).
    const providerId = ticketId ?? ticketNumber ?? null;
    const idempotencyKey = deriveIdempotencyKey("web_form", {
      providerId,
      contentIdentity: {
        contactName: submission.contactName,
        contactEmail: submission.contactEmail,
        contactPhone: submission.contactPhone ?? null,
        subject: submission.subject,
        description: submission.description,
        capturedAt,
      },
    });

    const candidate: InboundLead = {
      source: "web_form",
      capturedAt,
      name: submission.contactName.slice(0, NAME_MAX),
      email: submission.contactEmail,
      phone: submission.contactPhone,
      content: buildContent(submission),
      // Retain the unmodified original Raw_Payload verbatim (Req 1.3).
      rawPayload: raw,
      attribution: flattenAttribution(attribution as AttributionData | null | undefined),
      idempotencyKey,
    };

    // Validate against the single canonical schema (Req 2.2). On failure the
    // payload could not be normalized into a schema-valid lead (Req 2.3).
    const validated = inboundLeadSchema.safeParse(candidate);
    if (!validated.success) {
      return {
        ok: false,
        code: "invalid_payload",
        message: `normalized web_form lead failed canonical validation: ${validated.error.message}`,
        raw,
      };
    }

    return { ok: true, lead: validated.data };
  },
};
