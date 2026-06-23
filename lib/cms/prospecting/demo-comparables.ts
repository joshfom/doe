/**
 * Representative (demo) comparable sales — Prospecting Workspace.
 *
 * The market mirror (`market_*`) is fed by an UNOFFICIAL reseller on a TRIAL
 * tier, so a live `find_comparables` read can legitimately return nothing (the
 * area hasn't synced, or the trial quota is exhausted). When that happens the
 * flow must NOT dead-end: the buyer hypothesis and the AI pitch both need
 * concrete comparable transactions to be any good. This module produces a
 * deterministic, clearly-labelled set of representative comparables derived
 * purely from the rep's brief, so the chain always has grounding to work with.
 *
 * DETERMINISTIC (CC-Synthetic): identical brief input ⇒ identical output, so a
 * rep "sees the same data again and again" rather than numbers that churn each
 * refresh. No clock, no randomness — values are derived from the spec via a
 * fixed band ladder. Every row is stamped `source: "demo"` so it is never
 * mistaken for live market data (the UI labels it explicitly).
 */

import type { BriefSpec } from "./brief";

/** A figure paired with its provenance (mirrors the live comparable shape). */
interface StatFigure<T> {
  value: T;
  source: string | null;
  asOf: string | null;
}

/** Aggregate, PII-free buyer-segment mix bucket. */
interface SegmentBucket {
  segment: string;
  count: number;
  pct: number;
}

/** One representative comparable project (matches the live `Comparable` shape). */
export interface DemoComparable {
  marketProjectId: string;
  name: string;
  communityName: string | null;
  segment: string | null;
  score: number;
  reasons: string[];
  source: string;
  asOf: string | null;
  stats: {
    marketProjectId: string;
    txnCount: number;
    recentSalePriceAed: StatFigure<number | null>;
    avgPricePerSqft: StatFigure<number | null>;
    velocitySalesLast12m: StatFigure<number | null>;
    buyerSegmentMix: StatFigure<SegmentBucket[]>;
  };
}

/** Fixed as-of stamp so repeated reads of the same brief are byte-identical. */
const DEMO_ASOF = "2026-01-01T00:00:00.000Z";
const DEMO_SOURCE = "demo";

/** Representative price-per-sqft by segment (AED/sqft) — a fixed band ladder. */
const PPSF_BY_SEGMENT: Record<string, number> = {
  ultra_luxury: 6000,
  luxury: 3500,
  premium: 2000,
  mid: 1200,
};

/** Representative headline sale price (AED) by segment when no band is given. */
const PRICE_BY_SEGMENT: Record<string, number> = {
  ultra_luxury: 35_000_000,
  luxury: 18_000_000,
  premium: 8_000_000,
  mid: 3_000_000,
};

/** Synthetic comparable developers/projects — different developers for context. */
const COMP_PROJECTS = [
  { suffix: "Signature Residences", developer: "Emaar" },
  { suffix: "Marina Heights", developer: "DAMAC" },
  { suffix: "Beachfront Collection", developer: "Nakheel" },
] as const;

/** The aggregate buyer-segment mix demo comparables present (PII-free labels). */
const DEMO_SEGMENT_MIX: ReadonlyArray<{ segment: string; weight: number }> = [
  { segment: "International investor", weight: 38 },
  { segment: "Family office", weight: 27 },
  { segment: "HNW individual", weight: 23 },
  { segment: "Golden visa holder", weight: 12 },
];

/** A small deterministic spread factor per comp so the three rows aren't identical. */
const SPREAD = [1, 0.92, 1.08] as const;

function round(n: number): number {
  return Math.round(n);
}

/**
 * Build a deterministic set of representative comparable sales from the brief.
 * Used as the labelled fallback when the live market read returns nothing, so
 * the hypothesis + pitch always have concrete grounding (CC-Synthetic).
 */
export function buildDemoComparables(spec: BriefSpec): DemoComparable[] {
  const segment = spec.segment ?? "premium";
  const area = spec.area?.trim() || "Dubai";
  const ppsfBase = PPSF_BY_SEGMENT[segment] ?? PPSF_BY_SEGMENT.premium;

  // Headline price: midpoint of the rep's band when given, else a segment default.
  const bandMid =
    spec.priceMinAed != null && spec.priceMaxAed != null
      ? (spec.priceMinAed + spec.priceMaxAed) / 2
      : spec.priceMaxAed ?? spec.priceMinAed ?? null;
  const priceBase = bandMid ?? PRICE_BY_SEGMENT[segment] ?? PRICE_BY_SEGMENT.premium;

  const unit = spec.unitType ?? "property";
  const beds = spec.bedrooms;

  return COMP_PROJECTS.map((proj, i) => {
    const spread = SPREAD[i] ?? 1;
    const price = round(priceBase * spread);
    const ppsf = round(ppsfBase * spread);
    const velocity = 18 - i * 4; // 18, 14, 10 — deterministic
    const txnCount = 24 - i * 6; // 24, 18, 12

    const mixTotal = txnCount;
    const buyerSegmentMix: SegmentBucket[] = DEMO_SEGMENT_MIX.map((s) => {
      const count = Math.max(1, round((s.weight / 100) * mixTotal));
      return { segment: s.segment, count, pct: s.weight };
    });

    const reasons = [
      `Similar ${unit}${beds != null ? ` (${beds}-bed)` : ""} in a comparable price band`,
      `Same ${segment.replace(/_/g, " ")} segment`,
      `Recent sales activity in ${area}`,
    ];

    return {
      marketProjectId: `demo-comp-${i + 1}`,
      name: `${area} ${proj.suffix}`,
      communityName: area,
      segment,
      score: 0.9 - i * 0.08,
      reasons,
      source: DEMO_SOURCE,
      asOf: DEMO_ASOF,
      stats: {
        marketProjectId: `demo-comp-${i + 1}`,
        txnCount,
        recentSalePriceAed: { value: price, source: DEMO_SOURCE, asOf: DEMO_ASOF },
        avgPricePerSqft: { value: ppsf, source: DEMO_SOURCE, asOf: DEMO_ASOF },
        velocitySalesLast12m: { value: velocity, source: DEMO_SOURCE, asOf: DEMO_ASOF },
        buyerSegmentMix: { value: buyerSegmentMix, source: DEMO_SOURCE, asOf: DEMO_ASOF },
      },
    };
  });
}
