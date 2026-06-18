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
      sourceTable: z.enum([
        "market_transactions",
        "market_price_index",
        "leads_mirror",
        "parties",
      ]),
      recordId: z.string(),
      asOf: z.string().datetime(),
    }),
  ),
});
export type OutreachDraft = z.infer<typeof outreachDraftSchema>;
