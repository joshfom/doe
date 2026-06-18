import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/pg-proxy";
import fc from "fast-check";

import type { Database } from "@/lib/cms/db";
import * as schema from "@/lib/cms/schema";
import {
  readBriefingCache,
  writeBriefingCache,
  type CacheKey,
} from "./briefing-cache";
import type { Briefing, BriefingFigure, BriefingWindow, StackItem } from "./types";

/**
 * ── Property 5: Cache figure parity ─────────────────────────────────────────
 *
 * Feature: agentic-home, Property 5: A served cached Briefing presents figures
 * byte-identical to the assembled Briefing, and a non-expired cache hit never
 * re-runs the Briefing_Workflow.
 *
 * **Validates: Requirements 5.2, 5.7**
 *
 * This drives the REAL Briefing_Cache accessors (`writeBriefingCache` /
 * `readBriefingCache` from `briefing-cache.ts`) against an in-memory Postgres
 * (`pg-mem` + the real migration `drizzle/0037_briefing_cache.sql`) wired to a
 * genuine Drizzle node-postgres handle — so the assembled Briefing JSON makes a
 * full round-trip through the `briefing_cache` table's `jsonb` column, exactly
 * as it would in production. The harness mirrors the sibling pg-mem property
 * tests (`lib/cms/ai/tools/dispatch.audit.property.test.ts`).
 *
 * Three facets, one property:
 *   • Figure parity (Req 5.7): a served cached Briefing's figures are
 *     byte-identical (deep-equal — value/rounding/precision identical) to what
 *     was written/assembled, guaranteed because the cached JSON *is* the
 *     assembled Briefing (no recomputation on read).
 *   • No re-run on hit (Req 5.2): a tiny cache-first helper models the workflow
 *     as a spy counter; on a non-expired hit the assembler spy stays at 0 calls
 *     and the cached Briefing is served.
 *   • Expired / missing → miss: an entry read past its `expires_at`, or a key
 *     that was never written, yields `null`, so the caller WOULD run the
 *     workflow (the spy is invoked).
 */

const MIGRATION_FILE = "0037_briefing_cache.sql";

/** Stand up pg-mem with the briefing_cache migration applied + a drizzle handle. */
function buildDb(): { mem: IMemoryDb; db: Database } {
  const mem = newDb();

  // The migration's `assembled_at DEFAULT now()` resolves natively; no extra
  // function stubs are needed for this table. Register gen_random_uuid anyway
  // for parity with the sibling harness (harmless if unused).
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });

  const migrationSql = readFileSync(
    join(process.cwd(), "drizzle", MIGRATION_FILE),
    "utf-8"
  );
  // The 0037 migration carries no `--> statement-breakpoint`; pg-mem runs the
  // CREATE TABLE + CREATE INDEX (both `IF NOT EXISTS`) from the one string.
  mem.public.none(migrationSql);

  // Use Drizzle's pg-proxy driver over pg-mem rather than the node-postgres
  // adapter: the latter interpolates the assembled-Briefing `jsonb` value into
  // the SQL text, where pg-mem's lexer rejects backslash escape sequences. The
  // proxy driver binds params separately (mirrors the sibling jsonb harnesses
  // `lib/cms/realtime/events.property.test.ts` / `inbound-sync.idempotence`).
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
      rows:
        method === "all"
          ? objectRows.map((row) => Object.values(row))
          : objectRows,
    };
  };

  const db = drizzle(executor as never, { schema }) as unknown as Database;
  return { mem, db };
}

// ── Generators ────────────────────────────────────────────────────────────────

/**
 * pg-mem's SQL/JSON lexer rejects backslash escape sequences when the
 * assembled-Briefing `jsonb` value is materialised (real Postgres handles them
 * fine — this is purely an in-memory-harness limitation). We therefore draw
 * string content from a printable, backslash-free alphabet. This does not
 * weaken the parity property: figures still range over varied numbers and
 * strings, and parity is asserted by deep-equality after a full DB round-trip.
 */
const SAFE_CHARS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:;_-#@()[]{}".split(
    ""
  );
const safeCharArb = fc.constantFrom(...SAFE_CHARS);
const safeString = (opts?: { minLength?: number; maxLength?: number }) =>
  fc.string({ unit: safeCharArb, ...opts });

const windowArb: fc.Arbitrary<BriefingWindow> = fc.constantFrom(
  "morning",
  "midday",
  "evening"
);

/**
 * Figure values are constrained to JSON-stable shapes so "byte-identical"
 * parity is meaningful: finite numbers (no NaN/Infinity, which JSON coerces to
 * null) with `-0` normalised to `0` (it round-trips as `0`), and strings.
 */
const figureValueArb: fc.Arbitrary<number | string> = fc.oneof(
  fc.integer(),
  fc
    .double({ noNaN: true, noDefaultInfinity: true })
    .map((n) => (Object.is(n, -0) ? 0 : n)),
  safeString()
);

const figureArb: fc.Arbitrary<BriefingFigure> = fc.record({
  metricId: safeString({ minLength: 1 }),
  scopeId: safeString({ minLength: 1 }),
  period: safeString({ minLength: 1 }),
  value: figureValueArb,
  available: fc.boolean(),
});

const stackItemArb: fc.Arbitrary<StackItem> = fc.record({
  id: fc.uuid(),
  kind: fc.constantFrom("task", "lead_followup", "appointment"),
  title: safeString(),
  status: fc.constantFrom("open", "done"),
  dueAt: fc.option(fc.date().map((d) => d.toISOString()), { nil: null }),
  leadPhoneHash: fc.option(safeString({ minLength: 8, maxLength: 64 }), {
    nil: null,
  }),
});

const periodDateArb: fc.Arbitrary<string> = fc
  .date({ min: new Date("2020-01-01"), max: new Date("2035-12-31") })
  .map((d) => d.toISOString().slice(0, 10));

const keyArb: fc.Arbitrary<CacheKey> = fc.record({
  userId: fc.uuid(),
  window: windowArb,
  periodDate: periodDateArb,
});

function briefingArb(key: CacheKey): fc.Arbitrary<Briefing> {
  return fc.record({
    greeting: safeString(),
    recap: fc.option(
      fc.record({
        completed: fc.array(stackItemArb, { maxLength: 4 }),
        outstanding: fc.array(stackItemArb, { maxLength: 4 }),
      }),
      { nil: null }
    ),
    stack: fc.oneof(
      fc.array(stackItemArb, { maxLength: 6 }),
      fc.constant({ unavailable: true as const })
    ),
    figures: fc.array(figureArb, { maxLength: 6 }),
    invitesAdd: fc.boolean(),
    assembledAt: fc.date().map((d) => d.toISOString()),
  }).map((rest) => ({
    userId: key.userId,
    window: key.window,
    periodDate: key.periodDate,
    ...rest,
  }));
}

// ── Cache-first helper (models the route: hit serves; miss runs the workflow) ──

interface AssemblerSpy {
  calls: number;
  fn: () => Promise<Briefing>;
}

function makeAssembler(briefing: Briefing): AssemblerSpy {
  const spy: AssemblerSpy = {
    calls: 0,
    fn: async () => {
      spy.calls += 1;
      return briefing;
    },
  };
  return spy;
}

/**
 * The cache-first read path the Home_Surface route uses: serve a non-expired
 * cached Briefing without re-running the workflow (Req 5.2); on a miss, run the
 * workflow (here, the spy) and store the result (Req 5.3).
 */
async function getBriefingCacheFirst(
  db: Database,
  key: CacheKey,
  assembler: AssemblerSpy,
  now: Date
): Promise<Briefing> {
  const cached = await readBriefingCache(db, key, now);
  if (cached) return cached;
  const assembled = await assembler.fn();
  await writeBriefingCache(db, key, assembled);
  return assembled;
}

// ── Property ────────────────────────────────────────────────────────────────

describe("Briefing_Cache — Property 5: cache figure parity + no re-run on hit", () => {
  it("serves cached figures byte-identically and never re-runs the workflow on a non-expired hit; expired/missing → miss", async () => {
    await fc.assert(
      fc.asyncProperty(
        keyArb.chain((key) =>
          fc.record({
            key: fc.constant(key),
            briefing: briefingArb(key),
            ttlMinutes: fc.integer({ min: 1, max: 60 }),
          })
        ),
        async ({ key, briefing, ttlMinutes }) => {
          const { mem, db } = buildDb();
          try {
            // ── Assemble + store the Briefing (the workflow ran exactly once). ──
            await writeBriefingCache(db, key, briefing, ttlMinutes);

            // ── Non-expired hit: served figures are byte-identical (Req 5.7). ──
            const served = await readBriefingCache(db, key, new Date());
            expect(served).not.toBeNull();
            // Figure parity: value/rounding/precision identical (deep-equal).
            expect(served!.figures).toEqual(briefing.figures);
            // The whole served Briefing equals what was assembled.
            expect(served).toEqual(briefing);

            // ── No re-run on hit (Req 5.2): cache-first serves without the spy. ──
            const hitSpy = makeAssembler(briefing);
            const hit = await getBriefingCacheFirst(db, key, hitSpy, new Date());
            expect(hitSpy.calls).toBe(0);
            expect(hit.figures).toEqual(briefing.figures);
            expect(hit).toEqual(briefing);

            // ── Expired entry → miss: read past expires_at returns null. ──
            // expires_at = (write instant) + clamp(ttl,1,60)min; max ttl is 60,
            // so 61 minutes past "now" is guaranteed beyond it.
            const pastExpiry = new Date(Date.now() + 61 * 60_000);
            const expired = await readBriefingCache(db, key, pastExpiry);
            expect(expired).toBeNull();

            // A cache-first read at that instant is a MISS, so the workflow runs.
            const missSpy = makeAssembler(briefing);
            await getBriefingCacheFirst(db, key, missSpy, pastExpiry);
            expect(missSpy.calls).toBe(1);

            // ── Missing entry (untouched key) → miss → workflow runs. ──
            const otherKey: CacheKey = {
              userId: randomUUID(),
              window: key.window,
              periodDate: key.periodDate,
            };
            const missing = await readBriefingCache(db, otherKey, new Date());
            expect(missing).toBeNull();
            const missingSpy = makeAssembler(briefing);
            await getBriefingCacheFirst(db, otherKey, missingSpy, new Date());
            expect(missingSpy.calls).toBe(1);
          } finally {
            // pg-mem instances are GC'd; nothing to close for the adapter pool.
            void mem;
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
