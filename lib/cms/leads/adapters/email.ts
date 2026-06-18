/**
 * Lead Engine (S3) — `email` ingestion adapter.
 *
 * Normalizes an inbound **email message** into the canonical
 * {@link InboundLead}. The adapter does not talk to a live mail transport
 * (that wiring is deferred to the container-tier ingestion worker, task 7.4);
 * it normalizes a documented, already-received message shape — the fields a
 * mailbox connector hands off after fetching a message (Microsoft Graph /
 * Azure Communication mail follows this shape: a stable `messageId`, a `from`
 * address, `subject`, body text, and a received timestamp).
 *
 * Credential gate ([deps], Req 1.7): inbound email requires the mailbox
 * credentials the rest of the platform already uses for Azure / Microsoft
 * Graph mail. When any are absent the adapter produces **no** lead and returns
 * `{ ok: false, code: "unconfigured_source" }`, retaining the Raw_Payload; the
 * caller (the ingestion worker) publishes `lead.source.unconfigured` and keeps
 * the payload for retry. The credential check is injectable via
 * {@link EmailAdapterDeps.isConfigured} so tests can simulate either state
 * without touching `process.env`.
 *
 * Determinism (Req 2.4): every field is a pure function of the Raw_Payload —
 * `capturedAt` comes from the message's received timestamp (never the wall
 * clock) and the `idempotencyKey` is derived from the source plus the stable
 * provider `messageId`. Re-normalizing the same message yields a field-equal
 * lead with an identical key.
 *
 * Design references: §Components #1 (Canonical InboundLead + Ingestion
 * adapters). Requirements: 1.1, 1.2, 1.3, 1.4, 1.7, 2.2, 2.4.
 */

import { z } from "zod";

import type { AttributionData } from "@/lib/analytics/types";
import {
  inboundLeadSchema,
  type IngestionAdapter,
  type InboundLead,
  type NormalizeResult,
} from "../inbound";
import { deriveIdempotencyKey, flattenAttribution } from "./web-form";

// ── Documented Raw_Payload shape (an already-received email message) ──────────

/** Reused namespaced `ora_attribution` touch shape, passed through when the
 * mailbox connector resolved one for the sender (rare for email; optional). */
const touchRecordSchema = z
  .object({
    utm_source: z.string().optional(),
    utm_medium: z.string().optional(),
    utm_campaign: z.string().optional(),
    utm_term: z.string().optional(),
    utm_content: z.string().optional(),
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
 * The Raw_Payload the `email` adapter consumes: one fetched message.
 *
 * - `messageId` — the provider's stable message identifier (the idempotency
 *   anchor).
 * - `from` — sender address and optional display name.
 * - `subject` / `text` / `html` — message content (at least one of text/html
 *   is expected; `text` is preferred, `html` is a fallback).
 * - `receivedAt` — ISO 8601 UTC instant the message was received.
 * - `attribution` — optional `ora_attribution` data, when the connector
 *   resolved one for the sender.
 */
export const emailRawPayloadSchema = z.object({
  messageId: z.string().min(1),
  from: z.object({
    name: z.string().optional(),
    address: z.string().min(1),
  }),
  subject: z.string().optional(),
  text: z.string().optional(),
  html: z.string().optional(),
  receivedAt: z.iso.datetime(),
  attribution: attributionDataSchema.nullish(),
});

/** The Raw_Payload shape the `email` adapter consumes. */
export type EmailRawPayload = z.infer<typeof emailRawPayloadSchema>;

// ── Credential seam ───────────────────────────────────────────────────────────

/**
 * Injectable dependencies for the `email` adapter. `isConfigured` decides
 * whether the source's credentials are present; it defaults to the env-based
 * check {@link emailCredentialsConfigured} but can be overridden in tests to
 * simulate a configured or unconfigured source (Req 1.7).
 */
export interface EmailAdapterDeps {
  isConfigured?: () => boolean;
}

/**
 * Whether the inbound-email credentials are present in the environment. Mirrors
 * the Azure / Microsoft Graph mail credentials the platform already reads
 * (`lib/cms/ai/email.ts`): all four must be set for the source to be
 * configured.
 */
export function emailCredentialsConfigured(): boolean {
  return Boolean(
    process.env.AZURE_COMMUNICATION_TENANT_ID &&
      process.env.AZURE_COMMUNICATION_CLIENT_ID &&
      process.env.AZURE_COMMUNICATION_CLIENT_SECRET &&
      process.env.AZURE_COMMUNICATION_SENDER
  );
}

// ── Normalization ─────────────────────────────────────────────────────────────

const NAME_MAX = 255;
const CONTENT_MAX = 10_000;

/** Strip HTML tags to recover a plain-text fallback when no `text` part exists. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Build the free-text `content` from subject + body, bounded to 10,000 chars. */
function buildContent(payload: EmailRawPayload): string {
  const body = payload.text ?? (payload.html ? htmlToText(payload.html) : "");
  const subject = payload.subject ?? "";
  const combined = `${subject}\n\n${body}`.trim();
  return combined.slice(0, CONTENT_MAX);
}

/**
 * Build the `email` Ingestion_Adapter. Defaults to the env-based credential
 * check; pass {@link EmailAdapterDeps.isConfigured} to override in tests.
 */
export function createEmailAdapter(deps: EmailAdapterDeps = {}): IngestionAdapter {
  const isConfigured = deps.isConfigured ?? emailCredentialsConfigured;

  return {
    source: "email",

    normalize(raw: unknown): NormalizeResult {
      // Credential gate first (Req 1.7): produce no lead, retain the payload.
      if (!isConfigured()) {
        return {
          ok: false,
          code: "unconfigured_source",
          message:
            "email source is unconfigured: inbound mailbox credentials (AZURE_COMMUNICATION_*) are absent",
          raw,
        };
      }

      const parsed = emailRawPayloadSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          code: "invalid_payload",
          message: `email payload did not match the inbound-message shape: ${parsed.error.message}`,
          raw,
        };
      }

      const msg = parsed.data;

      const idempotencyKey = deriveIdempotencyKey("email", {
        providerId: msg.messageId,
        contentIdentity: {
          messageId: msg.messageId,
          from: msg.from.address,
          receivedAt: msg.receivedAt,
        },
      });

      const candidate: InboundLead = {
        source: "email",
        capturedAt: msg.receivedAt,
        name: msg.from.name ? msg.from.name.slice(0, NAME_MAX) : undefined,
        email: msg.from.address,
        // Email carries no inbound phone; left unset (Req 1.5 still produces).
        phone: undefined,
        content: buildContent(msg),
        rawPayload: raw,
        attribution: flattenAttribution(
          (msg.attribution ?? undefined) as AttributionData | undefined
        ),
        idempotencyKey,
      };

      const validated = inboundLeadSchema.safeParse(candidate);
      if (!validated.success) {
        return {
          ok: false,
          code: "invalid_payload",
          message: `normalized email lead failed canonical validation: ${validated.error.message}`,
          raw,
        };
      }

      return { ok: true, lead: validated.data };
    },
  };
}

/** The `email` Ingestion_Adapter, reading credentials from the environment. */
export const emailAdapter: IngestionAdapter = createEmailAdapter();
