/**
 * Prospecting Workspace (S7) — OutreachDraft schema + grounding-manifest contract
 * (Design §Components #7; Requirements 6.1, 6.2).
 *
 * An OutreachDraft is an editable, multi-channel, model-written approach in the
 * rep's voice and requested language (EN/AR). It is never auto-sent: a send
 * requires an explicit human Approval_Flow token.
 *
 * Every factual claim in the draft is pinned by the {@link outreachDraftSchema}
 * `grounding` manifest to a real record in a named SQL source (the Market_Mirror
 * or the party graph), with its `asOf` stamp — the model writes prose only and
 * never invents figures (CC-SQL).
 *
 * S7 increment (Design §4, Req 14.8 — extends Req 6.2): the `sourceTable` enum
 * already names BOTH market tables, so this contract is unchanged. A claim
 * grounded in an Area_Trend pins to a `market_price_index` row by `recordId`
 * (the stable id surfaced by `market_comps`, now carrying ROI / volume / YoY);
 * a claim grounded in a specific comparable pins to a `market_transactions` row
 * by `id`. Every market / Area_Trend figure a draft embeds therefore traces to a
 * real `market_*` record — never model-computed.
 */

import { z } from "zod";

// ── Schema ───────────────────────────────────────────────────────────────────

/** An editable, grounded, unsent outreach draft for a researched Target. */
export const outreachDraftSchema = z.object({
  targetId: z.string().uuid(),
  briefId: z.string().uuid().optional(),
  channel: z.enum(["email", "whatsapp", "message"]),
  language: z.enum(["en", "ar"]),
  subject: z.string().max(200).optional(),
  body: z.string().max(8000),
  /** The grounding manifest: every factual claim → its SQL source record (Req 6 C2, CC-SQL). */
  grounding: z.array(
    z.object({
      claim: z.string().max(200),
      // The named SQL source the claim's figure is read back from. An Area_Trend
      // claim pins to `market_price_index`, a specific-comp claim pins to
      // `market_transactions`; party-graph claims pin to `leads_mirror` /
      // `parties`. A claim about the OWN unit being sold (its asking price, size,
      // floor, handover) pins to `ai_units` — the rep's own catalog record, the
      // actual Own_Subject of the outreach. No figure is ever model-computed.
      sourceTable: z.enum([
        "market_transactions",
        "market_price_index",
        "leads_mirror",
        "parties",
        "ai_units",
      ]),
      recordId: z.string(),
      asOf: z.string().datetime(),
    }),
  ),
});
export type OutreachDraft = z.infer<typeof outreachDraftSchema>;
