/**
 * Prospecting Workspace (S7) — Buyer_Hypothesis schema (Design §Components #1;
 * Requirements 10.3, 10.4).
 *
 * The Buyer_Hypothesis is the Prospecting_Agent's evidence-backed, editable
 * proposal of who is most likely to buy the brief (segments, feeder markets,
 * titles, wealth signals). Every numeric `evidence` item is grounded in the
 * Market_Mirror via a SQL `sourceTable` + `asOf` stamp — the model narrates the
 * claim but never computes the figure (CC-SQL). The hypothesis is surfaced as an
 * editable proposal the rep can adjust before Target_Search runs against it.
 */

import { z } from "zod";

// ── Schema ───────────────────────────────────────────────────────────────────

/** The agent's editable, evidence-backed buyer profile for a brief. */
export const buyerHypothesisSchema = z.object({
  segments: z.array(z.string().max(80)).max(12), // e.g. "post-liquidity founders"
  feederMarkets: z.array(z.string().max(60)).max(20), // e.g. "India", "UK"
  titles: z.array(z.string().max(80)).max(20), // search seeds for prospect_search
  wealthSignals: z.array(z.string().max(80)).max(20),
  evidence: z.array(
    z.object({
      // grounded in comparables (CC-SQL)
      claim: z.string().max(200),
      sourceTable: z.enum(["market_transactions", "market_price_index"]),
      asOf: z.string().datetime(),
    }),
  ),
  confidence: z.enum(["low", "medium", "high"]),
});
export type BuyerHypothesis = z.infer<typeof buyerHypothesisSchema>;
