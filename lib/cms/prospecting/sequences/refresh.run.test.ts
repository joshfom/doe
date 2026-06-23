import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";

import type { Database } from "../../db";
import * as schema from "../../schema";
import { PROVIDER_IDS, type ProviderResult } from "../providers";

/**
 * Unit — open-ended enrollment + completion bookkeeping (Requirements 3.1, 4.4).
 *
 * A Sequence Refresh_Run is OPEN-ENDED: unlike the legacy one-shot flow it has no
 * campaign-total stop. A single refresh enrolls only up to its per-refresh size
 * (`target_count`) and the Sequence's enrollment cap for the period — never a
 * fixed lifetime N (Req 3.1). On completing a refresh the handler stamps the
 * Sequence's `last_refreshed_at` (Req 4.4).
 *
 * Driven through the SAME durable batch handler the ad-hoc path uses —
 * `runProspectingBatch` (`lib/cms/prospecting/batch/run.ts`) — in its
 * SEQUENCE-SCOPED mode (the Batch_Run row carries a `sequence_id`). The external
 * seams are mocked so every candidate is deterministically cold-eligible.
 */

const h = vi.hoisted(() => ({
  candidates: [] as unknown[],
}));

vi.mock("../../ai/tools/dispatch", () => ({
  dispatchTool: vi.fn(
    async (db: unknown, toolName: string, input: Record<string, unknown>) => {
      switch (toolName) {
        case "prospect_search":
          return {
            ok: true,
            result: {
              candidates: h.candidates,
              unconfiguredProviders: [],
              failedProviders: [],
            },
          };
        case "record_target": {
          const handle = db as Database;
          const [row] = await handle
            .insert(schema.targets)
            .values({
              targetType: input.targetType as "person",
              displayName: (input.displayName as string) ?? null,
              email: (input.email as string) ?? null,
              attributes: {},
              sourceProvider: input.sourceProvider as string,
              sourceRef: (input.sourceRef as string) ?? null,
              lawfulBasis: input.lawfulBasis as string,
            })
            .returning({ id: schema.targets.id });
          return { ok: true, result: { targetId: row.id, phoneHash: null } };
        }
        case "draft_outreach": {
          const handle = db as Database;
          const [row] = await handle
            .insert(schema.outreachDrafts)
            .values({
              targetId: input.targetId as string,
              channel: input.channel as "email",
              language: input.language as "en",
              subject: (input.subject as string) ?? null,
              body: input.body as string,
              grounding: (input.grounding as unknown) ?? [],
            })
            .returning({ id: schema.outreachDrafts.id });
          return { ok: true, result: { draftId: row.id, status: "drafted" } };
        }
        default:
          return { ok: false, error: new Error(`unexpected tool ${toolName}`) };
      }
    }
  ),
}));

vi.mock("../crm-check", () => ({
  checkCrmForContact: vi.fn(async () => ({
    configured: true,
    found: false,
    matches: [],
    checkedEmail: null,
  })),
}));

import { runProspectingBatch } from "../batch/run";

const BATCH_MIGRATION_FILE = "0040_agentic_prospecting_batch.sql";
const SEQUENCE_MIGRATION_FILE = "0043_prospecting_sequences.sql";

const PREREQUISITE_SQL = `
  CREATE TABLE "users" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
  );
  CREATE TABLE "targets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "brief_id" uuid,
    "target_type" text NOT NULL,
    "display_name" text,
    "company_name" text,
    "title" text,
    "email" text,
    "phone_hash" text,
    "raw_phone" text,
    "country" text,
    "attributes" jsonb,
    "source_provider" text NOT NULL,
    "source_ref" text,
    "lawful_basis" text NOT NULL,
    "status" text NOT NULL DEFAULT 'new',
    "party_id" uuid,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "outreach_drafts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "target_id" uuid NOT NULL REFERENCES "targets"("id") ON DELETE CASCADE,
    "brief_id" uuid,
    "channel" text NOT NULL,
    "language" text NOT NULL,
    "subject" text,
    "body" text NOT NULL,
    "grounding" jsonb NOT NULL,
    "status" text NOT NULL DEFAULT 'draft',
    "approved_by" uuid,
    "job_key" text,
    "ai_original_subject" text,
    "ai_original_body" text,
    "sent_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "prospect_optouts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "match_kind" text NOT NULL,
    "match_value" text NOT NULL,
    "reason" text,
    "created_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE UNIQUE INDEX "prospect_optouts_match_ux" ON "prospect_optouts" ("match_kind", "match_value");
  CREATE TABLE "events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "type" text NOT NULL,
    "payload" jsonb,
    "at" timestamp DEFAULT now() NOT NULL
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

beforeEach(() => {
  backup.restore();
});

afterAll(async () => {
  await dbPool?.end?.();
});

/** Build `n` distinct cold-eligible candidates. */
function coldCandidates(n: number): ProviderResult[] {
  return Array.from({ length: n }, (_, i) => ({
    targetType: "person" as const,
    displayName: `Cand ${i}`,
    email: `cand-${i}-${randomUUID()}@example.com`,
    attributes: {
      email: {
        value: `cand-${i}@example.com`,
        source: PROVIDER_IDS[0],
        asOf: "2025-01-01T00:00:00.000Z",
      },
    },
    sourceProvider: PROVIDER_IDS[0],
    sourceRef: `ref-${i}-${randomUUID()}`,
    lawfulBasis: "legitimate_interest",
  }));
}

/** Seed a `live` Sequence + its Refresh_Run with the given per-refresh size + cap. */
async function seedSequenceRun(
  perRefreshSize: number,
  enrollmentCap: number | null
): Promise<{ sequenceId: string; runId: string }> {
  const ownerRep = randomUUID();
  await db.execute(sql`INSERT INTO "users" ("id") VALUES (${ownerRep})`);

  const [sequence] = await db
    .insert(schema.prospectingSequences)
    .values({
      ownerRep,
      name: `seq-${randomUUID()}`,
      subject: { kind: "icp", icpFilter: { targetType: "person" } },
      targetCount: perRefreshSize,
      mode: "live",
      status: "live",
      enrollmentCap,
      enrollmentPeriod: "month",
    })
    .returning({ id: schema.prospectingSequences.id });

  const [run] = await db
    .insert(schema.prospectingBatchRuns)
    .values({
      ownerRep,
      sequenceId: sequence.id,
      subject: { kind: "icp", icpFilter: { targetType: "person" } },
      targetCount: perRefreshSize,
      rerunKey: `rk-${randomUUID()}`,
    })
    .returning({ id: schema.prospectingBatchRuns.id });
  return { sequenceId: sequence.id, runId: run.id };
}

async function countEnrollments(sequenceId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.prospectingSequenceEnrollments)
    .where(eq(schema.prospectingSequenceEnrollments.sequenceId, sequenceId));
  return row.count;
}

async function readSequence(sequenceId: string) {
  const [row] = await db
    .select({
      status: schema.prospectingSequences.status,
      lastRefreshedAt: schema.prospectingSequences.lastRefreshedAt,
    })
    .from(schema.prospectingSequences)
    .where(eq(schema.prospectingSequences.id, sequenceId));
  return row;
}

describe("Sequence Refresh_Run — open-ended enrollment + completion bookkeeping", () => {
  it("enrolls only up to the per-refresh size with no campaign-total stop, even when the candidate pool is larger (Req 3.1)", async () => {
    const perRefreshSize = 3;
    const { sequenceId, runId } = await seedSequenceRun(perRefreshSize, null);
    // A pool LARGER than the per-refresh size — a one-shot campaign-total stop
    // would cap differently, but a refresh is bounded only by the per-refresh N.
    h.candidates = coldCandidates(7);

    await runProspectingBatch(db, { batchRunId: runId }, {} as never);

    expect(await countEnrollments(sequenceId)).toBe(perRefreshSize);
  });

  it("a refresh is additionally bounded by the enrollment cap for the period (Req 3.1)", async () => {
    const perRefreshSize = 10;
    const cap = 2;
    const { sequenceId, runId } = await seedSequenceRun(perRefreshSize, cap);
    h.candidates = coldCandidates(6);

    await runProspectingBatch(db, { batchRunId: runId }, {} as never);

    expect(await countEnrollments(sequenceId)).toBe(cap);
  });

  it("a fresh refresh against an unbounded cap enrolls the whole pool when below the per-refresh size (Req 3.1)", async () => {
    const perRefreshSize = 10;
    const { sequenceId, runId } = await seedSequenceRun(perRefreshSize, null);
    h.candidates = coldCandidates(4);

    await runProspectingBatch(db, { batchRunId: runId }, {} as never);

    expect(await countEnrollments(sequenceId)).toBe(4);
  });

  it("completing a refresh stamps the Sequence's last_refreshed_at and leaves it live (Req 4.4)", async () => {
    const before = Date.now();
    const { sequenceId, runId } = await seedSequenceRun(5, null);
    h.candidates = coldCandidates(3);

    await runProspectingBatch(db, { batchRunId: runId }, {} as never);

    const seq = await readSequence(sequenceId);
    expect(seq.status).toBe("live");
    expect(seq.lastRefreshedAt).not.toBeNull();
    expect(seq.lastRefreshedAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("completing a refresh that finds zero candidates still stamps last_refreshed_at (Req 4.4)", async () => {
    const { sequenceId, runId } = await seedSequenceRun(5, null);
    h.candidates = [];

    await runProspectingBatch(db, { batchRunId: runId }, {} as never);

    const seq = await readSequence(sequenceId);
    expect(seq.lastRefreshedAt).not.toBeNull();
    expect(await countEnrollments(sequenceId)).toBe(0);
  });
});
