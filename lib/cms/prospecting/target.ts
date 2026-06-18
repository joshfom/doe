/**
 * Prospecting Workspace (S7) — Target schema + per-field provenance contract
 * (Design §Components #3; Requirements 1.2, 1.3, 9.1, CC-Provenance).
 *
 * A Target is a prospective buyer or partner the workspace researches and may
 * approach; `targetType ∈ {person, company, intermediary}`. A Target is NOT a
 * Lead and is NOT a `tickets` row — it is promoted into the party graph
 * (`parties` + `leads_mirror`) on qualification.
 *
 * Every enriched attribute carries its own provenance ({@link provenancedFieldSchema}):
 * the source provider, fetch/as-of timestamp, and — for PII fields — a lawful-basis
 * marker, so purchased data is never indistinguishable from first-party data. The
 * record itself also carries record-level acquisition provenance + lawful basis.
 * A Target's phone is persisted only as a salted hash; the raw phone is held
 * transiently for an eventual Salesforce-bound payload (CC-Privacy).
 */

import { z } from "zod";

// ── Schema ───────────────────────────────────────────────────────────────────

/** The three prospecting modes a Target can carry. */
export const TARGET_TYPES = ["person", "company", "intermediary"] as const;

/** Every enriched attribute carries its own provenance (CC-Provenance). */
export const provenancedFieldSchema = z.object({
  value: z.string(),
  source: z.string(), // provider id
  asOf: z.string().datetime(),
  lawfulBasis: z.string().optional(), // required for PII fields
});
export type ProvenancedField = z.infer<typeof provenancedFieldSchema>;

/** The canonical Target object across all three prospecting modes. */
export const targetSchema = z.object({
  targetType: z.enum(TARGET_TYPES),
  displayName: z.string().max(255).optional(),
  companyName: z.string().max(255).optional(),
  title: z.string().max(160).optional(),
  email: z.string().max(254).optional(), // normalized; matchable identity
  phone: z.string().optional(), // raw only in-memory / SF-bound → persisted as hash
  country: z.string().max(60).optional(),
  attributes: z.record(z.string(), provenancedFieldSchema).default({}),
  sourceProvider: z.string(), // record-acquisition provenance (Req 1 C3)
  sourceRef: z.string().optional(),
  lawfulBasis: z.string(), // record-level lawful basis
});
export type Target = z.infer<typeof targetSchema>;
