import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/pg-proxy";
import { eq } from "drizzle-orm";
import fc from "fast-check";

import * as schema from "../schema";
import { sfOutbox, jobs } from "../schema";
import { enqueueOutbox, drainOnce, type OutboxKind } from "./index";
import {
  enqueueJob,
  runJob,
  type JobKind,
  type JobHandlerRegistry,
} from "../jobs";
import type { Database } from "../db";
import type { SalesforceAdapter } from "../tickets/crm/salesforce";

/**
 * Property test for jobKey idempotency across BOTH agent-triggered side-effect
 * spines — the Salesforce outbox (`enqueueOutbox`/`drainOnce`) and the durable
 * job runner (`enqueueJob`/`runJob`). This is the non-optional CC-Idem boundary
 * test (task 4.6): an agent that retries a side effect must never double-act.
 *
 * **Feature: agentic-foundation, Property 14: For any sequence of
 * enqueueOutbox/enqueueJob calls, for every jobKey k the number of rows with
 * jobKey = k is at most one in each of sf_outbox and jobs, and draining/running
 * produces at most one external side effect per k regardless of retries.**
 *
 * **Validates: Requirements 12.3, 12.4**
 *
 * Harness mirrors `lib/cms/outbox/drain.integration.test.ts`: migration 0029 is
 * applied statement-by-statement over an in-memory Postgres (pg-mem) so the real
 * `sf_outbox` and `jobs` tables exist with their true column shapes and unique
 * `job_key` constraints. A pg-proxy Drizzle handle runs `enqueueOutbox`,
 * `drainOnce`, `enqueueJob`, and `runJob` against genuine SQL (`ON CONFLICT
 * (job_key) DO NOTHING`, the atomic conditional-UPDATE claim).
 *
 * pg-mem ships neither `gen_random_uuid()` (column DEFAULTs) nor `pg_notify`
 * (issued by `publishEvent` inside both `drainOnce` and `runJob`), so both are
 * registered as no-op/uuid stubs. A BEGIN/COMMIT/ROLLBACK shim is layered over
 * the single connection because `publishEvent` wraps its insert + NOTIFY in
 * `db.transaction`, which the pg-proxy driver does not provide out of the box.
 *
 * External side effects are modelled by COUNTING FAKES — a `SalesforceAdapter`
 * whose `requestJson` transport counts Salesforce creates (one per drained
 * outbox row), and a job handler registry that counts invocations per
 * `jobKey`. The property asserts the count stays ≤ 1 per jobKey no matter how
 * many times we drain/run (the retry axis).
 */

/** fast-check budget — the design mandates ≥100 iterations for each property. */
const NUM_RUNS = 100;
const MAX_SEQUENCE = 10;

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
const JOB_KINDS: readonly JobKind[] = [
  "post_call_processing",
  "compile_and_email_report",
  "morning_briefing",
  "send_whatsapp_brief",
];

/** Split a Drizzle migration into individual statements. */
function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Read + parse the migration once; applying it per-run is the per-iteration cost.
const MIGRATION_STATEMENTS = splitStatements(
  readFileSync(join(process.cwd(), "drizzle", MIGRATION_FILE), "utf-8")
);

/**
 * Stand up a fresh in-memory Postgres with migration 0029 applied and return a
 * Drizzle handle bound to it, with a real transaction over the single
 * connection so `publishEvent` (insert + NOTIFY) runs inside both `drainOnce`
 * and `runJob`.
 */
function buildDb(): { db: Database; mem: IMemoryDb } {
  const mem = newDb();

  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });
  mem.public.registerFunction({
    name: "pg_notify",
    args: [DataType.text, DataType.text],
    returns: DataType.text,
    implementation: () => null,
    impure: true,
  });

  mem.public.none(PREREQUISITE_SQL);
  for (const stmt of MIGRATION_STATEMENTS) {
    mem.public.none(stmt);
  }

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

  (db as unknown as { transaction: unknown }).transaction = async (
    fn: (tx: Database) => Promise<unknown>
  ) => {
    await executor("BEGIN", [], "execute");
    try {
      const result = await fn(db);
      await executor("COMMIT", [], "execute");
      return result;
    } catch (err) {
      await executor("ROLLBACK", [], "execute");
      throw err;
    }
  };

  return { db, mem };
}

// ── Counting fakes for the external side effects ──────────────────────────────

/**
 * A fake `SalesforceAdapter` whose `requestJson` transport always succeeds and
 * records every create (POST) so we can count Salesforce records created. The
 * Object_Router inside `drainOnce` drives this transport via a
 * `SalesforceObjectClient`; one create per outbox row is the at-most-once
 * boundary this property protects (`ticketNumber`/Case mapping is gone).
 */
function makeCountingAdapter() {
  const createdIds: string[] = [];
  let seq = 0;
  const adapter = {
    name: "counting-salesforce",
    async requestJson<T>(
      method: string,
      _path: string,
      _body?: Record<string, unknown>
    ): Promise<T> {
      if (method === "POST") {
        seq += 1;
        const id = `sf-${seq}`;
        createdIds.push(id);
        return { id, success: true, errors: [] } as T;
      }
      // PATCH (update) → 204 No Content; GET unused on this path.
      return {} as T;
    },
  };
  return {
    adapter: adapter as unknown as SalesforceAdapter,
    createdIds,
    /** Total Salesforce object creates performed. */
    get createCount() {
      return createdIds.length;
    },
  };
}

/** Backdate every pending outbox row so the next drain skips its backoff window. */
async function backdateOutbox(db: Database): Promise<void> {
  await db
    .update(sfOutbox)
    .set({ updatedAt: new Date(0) })
    .where(eq(sfOutbox.status, "pending"));
}

describe("Outbox + Jobs — Property 14: jobKey idempotency across both spines (Req 12.3, 12.4)", () => {
  it("keeps at most one row per jobKey in each table and at most one external side effect per jobKey regardless of retries", async () => {
    await fc.assert(
      fc.asyncProperty(
        // A sequence of enqueue operations against EITHER spine. A small jobKey
        // pool forces duplicates within each table — exactly the retry/dedupe
        // case that would double-act if the spines weren't idempotent.
        fc.array(
          fc.oneof(
            fc.record({
              target: fc.constant("outbox" as const),
              key: fc.constantFrom("k1", "k2", "k3"),
              kind: fc.constantFrom(...OUTBOX_KINDS),
            }),
            fc.record({
              target: fc.constant("job" as const),
              key: fc.constantFrom("k1", "k2", "k3"),
              kind: fc.constantFrom(...JOB_KINDS),
            })
          ),
          { minLength: 1, maxLength: MAX_SEQUENCE }
        ),
        // How many times we drain / re-run each job — the "regardless of
        // retries" axis.
        fc.integer({ min: 1, max: 4 }),
        // Run job repeats concurrently (true) or sequentially (false).
        fc.boolean(),
        async (operations, retryCount, concurrent) => {
          const { db } = buildDb();
          const fakeSf = makeCountingAdapter();
          const jobSideEffects = new Map<string, number>();

          const countingHandler = async (
            _db: Database,
            _payload: unknown,
            ctx: { jobKey: string }
          ) => {
            jobSideEffects.set(
              ctx.jobKey,
              (jobSideEffects.get(ctx.jobKey) ?? 0) + 1
            );
          };
          const jobRegistry: JobHandlerRegistry = {
            post_call_processing: countingHandler,
            compile_and_email_report: countingHandler,
            morning_briefing: countingHandler,
            send_whatsapp_brief: countingHandler,
          };

          // (a) Enqueue every (possibly duplicate) operation. A re-enqueue of a
          //     known key MUST return the same row id (ON CONFLICT DO NOTHING).
          const outboxIdByKey = new Map<string, string>();
          const jobIdByKey = new Map<string, string>();

          for (const op of operations) {
            if (op.target === "outbox") {
              // Payload carries no SF identity → the router creates one object
              // per row; the at-most-once count is therefore per jobKey.
              const id = await enqueueOutbox(
                db,
                op.kind as OutboxKind,
                { subject: `for ${op.key}` },
                op.key
              );
              const seen = outboxIdByKey.get(op.key);
              if (seen !== undefined) expect(id).toBe(seen);
              else outboxIdByKey.set(op.key, id);
            } else {
              const id = await enqueueJob(
                db,
                op.kind as JobKind,
                { key: op.key },
                op.key
              );
              const seen = jobIdByKey.get(op.key);
              if (seen !== undefined) expect(id).toBe(seen);
              else jobIdByKey.set(op.key, id);
            }
          }

          // (b) At most one row per distinct jobKey in EACH table.
          for (const key of outboxIdByKey.keys()) {
            const rows = await db
              .select({ id: sfOutbox.id })
              .from(sfOutbox)
              .where(eq(sfOutbox.jobKey, key));
            expect(rows).toHaveLength(1);
            expect(rows[0].id).toBe(outboxIdByKey.get(key));
          }
          for (const key of jobIdByKey.keys()) {
            const rows = await db
              .select({ id: jobs.id })
              .from(jobs)
              .where(eq(jobs.jobKey, key));
            expect(rows).toHaveLength(1);
            expect(rows[0].id).toBe(jobIdByKey.get(key));
          }

          // (c) Drain the outbox repeatedly; backdate between drains so any
          //     still-pending row is immediately eligible for a retry. A
          //     correct drainer sends each row at most once.
          for (let i = 0; i < retryCount; i++) {
            await drainOnce(db, fakeSf.adapter);
            await backdateOutbox(db);
          }

          // (d) Run each distinct job retryCount times (sequential/concurrent).
          for (const key of jobIdByKey.keys()) {
            const jobId = jobIdByKey.get(key)!;
            const runs = Array.from({ length: retryCount }, () =>
              runJob(db, jobId, jobRegistry)
            );
            if (concurrent) await Promise.all(runs);
            else for (const r of runs) await r;
          }

          // (e) THE PROPERTY: at most one external side effect per jobKey, in
          //     each spine, no matter how many drains/runs occurred. Each outbox
          //     jobKey is one row created exactly once despite `retryCount`
          //     drains; every created Salesforce id is distinct.
          expect(fakeSf.createCount).toBe(outboxIdByKey.size);
          expect(new Set(fakeSf.createdIds).size).toBe(fakeSf.createCount);
          for (const key of jobIdByKey.keys()) {
            expect(jobSideEffects.get(key) ?? 0).toBeLessThanOrEqual(1);
          }

          // No stray side effects for keys never enqueued into the jobs spine.
          expect(jobSideEffects.size).toBeLessThanOrEqual(jobIdByKey.size);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
