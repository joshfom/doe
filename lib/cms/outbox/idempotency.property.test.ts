import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import fc from "fast-check";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/cms/schema";
import { sfOutbox } from "@/lib/cms/schema";
import type { Database } from "@/lib/cms/db";
import { enqueueOutbox, type OutboxKind } from "@/lib/cms/outbox";

/**
 * Property test for Salesforce outbox idempotency (task 3.2).
 *
 * Property 1: Outbox idempotency by jobKey — for arbitrary `(jobKey, payload)`
 * sequences, at most one `sf_outbox` row exists per distinct `jobKey`, and
 * re-enqueuing a known `jobKey` returns the SAME row id.
 *
 * **Validates: Requirements 8.2**
 *
 * Setup mirrors `lib/cms/jobs/idempotency.property.test.ts`: migration 0029 is
 * applied under an in-memory Postgres (pg-mem) so the real `sf_outbox` table
 * exists with its true column shape and unique `job_key` constraint. A drizzle
 * handle is wired onto the same pg-mem instance via its node-postgres adapter so
 * `enqueueOutbox` runs against genuine SQL (`ON CONFLICT (job_key) DO NOTHING`).
 *
 * pg-mem does not ship `gen_random_uuid()` (needed by column DEFAULTs), so it is
 * registered as a stub. `enqueueOutbox` issues no `pg_notify`, so no NOTIFY stub
 * is required for this property.
 */

const MIGRATION_FILE = "0029_demonic_mandrill.sql";

// Pre-existing tables migration 0029 ALTERs / references (FK targets).
const PREREQUISITE_SQL = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_appointments" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_conversations" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_messages" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
`;

const OUTBOX_KINDS: readonly OutboxKind[] = ["lead_upsert", "task", "event"];

/**
 * fast-check run count. Reduced from the default 100 to keep this property
 * fast: the jobKey pool and sequence length are small/bounded, so 25 runs
 * comfortably covers the duplicate-collision input space.
 */
const FC_RUNS = 25;

// Strings restricted to an alphanumeric-ish alphabet. The idempotency property
// is independent of payload bytes, but pg-mem's pg adapter inlines string
// params as SQL literals (rather than true bound params) and mis-parses
// backslashes/quotes inside jsonb strings — a harness limitation, not a code
// bug. Constraining the alphabet keeps generated payloads within what the
// in-memory engine can round-trip while still exercising arbitrary structure.
const safeString = fc.string({
  unit: fc.constantFrom(
    ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _-.".split(
      ""
    )
  ),
  maxLength: 12,
});

// Arbitrary, recursively-nested JSON-ish payloads built from the safe alphabet.
// The final `.map` round-trips through JSON so the value carries a normal
// prototype: fast-check's `fc.dictionary` can emit null-prototype objects, and
// drizzle's internal `is()` check reads `Object.getPrototypeOf(value).constructor`
// which throws on a null prototype. Real outbox payloads are always
// JSON-serializable values, so this normalization reflects production inputs
// while keeping the generated structure arbitrary (the property is independent
// of payload bytes anyway).
const safePayload: fc.Arbitrary<unknown> = fc
  .letrec((tie) => ({
    value: fc.oneof(
      { maxDepth: 3 },
      safeString,
      fc.integer(),
      fc.boolean(),
      fc.array(tie("value"), { maxLength: 4 }),
      fc.dictionary(safeString, tie("value"), { maxKeys: 4 })
    ),
  }))
  .value.map((v) => JSON.parse(JSON.stringify(v ?? null)));

function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Stand up pg-mem with migration 0029 applied and return a drizzle handle. */
function buildDb(): { mem: IMemoryDb; db: Database } {
  const mem = newDb();

  // DEFAULTs reference gen_random_uuid(); pg-mem does not ship it. Mark it
  // `impure` so pg-mem re-evaluates it per row instead of caching one value
  // (which would otherwise collide on the `id` primary key across inserts).
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
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
  // `rowMode: "array"`. We strip both options and, when drizzle asked for
  // array-mode rows, convert pg-mem's object rows back into positional arrays
  // (in select order) so drizzle's row mapper stays happy.
  const originalQuery = pool.query.bind(pool);
  pool.query = (config: unknown, values?: unknown, cb?: unknown) => {
    if (config && typeof config === "object" && !Array.isArray(config)) {
      const cfg = config as Record<string, unknown>;
      const wantArray = cfg.rowMode === "array";
      const clean = { ...cfg };
      delete clean.rowMode;
      delete clean.types;
      const result = originalQuery(clean, values, cb);
      if (
        wantArray &&
        result &&
        typeof (result as Promise<unknown>).then === "function"
      ) {
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

describe("Salesforce outbox — Property 1: idempotency by jobKey (Req 8.2)", () => {
  let db: Database;

  beforeAll(() => {
    ({ db } = buildDb());
  });

  it("collapses duplicate (jobKey, payload) enqueues to at most one row per jobKey, returning a stable id", async () => {
    let iteration = 0;

    await fc.assert(
      fc.asyncProperty(
        // Each enqueue picks a key from a small pool → forces duplicates.
        fc.array(
          fc.record({
            key: fc.constantFrom("k1", "k2", "k3"),
            payload: safePayload,
          }),
          { minLength: 1, maxLength: 8 }
        ),
        fc.constantFrom(...OUTBOX_KINDS),
        async (entries, kind) => {
          // Namespace keys per iteration so iterations don't interfere while
          // still exercising duplicate enqueues *within* an iteration.
          const ns = `it${iteration++}`;

          const fullEntries = entries.map((e) => ({
            key: `${ns}:${e.key}`,
            payload: e.payload,
          }));
          const distinctKeys = [...new Set(fullEntries.map((e) => e.key))];

          // Enqueue every (possibly duplicate) entry. ON CONFLICT DO NOTHING
          // must collapse duplicates to one row per jobKey, and every enqueue
          // of a known key must return the SAME row id.
          const idByKey = new Map<string, string>();
          for (const { key, payload } of fullEntries) {
            const id = await enqueueOutbox(db, kind, payload, key);
            const seen = idByKey.get(key);
            if (seen !== undefined) {
              expect(id).toBe(seen);
            } else {
              idByKey.set(key, id);
            }
          }

          // At most one outbox row per distinct jobKey, and that row's id
          // matches the id returned at first enqueue.
          for (const key of distinctKeys) {
            const rows = await db
              .select({ id: sfOutbox.id })
              .from(sfOutbox)
              .where(eq(sfOutbox.jobKey, key));
            expect(rows).toHaveLength(1);
            expect(rows[0].id).toBe(idByKey.get(key));
          }
        }
      ),
      { numRuns: FC_RUNS }
    );
  });

  it("re-enqueuing a known jobKey returns the same id and never inserts a second row", async () => {
    const jobKey = "stable-id-key";

    const first = await enqueueOutbox(db, "task", { n: 1 }, jobKey);
    const second = await enqueueOutbox(db, "event", { n: 2 }, jobKey);
    const third = await enqueueOutbox(db, "lead_upsert", { n: 3 }, jobKey);

    expect(second).toBe(first);
    expect(third).toBe(first);

    const rows = await db
      .select({ id: sfOutbox.id, kind: sfOutbox.kind })
      .from(sfOutbox)
      .where(eq(sfOutbox.jobKey, jobKey));

    // Exactly one row, and the first writer wins (no overwrite on conflict).
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first);
    expect(rows[0].kind).toBe("task");
  });
});
