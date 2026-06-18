/**
 * Lead Engine (S3) — `whatsapp` ingestion adapter.
 *
 * Normalizes an inbound **WhatsApp message** into the canonical
 * {@link InboundLead}. The adapter does not call the WhatsApp Cloud API
 * directly (live receiving is deferred to the container-tier ingestion worker,
 * task 7.4); it normalizes one already-extracted inbound message — the shape a
 * WhatsApp Business Cloud webhook delivers under
 * `entry[].changes[].value.messages[]`, paired with the sender profile from
 * `value.contacts[]` and any click-to-WhatsApp ad `referral`.
 *
 * Credential gate ([deps], Req 1.7): receiving WhatsApp messages requires the
 * WhatsApp Business access token and phone-number id. When either is absent the
 * adapter produces **no** lead and returns
 * `{ ok: false, code: "unconfigured_source" }`, retaining the Raw_Payload; the
 * caller publishes `lead.source.unconfigured` and keeps the payload for retry.
 * The check is injectable via {@link WhatsAppAdapterDeps.isConfigured}.
 *
 * Determinism (Req 2.4): `capturedAt` is derived from the message's own Unix
 * timestamp (never the wall clock), and the `idempotencyKey` is derived from
 * the source plus the WhatsApp message id (`wamid`), so re-normalizing the same
 * message yields a field-equal lead with an identical key.
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

// ── Documented Raw_Payload shape (one inbound WhatsApp message) ───────────────

/** Click-to-WhatsApp ad referral, present when the chat started from an ad. */
const referralSchema = z
  .object({
    source_url: z.string().optional(),
    source_id: z.string().optional(),
    source_type: z.string().optional(),
    headline: z.string().optional(),
    ctwa_clid: z.string().optional(),
  })
  .passthrough();

/**
 * The Raw_Payload the `whatsapp` adapter consumes: a single inbound message.
 *
 * - `messageId` — the WhatsApp message id (`wamid`), the idempotency anchor.
 * - `from` — the sender's phone number in WhatsApp wire form (digits, no `+`).
 * - `timestamp` — Unix epoch seconds as a string (WhatsApp wire form).
 * - `profileName` — the sender's WhatsApp profile name, when present.
 * - `text.body` — the message text (for `type: "text"` messages).
 * - `referral` — click-to-WhatsApp ad attribution, when present.
 */
export const whatsappRawPayloadSchema = z.object({
  messageId: z.string().min(1),
  from: z.string().min(1),
  timestamp: z.string().regex(/^\d+$/, "WhatsApp timestamp must be Unix seconds"),
  profileName: z.string().optional(),
  type: z.string().optional(),
  text: z.object({ body: z.string() }).optional(),
  referral: referralSchema.optional(),
});

/** The Raw_Payload shape the `whatsapp` adapter consumes. */
export type WhatsAppRawPayload = z.infer<typeof whatsappRawPayloadSchema>;

// ── Credential seam ───────────────────────────────────────────────────────────

/** Injectable dependencies for the `whatsapp` adapter (Req 1.7). */
export interface WhatsAppAdapterDeps {
  isConfigured?: () => boolean;
}

/**
 * Whether the WhatsApp Business credentials are present in the environment: a
 * Cloud API access token and the business phone-number id the webhook is bound
 * to.
 */
export function whatsappCredentialsConfigured(): boolean {
  return Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID
  );
}

// ── Normalization ─────────────────────────────────────────────────────────────

const NAME_MAX = 255;
const CONTENT_MAX = 10_000;

/** Map the WhatsApp referral into the lead's string attribution record. */
function buildAttribution(
  referral: WhatsAppRawPayload["referral"]
): Record<string, string> | undefined {
  if (!referral) return undefined;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(referral)) {
    if (typeof raw === "string" && raw.length > 0) {
      out[`referral_${key}`] = raw;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Build the `whatsapp` Ingestion_Adapter. Defaults to the env-based credential
 * check; pass {@link WhatsAppAdapterDeps.isConfigured} to override in tests.
 */
export function createWhatsAppAdapter(
  deps: WhatsAppAdapterDeps = {}
): IngestionAdapter {
  const isConfigured = deps.isConfigured ?? whatsappCredentialsConfigured;

  return {
    source: "whatsapp",

    normalize(raw: unknown): NormalizeResult {
      if (!isConfigured()) {
        return {
          ok: false,
          code: "unconfigured_source",
          message:
            "whatsapp source is unconfigured: WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID are absent",
          raw,
        };
      }

      const parsed = whatsappRawPayloadSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          code: "invalid_payload",
          message: `whatsapp payload did not match the inbound-message shape: ${parsed.error.message}`,
          raw,
        };
      }

      const msg = parsed.data;

      // WhatsApp timestamps are Unix epoch seconds; convert to ISO 8601 UTC
      // deterministically (Req 2.4).
      const capturedAt = new Date(Number(msg.timestamp) * 1000).toISOString();

      const idempotencyKey = deriveIdempotencyKey("whatsapp", {
        providerId: msg.messageId,
        contentIdentity: {
          messageId: msg.messageId,
          from: msg.from,
          timestamp: msg.timestamp,
        },
      });

      const candidate: InboundLead = {
        source: "whatsapp",
        capturedAt,
        name: msg.profileName ? msg.profileName.slice(0, NAME_MAX) : undefined,
        // WhatsApp leads carry no email; the sender number is the phone.
        email: undefined,
        phone: msg.from,
        content: (msg.text?.body ?? "").slice(0, CONTENT_MAX),
        rawPayload: raw,
        attribution: buildAttribution(msg.referral),
        idempotencyKey,
      };

      const validated = inboundLeadSchema.safeParse(candidate);
      if (!validated.success) {
        return {
          ok: false,
          code: "invalid_payload",
          message: `normalized whatsapp lead failed canonical validation: ${validated.error.message}`,
          raw,
        };
      }

      return { ok: true, lead: validated.data };
    },
  };
}

/** The `whatsapp` Ingestion_Adapter, reading credentials from the environment. */
export const whatsappAdapter: IngestionAdapter = createWhatsAppAdapter();
