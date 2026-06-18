import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/pg-proxy";
import { sql } from "drizzle-orm";
import fc from "fast-check";

import * as schema from "../schema";
import type { Database } from "../db";

/**
 * Property test for SQL lead figures (task 7.2).
 *
 * **Feature: salesforce-lead-core, Property 10: For identical scope and period over unchanged leads_mirror data, metrics_leads returns identical figures, sourced only from leads_mirror, never counting lead_inquiry tickets.**
 *
 * **Validates: Requirements 9.1, 9.3, 13.9, 13.10**
 *
 * `metrics_leads` (drizzle/0035_lead_metrics_views.sql) is the canonical SQL
 * source of lead figures: a view over `leads_mirror` that counts each
 * `DISTINCT party_id` once, excludes demo rows, and groups by day + tier. The
 * admin agent's lead count (`lib/cms/ai/admin-agent.ts` `queryLeadCount`) sums
 * the view's `lead_count`, optionally windowed by the view's `day` column. This
 * test drives that exact query shape against the REAL view derivation and
 * asserts, across ≥100 generated worlds, that:
 *
 *   1. Determinism (Req 9.3): the same scope + period over unchanged
 *      `leads_mirror` data returns identical figures on repeated reads.
 *   2. Sourced only from leads_mirror (Req 9.1, 13.10): the figure equals an
 *      INDEPENDENT SQL `count(DISTINCT party_id)` over non-demo `leads_mirror`
 *      rows (within the window) — never computed in app/model code.
 *   3. Never counts lead_inquiry tickets (Req 13.9, 13.10): seeding arbitrary
 *      numbers of `tickets.request_type = 'lead_inquiry'` rows — and adding yet
 *      more between reads — never changes the figure.
 *   4. Demo rows (demo = true) are excluded.
 *
 * ── How the view is exercised under pg-mem ──────────────────────────────────
 * The REAL migration file `drizzle/0035_lead_metrics_views.sql` is loaded and
 * applied verbatim except for ONE semantics-preserving rewrite: pg-mem cannot
 * create a view whose `GROUP BY` uses positional ordinals (`GROUP BY 1, 2`), so
 * those ordinals are replaced with the exact SELECT expressions they denote
 * (`date_trunc('day', lm.updated_at)::date, lm.tier`). In PostgreSQL a
 * positional `GROUP BY` is pure sugar for grouping by the corresponding select
 * expressions, so the rewrite changes nothing about the view's semantics —
 * still `count(DISTINCT party_id)` of non-demo `leads_mirror` rows grouped by
 * day + tier. pg-mem also lacks a native `date_trunc`, so it is registered as a
 * custom function truncating a timestamp to the start of its UTC day (matching
 * `date_trunc('day', …)`). Everything else — the `count(DISTINCT …)`, the
 * `demo = false` filter, the `::date` cast, the `SUM(lead_count)` query, and
 * the `day` window — is the unmodified production SQL.
 */

const NUM_RUNS = 100;
const VIEW_FILE = "0035_lead_metrics_views.sql";

// Real DDL for the two tables the view depends on, copied verbatim from
// drizzle/0029_demonic_mandrill.sql (party graph root + leads_mirror). The FK
// from leads_mirror.party_id → parties.id is added so seeding is realistic.
const PARTIES_DDL = `
  CREATE TABLE "parties" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "type" text DEFAULT 'person' NOT NULL,
    "name" text,
    "language" text DEFAULT 'en',
    "client_id" uuid,
    "tenant_id" uuid,
    "consent_at" timestamp,
    "demo" boolean DEFAULT false NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  );`;

const LEADS_MIRROR_DDL = `
  CREATE TABLE "leads_mirror" (
    "party_id" uuid PRIMARY KEY NOT NULL REFERENCES "parties"("id") ON DELETE CASCADE,
    "sf_lead_id" text,
    "stage" text,
    "tier" text,
    "score_reason" text,
    "project_interest" text,
    "unit_interest" text,
    "budget_band" text,
    "source" text,
    "campaign" text,
    "assigned_rep_id" uuid,
    "last_interaction_at" timestamp,
    "last_interaction_summary" text,
    "sla_due_at" timestamp,
    "demo" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );`;

// Minimal `tickets` table carrying the legacy `request_type = 'lead_inquiry'`
// shim, so the test can prove the view never reads it. The view does NOT touch
// tickets; this exists only to seed noise.
const TICKETS_DDL = `
  CREATE TABLE "tickets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "request_type" text,
    "demo" boolean DEFAULT false NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  );`;

/** Stand up a fresh pg-mem with the view + its tables and a Drizzle handle. */
function buildMetricsDb(): { db: Database; mem: IMemoryDb } {
  const mem = newDb();

  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });

  // pg-mem ships no native date_trunc; register the 'day' truncation the view
  // uses (start of the timestamp's UTC day), matching Postgres' date_trunc.
  mem.public.registerFunction({
    name: "date_trunc",
    args: [DataType.text, DataType.timestamp],
    returns: DataType.timestamp,
    implementation: (unit: string, ts: Date | string) => {
      const d = ts instanceof Date ? new Date(ts.getTime()) : new Date(ts);
      if (unit === "day") d.setUTCHours(0, 0, 0, 0);
      return d;
    },
  });

  mem.public.none(PARTIES_DDL);
  mem.public.none(LEADS_MIRROR_DDL);
  mem.public.none(TICKETS_DDL);

  // Apply the REAL view migration verbatim, with the single semantics-
  // preserving GROUP BY ordinal → explicit-expression rewrite (see header).
  let viewSql = readFileSync(join(process.cwd(), "drizzle", VIEW_FILE), "utf-8");
  viewSql = viewSql.replace(
    /GROUP BY 1, 2;/,
    "GROUP BY date_trunc('day', lm.updated_at)::date, lm.tier;"
  );
  mem.public.none(viewSql);

  const { Client } = mem.adapters.createPg();
  const client = new Client();

  const executor = async (
    queryText: string,
    params: unknown[],
    method: "all" | "execute"
  ): Promise<{ rows: unknown[] }> => {
    const res = await client.query({ text: queryText, values: params });
    const objectRows = (res.rows ?? []) as Record<string, unknown>[];
    return {
      rows:
        method === "all" ? objectRows.map((row) => Object.values(row)) : objectRows,
    };
  };

  const db = drizzle(executor as never, { schema }) as unknown as Database;
  return { db, mem };
}

// A small pool of distinct calendar days so grouping/windows are meaningful and
// same-day rows collapse under date_trunc.
const DAY_POOL = [
  "2024-01-01",
  "2024-01-02",
  "2024-01-03",
  "2024-01-04",
  "2024-01-05",
] as const;

const TIERS = ["HOT", "WARM", "NURTURE"] as const;

/** A single leads_mirror row spec. */
const mirrorRowArb = fc.record({
  dayIdx: fc.integer({ min: 0, max: DAY_POOL.length - 1 }),
  hour: fc.integer({ min: 0, max: 23 }),
  tier: fc.constantFrom(...TIERS),
  demo: fc.boolean(),
});

/**
 * The exact admin-agent lead-count query (verbatim shape), optionally windowed
 * by the view's `day` column. This is the production reporting path under test.
 */
async function queryViewLeadCount(
  db: Database,
  window?: { start?: string; end?: string }
): Promise<number> {
  const conds: ReturnType<typeof sql>[] = [];
  if (window?.start) conds.push(sql`day >= ${window.start}`);
  if (window?.end) conds.push(sql`day <= ${window.end}`);
  const whereClause = conds.length
    ? sql` WHERE ${sql.join(conds, sql` AND `)}`
    : sql``;
  const result = await db.execute(
    sql`SELECT COALESCE(SUM(lead_count), 0)::int AS leads FROM metrics_leads${whereClause}`
  );
  const rows = (Array.isArray(result) ? result : result.rows) as Array<{
    leads: number | string;
  }>;
  return Number(rows[0]?.leads ?? 0);
}

/**
 * INDEPENDENT oracle computed directly over leads_mirror (NOT the view): the
 * count of DISTINCT party_id among non-demo rows, optionally within the window.
 * This deliberately bypasses metrics_leads to prove the view's figure is the
 * one sourced from leads_mirror.
 */
async function oracleLeadCount(
  db: Database,
  window?: { start?: string; end?: string }
): Promise<number> {
  const conds: ReturnType<typeof sql>[] = [sql`lm.demo = false`];
  if (window?.start)
    conds.push(sql`date_trunc('day', lm.updated_at)::date >= ${window.start}`);
  if (window?.end)
    conds.push(sql`date_trunc('day', lm.updated_at)::date <= ${window.end}`);
  const result = await db.execute(
    sql`SELECT count(DISTINCT lm.party_id)::int AS c FROM leads_mirror lm WHERE ${sql.join(
      conds,
      sql` AND `
    )}`
  );
  const rows = (Array.isArray(result) ? result : result.rows) as Array<{
    c: number | string;
  }>;
  return Number(rows[0]?.c ?? 0);
}

describe("metrics_leads — Property 10: SQL lead figures (Req 9.1, 9.3, 13.9, 13.10)", () => {
  it("returns identical figures from leads_mirror only, never counting lead_inquiry tickets", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(mirrorRowArb, { minLength: 0, maxLength: 12 }),
        // Number of lead_inquiry tickets seeded BEFORE the first read.
        fc.integer({ min: 0, max: 8 }),
        // Number of EXTRA lead_inquiry tickets inserted BETWEEN reads.
        fc.integer({ min: 0, max: 8 }),
        // A day window: two pool indices forming an inclusive [lo, hi] range.
        fc.tuple(
          fc.integer({ min: 0, max: DAY_POOL.length - 1 }),
          fc.integer({ min: 0, max: DAY_POOL.length - 1 })
        ),
        async (rows, ticketsBefore, ticketsBetween, [a, b]) => {
          const { db } = buildMetricsDb();

          // Seed leads_mirror (each row a distinct party → distinct party_id).
          for (const r of rows) {
            const partyId = randomUUID();
            const ts = `${DAY_POOL[r.dayIdx]}T${String(r.hour).padStart(2, "0")}:00:00Z`;
            await db.execute(
              sql`INSERT INTO parties (id, demo) VALUES (${partyId}, ${r.demo})`
            );
            await db.execute(
              sql`INSERT INTO leads_mirror (party_id, tier, demo, updated_at)
                  VALUES (${partyId}, ${r.tier}, ${r.demo}, ${ts})`
            );
          }

          // Seed lead_inquiry tickets — pure noise the view must ignore.
          for (let i = 0; i < ticketsBefore; i++) {
            await db.execute(
              sql`INSERT INTO tickets (request_type) VALUES ('lead_inquiry')`
            );
          }

          const lo = DAY_POOL[Math.min(a, b)];
          const hi = DAY_POOL[Math.max(a, b)];

          // (1) Determinism — same scope/period, unchanged data, repeated reads.
          const total1 = await queryViewLeadCount(db);
          const total2 = await queryViewLeadCount(db);
          expect(total2).toBe(total1);

          const windowed1 = await queryViewLeadCount(db, { start: lo, end: hi });
          const windowed2 = await queryViewLeadCount(db, { start: lo, end: hi });
          expect(windowed2).toBe(windowed1);

          // (2)+(4) Figure equals the independent leads_mirror oracle (non-demo,
          // distinct party_id), unwindowed and windowed — proving the figure is
          // sourced from leads_mirror and demo rows are excluded.
          expect(total1).toBe(await oracleLeadCount(db));
          expect(windowed1).toBe(
            await oracleLeadCount(db, { start: lo, end: hi })
          );

          // (3) Independence from lead_inquiry tickets: add MORE tickets, then
          // re-read — the figure must not move.
          for (let i = 0; i < ticketsBetween; i++) {
            await db.execute(
              sql`INSERT INTO tickets (request_type) VALUES ('lead_inquiry')`
            );
          }
          expect(await queryViewLeadCount(db)).toBe(total1);
          expect(await queryViewLeadCount(db, { start: lo, end: hi })).toBe(
            windowed1
          );
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
