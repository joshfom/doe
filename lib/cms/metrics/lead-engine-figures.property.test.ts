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
 * Property test for figures-from-SQL (Lead Engine S3, task 7.3, not optional).
 *
 * **Feature: lead-engine, Property 12: A reported figure equals its metrics_* view value for the same scope/period and is identical across repeated reads over unchanged data.**
 *
 * **Validates: Requirements 15.1, 15.3**
 *
 * The Lead Engine never computes analytics figures in the model: every count an
 * agent narrates is read verbatim from a `metrics_*` SQL view (Req 15.1, 15.2),
 * and the same scope + period over unchanged Lead data returns an identical
 * figure on every read (Req 15.3). The canonical lead figure the engine reports
 * is the lead count, sourced from `metrics_leads`
 * (`drizzle/0035_lead_metrics_views.sql`) — a view over `leads_mirror` that
 * counts each `DISTINCT party_id` once, excludes demo rows, and groups by day +
 * tier. The reporting path is the exact production query shape used by the lead
 * figure readers (`lib/cms/ai/admin-agent.ts` / `admin-capabilities.ts`):
 *
 *     SELECT COALESCE(SUM(lead_count), 0)::int FROM metrics_leads
 *       [WHERE day >= :start AND day <= :end] [AND tier = :scope]
 *
 * Across ≥100 generated worlds — each with an arbitrary `leads_mirror`
 * population, an arbitrary tier scope (a specific tier or all tiers), and an
 * arbitrary day window — this test asserts:
 *
 *   1. Reported == view value (Req 15.1): the figure the engine would report
 *      for a (scope, period) equals the figure obtained by reading the
 *      `metrics_leads` view directly for that same (scope, period). The
 *      reporting path applies no rounding/aggregation/transformation of its
 *      own — it narrates the view's number verbatim.
 *   2. Sourced from SQL, never model-computed (Req 15.1, 15.2): that same
 *      figure also equals an INDEPENDENT SQL oracle computed directly over the
 *      `leads_mirror` base table (`count(DISTINCT party_id)` of non-demo rows
 *      within the same scope/period), proving the number originates in SQL.
 *   3. Determinism over unchanged data (Req 15.3): repeated reads of the same
 *      scope/period over an unchanged `leads_mirror` return identical figures,
 *      and seeding unrelated noise (`tickets.request_type = 'lead_inquiry'`,
 *      which the view never reads) between reads does not move the figure.
 *
 * ── How the view is exercised under pg-mem ──────────────────────────────────
 * The REAL migration `drizzle/0035_lead_metrics_views.sql` is loaded and applied
 * verbatim except for ONE semantics-preserving rewrite: pg-mem cannot create a
 * view whose `GROUP BY` uses positional ordinals (`GROUP BY 1, 2`), so those
 * ordinals are replaced with the exact SELECT expressions they denote. In
 * PostgreSQL a positional `GROUP BY` is pure sugar for grouping by those
 * expressions, so the view's semantics are unchanged. pg-mem also ships no
 * native `date_trunc`, so it is registered to truncate a timestamp to the start
 * of its UTC day (matching `date_trunc('day', …)`). Everything else — the
 * `count(DISTINCT …)`, the `demo = false` filter, the `::date` cast, and the
 * `SUM(lead_count)` reporting query — is the unmodified production SQL.
 */

const NUM_RUNS = Number(process.env.PBT_NUM_RUNS ?? 100);
const VIEW_FILE = "0035_lead_metrics_views.sql";

// Real DDL for the two tables the view depends on, copied verbatim from
// drizzle/0029_demonic_mandrill.sql (party graph root + leads_mirror).
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
// shim. The view never reads it; it exists only to seed noise the figure must
// ignore between reads.
const TICKETS_DDL = `
  CREATE TABLE "tickets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "request_type" text,
    "demo" boolean DEFAULT false NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  );`;

/** Stand up a fresh pg-mem with the real metrics_leads view + its tables. */
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
  "2024-02-01",
  "2024-02-02",
  "2024-02-03",
  "2024-02-04",
  "2024-02-05",
] as const;

const TIERS = ["HOT", "WARM", "NURTURE"] as const;

/** A single leads_mirror row spec. */
const mirrorRowArb = fc.record({
  dayIdx: fc.integer({ min: 0, max: DAY_POOL.length - 1 }),
  hour: fc.integer({ min: 0, max: 23 }),
  tier: fc.constantFrom(...TIERS),
  demo: fc.boolean(),
});

/** A reporting scope: a specific tier, or all tiers (`null`). */
type Scope = { tier: (typeof TIERS)[number] | null };
/** A reporting period: an inclusive day window, or none (all time). */
type Period = { start?: string; end?: string };

/**
 * The reported figure — the exact production reporting query shape (verbatim
 * SUM of the view's lead_count), optionally windowed by the view's `day` column
 * and filtered to a single tier scope. This applies NO model transformation;
 * it narrates the view's number (Req 15.1, 15.2).
 */
async function reportedFigure(
  db: Database,
  scope: Scope,
  period: Period
): Promise<number> {
  const conds: ReturnType<typeof sql>[] = [];
  if (period.start) conds.push(sql`day >= ${period.start}`);
  if (period.end) conds.push(sql`day <= ${period.end}`);
  if (scope.tier) conds.push(sql`tier = ${scope.tier}`);
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
 * The view value for the same scope/period, obtained by reading the
 * `metrics_leads` view's own rows and summing their `lead_count`. This is the
 * figure "stored in" the view for that scope/period — what `reportedFigure`
 * must equal verbatim (Req 15.1).
 */
async function viewValue(
  db: Database,
  scope: Scope,
  period: Period
): Promise<number> {
  const conds: ReturnType<typeof sql>[] = [];
  if (period.start) conds.push(sql`day >= ${period.start}`);
  if (period.end) conds.push(sql`day <= ${period.end}`);
  if (scope.tier) conds.push(sql`tier = ${scope.tier}`);
  const whereClause = conds.length
    ? sql` WHERE ${sql.join(conds, sql` AND `)}`
    : sql``;
  const result = await db.execute(
    sql`SELECT lead_count FROM metrics_leads${whereClause}`
  );
  const rows = (Array.isArray(result) ? result : result.rows) as Array<{
    lead_count: number | string;
  }>;
  return rows.reduce((acc, r) => acc + Number(r.lead_count ?? 0), 0);
}

/**
 * INDEPENDENT SQL oracle computed directly over leads_mirror (NOT the view):
 * count of DISTINCT party_id among non-demo rows within the same scope/period.
 * This proves the reported figure originates in SQL over the canonical Lead
 * data and is never computed/transformed in the model (Req 15.1, 15.2).
 */
async function oracleFigure(
  db: Database,
  scope: Scope,
  period: Period
): Promise<number> {
  const conds: ReturnType<typeof sql>[] = [sql`lm.demo = false`];
  if (period.start)
    conds.push(sql`date_trunc('day', lm.updated_at)::date >= ${period.start}`);
  if (period.end)
    conds.push(sql`date_trunc('day', lm.updated_at)::date <= ${period.end}`);
  if (scope.tier) conds.push(sql`lm.tier = ${scope.tier}`);
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

describe("Lead Engine figures — Property 12: figures from SQL (Req 15.1, 15.3)", () => {
  it("reports the metrics_* view value verbatim for a scope/period and is identical across repeated reads over unchanged data", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(mirrorRowArb, { minLength: 0, maxLength: 12 }),
        // Scope: a specific tier, or all tiers (null).
        fc.option(fc.constantFrom(...TIERS), { nil: null }),
        // Period: two pool indices forming an inclusive [lo, hi] day window.
        fc.tuple(
          fc.integer({ min: 0, max: DAY_POOL.length - 1 }),
          fc.integer({ min: 0, max: DAY_POOL.length - 1 })
        ),
        // lead_inquiry ticket noise seeded BEFORE the first read.
        fc.integer({ min: 0, max: 8 }),
        // EXTRA lead_inquiry ticket noise inserted BETWEEN reads.
        fc.integer({ min: 0, max: 8 }),
        async (rows, tier, [a, b], ticketsBefore, ticketsBetween) => {
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

          const scope: Scope = { tier };
          const period: Period = {
            start: DAY_POOL[Math.min(a, b)],
            end: DAY_POOL[Math.max(a, b)],
          };
          // Also exercise the all-time (no period) reporting path.
          const allTime: Period = {};

          // (1) Reported figure == the view's own value for the same
          // scope/period (verbatim narration; no model transformation).
          const reportedWindowed = await reportedFigure(db, scope, period);
          expect(reportedWindowed).toBe(await viewValue(db, scope, period));

          const reportedAll = await reportedFigure(db, scope, allTime);
          expect(reportedAll).toBe(await viewValue(db, scope, allTime));

          // (2) Reported figure == the independent leads_mirror SQL oracle,
          // proving it is sourced from SQL and never computed in the model.
          expect(reportedWindowed).toBe(await oracleFigure(db, scope, period));
          expect(reportedAll).toBe(await oracleFigure(db, scope, allTime));

          // (3) Determinism over unchanged data — repeated reads are identical.
          expect(await reportedFigure(db, scope, period)).toBe(reportedWindowed);
          expect(await reportedFigure(db, scope, allTime)).toBe(reportedAll);

          // (3, cont.) Seeding lead_inquiry ticket noise the view never reads
          // does not move the figure on a subsequent read.
          for (let i = 0; i < ticketsBetween; i++) {
            await db.execute(
              sql`INSERT INTO tickets (request_type) VALUES ('lead_inquiry')`
            );
          }
          expect(await reportedFigure(db, scope, period)).toBe(reportedWindowed);
          expect(await reportedFigure(db, scope, allTime)).toBe(reportedAll);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
