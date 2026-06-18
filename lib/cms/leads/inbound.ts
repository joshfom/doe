/**
 * Lead Engine (S3) — canonical inbound-lead shape.
 *
 * Every Lead_Source normalizes its Raw_Payload to one source-agnostic
 * {@link InboundLead}, defined by a single Zod schema. Downstream parsing,
 * dedupe, routing, and enrichment all depend on this single contract, so the
 * schema is the source of truth and the TypeScript type is derived via
 * `z.infer`.
 *
 * Design references: §Components #1 (Canonical InboundLead + Ingestion
 * adapters).
 * Requirements: 2.1 (single canonical Zod schema with the required/optional
 * fields and length bounds), 2.2 (adapters validate against this schema).
 *
 * Convention: schemas are the source of truth; types are derived via
 * `z.infer`. Where the design shows a hand-written `interface`/`type`, an
 * equivalent is exported so consumers can import either form.
 */

import { z } from "zod";

// ── Lead sources ─────────────────────────────────────────────────────────────

/** The five distinct origin channels for an inbound lead (Req 1.1, 2.1). */
export const LEAD_SOURCES = [
  "web_form",
  "email",
  "whatsapp",
  "meta_lead_ads",
  "portal",
] as const;

/** A distinct origin channel for an inbound lead. */
export type LeadSource = (typeof LEAD_SOURCES)[number];

// ── Canonical inbound lead ───────────────────────────────────────────────────

/**
 * The single canonical shape every source normalizes to (Req 2.1).
 *
 * Required: `source`, `capturedAt`, `rawPayload`, `idempotencyKey`.
 * Optional: `name`, `email`, `phone`, `attribution`.
 * `content` defaults to `""`; `rawPayload` is retained verbatim.
 */
export const inboundLeadSchema = z.object({
  /** The Lead_Source this lead was captured from (Req 2.1). */
  source: z.enum(LEAD_SOURCES),
  /** ISO 8601 UTC capture timestamp (Req 2.1). */
  capturedAt: z.iso.datetime(),
  /** Contact name, ≤255 characters (Req 2.1). */
  name: z.string().max(255).optional(),
  /** Contact email, ≤254 characters (Req 2.1). */
  email: z.string().max(254).optional(),
  /** Raw phone; only in-memory / Salesforce-bound, persisted as a hash (Req 13.1). */
  phone: z.string().optional(),
  /** Free-text content, ≤10,000 characters (Req 2.1). */
  content: z.string().max(10_000).default(""),
  /** The unmodified original Raw_Payload, retained verbatim (Req 1.3, 2.1). */
  rawPayload: z.unknown(),
  /** UTM/attribution data from `ora_attribution` when present (Req 1.4). */
  attribution: z.record(z.string(), z.string()).optional(),
  /** Idempotency key, 1–255 characters (Req 2.1, 3.2). */
  idempotencyKey: z.string().min(1).max(255),
});

/** The canonical, source-agnostic representation of an inbound lead. */
export type InboundLead = z.infer<typeof inboundLeadSchema>;

// ── Ingestion adapter contract ───────────────────────────────────────────────

/**
 * The result of normalizing a Raw_Payload through an {@link IngestionAdapter}.
 *
 * - `invalid_payload` — the payload could not be normalized into a
 *   schema-valid {@link InboundLead} (Req 2.3).
 * - `unconfigured_source` — required source credentials are absent, so the
 *   adapter produces no lead and retains the Raw_Payload for retry (Req 1.7).
 */
export type NormalizeResult =
  | { ok: true; lead: InboundLead }
  | {
      ok: false;
      code: "invalid_payload" | "unconfigured_source";
      message: string;
      raw: unknown;
    };

/** One source adapter: Raw_Payload → canonical {@link InboundLead} (Req 1.2). */
export interface IngestionAdapter {
  /** The single Lead_Source this adapter ingests (Req 1.1, 1.2). */
  readonly source: LeadSource;
  /** Normalize a Raw_Payload into an InboundLead or a normalization failure. */
  normalize(raw: unknown): NormalizeResult;
}
