import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import fc from "fast-check";

import type { Database } from "../../db";
import * as schema from "../../schema";

/**
 * Property 6 — Cadence advance and status gating (Requirements 4.1, 4.5, 4.6,
 * 10.3).
 *
 *   **Feature: prospecting-sequences, Property 6: Cadence advance and status
 *   gating.**
 *
 * **Validates: Requirements 4.1, 4.5, 4.6, 10.3**
 *
 * *For any* Sequence status + `next_refresh_at` offset + refresh interval, one
 * `runSequenceRefreshSweep` pass enqueues a Refresh_Run IFF the Sequence is
 * `live` AND due (`next_refresh_at <= now`); when it fires, `next_refresh_at`
 * advances by exactly the interval; and a `draft` / `paused` / `archived`
 * Sequence (or a `live` one not yet due) NEVER enqueues and keeps its slot
 * unchanged (Req 4.1, 4.5, 4.6, 10.3 — including after an edited interval).
 *
 * `runSequenceRefreshSweep` (`lib/cms/prospecting/sequences/refresh-sweep.ts`)
 * is the pure, timer-free body of one tick. Driven for real against an in-memory
 * Postgres (pg-mem) carrying the real
 * `drizzle/0040_agentic_prospecting_batch.sql` +
 * `drizzle/0043_prospecting_sequences.sql` schemas plus the `jobs` table.
 */

const NUM_RUNS = Math.max(100, Number(process.env.PBT_RUNS ?? 100));
const BATCH_MIGRATION_FILE = "0040_agentic_prospecting_batch.sql";
const SEQUENCE_MIGRATION_FILE = "0043_prospecting_sequences.sql";

vi.mock("../../realtime/events", () => ({
  publishEvent: vi.fn(async () => {}),
}));

import { runSequenceRefreshSweep, refreshRerunKey } from "./refresh-sweep";

const PREREQUISITE_SQL = `
  CREATE TABLE "users" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
  );
  CREATE TABLE "targets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "target_type" text NOT NULL,
    "source_provider" text NOT NULL,
    "lawful_basis" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "outreach_drafts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "target_id" uuid NOT NULL REFERENCES "targets"("id") ON DELETE CASCADE,
    "channel" text NOT NULL,
    "language" text NOT NULL,
    "body" text NOT NULL,
    "grounding" jsonb NOT NULL,
    "status" text NOT NULL DEFAULT 'draft',
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "type" text NOT NULL,
    "payload" jsonb,
    "at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "jobs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "kind" text NOT NULL,
    "job_key" text NOT NULL,
    "status" text DEFAULT 'received' NOT NULL,
    "payload" jsonb,
    "plan" jsonb,
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_error" text,
    "party_id" uuid,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "jobs_job_key_unique" UNIQUE("job_key")
  );
  CREATE TABLE "prospecting_sequences" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "owner_rep" uuid NOT NULL,
    "name" text NOT NULL,
    "description" text,
    "subject" jsonb NOT NULL,
    "target_count" integer NOT NULL DEFAULT 10,
    "mode" text NOT NULL DEFAULT 'draft',
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
`;

function applyMigration(mem: IMemoryDb, file: string): void {
  const migration = readFileSync(join(process.cwd(), "drizzle", file), "utf-8");
  for (const statement of migration.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) mem.public.none(trimmed);
  }
}

function buildDb(): {
  mem: IMemoryDb;
  db: Database;
  pool: { end: () => Promise<void> };
} {
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
  mem.public.registerFunction({
    name: "now",
    returns: DataType.timestamptz,
    implementation: () => new Date(),
    impure: true,
  });

  mem.public.none(PREREQUISITE_SQL);

  applyMigration(mem, BATCH_MIGRATION_FILE);
  mem.public.none(
    'ALTER TABLE "prospecting_batch_runs" ADD COLUMN "sequence_id" uuid'
  );
  applyMigration(mem, SEQUENCE_MIGRATION_FILE);

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  const countRows = (table: string): number =>
    Number(
      (
        mem.public.many(`SELECT count(*) AS c FROM "${table}"`) as Array<{
          c: number | string;
        }>
      )[0].c
    );

  const originalQuery = pool.query.bind(pool);
  pool.query = ((config: unknown, values?: unknown, cb?: unknown) => {
    if (config && typeof config === "object" && !Array.isArray(config)) {
      const cfg = config as Record<string, unknown>;
      const wantArray = cfg.rowMode === "array";
      const text = String(cfg.text ?? "");
      const lower = text.toLowerCase();
      const clean = { ...cfg };
      delete clean.rowMode;
      delete clean.types;

      const conflictDoNothingReturning =
        lower.includes("on conflict") &&
        lower.includes("do nothing") &&
        lower.includes("returning");

      const shapeRows = (rows: Record<string, unknown>[]) =>
        wantArray ? rows.map((row) => Object.values(row)) : rows;

      if (conflictDoNothingReturning) {
        const table = text.match(/insert\s+into\s+"?([\w.]+)"?/i)?.[1] ?? null;
        const before = table ? countRows(table) : null;
        const result = originalQuery(clean, values, cb);
        return Promise.resolve(
          result as Promise<{ rows: Record<string, unknown>[] }>
        ).then((r) => {
          const after = table ? countRows(table) : null;
          const inserted =
            before === null || after === null ? true : after > before;
          const rows = inserted ? (r.rows ?? []) : [];
          return { ...r, rows: shapeRows(rows), rowCount: rows.length };
        });
      }

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
  }) as typeof pool.query;

  const db = drizzle(pool, { schema }) as unknown as Database;
  return { mem, db, pool };
}

let mem!: IMemoryDb;
let db!: Database;
let dbPool!: { end: () => Promise<void> };
let backup!: { restore: () => void };

beforeAll(() => {
  ({ mem, db, pool: dbPool } = buildDb());
  backup = mem.backup();
});

afterAll(async () => {
  await dbPool?.end?.();
});

type SeqStatus = "draft" | "live" | "paused" | "archived";

async function seedSequence(
  status: SeqStatus,
  slot: Date,
  intervalMinutes: number
): Promise<string> {
  const ownerRep = randomUUID();
  await db.execute(sql`INSERT INTO "users" ("id") VALUES (${ownerRep})`);
  const [seq] = await db
    .insert(schema.prospectingSequences)
    .values({
      ownerRep,
      name: `seq-${randomUUID()}`,
      subject: { kind: "icp", icpFilter: { targetType: "person" } },
      targetCount: 10,
      mode: status === "live" ? "live" : "draft",
      status,
      nextRefreshAt: slot,
      refreshIntervalMinutes: intervalMinutes,
    })
    .returning({ id: schema.prospectingSequences.id });
  return seq.id;
}

async function readSlot(sequenceId: string): Promise<Date | null> {
  const [row] = await db
    .select({ nextRefreshAt: schema.prospectingSequences.nextRefreshAt })
    .from(schema.prospectingSequences)
    .where(eq(schema.prospectingSequences.id, sequenceId));
  return row.nextRefreshAt;
}

async function countRuns(sequenceId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.prospectingBatchRuns)
    .where(eq(schema.prospectingBatchRuns.sequenceId, sequenceId));
  return row.count;
}

async function countJobsByKey(jobKey: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.jobs)
    .where(eq(schema.jobs.jobKey, jobKey));
  return row.count;
}

describe("**Feature: prospecting-sequences, Property 6: Cadence advance and status gating.**", () => {
  it("Validates: Requirements 4.1, 4.5, 4.6, 10.3 — a Refresh_Run is enqueued only when live and due, next_refresh_at advances by the interval when it fires, and draft/paused/archived (or not-yet-due) Sequences never enqueue", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          status: fc.constantFrom<SeqStatus>(
            "draft",
            "live",
            "paused",
            "archived"
          ),
          // Negative offset = slot in the past (due); positive = future (not due).
          slotOffsetMinutes: fc.integer({ min: -10_000, max: 10_000 }),
          intervalMinutes: fc.integer({ min: 60, max: 20_160 }),
        }),
        async ({ status, slotOffsetMinutes, intervalMinutes }) => {
          backup.restore();

          const now = new Date("2026-04-01T00:00:00.000Z");
          const slot = new Date(now.getTime() + slotOffsetMinutes * 60_000);
          const sequenceId = await seedSequence(status, slot, intervalMinutes);
          const key = refreshRerunKey(sequenceId, slot);

          const result = await runSequenceRefreshSweep(db, now);

          const isDue = slot.getTime() <= now.getTime();
          const shouldFire = status === "live" && isDue;

          if (shouldFire) {
            // (Req 4.1) Exactly one Refresh_Run + one job enqueued for the slot.
            expect(result.enqueued).toBe(1);
            expect(await countRuns(sequenceId)).toBe(1);
            expect(await countJobsByKey(key)).toBe(1);

            // (Req 4.5, 10.3) next_refresh_at advanced by exactly the interval.
            const advanced = await readSlot(sequenceId);
            expect(advanced).not.toBeNull();
            const expected = now.getTime() + intervalMinutes * 60_000;
            expect(advanced!.getTime()).toBe(expected);
          } else {
            // (Req 4.6) Not fired — no run, no job, and the slot is unchanged.
            expect(result.enqueued).toBe(0);
            expect(await countRuns(sequenceId)).toBe(0);
            expect(await countJobsByKey(key)).toBe(0);

            const unchanged = await readSlot(sequenceId);
            expect(unchanged!.getTime()).toBe(slot.getTime());
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  }, 120000);
});
