import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { newDb, DataType } from "pg-mem";
import { drizzle } from "drizzle-orm/pg-proxy";
import { sql } from "drizzle-orm";
import fc from "fast-check";
import * as schema from "@/lib/cms/schema";
import { enqueueOutbox, type OutboxKind } from "@/lib/cms/outbox/index";
import type { Database } from "@/lib/cms/db";

/**
 * Property test for the Salesforce outbox (task 3.2).
 *
 * Property 1: Outbox idempotency by jobKey — for arbitrary `(jobKey, payload)`
 * enqueue sequences, at most one `sf_outbox` row exists per distinct `jobKey`,
 * and repeated `enqueueOutbox` calls for the same `jobKey` return the SAME row
 * id (Req 8.2). This relies on the unique `job_key` constraint + the
 * `ON CONFLICT (job_key) DO NOTHING` insert in `enqueueOutbox`.
 *
 * Setup mirrors the established pg-mem pattern from
 * `lib/cms/schema.migration.test.ts`: register `gen_random_uuid`, create the
 * `sf_outbox` table from migration 0029's DDL, then drive Drizzle through
 * pg-mem's node-postgres adapter so we exercise the real query path.
 *
 * **Validates: Requirements 8.2**
 */

// sf_outbox DDL, taken verbatim from drizzle/0029_demonic_mandrill.sql.
const SF_OUTBOX_DDL = `
  CREATE TABLE "sf_outbox" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "kind" text NOT NULL,
    "job_key" text NOT NULL,
    "payload" jsonb NOT NULL,
    "status" text DEFAULT 'pending' NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "sf_id" text,
    "last_error" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "sf_outbox_job_key_unique" UNIQUE("job_key")
  );
`;

/** Build a fresh Drizzle DB over an in-memory Postgres with sf_outbox ready. */
function buildDb(): Database {
  const mem = newDb();

  // pg-mem does not ship `gen_random_uuid()`; register it so DEFAULTs resolve.
  // `impure: true` is required so pg-mem does NOT memoize the result — otherwise
  // every inserted row gets the same id and collides on the primary key.
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });

  mem.public.none(SF_OUTBOX_DDL);

  // pg-mem's node-postgres adapter is incompatible with Drizzle's node-postgres
  // driver (it rejects the `getTypeParser`/`rowMode` query options Drizzle
  // sets). Instead we drive Drizzle through its pg-proxy driver and route every
  // query to pg-mem's pg `Pool` ourselves (so those unsupported options are
  // never passed). For `method === "all"` Drizzle expects each row as an array
  // of column values in selection order, so we project objects to value arrays.
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();

  return drizzle(async (queryString, params, method) => {
    const result = await pool.query(queryString, params);
    const rows =
      method === "all"
        ? result.rows.map((r: Record<string, unknown>) => Object.values(r))
        : result.rows;
    return { rows };
  }, { schema }) as unknown as Database;
}

const OUTBOX_KINDS: OutboxKind[] = ["lead_upsert", "task", "event"];

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
const safePayload: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  value: fc.oneof(
    { maxDepth: 3 },
    safeString,
    fc.integer(),
    fc.boolean(),
    fc.array(tie("value"), { maxLength: 4 }),
    // `noNullPrototype: true`: jsonb payloads always originate from JSON
    // (tool calls / JSON.parse) and so carry Object.prototype. Without this,
    // fast-check can draw a `__proto__` key and emit a null-prototype object,
    // which Drizzle's internal `is()` check chokes on (`.constructor` of null) —
    // a harness artefact unrelated to the jobKey idempotency property here.
    fc.dictionary(safeString, tie("value"), { maxKeys: 4, noNullPrototype: true })
  ),
})).value;

describe("enqueueOutbox — Property 1: outbox idempotency by jobKey", () => {
  it("keeps at most one row per jobKey and returns a stable id (Req 8.2)", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Sequences of enqueue calls. jobKeys drawn from a small pool so the
        // same key collides frequently across the sequence.
        fc.array(
          fc.record({
            jobKey: fc.constantFrom("k1", "k2", "k3", "k4", "k5"),
            kind: fc.constantFrom(...OUTBOX_KINDS),
            payload: safePayload,
          }),
          { minLength: 1, maxLength: 40 }
        ),
        async (calls) => {
          const db = buildDb();

          // Track the id returned for each jobKey to assert stability.
          const idsByKey = new Map<string, string>();

          for (const call of calls) {
            const id = await enqueueOutbox(
              db,
              call.kind,
              call.payload,
              call.jobKey
            );

            // enqueueOutbox must always return the same id for a given jobKey.
            const seen = idsByKey.get(call.jobKey);
            if (seen === undefined) {
              idsByKey.set(call.jobKey, id);
            } else {
              expect(id).toBe(seen);
            }
          }

          // At most one row per distinct jobKey.
          const counts = (await db
            .select({
              jobKey: schema.sfOutbox.jobKey,
              n: sql<number>`count(*)::int`,
            })
            .from(schema.sfOutbox)
            .groupBy(schema.sfOutbox.jobKey)) as Array<{
            jobKey: string;
            n: number;
          }>;

          for (const row of counts) {
            expect(row.n).toBe(1);
          }

          // Distinct keys enqueued == distinct rows persisted.
          const distinctKeys = new Set(calls.map((c) => c.jobKey));
          expect(counts.length).toBe(distinctKeys.size);
        }
      ),
      { numRuns: 50 }
    );
  });
});
