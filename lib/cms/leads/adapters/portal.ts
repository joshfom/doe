/**
 * Lead Engine (S3) — `portal` ingestion adapter.
 *
 * Normalizes a **property-portal lead record** (Bayut / PropertyFinder) into
 * the canonical {@link InboundLead}. The adapter does not poll a portal API
 * directly (live retrieval is deferred to the container-tier ingestion worker,
 * task 7.4); it normalizes a documented, already-retrieved portal lead record —
 * the contact-request shape both portals deliver (a stable per-portal lead id,
 * the enquirer's contact details, the message, and the listing reference).
 *
 * Credential gate ([deps], Req 1.7): pulling portal leads requires a portal API
 * key. When it is absent the adapter produces **no** lead and returns
 * `{ ok: false, code: "unconfigured_source" }`, retaining the Raw_Payload; the
 * caller publishes `lead.source.unconfigured` and keeps the payload for retry.
 * The check is injectable via {@link PortalAdapterDeps.isConfigured}.
 *
 * Determinism (Req 2.4): `capturedAt` comes from the record's `receivedAt` and
 * the `idempotencyKey` is derived from the source plus a `portal:leadId`
 * provider id, so re-normalizing the same record yields a field-equal lead with
 * an identical key.
 *
 * Design references: §Components #1. Requirements: 1.1, 1.2, 1.3, 1.4, 1.7,
 * 2.2, 2.4.
 */

import { z } from "zod";

import {
  inboundLeadSchema,
  type IngestionAdapter,
  type InboundLead,
  type NormalizeResult,
} from "../inbound";
import { deriveIdempotencyKey } from "./web-form";

// ── Documented Raw_Payload shape (a portal contact-request record) ────────────

/** The supported property portals. */
export const PORTALS = ["bayut", "property_finder"] as const;

/**
 * The Raw_Payload the `portal` adapter consumes: one contact-request record.
 *
 * - `portal` — which portal produced the lead (namespaces the idempotency key).
 * - `leadId` — the portal's per-lead identifier, the idempotency anchor.
 * - `name` / `email` / `phone` — the enquirer's contact details.
 * - `message` — the enquiry free text.
 * - `propertyReference` / `listingId` — the listing the enquiry is about,
 *   carried into attribution.
 * - `receivedAt` — ISO 8601 UTC instant the portal recorded the enquiry.
 */
export const portalRawPayloadSchema = z.object({
  portal: z.enum(PORTALS),
  leadId: z.string().min(1),
  name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  message: z.string().optional(),
  propertyReference: z.string().optional(),
  listingId: z.string().optional(),
  receivedAt: z.iso.datetime(),
});

/** The Raw_Payload shape the `portal` adapter consumes. */
export type PortalRawPayload = z.infer<typeof portalRawPayloadSchema>;

// ── Credential seam ───────────────────────────────────────────────────────────

/** Injectable dependencies for the `portal` adapter (Req 1.7). */
export interface PortalAdapterDeps {
  isConfigured?: () => boolean;
}

/**
 * Whether the portal credentials are present in the environment. A single
 * portal API key gates both Bayut and PropertyFinder retrieval.
 */
export function portalCredentialsConfigured(): boolean {
  return Boolean(process.env.PORTAL_API_KEY);
}

// ── Normalization ─────────────────────────────────────────────────────────────

const NAME_MAX = 255;
const CONTENT_MAX = 10_000;

/** Flatten the portal + listing context into the lead's attribution record. */
function buildAttribution(
  payload: PortalRawPayload
): Record<string, string> | undefined {
  const out: Record<string, string> = { utm_source: payload.portal };
  if (payload.propertyReference) {
    out.property_reference = payload.propertyReference;
  }
  if (payload.listingId) out.listing_id = payload.listingId;
  return out;
}

/**
 * Build the `portal` Ingestion_Adapter. Defaults to the env-based credential
 * check; pass {@link PortalAdapterDeps.isConfigured} to override in tests.
 */
export function createPortalAdapter(
  deps: PortalAdapterDeps = {}
): IngestionAdapter {
  const isConfigured = deps.isConfigured ?? portalCredentialsConfigured;

  return {
    source: "portal",

    normalize(raw: unknown): NormalizeResult {
      if (!isConfigured()) {
        return {
          ok: false,
          code: "unconfigured_source",
          message:
            "portal source is unconfigured: PORTAL_API_KEY is absent",
          raw,
        };
      }

      const parsed = portalRawPayloadSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          code: "invalid_payload",
          message: `portal payload did not match the contact-request shape: ${parsed.error.message}`,
          raw,
        };
      }

      const record = parsed.data;

      // Namespace the provider id by portal so Bayut and PropertyFinder lead ids
      // can never collide (Req 2.4).
      const idempotencyKey = deriveIdempotencyKey("portal", {
        providerId: `${record.portal}:${record.leadId}`,
        contentIdentity: {
          portal: record.portal,
          leadId: record.leadId,
        },
      });

      const candidate: InboundLead = {
        source: "portal",
        capturedAt: record.receivedAt,
        name: record.name ? record.name.slice(0, NAME_MAX) : undefined,
        email: record.email,
        phone: record.phone,
        content: (record.message ?? "").slice(0, CONTENT_MAX),
        rawPayload: raw,
        attribution: buildAttribution(record),
        idempotencyKey,
      };

      const validated = inboundLeadSchema.safeParse(candidate);
      if (!validated.success) {
        return {
          ok: false,
          code: "invalid_payload",
          message: `normalized portal lead failed canonical validation: ${validated.error.message}`,
          raw,
        };
      }

      return { ok: true, lead: validated.data };
    },
  };
}

/** The `portal` Ingestion_Adapter, reading credentials from the environment. */
export const portalAdapter: IngestionAdapter = createPortalAdapter();
