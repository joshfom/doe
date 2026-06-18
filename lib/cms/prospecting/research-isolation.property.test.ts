import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { newDb, DataType } from "pg-mem";
import { drizzle } from "drizzle-orm/pg-proxy";
import fc from "fast-check";

import * as schema from "../schema";
import { marketTransactions } from "../schema";
import type { Database } from "../db";
import type { MemoryKey } from "../agents/memory";
import { buildTargetMemoryKey } from "./memory";
import { comparableStats } from "../market/stats";

/**
 * Property test for research PII isolation (task 5.3, NOT optional).
 *
 * **Feature: prospecting-workspace, Property 9: Agent memory and research for target:A return only A's records; comparable buyer data is aggregate-only and names no individual.**
 *
 * **Validates: Requirements 9 (P-NoLeak), 11 aggregate constraint**
 *
 * Property 9 protects two non-negotiable boundaries the prospecting research
 * path must hold:
 *
 *  A. **Per-Target memory isolation (Req 9 / P-NoLeak).** The Prospecting_Agent
 *     stores a Target's research in S1 Agent_Memory keyed `target:{id}` under
 *     `scope: "resource"` (Design §Components #3). Retrieval for `target:A` must
 *     return ONLY records keyed to A — never another Target's research. This
 *     mirrors the S1 isolation precedent (`memory-retrieval.property.test.ts`):
 *     a FAKE store mirroring Mastra's documented retrieval contract, driven by
 *     the REAL key builder (`buildTargetMemoryKey`) so the property pins the
 *     keying our code actually requests, not a restated copy of it.
 *
 *  B. **Aggregate-only comparable buyer data (Req 11.4 / Decision 4).** The SQL
 *     stat reader (`comparableStats`, lib/cms/market/stats.ts) is the ONLY path
 *     by which buyer information reaches the agent, and it returns buyer data as
 *     an aggregate segment MIX (segment label + count + percentage) — never an
 *     individual buyer. This half seeds `market_transactions` (in pg-mem) where
 *     every row also carries a UNIQUE individual-identifying token, then asserts
 *     that NONE of those individual tokens ever surface in the reader's output,
 *     that the mix names only aggregate segment labels, and that the aggregation
 *     is sound (counts ≤ sale count, percentages sum to ~100).
 *
 * Baseline for this non-optional property is ≥100 iterations; overridable via
 * FAST_CHECK_NUM_RUNS for CI.
 */

const NUM_RUNS = Number(process.env.FAST_CHECK_NUM_RUNS) || 100;

// ──────────────────────────────────────────────────────────────────────────
// Part A — Per-Target memory isolation (Req 9 / P-NoLeak)
// ──────────────────────────────────────────────────────────────────────────

/** Serialise a MemoryKey to a comparable scope token (exactly one key is set). */
function keyToken(key: MemoryKey): string {
  return key.resourceId !== undefined ? `r:${key.resourceId}` : `t:${key.threadId}`;
}

/** A stored research record, tagged with the Target it was written for. */
interface ResearchRecord {
  targetId: string;
  writtenAt: number;
  seq: number;
  payload: string;
}

/**
 * FAKE Agent_Memory store mirroring Mastra's `Memory` retrieval contract for
 * resource-scoped research: records are scoped by the `target:{id}` key the REAL
 * `buildTargetMemoryKey` yields, retrieval is filtered to the turn's Target key
 * and ordered most-recent-write-first. No live database is touched.
 */
class FakeResearchMemory {
  private records: ResearchRecord[] = [];
  private nextSeq = 0;

  write(targetId: string, writtenAt: number, payload: string): void {
    this.records.push({ targetId, writtenAt, seq: this.nextSeq++, payload });
  }

  /** Retrieve research for a turn about `targetId` (scope: "resource"). */
  retrieve(targetId: string): ResearchRecord[] {
    const wanted = keyToken(buildTargetMemoryKey(targetId));
    return this.records
      .filter((r) => keyToken(buildTargetMemoryKey(r.targetId)) === wanted)
      .sort((a, b) => b.writtenAt - a.writtenAt || b.seq - a.seq);
  }
}

// A small id pool forces repeats within a Target (so one Target accumulates many
// records) and many distinct Targets (so cross-Target leakage has a chance).
const targetIdArb = fc.constantFrom("A", "B", "C", "D");

const researchSpecArb = fc.record({
  targetId: targetIdArb,
  writtenAt: fc.integer({ min: 0, max: 1_000_000 }),
  payload: fc.string({ maxLength: 16 }),
});

describe("Feature: prospecting-workspace, Property 9: research PII isolation", () => {
  it("memory retrieval for target:A returns only A's records, never another Target's", () => {
    fc.assert(
      fc.property(
        fc.array(researchSpecArb, { maxLength: 60 }),
        targetIdArb,
        (specs, target) => {
          const store = new FakeResearchMemory();
          for (const s of specs) store.write(s.targetId, s.writtenAt, s.payload);

          const wanted = keyToken(buildTargetMemoryKey(target));
          const got = store.retrieve(target);

          // Isolation (Req 9 / P-NoLeak): every returned record is keyed to the
          // target Target, and none belongs to a different Target.
          for (const r of got) {
            expect(keyToken(buildTargetMemoryKey(r.targetId))).toBe(wanted);
            expect(r.targetId).toBe(target);
          }

          // Completeness: exactly the target Target's records are returned —
          // nothing of A's is dropped and nothing foreign is leaked in.
          const expectedCount = specs.filter((s) => s.targetId === target).length;
          expect(got.length).toBe(expectedCount);

          // Ordering: most-recent-write first (non-increasing timestamp).
          for (let i = 1; i < got.length; i++) {
            expect(got[i - 1].writtenAt).toBeGreaterThanOrEqual(got[i].writtenAt);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("a Target with no research returns an empty set without error", () => {
    fc.assert(
      fc.property(
        fc.array(researchSpecArb, { maxLength: 60 }),
        targetIdArb,
        (specs, target) => {
          const store = new FakeResearchMemory();
          // Persist only OTHER Targets' research, so `target` genuinely has none.
          for (const s of specs) {
            if (s.targetId !== target) store.write(s.targetId, s.writtenAt, s.payload);
          }
          expect(store.retrieve(target)).toEqual([]);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Part B — Aggregate-only comparable buyer data (Req 11.4 / Decision 4)
// ──────────────────────────────────────────────────────────────────────────

// Only the table the SQL reader touches (mirrors comparables.property.test.ts).
const DDL = `
  CREATE TABLE "market_transactions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "market_project_id" uuid,
    "market_building_id" uuid,
    "community_name" text,
    "area_name" text,
    "txn_type" text NOT NULL,
    "txn_date" date NOT NULL,
    "unit_type" text,
    "area_sqm" numeric,
    "bedrooms" integer,
    "price_aed" numeric,
    "price_per_sqft" numeric,
    "is_cash" boolean,
    "buyer_segment" text,
    "buyer_nationality" text,
    "source" text NOT NULL,
    "source_ref" text,
    "as_of" timestamp,
    "demo" boolean NOT NULL DEFAULT false,
    "created_at" timestamp DEFAULT now() NOT NULL
  );
`;

function buildDb(): Database {
  const mem = newDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });
  mem.public.none(DDL);

  const { Client } = mem.adapters.createPg();
  const client = new Client();

  const executor = async (
    sql: string,
    params: unknown[],
    method: "all" | "execute"
  ): Promise<{ rows: unknown[] }> => {
    const res = await client.query({ text: sql, values: params });
    const objectRows = (res.rows ?? []) as Record<string, unknown>[];
    return {
      rows: method === "all" ? objectRows.map((row) => Object.values(row)) : objectRows,
    };
  };

  return drizzle(executor as never, { schema }) as unknown as Database;
}

/** The aggregate buyer-segment labels (the ONLY buyer info that may be surfaced). */
const SEGMENTS = ["founder", "family_office", "uhnwi", "golden_visa"] as const;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * A generated sale transaction. `buyerSegment` is an aggregate label; every row
 * also gets a UNIQUE individual-identifying token (stored where an individual
 * PII value might otherwise live) that the aggregate reader must NEVER surface.
 */
const txnArb = fc.record({
  txnType: fc.constantFrom("sale" as const, "rent" as const, "off_plan" as const),
  txnDate: fc
    .record({
      y: fc.integer({ min: 2022, max: 2026 }),
      m: fc.integer({ min: 1, max: 12 }),
      d: fc.integer({ min: 1, max: 28 }),
    })
    .map(({ y, m, d }) => `${y}-${pad(m)}-${pad(d)}`),
  priceAed: fc.option(fc.integer({ min: 500_000, max: 100_000_000 }), { nil: null }),
  pricePerSqft: fc.option(fc.integer({ min: 500, max: 8000 }), { nil: null }),
  buyerSegment: fc.option(fc.constantFrom(...SEGMENTS), { nil: null }),
  source: fc.constantFrom("dubai_pulse", "property_monitor"),
});

describe("Feature: prospecting-workspace, Property 9: comparable buyer data is aggregate-only", () => {
  it(
    "comparableStats names only aggregate segments and never leaks an individual buyer",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 4 }),
          fc.array(fc.array(txnArb, { maxLength: 10 }), { maxLength: 4 }),
          async (projectCount, txnGroups) => {
            const ids = Array.from({ length: projectCount }, () => randomUUID());
            const db = buildDb();

            // Every seeded row carries a UNIQUE individual token; these stand in
            // for individual buyer PII that must never reach the agent.
            const individualTokens: string[] = [];

            for (let i = 0; i < ids.length; i++) {
              const group = txnGroups[i] ?? [];
              for (const t of group) {
                const individual = `INDIVIDUAL_${randomUUID()}`;
                individualTokens.push(individual);
                await db.insert(marketTransactions).values({
                  marketProjectId: ids[i],
                  txnType: t.txnType,
                  txnDate: t.txnDate,
                  priceAed: t.priceAed,
                  pricePerSqft: t.pricePerSqft,
                  buyerSegment: t.buyerSegment,
                  // Individual-level PII column — present in the row but must be
                  // aggregated away, never surfaced by the reader.
                  buyerNationality: individual,
                  source: t.source,
                });
              }
            }

            const stats = await comparableStats(db, ids);

            // The full serialised output is the agent's entire view of buyers.
            const serialised = JSON.stringify(stats);

            for (const s of stats) {
              const mix = s.buyerSegmentMix.value;

              // 1) Aggregate-only: the mix names ONLY aggregate segment labels,
              //    never an individual. (Bounded by the segment vocabulary.)
              const labels = mix.map((e) => e.segment);
              for (const label of labels) {
                expect(SEGMENTS).toContain(label);
              }
              expect(new Set(labels).size).toBe(labels.length); // one bucket per segment
              expect(labels.length).toBeLessThanOrEqual(SEGMENTS.length);

              // 2) Aggregation soundness: counts are aggregate counts (≤ sale
              //    count) and, when present, percentages sum to ~100.
              const totalCount = mix.reduce((a, e) => a + e.count, 0);
              expect(totalCount).toBeLessThanOrEqual(s.txnCount);
              for (const e of mix) {
                expect(e.count).toBeGreaterThan(0);
                expect(e.pct).toBeGreaterThanOrEqual(0);
                expect(e.pct).toBeLessThanOrEqual(100);
              }
              if (mix.length > 0) {
                const pctSum = mix.reduce((a, e) => a + e.pct, 0);
                expect(Math.abs(pctSum - 100)).toBeLessThanOrEqual(0.5);
              }
            }

            // 3) No-leak: not one individual token appears anywhere in the
            //    reader's output — individual buyer PII is aggregated away.
            for (const token of individualTokens) {
              expect(serialised.includes(token)).toBe(false);
            }
          }
        ),
        { numRuns: NUM_RUNS }
      );
    },
    60_000
  );
});
