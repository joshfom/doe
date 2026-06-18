/**
 * lib/cms/market/comparables.ts
 *
 * PURE comparables ranker for the Prospecting Workspace (S7).
 *
 * Given a Prospecting_Brief (the thing a rep wants to sell) and a set of
 * external `market_projects` rows, this module ranks the projects by their
 * similarity to the brief over four dimensions — area, segment, price band,
 * and unit mix — and explains each match.
 *
 * Design constraints (Design §Components #2; Requirement 11.3):
 *  - PURE: no DB access, no I/O, no clock, no randomness. Identical inputs
 *    always yield identical output (deterministic), which is what makes the
 *    SQL-grounded `find_comparables` tool reproducible (CC-SQL).
 *  - STABLE ordering: results are sorted by descending score, with ties broken
 *    deterministically by ascending `marketProjectId`.
 *
 * NOTE: The shared `ProspectingBrief` / `BriefSpec` Zod types live in
 * `lib/cms/prospecting/brief.ts` (created in parallel as task 2.2). To let this
 * module compile and be unit-tested independently, we define a minimal local
 * `BriefSpecInput` describing only the fields the ranker reads. When the shared
 * schema lands, callers can pass its inferred type — the shapes are compatible.
 */

import type { marketProjects } from "../schema";

/** A persisted `market_projects` row (Drizzle select model). */
export type MarketProjectRow = typeof marketProjects.$inferSelect;

/** Market segments, ordered from most to least premium. */
export const SEGMENT_LADDER = [
  "ultra_luxury",
  "luxury",
  "premium",
  "mid",
] as const;
export type MarketSegment = (typeof SEGMENT_LADDER)[number];

/**
 * The subset of a Prospecting_Brief spec the ranker reads. Mirrors
 * `briefSpecSchema` in `lib/cms/prospecting/brief.ts`; kept structurally
 * compatible so the shared type can be passed directly once available.
 */
export interface BriefSpecInput {
  area?: string;
  segment?: MarketSegment;
  unitType?: string;
  bedrooms?: number;
  priceMinAed?: number;
  priceMaxAed?: number;
  features?: string[];
}

/** A single ranked comparable. */
export interface RankedComparable {
  marketProjectId: string;
  /** Similarity in [0, 1], rounded to 4 decimals for stable comparison. */
  score: number;
  /** Human-readable explanations of which dimensions matched. */
  reasons: string[];
}

/**
 * Relative weight of each similarity dimension. Only the dimensions the brief
 * actually specifies contribute; the final score is the weighted average over
 * the specified dimensions, so a sparse brief is not penalised for the
 * dimensions it omits.
 */
const WEIGHTS = {
  area: 0.35,
  segment: 0.25,
  price: 0.25,
  unitMix: 0.15,
} as const;

/** Normalise a free-text location/name for comparison. */
function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Area similarity: compares the brief's area against the project's
 * community / city / region / country. Exact normalised match scores 1;
 * a containment (one string contains the other) scores 0.6; otherwise 0.
 */
function areaSimilarity(
  briefArea: string,
  project: MarketProjectRow
): { sim: number; matchedOn: string | null } {
  const needle = normalizeText(briefArea);
  if (!needle) return { sim: 0, matchedOn: null };

  const candidates: Array<[string, string | null]> = [
    ["community", project.communityName],
    ["city", project.city],
    ["region", project.region],
    ["country", project.country],
  ];

  let best = 0;
  let bestField: string | null = null;
  for (const [field, raw] of candidates) {
    const hay = normalizeText(raw);
    if (!hay) continue;
    let sim = 0;
    if (hay === needle) sim = 1;
    else if (hay.includes(needle) || needle.includes(hay)) sim = 0.6;
    if (sim > best) {
      best = sim;
      bestField = field;
    }
  }
  return { sim: best, matchedOn: bestField };
}

/**
 * Segment similarity using the premium ladder. Exact match scores 1; each step
 * of distance on the ladder reduces the score linearly (adjacent ~0.67).
 */
function segmentSimilarity(
  briefSegment: MarketSegment,
  projectSegment: MarketProjectRow["segment"]
): number {
  if (!projectSegment) return 0;
  const a = SEGMENT_LADDER.indexOf(briefSegment);
  const b = SEGMENT_LADDER.indexOf(projectSegment as MarketSegment);
  if (a < 0 || b < 0) return 0;
  const span = SEGMENT_LADDER.length - 1;
  return Math.max(0, 1 - Math.abs(a - b) / span);
}

/**
 * Price-band similarity via interval overlap (intersection-over-union) of the
 * brief band and the project band. Missing brief bounds are treated as open
 * (0 / project max) so a one-sided brief still ranks sensibly. Returns 0 when
 * the project carries no price data.
 */
function priceSimilarity(
  spec: BriefSpecInput,
  project: MarketProjectRow
): number {
  const projMin = project.priceMin ?? project.priceMax;
  const projMax = project.priceMax ?? project.priceMin;
  if (projMin == null || projMax == null) return 0;

  const briefLo = spec.priceMinAed ?? 0;
  const briefHi = spec.priceMaxAed ?? Math.max(projMax, briefLo);

  const lo = Math.min(briefLo, briefHi);
  const hi = Math.max(briefLo, briefHi);
  const pLo = Math.min(projMin, projMax);
  const pHi = Math.max(projMin, projMax);

  const overlap = Math.max(0, Math.min(hi, pHi) - Math.max(lo, pLo));
  const union = Math.max(hi, pHi) - Math.min(lo, pLo);
  if (union <= 0) {
    // Both bands collapse to a single point: similar iff identical.
    return lo === pLo ? 1 : 0;
  }
  return overlap / union;
}

/**
 * Unit-mix similarity: does the project offer the brief's requested unit type?
 * Match scores 1, absence scores 0. When the project lists no unit types we
 * cannot confirm, so we score 0.
 */
function unitMixSimilarity(
  briefUnitType: string,
  project: MarketProjectRow
): boolean {
  const needle = normalizeText(briefUnitType);
  if (!needle) return false;
  const types = Array.isArray(project.unitTypes)
    ? (project.unitTypes as unknown[])
    : [];
  return types.some(
    (t) => typeof t === "string" && normalizeText(t) === needle
  );
}

/** Round to 4 decimals for stable, noise-free score comparison. */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/**
 * Rank `projects` by similarity to `brief`.
 *
 * The brief may carry a `resolvedSpec` (the merged own-project/unit + free-form
 * spec). We read from `resolvedSpec` when present, otherwise from `spec`.
 *
 * Ordering is deterministic: descending score, then ascending `marketProjectId`.
 */
export function rankComparables(
  brief: { spec?: BriefSpecInput; resolvedSpec?: BriefSpecInput },
  projects: MarketProjectRow[]
): RankedComparable[] {
  const spec: BriefSpecInput = brief.resolvedSpec ?? brief.spec ?? {};

  const ranked = projects.map((project): RankedComparable => {
    let weightedSum = 0;
    let weightTotal = 0;
    const reasons: string[] = [];

    // Area
    if (spec.area != null && spec.area !== "") {
      const { sim, matchedOn } = areaSimilarity(spec.area, project);
      weightedSum += WEIGHTS.area * sim;
      weightTotal += WEIGHTS.area;
      if (sim >= 1) reasons.push(`Same area (${matchedOn}: ${spec.area})`);
      else if (sim > 0)
        reasons.push(`Nearby area (${matchedOn}: ${spec.area})`);
    }

    // Segment
    if (spec.segment != null) {
      const sim = segmentSimilarity(spec.segment, project.segment);
      weightedSum += WEIGHTS.segment * sim;
      weightTotal += WEIGHTS.segment;
      if (sim >= 1) reasons.push(`Same segment (${spec.segment})`);
      else if (sim > 0)
        reasons.push(
          `Adjacent segment (${spec.segment} vs ${project.segment})`
        );
    }

    // Price band
    if (spec.priceMinAed != null || spec.priceMaxAed != null) {
      const sim = priceSimilarity(spec, project);
      weightedSum += WEIGHTS.price * sim;
      weightTotal += WEIGHTS.price;
      if (sim >= 0.5) reasons.push("Overlapping price band");
      else if (sim > 0) reasons.push("Partially overlapping price band");
    }

    // Unit mix
    if (spec.unitType != null && spec.unitType !== "") {
      const matched = unitMixSimilarity(spec.unitType, project);
      weightedSum += WEIGHTS.unitMix * (matched ? 1 : 0);
      weightTotal += WEIGHTS.unitMix;
      if (matched) reasons.push(`Offers unit type (${spec.unitType})`);
    }

    const score = weightTotal > 0 ? round4(weightedSum / weightTotal) : 0;
    return { marketProjectId: project.id, score, reasons };
  });

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Stable, deterministic tie-break by id.
    return a.marketProjectId < b.marketProjectId
      ? -1
      : a.marketProjectId > b.marketProjectId
        ? 1
        : 0;
  });

  return ranked;
}
