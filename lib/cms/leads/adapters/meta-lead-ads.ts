/**
 * Lead Engine (S3) — `meta_lead_ads` ingestion adapter.
 *
 * Normalizes a **Meta lead-ads** submission into the canonical
 * {@link InboundLead}. The adapter does not call the Meta Graph API to fetch
 * the lead (live retrieval is deferred to the container-tier ingestion worker,
 * task 7.4); it normalizes a documented, already-retrieved leadgen record — a
 * webhook `leadgen` change (`entry[].changes[].value`) joined with the lead's
 * resolved `field_data` (the answers fetched via `/{leadgen_id}`).
 *
 * Credential gate ([deps], Req 1.7): Meta lead ads require the app secret used
 * to verify webhook signatures and a page access token used to fetch the lead's
 * field data. When either is absent the adapter produces **no** lead and returns
 * `{ ok: false, code: "unconfigured_source" }`, retaining the Raw_Payload; the
 * caller publishes `lead.source.unconfigured` and keeps the payload for retry.
 * The check is injectable via {@link MetaLeadAdsAdapterDeps.isConfigured}.
 *
 * Determinism (Req 2.4): `capturedAt` comes from the leadgen `createdTime` and
 * the `idempotencyKey` is derived from the source plus the `leadgenId`, so
 * re-normalizing the same record yields a field-equal lead with an identical
 * key.
 *
 * Attribution (Req 1.4): the ad/campaign/form identifiers Meta supplies are the
 * lead's attribution and are flattened into the lead's `attribution` record.
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

// ── Documented Raw_Payload shape (a resolved Meta leadgen record) ─────────────

/** A single answered field from the lead form. */
const fieldDataSchema = z.object({
  name: z.string(),
  values: z.array(z.string()),
});

/**
 * The Raw_Payload the `meta_lead_ads` adapter consumes: a resolved leadgen.
 *
 * - `leadgenId` — the lead's Graph id, the idempotency anchor.
 * - `formId` / `pageId` / `adId` / `adgroupId` / `campaignId` — ad context,
 *   carried into attribution when present.
 * - `createdTime` — ISO 8601 UTC instant Meta recorded the lead.
 * - `fieldData` — the form answers (`full_name`, `email`, `phone_number`, and
 *   any custom questions).
 */
export const metaLeadAdsRawPayloadSchema = z.object({
  leadgenId: z.string().min(1),
  formId: z.string().optional(),
  pageId: z.string().optional(),
  adId: z.string().optional(),
  adgroupId: z.string().optional(),
  campaignId: z.string().optional(),
  createdTime: z.iso.datetime(),
  fieldData: z.array(fieldDataSchema),
});

/** The Raw_Payload shape the `meta_lead_ads` adapter consumes. */
export type MetaLeadAdsRawPayload = z.infer<typeof metaLeadAdsRawPayloadSchema>;

// ── Credential seam ───────────────────────────────────────────────────────────

/** Injectable dependencies for the `meta_lead_ads` adapter (Req 1.7). */
export interface MetaLeadAdsAdapterDeps {
  isConfigured?: () => boolean;
}

/**
 * Whether the Meta lead-ads credentials are present in the environment: the app
 * secret (webhook signature verification) and a page access token (to fetch the
 * lead's field data).
 */
export function metaLeadAdsCredentialsConfigured(): boolean {
  return Boolean(
    process.env.META_APP_SECRET && process.env.META_PAGE_ACCESS_TOKEN
  );
}

// ── Normalization ─────────────────────────────────────────────────────────────

const NAME_MAX = 255;
const CONTENT_MAX = 10_000;

/** Standard Meta lead-form field keys (their `field_data[].name`). */
const FULL_NAME_KEYS = new Set(["full_name", "name"]);
const EMAIL_KEYS = new Set(["email"]);
const PHONE_KEYS = new Set(["phone_number", "phone"]);

/** First non-empty value for a field whose name is in `keys`. */
function firstValue(
  fieldData: MetaLeadAdsRawPayload["fieldData"],
  keys: Set<string>
): string | undefined {
  for (const field of fieldData) {
    if (keys.has(field.name)) {
      const v = field.values.find((x) => x.length > 0);
      if (v) return v;
    }
  }
  return undefined;
}

/** Build free-text content from any non-standard form answers. */
function buildContent(fieldData: MetaLeadAdsRawPayload["fieldData"]): string {
  const lines: string[] = [];
  for (const field of fieldData) {
    if (
      FULL_NAME_KEYS.has(field.name) ||
      EMAIL_KEYS.has(field.name) ||
      PHONE_KEYS.has(field.name)
    ) {
      continue;
    }
    const value = field.values.filter((v) => v.length > 0).join(", ");
    if (value) lines.push(`${field.name}: ${value}`);
  }
  return lines.join("\n").slice(0, CONTENT_MAX);
}

/** Flatten the ad/campaign context into the lead's attribution record. */
function buildAttribution(
  payload: MetaLeadAdsRawPayload
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  const add = (key: string, value: string | undefined) => {
    if (value && value.length > 0) out[key] = value;
  };
  add("utm_source", "meta_lead_ads");
  add("form_id", payload.formId);
  add("page_id", payload.pageId);
  add("ad_id", payload.adId);
  add("adgroup_id", payload.adgroupId);
  add("campaign_id", payload.campaignId);
  // `utm_source` alone is not lead-specific attribution; require at least one
  // real identifier before carrying attribution (Req 1.5 leaves it unset).
  return Object.keys(out).length > 1 ? out : undefined;
}

/**
 * Build the `meta_lead_ads` Ingestion_Adapter. Defaults to the env-based
 * credential check; pass {@link MetaLeadAdsAdapterDeps.isConfigured} to override
 * in tests.
 */
export function createMetaLeadAdsAdapter(
  deps: MetaLeadAdsAdapterDeps = {}
): IngestionAdapter {
  const isConfigured = deps.isConfigured ?? metaLeadAdsCredentialsConfigured;

  return {
    source: "meta_lead_ads",

    normalize(raw: unknown): NormalizeResult {
      if (!isConfigured()) {
        return {
          ok: false,
          code: "unconfigured_source",
          message:
            "meta_lead_ads source is unconfigured: META_APP_SECRET / META_PAGE_ACCESS_TOKEN are absent",
          raw,
        };
      }

      const parsed = metaLeadAdsRawPayloadSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          code: "invalid_payload",
          message: `meta_lead_ads payload did not match the leadgen shape: ${parsed.error.message}`,
          raw,
        };
      }

      const lead = parsed.data;
      const name = firstValue(lead.fieldData, FULL_NAME_KEYS);

      const idempotencyKey = deriveIdempotencyKey("meta_lead_ads", {
        providerId: lead.leadgenId,
        contentIdentity: {
          leadgenId: lead.leadgenId,
          createdTime: lead.createdTime,
        },
      });

      const candidate: InboundLead = {
        source: "meta_lead_ads",
        capturedAt: lead.createdTime,
        name: name ? name.slice(0, NAME_MAX) : undefined,
        email: firstValue(lead.fieldData, EMAIL_KEYS),
        phone: firstValue(lead.fieldData, PHONE_KEYS),
        content: buildContent(lead.fieldData),
        rawPayload: raw,
        attribution: buildAttribution(lead),
        idempotencyKey,
      };

      const validated = inboundLeadSchema.safeParse(candidate);
      if (!validated.success) {
        return {
          ok: false,
          code: "invalid_payload",
          message: `normalized meta_lead_ads lead failed canonical validation: ${validated.error.message}`,
          raw,
        };
      }

      return { ok: true, lead: validated.data };
    },
  };
}

/** The `meta_lead_ads` Ingestion_Adapter, reading credentials from the env. */
export const metaLeadAdsAdapter: IngestionAdapter = createMetaLeadAdsAdapter();
