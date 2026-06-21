/**
 * Demo seed for the market catalog (`market_*` mirror) — Prospecting Workspace.
 *
 * The live market source (Property Finder reseller via RapidAPI) is gated by
 * `RAPIDAPI_KEY`; absent that, the catalog is empty and the workspace shows "No
 * market comparables are configured yet". This seed populates a realistic Dubai
 * competitor catalog (developers → projects → transactions → price index) so the
 * `find_comparables` / `market_comps` tools return SQL-grounded comparables, a
 * derived Buyer_Hypothesis, and an Area_Trend headline — exactly as they would
 * against live data, just stamped `demo = true` (CC-Synthetic, Decision 10).
 *
 * It writes ONLY through the real, idempotent `ingestMarketBatch` keyed on
 * `(source, source_ref)`, so re-running is a field-identical no-op. No tool,
 * schema, or reader changes — this is pure data.
 */

import type { Database } from "../db";
import type {
  MarketBatch,
  RawDeveloper,
  RawIndex,
  RawProject,
  RawTransaction,
} from "../market/adapter";
import { ingestMarketBatch } from "../market/ingest";

/** The reseller source discriminator — same posture as the live demo feed. */
const SOURCE = "property_finder_reseller";

/** Deterministic mulberry32 PRNG so re-runs produce identical synthetic rows. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(r: () => number, arr: readonly T[]): T {
  return arr[Math.floor(r() * arr.length) % arr.length];
}

function round(n: number, dp = 0): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Subtract `n` days from a base date, return "YYYY-MM-DD". */
function dateMinusDays(base: Date, n: number): string {
  const d = new Date(base.getTime() - n * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

// ── Developers ────────────────────────────────────────────────────────────────

const DEVELOPERS: RawDeveloper[] = [
  { sourceRef: "dev-nakheel", name: "Nakheel", country: "AE" },
  { sourceRef: "dev-emaar", name: "Emaar Properties", country: "AE" },
  { sourceRef: "dev-omniyat", name: "Omniyat", country: "AE" },
  { sourceRef: "dev-meraas", name: "Meraas", country: "AE" },
  { sourceRef: "dev-select", name: "Select Group", country: "AE" },
  { sourceRef: "dev-kerzner", name: "Kerzner International", country: "AE" },
];

// ── Projects (the competitor catalog) ──────────────────────────────────────────

interface SeedProject {
  ref: string;
  developerRef: string;
  name: string;
  area: string; // communityName — what the brief's `area` matches against
  segment: RawProject["segment"];
  unitTypes: string[];
  priceMin: number;
  priceMax: number;
  avgPricePerSqft: number;
  branded?: boolean;
  brandName?: string;
  lat?: number;
  lng?: number;
}

const PROJECTS: SeedProject[] = [
  {
    ref: "mp-palm-signature-villas",
    developerRef: "dev-nakheel",
    name: "Signature Villas Palm Jumeirah",
    area: "Palm Jumeirah",
    segment: "ultra_luxury",
    unitTypes: ["villa"],
    priceMin: 12_000_000,
    priceMax: 28_000_000,
    avgPricePerSqft: 4200,
    lat: 25.112,
    lng: 55.138,
  },
  {
    ref: "mp-palm-beach-residences",
    developerRef: "dev-omniyat",
    name: "Palm Beach Residences",
    area: "Palm Jumeirah",
    segment: "ultra_luxury",
    unitTypes: ["villa", "penthouse", "apartment"],
    priceMin: 6_000_000,
    priceMax: 18_000_000,
    avgPricePerSqft: 3800,
    lat: 25.118,
    lng: 55.131,
  },
  {
    ref: "mp-atlantis-royal-residences",
    developerRef: "dev-kerzner",
    name: "Atlantis The Royal Residences",
    area: "Palm Jumeirah",
    segment: "ultra_luxury",
    unitTypes: ["apartment", "penthouse"],
    priceMin: 8_000_000,
    priceMax: 40_000_000,
    avgPricePerSqft: 5200,
    branded: true,
    brandName: "Atlantis",
  },
  {
    ref: "mp-jbi-bulgari-residences",
    developerRef: "dev-meraas",
    name: "Bulgari Resort & Residences",
    area: "Jumeirah Bay Island",
    segment: "ultra_luxury",
    unitTypes: ["villa", "apartment", "penthouse"],
    priceMin: 10_000_000,
    priceMax: 60_000_000,
    avgPricePerSqft: 6000,
    branded: true,
    brandName: "Bulgari",
  },
  {
    ref: "mp-emirates-hills-grove",
    developerRef: "dev-emaar",
    name: "Hills Grove Villas",
    area: "Emirates Hills",
    segment: "ultra_luxury",
    unitTypes: ["villa"],
    priceMin: 20_000_000,
    priceMax: 80_000_000,
    avgPricePerSqft: 3500,
  },
  {
    ref: "mp-downtown-burj-vista",
    developerRef: "dev-emaar",
    name: "Burj Vista",
    area: "Downtown Dubai",
    segment: "luxury",
    unitTypes: ["apartment", "penthouse"],
    priceMin: 3_000_000,
    priceMax: 20_000_000,
    avgPricePerSqft: 3000,
  },
  {
    ref: "mp-marina-vista",
    developerRef: "dev-emaar",
    name: "Marina Vista",
    area: "Dubai Marina",
    segment: "luxury",
    unitTypes: ["apartment"],
    priceMin: 2_000_000,
    priceMax: 9_000_000,
    avgPricePerSqft: 2200,
  },
  {
    ref: "mp-marina-gate",
    developerRef: "dev-select",
    name: "Marina Gate",
    area: "Dubai Marina",
    segment: "premium",
    unitTypes: ["apartment"],
    priceMin: 1_500_000,
    priceMax: 6_000_000,
    avgPricePerSqft: 1800,
  },
  {
    ref: "mp-businessbay-peninsula",
    developerRef: "dev-select",
    name: "Peninsula",
    area: "Business Bay",
    segment: "premium",
    unitTypes: ["apartment", "studio"],
    priceMin: 1_200_000,
    priceMax: 5_000_000,
    avgPricePerSqft: 1900,
  },
];

/** Buyer-segment mix weighting per market segment (drives Buyer_Hypothesis). */
const SEGMENT_BUYER_MIX: Record<string, readonly string[]> = {
  ultra_luxury: [
    "Family office",
    "HNW individual",
    "HNW individual",
    "International investor",
    "Golden visa holder",
  ],
  luxury: [
    "International investor",
    "End user",
    "Golden visa holder",
    "HNW individual",
    "Buy-to-let investor",
  ],
  premium: [
    "End user",
    "Buy-to-let investor",
    "International investor",
    "First-time buyer",
  ],
  mid: ["End user", "First-time buyer", "Buy-to-let investor"],
};

const NATIONALITIES = [
  "India",
  "United Kingdom",
  "United Arab Emirates",
  "Saudi Arabia",
  "Russia",
  "China",
  "Germany",
] as const;

const BEDROOMS_BY_UNIT: Record<string, number[]> = {
  studio: [0],
  apartment: [1, 2, 3],
  penthouse: [3, 4, 5],
  villa: [4, 5, 6, 7],
};

/** Build the full demo MarketBatch (deterministic). */
export function buildMarketDemoBatch(asOf: Date = new Date()): MarketBatch {
  const transactions: RawTransaction[] = [];
  const priceIndex: RawIndex[] = [];

  const projects: RawProject[] = PROJECTS.map((p) => ({
    sourceRef: p.ref,
    developerSourceRef: p.developerRef,
    name: p.name,
    communityName: p.area,
    city: "Dubai",
    region: "Dubai",
    country: "AE",
    locationLat: p.lat ?? null,
    locationLng: p.lng ?? null,
    segment: p.segment,
    status: "completed",
    totalUnits: 120,
    unitTypes: p.unitTypes,
    priceMin: p.priceMin,
    priceMax: p.priceMax,
    avgPricePerSqft: p.avgPricePerSqft,
    branded: p.branded ?? false,
    brandName: p.brandName ?? null,
    asOf,
  }));

  // Transactions: ~10 sales per project over the trailing ~10 months.
  PROJECTS.forEach((p, pIdx) => {
    const r = rng(1000 + pIdx);
    const mix = SEGMENT_BUYER_MIX[p.segment ?? "premium"] ?? ["End user"];
    const count = 10;
    for (let i = 0; i < count; i++) {
      const unitType = pick(r, p.unitTypes);
      const beds = pick(r, BEDROOMS_BY_UNIT[unitType] ?? [2]);
      const ppsf = round(p.avgPricePerSqft * (0.85 + r() * 0.35));
      const price = round(
        p.priceMin + r() * (p.priceMax - p.priceMin),
        -4 // round to nearest 10k
      );
      const areaSqft = round(price / ppsf);
      transactions.push({
        sourceRef: `${p.ref}-txn-${i}`,
        projectSourceRef: p.ref,
        communityName: p.area,
        areaName: p.area,
        txnType: "sale",
        txnDate: dateMinusDays(asOf, 15 + i * 28 + Math.floor(r() * 14)),
        unitType,
        areaSqm: round(areaSqft * 0.092903, 1),
        bedrooms: beds,
        priceAed: price,
        pricePerSqft: ppsf,
        isCash: r() > 0.5,
        buyerSegment: pick(r, mix),
        buyerNationality: pick(r, NATIONALITIES),
        asOf,
      });
    }
  });

  // Price index: one Area_Trend row per (area, segment) seen, current quarter.
  const areaSeg = new Map<string, SeedProject>();
  for (const p of PROJECTS) areaSeg.set(`${p.area}|${p.segment}`, p);
  let idx = 0;
  for (const [key, p] of areaSeg) {
    const r = rng(9000 + idx++);
    const yoy = round(4 + r() * 12, 1); // 4–16% YoY
    const roi = round(5 + r() * 4, 1); // 5–9% gross yield
    const volume = 40 + Math.floor(r() * 240);
    const avgPrice = round(p.avgPricePerSqft * (0.95 + r() * 0.1));
    priceIndex.push({
      areaName: p.area,
      segment: p.segment ?? null,
      period: "2026-Q1",
      indexValue: round(100 + yoy, 1),
      avgPricePerSqft: avgPrice,
      yoyPct: yoy,
      roiPct: roi,
      volume,
      trend: {
        saleAvgPrice: round(avgPrice * (areaSegAvgSqft(p))),
        saleAvgPriceChange: yoy,
        rentalYield: roi,
        transactionVolume: volume,
        period: "2026-Q1",
      },
      asOf,
    });
    void key;
  }

  return {
    developers: DEVELOPERS,
    projects,
    buildings: [],
    transactions,
    priceIndex,
    cursor: "demo",
  };
}

/** Rough typical unit size (sqft) per segment, for a believable avg sale price. */
function areaSegAvgSqft(p: SeedProject): number {
  if (p.unitTypes.includes("villa")) return 6000;
  if (p.unitTypes.includes("penthouse")) return 3500;
  return 1400;
}

export interface MarketDemoSummary {
  developers: number;
  projects: number;
  transactions: number;
  priceIndex: number;
}

/** Seed the demo market catalog via the real idempotent ingest. */
export async function seedMarketDemo(
  db: Database
): Promise<MarketDemoSummary> {
  const batch = buildMarketDemoBatch();
  await ingestMarketBatch(db, SOURCE, batch, { demo: true });
  return {
    developers: batch.developers.length,
    projects: batch.projects.length,
    transactions: batch.transactions.length,
    priceIndex: batch.priceIndex.length,
  };
}
