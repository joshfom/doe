// Feature: lead-engine, Property 8: For a given nudgeJobKey, any number of
// enqueues/retries produce at most one external nudge side effect.
// Validates: Requirements 11.1, 11.2
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

/**
 * Property test for the non-negotiable idempotency boundary (CC-Idem) of the
 * `lead_nudge` job (Property 8, Req 11.1/11.2).
 *
 * The property: for a SINGLE `nudgeJobKey` (one lead × type × window bucket),
 * ANY number of enqueue attempts AND any number of handler re-runs — INTERLEAVED
 * in arbitrary order — produce AT MOST ONE external nudge side effect: one
 * `ChannelAdapter.send`, one `sf_outbox` row, and one `lead.nudged` event. We
 * generate an arbitrary sequence of `enqueue` / `run` operations for the same
 * occasion, drive them through the REAL `enqueueJob` + `runJob` spine with a
 * counting fake `ChannelAdapter`, and assert each external side-effect count
 * never exceeds 1. The jobKey idempotency comes from `nudgeJobKey`
 * (lib/cms/leads/nudge.ts) + the jobs spine's at-most-once claim +
 * `enqueueOutbox`'s ON CONFLICT DO NOTHING.
 *
 * PERF: the spec's baseline for this non-optional property is >= 100 iterations.
 * Per an explicit user instruction this test must run FAST locally, so NUM_RUNS
 * was reduced to 25. Raise it back to 100 to restore the full baseline.
 *
 * Harness mirrors `lib/cms/jobs/lead-nudge.test.ts`: migration 0029 applied
 * under an in-memory Postgres so the real `parties` / `reps` / `leads_mirror` /
 * `jobs` / `events` / `sf_outbox` tables exist with their true shapes and unique
 * `job_key` constraints.
 */

const NUM_RUNS = 25;

import * as schema from "../schema";
import {
  parties,
  leadsMirror,
  reps,
  events as eventsTable,
  sfOutbox,
} from "../schema";
import type { Database } from "../db";
import { enqueueJob, runJob, type JobHandlerRegistry, type JobHandler } from "./index";
import { createLeadNudgeHandler } from "./lead-nudge";
import { nudgeJobKey, DEFAULT_NUDGE_POLICY } from "../leads/nudge";
import type { ChannelAdapter, ChannelMessage } from "./channel-adapter";

const MIGRATION_FILE = "0029_demonic_mandrill.sql";

const PREREQUISITE_SQL = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_appointments" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_conversations" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_messages" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
`;

// Read the migration SQL once; every fast-check iteration builds a fresh db.
const MIGRATION_SQL = readFileSync(
  join(process.cwd(), "drizzle", MIGRATION_FILE),
  "utf-8"
);

function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function buildDb(): { mem: IMemoryDb; db: Database } {
  const mem = newDb();

  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });
  mem.public.registerFunction({
    name: "pg_notify",
    args: [DataType.text, DataType.text],
    returns: DataType.text,
    implementation: () => "",
  });

  mem.public.none(PREREQUISITE_SQL);

  for (const stmt of splitStatements(MIGRATION_SQL)) {
    mem.public.none(stmt);
  }

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

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

/** A fake channel that counts and records every send. */
class CountingChannelAdapter implements ChannelAdapter {
  readonly provider = "fake";
  readonly sent: ChannelMessage[] = [];
  async send(message: ChannelMessage) {
    this.sent.push(message);
    return { messageId: `fake-${this.sent.length}`, provider: this.provider };
  }
}

const REP_PHONE = "+971500000009";

/** Seed a rep and an owned, stale lead (48h since last interaction). */
async function seedOwnedStaleLead(
  db: Database
): Promise<{ repId: string; partyId: string }> {
  const [rep] = await db
    .insert(reps)
    .values({
      name: "Aisha",
      languages: ["en"],
      projects: ["Bayn"],
      capacity: 3,
      openHotCount: 0,
      phone: REP_PHONE,
    })
    .returning({ id: reps.id });

  const [party] = await db
    .insert(parties)
    .values({ type: "person", name: "Lina", language: "en" })
    .returning({ id: parties.id });

  await db.insert(leadsMirror).values({
    partyId: party.id,
    tier: "HOT",
    projectInterest: "Bayn",
    budgetBand: "2M-3M",
    lastInteractionSummary: "Keen on a 2-bed.",
    lastInteractionAt: new Date(Date.now() - 48 * 3600_000),
    assignedRepId: rep.id,
  });

  return { repId: rep.id, partyId: party.id };
}

function registryWith(adapter: ChannelAdapter): JobHandlerRegistry {
  const noop: JobHandler = async () => {};
  return {
    post_call_processing: noop,
    compile_and_email_report: noop,
    morning_briefing: noop,
    send_whatsapp_brief: noop,
    lead_nudge: createLeadNudgeHandler(adapter),
    briefing_assembly: noop,
  };
}

type Op = "enqueue" | "run";

describe("lead_nudge idempotency (Property 8)", () => {
  it(
    "Feature: lead-engine, Property 8: For a given nudgeJobKey, any number of enqueues/retries produce at most one external nudge side effect.",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // An arbitrary INTERLEAVING of enqueue/run operations for ONE nudge
          // occasion (single jobKey). We guarantee at least one enqueue and one
          // run so the nudge is actually attempted, then shuffle in any extra
          // operations in any order.
          fc
            .array(fc.constantFrom<Op>("enqueue", "run"), {
              minLength: 0,
              maxLength: 10,
            })
            .map((extra) => ["enqueue", "run", ...extra] as Op[]),
          async (rawOps) => {
            // The first operation must be an enqueue so a job row exists before
            // any run; otherwise keep the generated order untouched.
            const ops: Op[] = rawOps[0] === "enqueue" ? rawOps : ["enqueue", ...rawOps];

            const { db } = buildDb();
            const adapter = new CountingChannelAdapter();
            const { partyId } = await seedOwnedStaleLead(db);

            const now = new Date();
            const jobKey = nudgeJobKey(partyId, "stale", now, DEFAULT_NUDGE_POLICY);
            const registry = registryWith(adapter);

            // Execute the interleaved sequence. Every `enqueue` for this jobKey
            // resolves to the SAME job row (Req 11.1); every `run` is bounded by
            // the spine's at-most-once claim (Req 11.2). A `run` before any
            // enqueue is impossible because the first op is forced to enqueue.
            let jobId = "";
            for (const op of ops) {
              if (op === "enqueue") {
                const id = await enqueueJob(
                  db,
                  "lead_nudge",
                  { partyId, type: "stale" },
                  jobKey
                );
                if (jobId === "") jobId = id;
                // Every enqueue for this jobKey must return the same job row.
                expect(id).toBe(jobId);
              } else if (jobId !== "") {
                await runJob(db, jobId, registry);
              }
            }

            // AT MOST ONE external side effect of each kind.
            expect(adapter.sent.length).toBeLessThanOrEqual(1);

            const nudged = await db
              .select({ id: eventsTable.id })
              .from(eventsTable)
              .where(eq(eventsTable.type, "lead.nudged"));
            expect(nudged.length).toBeLessThanOrEqual(1);

            const outbox = await db.select().from(sfOutbox);
            expect(outbox.length).toBeLessThanOrEqual(1);

            // The three external effects move together: a delivered send means
            // exactly one outbox row and one lead.nudged event.
            expect(outbox.length).toBe(adapter.sent.length);
            expect(nudged.length).toBe(adapter.sent.length);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    }
  );
});
