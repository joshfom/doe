// lib/cms/market/stats.ts
//
// SQL stat readers over the `market_*` mirror (CC-SQL, Design §Components #2).
//
// `comparableStats` reads ONLY the `market_*` tables, so every figure it returns
// is SQL-sourced — never model-computed — and is identical across repeated reads
// over unchanged data (Property 3 / Requirements 11.3, 11.4, 10.4). Each figure
// carries its own `source` + `asOf` so the UI/outreach can stamp provenance
// ("official DLD, Q1 2026" vs "reseller, cleaned" — Requirement 11.4).
//
// CRITICAL (Decision 4 / Requirement 11.4): the buyer-segment mix is
// AGGREGATE-only — counts and percentages by segment label. No individual buyer
// PII is ever read or returned; only `market_transactions.buyer_segment` (a
// segment label column) is grouped, never a person-identifying field.

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "../db";
import { marketTransactions } from "../schema";

/** A single figure paired with the provenance of the record(s) it derives from. */
export interface StatFigure<T> {
  value: T;
  /** Provider id of the contributing record (e.g. "dubai_pulse"), or null when no data. */
  source: string | null;
  /** ISO timestamp of the contributing record's `as_of`, or null when unavailable. */
  asOf: string | null;
}

/** One bucket of the aggregate buyer-segment mix (never individual PII). */
export interface BuyerSegmentMixEntry {
  /** The aggregate segment label from `market_transactions.buyer_segment`. */
  segment: string;
  /** Number of sale transactions attributed to this segment. */
  count: number;
  /** Share of the segmented sales, 0–100, rounded to one decimal place. */
  pct: number;
}

/** SQL-sourced statistics for a single comparable market project. */
export interface CompStats {
  marketProjectId: string;
  /** Total sale transactions considered for this project. */
  txnCount: number;
  /** Most recent sale price (AED) — from the latest priced sale transaction. */
  recentSalePriceAed: StatFigure<number | null>;
  /** Average price per sqft across priced sale transactions. */
  avgPricePerSqft: StatFigure<number | null>;
  /** Sale transactions in the trailing 12 months relative to the latest sale. */
  velocitySalesLast12m: StatFigure<number | null>;
  /** Aggregate buyer-segment mix — counts/percentages by segment, no PII. */
  buyerSegmentMix: StatFigure<BuyerSegmentMixEntry[]>;
}

/** Internal row shape pulled from `market_transactions` (sale rows only). */
interface TxnRow {
  id: string;
  marketProjectId: string | null;
  txnDate: string; // "YYYY-MM-DD"
  priceAed: number | null;
  pricePerSqft: number | null;
  buyerSegment: string | null;
  source: string;
  asOf: Date | null;
}

const EMPTY_FIGURE = <T>(value: T): StatFigure<T> => ({
  value,
  source: null,
  asOf: null,
});

function toIso(asOf: Date | null): string | null {
  return asOf ? asOf.toISOString() : null;
}

/**
 * Deterministic provenance ordering: latest `as_of` first (nulls last), then
 * latest `txn_date`, then highest `id`. Guarantees the same row is picked as the
 * provenance source for a figure across repeated reads over unchanged data.
 */
function compareProvenanceDesc(a: TxnRow, b: TxnRow): number {
  const aAsOf = a.asOf ? a.asOf.getTime() : -Infinity;
  const bAsOf = b.asOf ? b.asOf.getTime() : -Infinity;
  if (aAsOf !== bAsOf) return bAsOf - aAsOf;
  if (a.txnDate !== b.txnDate) return a.txnDate < b.txnDate ? 1 : -1;
  return a.id < b.id ? 1 : -1;
}

/** Pick the deterministic provenance (source + asOf) for a set of rows. */
function provenanceOf(rows: TxnRow[]): { source: string | null; asOf: string | null } {
  if (rows.length === 0) return { source: null, asOf: null };
  const top = [...rows].sort(compareProvenanceDesc)[0];
  return { source: top.source, asOf: toIso(top.asOf) };
}

/** Subtract 12 months from a "YYYY-MM-DD" date string, returning a comparable string. */
function minus12Months(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map((p) => parseInt(p, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCFullYear(dt.getUTCFullYear() - 1);
  return dt.toISOString().slice(0, 10);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Read comparable statistics for the given market projects from the SQL mirror.
 *
 * Returns one {@link CompStats} per unique input id, in the order supplied. A
 * project with no sale transactions yields zeroed/empty figures (never invented
 * values). All figures derive solely from `market_transactions` rows, so the
 * output is stable across repeated reads over unchanged data (Property 3).
 *
 * @param db Drizzle database handle (read-only here).
 * @param marketProjectIds Market project ids to compute stats for.
 */
export async function comparableStats(
  db: Database,
  marketProjectIds: string[]
): Promise<CompStats[]> {
  // De-duplicate while preserving caller order for stable output.
  const uniqueIds: string[] = [];
  const seen = new Set<string>();
  for (const id of marketProjectIds) {
    if (!seen.has(id)) {
      seen.add(id);
      uniqueIds.push(id);
    }
  }
  if (uniqueIds.length === 0) return [];

  // SQL read over market_* ONLY — sale transactions for the requested projects,
  // ordered deterministically so downstream reduction is reproducible.
  const rows = (await db
    .select({
      id: marketTransactions.id,
      marketProjectId: marketTransactions.marketProjectId,
      txnDate: marketTransactions.txnDate,
      priceAed: marketTransactions.priceAed,
      pricePerSqft: marketTransactions.pricePerSqft,
      buyerSegment: marketTransactions.buyerSegment,
      source: marketTransactions.source,
      asOf: marketTransactions.asOf,
    })
    .from(marketTransactions)
    .where(
      and(
        inArray(marketTransactions.marketProjectId, uniqueIds),
        eq(marketTransactions.txnType, "sale")
      )
    )
    .orderBy(
      asc(marketTransactions.marketProjectId),
      desc(marketTransactions.txnDate),
      desc(marketTransactions.id)
    )) as TxnRow[];

  // Bucket rows by project for per-project aggregation.
  const byProject = new Map<string, TxnRow[]>();
  for (const id of uniqueIds) byProject.set(id, []);
  for (const row of rows) {
    if (row.marketProjectId && byProject.has(row.marketProjectId)) {
      byProject.get(row.marketProjectId)!.push(row);
    }
  }

  return uniqueIds.map((projectId) => computeStats(projectId, byProject.get(projectId) ?? []));
}

/** Pure, deterministic aggregation of one project's sale transactions. */
function computeStats(marketProjectId: string, txns: TxnRow[]): CompStats {
  if (txns.length === 0) {
    return {
      marketProjectId,
      txnCount: 0,
      recentSalePriceAed: EMPTY_FIGURE<number | null>(null),
      avgPricePerSqft: EMPTY_FIGURE<number | null>(null),
      velocitySalesLast12m: EMPTY_FIGURE<number | null>(null),
      buyerSegmentMix: EMPTY_FIGURE<BuyerSegmentMixEntry[]>([]),
    };
  }

  // ── Recent sale price: the latest priced sale transaction. ──────────────────
  const priced = txns.filter((t) => t.priceAed !== null && t.priceAed !== undefined);
  const priceSorted = [...priced].sort((a, b) => {
    if (a.txnDate !== b.txnDate) return a.txnDate < b.txnDate ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });
  const latestPriced = priceSorted[0];
  const recentSalePriceAed: StatFigure<number | null> = latestPriced
    ? {
        value: latestPriced.priceAed,
        source: latestPriced.source,
        asOf: toIso(latestPriced.asOf),
      }
    : EMPTY_FIGURE<number | null>(null);

  // ── Average price per sqft over priced-per-sqft sales. ──────────────────────
  const perSqftRows = txns.filter(
    (t) => t.pricePerSqft !== null && t.pricePerSqft !== undefined
  );
  let avgPricePerSqft: StatFigure<number | null>;
  if (perSqftRows.length > 0) {
    // Sum in a deterministic (id-sorted) order for reproducible floating point.
    const ordered = [...perSqftRows].sort((a, b) => (a.id < b.id ? -1 : 1));
    const sum = ordered.reduce((acc, t) => acc + (t.pricePerSqft as number), 0);
    avgPricePerSqft = {
      value: round1(sum / ordered.length),
      ...provenanceOf(perSqftRows),
    };
  } else {
    avgPricePerSqft = EMPTY_FIGURE<number | null>(null);
  }

  // ── Velocity: sales in the trailing 12 months relative to the latest sale. ──
  const latestDate = txns.reduce(
    (max, t) => (t.txnDate > max ? t.txnDate : max),
    txns[0].txnDate
  );
  const windowStart = minus12Months(latestDate);
  const inWindow = txns.filter((t) => t.txnDate >= windowStart);
  const velocitySalesLast12m: StatFigure<number | null> = {
    value: inWindow.length,
    ...provenanceOf(inWindow),
  };

  // ── Aggregate buyer-segment mix (counts + %), AGGREGATE-only, no PII. ────────
  const segmented = txns.filter(
    (t) => t.buyerSegment !== null && t.buyerSegment !== undefined && t.buyerSegment !== ""
  );
  const counts = new Map<string, number>();
  for (const t of segmented) {
    const seg = t.buyerSegment as string;
    counts.set(seg, (counts.get(seg) ?? 0) + 1);
  }
  const total = segmented.length;
  const mix: BuyerSegmentMixEntry[] = [...counts.entries()]
    .map(([segment, count]) => ({
      segment,
      count,
      pct: total > 0 ? round1((count / total) * 100) : 0,
    }))
    // Deterministic ordering: highest count first, then segment label asc.
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.segment < b.segment ? -1 : 1));
  const buyerSegmentMix: StatFigure<BuyerSegmentMixEntry[]> = {
    value: mix,
    ...provenanceOf(segmented),
  };

  return {
    marketProjectId,
    txnCount: txns.length,
    recentSalePriceAed,
    avgPricePerSqft,
    velocitySalesLast12m,
    buyerSegmentMix,
  };
}
