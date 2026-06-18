import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import fc from "fast-check";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/cms/schema";
import { jobs } from "@/lib/cms/schema";
import type { Database } from "@/lib/cms/db";
import {
  enqueueJob,
  runJob,
  type JobKind,
  type JobHandlerRegistry,
} from "@/lib/cms/jobs";

/**
 * Property test for job idempotency (task 4.2).
 *
 * Property 7: Job idempotency by jobKey — running a `jobKey` more than once
 * yields the same terminal state and at most one external side effect
 * (modelled here by fake email/WhatsApp adapters that increment a counter).
 *
 * **Validates: Requirements 9.2, 9.3**
 *
 * Setup mirrors `schema.migration.test.ts`: migration 0029 is applied under an
 * in-memory Postgres (pg-mem) so the real `parties` / `events` / `jobs` tables
 * exist with their true column shapes. A drizzle handle is wired onto the same
 * pg-mem instance via its node-postgres adapter so `enqueueJob` / `runJob` run
 * against genuine SQL (atomic conditional-UPDATE claim, ON CONFLICT DO NOTHING).
 *
 * pg-mem ships neither `gen_random_uuid()` (needed by DEFAULTs) nor `pg_notify`
 * (issued by `publishEvent` inside the job runner), so both are registered as
 * stubs — the NOTIFY payload is irrelevant to this property, only the row state
 * matters.
 */

// Reduced fast-check budget — each generated case stands up a fresh in-memory
// DB / runs real SQL, so keep run counts and generated run-sequences small for
// speed (per the performance directive).
const NUM_RUNS = 25;

const MIGRATION_FILE = "0029_demonic_mandrill.sql";

// Pre-existing tables migration 0029 ALTERs / references (see migration test).
const PREREQUISITE_SQL = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_appointments" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_conversations" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_messages" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
`;

const JOB_KINDS: readonly JobKind[] = [
  "post_call_processing",
  "compile_and_email_report",
  "morning_briefing",
  "send_whatsapp_brief",
];

function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Stand up pg-mem with migration 0029 applied and return a drizzle handle. */
function buildDb(): { mem: IMemoryDb; db: Database } {
  const mem = newDb();

  // DEFAULTs reference gen_random_uuid(); pg-mem does not ship it.
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    // pg-mem treats registered functions as pure and caches a single result by
    // default; without `impure` every row would receive the SAME uuid and the
    // second insert would collide on jobs_pkey. Mark it impure so it is
    // re-evaluated per row (mirrors real gen_random_uuid()).
    impure: true,
    implementation: () => randomUUID(),
  });

  // publishEvent issues `SELECT pg_notify(channel, id)`; pg-mem lacks it.
  // The side effect is irrelevant to job-state idempotency, so stub it out.
  mem.public.registerFunction({
    name: "pg_notify",
    args: [DataType.text, DataType.text],
    returns: DataType.text,
    implementation: () => "",
  });

  mem.public.none(PREREQUISITE_SQL);

  const migrationSql = readFileSync(
    join(process.cwd(), "drizzle", MIGRATION_FILE),
    "utf-8"
  );
  for (const stmt of splitStatements(migrationSql)) {
    mem.public.none(stmt);
  }

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem's node-postgres adapter rejects two things this drizzle version
  // sends on every query: `types.getTypeParser` (custom result parsers) and
  // `rowMode: "array"`. Pool and Client are the same MemPg instance and
  // `connect()` returns `this`, so patching the one `query` here also covers
  // the transaction path used by publishEvent. We strip both options and, when
  // drizzle asked for array-mode rows, convert pg-mem's object rows back into
  // positional arrays (in select order) so drizzle's row mapper stays happy.
  const originalQuery = pool.query.bind(pool);
  pool.query = (config: unknown, values?: unknown, cb?: unknown) => {
    if (config && typeof config === "object" && !Array.isArray(config)) {
      const cfg = config as Record<string, unknown>;
      const wantArray = cfg.rowMode === "array";
      const clean = { ...cfg };
      delete clean.rowMode;
      delete clean.types;
      const result = originalQuery(clean, values, cb);
      if (wantArray && result && typeof (result as Promise<unknown>).then === "function") {
        return (result as Promise<{ rows: Record<string, unknown>[] }>).then(
          (r) => ({ ...r, rows: r.rows.map((row) => Object.values(row)) })
        );
      }
      return result;
    }
    return originalQuery(config, values, cb);
  };

  const db = drizzle(pool, { schema }) as unknown as Database;

  return { mem, db };
}

describe("Job runner — Property 7: idempotency by jobKey (Req 9.2, 9.3)", () => {
  let db: Database;

  // Counts the modelled external side effect (fake email/WhatsApp send) per
  // jobKey. A correct runner increments this AT MOST ONCE per jobKey.
  let sideEffects: Map<string, number>;

  // Every kind's handler models a successful external adapter send.
  function makeCountingRegistry(): JobHandlerRegistry {
    const handler = async (
      _db: Database,
      _payload: unknown,
      ctx: { jobKey: string }
    ) => {
      sideEffects.set(ctx.jobKey, (sideEffects.get(ctx.jobKey) ?? 0) + 1);
    };
    return {
      post_call_processing: handler,
      compile_and_email_report: handler,
      morning_briefing: handler,
      send_whatsapp_brief: handler,
    };
  }

  beforeAll(() => {
    ({ db } = buildDb());
  });

  it("dedupes enqueues and keeps side effects at-most-once across repeated/concurrent runs", async () => {
    let iteration = 0;

    await fc.assert(
      fc.asyncProperty(
        // Each enqueue picks a key from a small pool → forces duplicates.
        fc.array(fc.constantFrom("k1", "k2", "k3"), {
          minLength: 1,
          maxLength: 6,
        }),
        fc.constantFrom(...JOB_KINDS),
        // How many times each resulting job is run.
        fc.integer({ min: 1, max: 4 }),
        // Run repeats concurrently (true) or sequentially (false).
        fc.boolean(),
        async (poolKeys, kind, runCount, concurrent) => {
          // Namespace keys per iteration so iterations don't interfere while
          // still exercising duplicate enqueues *within* an iteration.
          const ns = `it${iteration++}`;
          sideEffects = new Map();

          const fullKeys = poolKeys.map((k) => `${ns}:${k}`);
          const distinctKeys = [...new Set(fullKeys)];

          // (a) Enqueue every (possibly duplicate) key. ON CONFLICT DO NOTHING
          //     must collapse duplicates to one row per jobKey.
          const idByKey = new Map<string, string>();
          for (const key of fullKeys) {
            const id = await enqueueJob(db, kind, { key }, key);
            const seen = idByKey.get(key);
            if (seen !== undefined) {
              // Re-enqueue of a known key must return the SAME row id.
              expect(id).toBe(seen);
            } else {
              idByKey.set(key, id);
            }
          }

          // At most one job row per distinct jobKey.
          for (const key of distinctKeys) {
            const rows = await db
              .select({ id: jobs.id })
              .from(jobs)
              .where(eq(jobs.jobKey, key));
            expect(rows).toHaveLength(1);
            expect(rows[0].id).toBe(idByKey.get(key));
          }

          // (b) Run each distinct job runCount times (sequential or concurrent).
          for (const key of distinctKeys) {
            const jobId = idByKey.get(key)!;
            const runs = Array.from({ length: runCount }, () =>
              runJob(db, jobId, makeCountingRegistry())
            );
            if (concurrent) {
              await Promise.all(runs);
            } else {
              for (const r of runs) await r;
            }
          }

          // Same terminal state: every job ends `done`.
          for (const key of distinctKeys) {
            const [row] = await db
              .select({ status: jobs.status })
              .from(jobs)
              .where(eq(jobs.jobKey, key));
            expect(row.status).toBe("done");
          }

          // At-most-once external side effect per jobKey — and exactly once,
          // since every handler here succeeds.
          for (const key of distinctKeys) {
            expect(sideEffects.get(key) ?? 0).toBe(1);
          }
          // No stray side effects for keys we never enqueued.
          expect(sideEffects.size).toBe(distinctKeys.length);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("failure path: a throwing handler marks the job failed and stays re-runnable, then succeeds exactly once", async () => {
    const jobKey = "fail-then-succeed";
    const jobId = await enqueueJob(db, "send_whatsapp_brief", {}, jobKey);

    const throwing: JobHandlerRegistry = {
      post_call_processing: async () => {},
      compile_and_email_report: async () => {},
      morning_briefing: async () => {},
      send_whatsapp_brief: async () => {
        throw new Error("adapter unavailable");
      },
    };

    await runJob(db, jobId, throwing);

    const [failed] = await db
      .select({ status: jobs.status, lastError: jobs.lastError })
      .from(jobs)
      .where(eq(jobs.id, jobId));
    expect(failed.status).toBe("failed");
    expect(failed.lastError).toBe("adapter unavailable");

    // A failed job is claimable again — a manual re-run must complete it once.
    let sends = 0;
    const succeeding: JobHandlerRegistry = {
      post_call_processing: async () => {},
      compile_and_email_report: async () => {},
      morning_briefing: async () => {},
      send_whatsapp_brief: async () => {
        sends += 1;
      },
    };

    await runJob(db, jobId, succeeding);
    await runJob(db, jobId, succeeding); // re-run of a done job is a no-op

    const [done] = await db
      .select({ status: jobs.status })
      .from(jobs)
      .where(eq(jobs.id, jobId));
    expect(done.status).toBe("done");
    expect(sends).toBe(1);
  });
});
