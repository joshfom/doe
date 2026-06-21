/**
 * Agentic Prospecting Batch — deterministic, explainable fit scoring
 * (Design §Components #4 "Fit scoring"; Requirements 2.4, 2.6).
 *
 * `scoreCandidateFit(subject, candidate)` scores how well a discovered candidate
 * (`ProviderResult`) matches a Batch_Run's subject — either a direct ICP filter
 * or a cluster-derived hypothesis (an ICP filter + optional market context).
 *
 * The function is **PURE and DETERMINISTIC**: no DB, no I/O, no clock, no
 * randomness. Identical `(subject, candidate)` inputs always yield identical
 * output. It NEVER asks a model to invent a number (Req 2.6) — the score is a
 * weighted average of signal-overlap similarities over the dimensions the
 * subject actually specifies, and the returned {@link FitRationale} enumerates
 * every evaluated signal with its weight and contribution so the score is fully
 * explainable (Req 2.4).
 *
 * It reuses the existing market ranking primitive `rankComparables`
 * (`lib/cms/market/comparables.ts`) for the optional market-alignment dimension
 * when the subject carries cluster-derived market context, and mirrors that
 * module's "weighted average over only the specified dimensions, normalised, and
 * rounded to 4 decimals for stable comparison" signal-overlap logic for the
 * person/account signal dimensions (titles, seniority, geography, wealth /
 * funding signals, industry).
 */

import {
  rankComparables,
  type BriefSpecInput,
  type MarketProjectRow,
} from "../../market/comparables";
import type { ProspectFilter, ProviderResult } from "../providers";

// ── Subject ─────────────────────────────────────────────────────────────────

/**
 * A Batch_Run subject (Design §Components #1). The fit scorer reads the ICP
 * filter (`icpFilter`) for the candidate-signal dimensions. For a `cluster`
 * subject the orchestrator resolves the cluster to a hypothesis-derived
 * `icpFilter` (and, optionally, `marketContext`) before scoring, so the scorer
 * stays pure.
 */
export interface BatchSubject {
  kind: "cluster" | "icp";
  /** When `kind === "cluster"` — the originating Bayn cluster. */
  clusterId?: string;
  /** Optional originating Prospecting_Brief. */
  briefId?: string;
  /**
   * The ICP filter to score against. Present directly for an `icp` subject and
   * populated from the cluster-derived hypothesis for a `cluster` subject.
   */
  icpFilter?: ProspectFilter;
  /**
   * Optional cluster-derived market context. When present, the candidate is
   * scored on a market-alignment dimension via `rankComparables` reuse.
   */
  marketContext?: {
    brief: { spec?: BriefSpecInput; resolvedSpec?: BriefSpecInput };
    comparables: MarketProjectRow[];
  };
}

// ── Rationale ─────────────────────────────────────────────────────────────────

/** One evaluated dimension's contribution to the overall fit score. */
export interface FitSignalContribution {
  /** The signal dimension evaluated (e.g. `"titles"`, `"geography"`). */
  dimension: string;
  /** The dimension's relative weight in the (normalised) overall score. */
  weight: number;
  /** Sub-score in `[0, 1]` for this dimension. */
  similarity: number;
  /** The subject's expected signals for the dimension. */
  expected: string[];
  /** The candidate signals that matched an expected signal. */
  matched: string[];
}

/**
 * The explainable rationale for a fit score: a non-empty enumeration of every
 * signal dimension that was evaluated, each with its weight and contribution,
 * plus the overall normalised score and a human-readable summary (Req 2.4).
 */
export interface FitRationale {
  /** Overall fit score in `[0, 1]`, mirroring the returned `score`. */
  score: number;
  /** Every evaluated dimension with its weight and similarity. Always non-empty. */
  signals: FitSignalContribution[];
  /** A short, deterministic human-readable explanation of the score. */
  summary: string;
}

/** The result of scoring one candidate against one subject. */
export interface FitScoreResult {
  /** Deterministic fit score in `[0, 1]`. */
  score: number;
  /** Non-empty, explainable rationale enumerating matched signals + weights. */
  rationale: FitRationale;
}

// ── Weights ─────────────────────────────────────────────────────────────────

/**
 * Relative weight of each scoring dimension. Mirrors the comparables ranker:
 * only the dimensions the subject actually specifies contribute, and the final
 * score is the weighted average over the specified dimensions — so a sparse
 * subject is never penalised for the dimensions it omits.
 */
const WEIGHTS = {
  titles: 0.3,
  seniority: 0.15,
  geography: 0.2,
  wealth: 0.15,
  funding: 0.1,
  industry: 0.1,
  market: 0.2,
} as const;

// ── Normalisation + matching helpers (deterministic) ──────────────────────────

/** Normalise free text for comparison (lowercase, collapse non-alphanumerics). */
function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Round to 4 decimals for stable, noise-free score comparison. */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/**
 * Does a candidate value match an expected signal? Symmetric containment over
 * normalised text (mirrors the demo provider's relevance matching), so e.g.
 * "Founder & CEO" matches the expected seed "Founder".
 */
function valueMatchesSignal(candidateValue: string, expected: string): boolean {
  const hay = normalizeText(candidateValue);
  const needle = normalizeText(expected);
  if (!hay || !needle) return false;
  return hay === needle || hay.includes(needle) || needle.includes(hay);
}

/**
 * Set-overlap similarity of a candidate's values against the subject's expected
 * signals for one dimension: the fraction of expected signals matched by at
 * least one candidate value. Returns `null` when the dimension is unspecified
 * (empty `expected`) so the caller can skip it (sparse-subject handling).
 */
function signalOverlap(
  candidateValues: string[],
  expected: string[] | undefined
): { similarity: number; matched: string[]; expected: string[] } | null {
  const expectedClean = (expected ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (expectedClean.length === 0) return null;

  const candidates = candidateValues
    .map((v) => v.trim())
    .filter((v) => v.length > 0);

  const matchedExpected: string[] = [];
  const matchedCandidate = new Set<string>();
  for (const exp of expectedClean) {
    const hit = candidates.find((c) => valueMatchesSignal(c, exp));
    if (hit !== undefined) {
      matchedExpected.push(exp);
      matchedCandidate.add(hit);
    }
  }

  return {
    similarity: round4(matchedExpected.length / expectedClean.length),
    matched: [...matchedCandidate],
    expected: expectedClean,
  };
}

/** Read a provenanced attribute's value off a candidate, if present. */
function attr(candidate: ProviderResult, key: string): string | undefined {
  return candidate.attributes[key]?.value;
}

/** Collect the candidate's values for a logical signal dimension (deduped, ordered). */
function candidateValues(
  candidate: ProviderResult,
  ...values: Array<string | undefined>
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (v == null) continue;
    const key = normalizeText(v);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

// ── Scoring ───────────────────────────────────────────────────────────────────

/**
 * Score how well `candidate` matches `subject`.
 *
 * Pure and deterministic: same input → same output. The score is the weighted
 * average of the signal-overlap similarities over only the dimensions the
 * subject specifies (so an omitted dimension neither helps nor hurts). The
 * rationale enumerates every evaluated dimension with its weight and similarity.
 */
export function scoreCandidateFit(
  subject: BatchSubject,
  candidate: ProviderResult
): FitScoreResult {
  const filter = subject.icpFilter;
  const signals: FitSignalContribution[] = [];
  let weightedSum = 0;
  let weightTotal = 0;

  const addDimension = (
    dimension: string,
    weight: number,
    overlap:
      | { similarity: number; matched: string[]; expected: string[] }
      | null
  ): void => {
    if (overlap === null) return;
    weightedSum += weight * overlap.similarity;
    weightTotal += weight;
    signals.push({
      dimension,
      weight,
      similarity: overlap.similarity,
      expected: overlap.expected,
      matched: overlap.matched,
    });
  };

  if (filter) {
    // Titles — candidate.title + any title attribute.
    addDimension(
      "titles",
      WEIGHTS.titles,
      signalOverlap(
        candidateValues(candidate, candidate.title, attr(candidate, "title")),
        filter.titles
      )
    );

    // Seniority.
    addDimension(
      "seniority",
      WEIGHTS.seniority,
      signalOverlap(
        candidateValues(candidate, attr(candidate, "seniority")),
        filter.seniority
      )
    );

    // Geography — candidate.country + any country/geography attribute.
    addDimension(
      "geography",
      WEIGHTS.geography,
      signalOverlap(
        candidateValues(
          candidate,
          candidate.country,
          attr(candidate, "country"),
          attr(candidate, "geography")
        ),
        filter.geography
      )
    );

    // Wealth signals.
    addDimension(
      "wealth",
      WEIGHTS.wealth,
      signalOverlap(
        candidateValues(
          candidate,
          attr(candidate, "wealthSignal"),
          attr(candidate, "wealthSignals")
        ),
        filter.wealthSignals
      )
    );

    // Funding / liquidity signals.
    addDimension(
      "funding",
      WEIGHTS.funding,
      signalOverlap(
        candidateValues(
          candidate,
          attr(candidate, "fundingSignal"),
          attr(candidate, "fundingSignals")
        ),
        filter.fundingSignals
      )
    );

    // Industry.
    addDimension(
      "industry",
      WEIGHTS.industry,
      signalOverlap(
        candidateValues(candidate, attr(candidate, "industry")),
        filter.industries
      )
    );
  }

  // Market-alignment dimension — reuse the comparables ranker on the
  // cluster-derived market context. The top comparable's similarity is the
  // market-fit sub-score (deterministic; `rankComparables` is pure).
  if (subject.marketContext && subject.marketContext.comparables.length > 0) {
    const ranked = rankComparables(
      subject.marketContext.brief,
      subject.marketContext.comparables
    );
    const top = ranked.length > 0 ? ranked[0].score : 0;
    weightedSum += WEIGHTS.market * top;
    weightTotal += WEIGHTS.market;
    signals.push({
      dimension: "market",
      weight: WEIGHTS.market,
      similarity: round4(top),
      expected: ["cluster market comparables"],
      matched:
        ranked.length > 0 && ranked[0].score > 0
          ? [ranked[0].marketProjectId]
          : [],
    });
  }

  const score = weightTotal > 0 ? round4(weightedSum / weightTotal) : 0;

  // Guarantee a non-empty rationale even when the subject specifies no
  // comparison signals (Req 2.4: rationale must always be non-empty).
  if (signals.length === 0) {
    signals.push({
      dimension: "none",
      weight: 0,
      similarity: 0,
      expected: [],
      matched: [],
    });
  }

  const matchedDims = signals.filter((s) => s.matched.length > 0);
  const summary =
    weightTotal === 0
      ? "No comparison signals available; fit defaults to 0."
      : matchedDims.length === 0
        ? `No signals matched across ${signals.length} evaluated dimension(s); fit ${score}.`
        : `Fit ${score} from ${matchedDims
            .map((s) => `${s.dimension} (${s.similarity}×${s.weight})`)
            .join(", ")}.`;

  return {
    score,
    rationale: { score, signals, summary },
  };
}
