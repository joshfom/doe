import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import fc from "fast-check";

import type { Database } from "../../db";
import * as schema from "../../schema";
import { PROVIDER_IDS, type ProviderResult } from "../providers";
import type { DispatchResult } from "../../ai/tools/dispatch";

// ── The dispatcher is mocked so the discovered candidate pool (and the Target /
//    draft writes) are driven by the generator, not by real providers (CC-Audit:
//    every prospecting effect in run.ts goes through `dispatchTool`). The handler
//    imports it from "../../ai/tools/dispatch"; this hoisted mock replaces that
//    module before run.ts loads it.
vi.mock("../../ai/tools/dispatch", () => ({
  dispatchTool: vi.fn(),
}));
import { dispatchTool } from "../../ai/tools/dispatch";
const mockedDispatch = vi.mocked(dispatchTool);

// ── CRM_Check is mocked CONFIGURED + NOT-FOUND (the check actually ran), so a
//    discovered candidate that clears the other compliance gates is genuinely
//    cold-eligible — exactly the candidates Property 1 counts against N.
vi.mock("../crm-check", () => ({
  checkCrmForContact: vi.fn(),
}));
import { checkCrmForContact, type CrmCheckResult } from "../crm-check";
const mockedCrm = vi.mocked(checkCrmForContact);

import { runProspectingBatch } from "./run";

/**
 * Property 1 — Batch size is bounded by N and terminates
 * (Requirements 2.1, 2.7).
 *
 *   **Feature: agentic-prospecting-batch, Property 1: Batch size is bounded by N
 *   and terminates.**
 *
 * **Validates: Requirements 2.1, 2.7**
 *
 * `runProspectingBatch` discovers candidates up to the target count N (Req 2.1)
 * and sets the run `completed` exactly when it has produced N Queued_Items OR has
 * exhausted the available candidates (Req 2.7). This property drives the WHOLE
 * handler end to end against a real Drizzle handle over an in-memory Postgres
 * (pg-mem) carrying the real `drizzle/0040_agentic_prospecting_batch.sql` schema,
 * over a random pool of cold-eligible candidates and a random target count N, and
 * pins three invariants on every run:
 *
 *   (a) **Bounded** — the number of cold-eligible Queued_Items is `<= N`; the
 *       loop never drafts past the target count.
 *   (b) **Terminates** — the run always reaches `status = "completed"` (it does
 *       not hang or fail under any pool / N shape).
 *   (c) **Exact stop condition** — the cold-eligible count equals
 *       `min(N, pool size)`: the loop produces N when the pool is large enough
 *       and otherwise drains the whole (exhausted) pool.
 *
 * The two external seams are mocked so every discovered candidate is
 * deterministically cold-eligible and the dispatcher boundary is observable:
 *   - `../../ai/tools/dispatch` — `prospect_search` returns the generated pool;
 *     `record_target` inserts a `targets` row and returns its id; `draft_outreach`
 *     inserts an `outreach_drafts` row and returns its id.
 *   - `../crm-check` — reports `configured: true, found: false` so every
 *     candidate is genuinely cold (the check RAN and did not find them).
 * Every OTHER gate (opt-out, lawful-basis, cross-rep claim, send-cap) runs for
 * real against the migrated schema (no cap is configured → unlimited budget, so
 * N is the only bound on cold drafting).
 */

const NUM_RUNS = Number(process.env.PBT_RUNS ?? 25);
const MIGRATION_FILE = "0040_agentic_prospecting_batch.sql";
const ASOF = "2026-01-15T00:00:00.000Z";

// `claimTarget` / `isOptedOut` salt-hash phones via `computePhoneHash`, which
// requires PHONE_HASH_SALT. A deterministic test salt keeps hashing stable.
process.env.PHONE_HASH_SALT =
  process.env.PHONE_HASH_SALT ?? "run-size-property-test-salt";

// Minimal stubs for the PRE-existing tables 0040 references (FKs) + the
// `prospect_optouts` table (0038) the eligibility gate reads + the `events`
// table the SSE mirror writes to. 0040 is purely additive over these.
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
  CREATE UNIQUE INDEX "prospect_optouts_match_ux"
    ON "prospect_optouts" ("match_kind", "match_value");
  CREATE TABLE "events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "type" text NOT NULL,
    "payload" jsonb,
    "at" timestamp DEFAULT now() NOT NULL
  );
`;

/** Stand up a fresh pg-mem with the prerequisites + 0040 applied + Drizzle. */
function buildDb(): {
  mem: IMemoryDb;
  db: Database;
  pool: { end: () => Promise<void> };
} {
  const mem = newDb();

  // pg-mem ships neither `gen_random_uuid()` nor `pg_notify()`; register both
  // (the latter as a no-op) so the real SQL + the event mirror resolve.
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

  const sql = readFileSync(
    join(process.cwd(), "drizzle", MIGRATION_FILE),
    "utf-8"
  );
  for (const statement of sql.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) {
      mem.public.none(trimmed);
    }
  }

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem's node-postgres adapter rejects `types.getTypeParser` and
  // `rowMode: "array"`; strip both, honouring drizzle's positional row mapping
  // by converting rows to arrays when `rowMode: "array"` was requested.
  //
  // It ALSO deviates from real Postgres on `INSERT … ON CONFLICT DO NOTHING …
  // RETURNING`: on a conflicting (no-op) insert, real Postgres returns ZERO
  // rows, but pg-mem returns the EXISTING row. `claimTarget` keys "fresh claim"
  // off a non-empty RETURNING, so faithful semantics are restored here.
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

// ── Shared pg-mem harness ────────────────────────────────────────────────────
// Build the in-memory Postgres + Drizzle handle ONCE for the whole file, then
// revert to the empty-schema restore point before each fast-check iteration.
// pg-mem's O(1) backup/restore gives every iteration the same isolation a fresh
// DB would, without paying to re-instantiate pg-mem (and leak an adapter pool)
// ~100 times — the instantiation volume that made the aggregate suite flaky.
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

/**
 * Seed a `prospecting_batch_runs` row (and its owner) with an ICP subject that
 * already carries an `icpFilter`, so `resolveSubjectToFilter` returns a filter
 * without any cluster resolution. `targetCount` is the generated N. Returns the
 * run id.
 */
function seedRun(mem: IMemoryDb, targetCount: number): string {
  const ownerRep = randomUUID();
  const id = randomUUID();
  mem.public.none(`INSERT INTO "users" ("id") VALUES ('${ownerRep}')`);
  const subject = JSON.stringify({
    kind: "icp",
    icpFilter: { targetType: "person" },
  });
  mem.public.none(
    `INSERT INTO "prospecting_batch_runs" ` +
      `("id", "owner_rep", "subject", "target_count", "rerun_key") ` +
      `VALUES ('${id}', '${ownerRep}', '${subject}'::jsonb, ${targetCount}, '${id}')`
  );
  return id;
}

// ── crm-check builder ─────────────────────────────────────────────────────────

/** SF configured + the check ran + found nobody → present candidate is cold. */
function notFoundCrm(email: string | null): CrmCheckResult {
  return { configured: true, found: false, matches: [], checkedEmail: email };
}

// ── Candidate builder ──────────────────────────────────────────────────────────

/** A cold-eligible candidate with a UNIQUE identity (`sourceRef`) per index. */
function makeCandidate(idx: number): ProviderResult {
  const u = randomUUID();
  const email = `${u}@example.com`;
  return {
    targetType: "person",
    displayName: `Candidate ${u.slice(0, 8)}`,
    companyName: `Acme ${u.slice(0, 4)}`,
    title: "Managing Partner",
    email,
    country: "AE",
    attributes: {
      email: {
        value: email,
        source: PROVIDER_IDS[idx % PROVIDER_IDS.length],
        asOf: ASOF,
        lawfulBasis: "legitimate_interest",
      },
    },
    sourceProvider: PROVIDER_IDS[idx % PROVIDER_IDS.length],
    // A unique sourceRef per candidate so the handler's stable identity key
    // never collapses two candidates — each yields its own cold-eligible item.
    sourceRef: `ref-${idx}-${u}`,
    lawfulBasis: "legitimate_interest",
  };
}

// ── Generators ───────────────────────────────────────────────────────────────

// A random cold-eligible candidate pool (0..20) — each candidate given a unique
// identity so the pool size equals the count of distinct cold candidates.
const poolArb: fc.Arbitrary<ProviderResult[]> = fc
  .integer({ min: 0, max: 20 })
  .map((size) => Array.from({ length: size }, (_, i) => makeCandidate(i)));

// A random target count N (1..15).
const targetCountArb = fc.integer({ min: 1, max: 15 });

describe("Feature: agentic-prospecting-batch, Property 1: Batch size is bounded by N and terminates", () => {
  beforeEach(() => {
    mockedDispatch.mockReset();
    mockedCrm.mockReset();
  });

  it("produces at most N cold-eligible queue items, always completes, and stops at exactly min(N, pool size) (Req 2.1, 2.7)", async () => {
    await fc.assert(
      fc.asyncProperty(
        poolArb,
        targetCountArb,
        async (pool, targetCount) => {
          backup.restore();
          const runId = seedRun(mem, targetCount);

          // The mocked CRM check always ran + found nobody, so every discovered
          // candidate is cold-eligible.
          mockedCrm.mockImplementation(
            async (input: { email?: string | null }) =>
              notFoundCrm(input.email ?? null)
          );

          // The mocked dispatcher feeds the generated pool and fulfils the
          // Target / draft writes the loop performs per cold-eligible candidate.
          mockedDispatch.mockImplementation(
            async (
              _db: Database,
              toolName: string,
              input: unknown
            ): Promise<DispatchResult> => {
              if (toolName === "prospect_search") {
                return {
                  ok: true,
                  result: {
                    candidates: pool,
                    unconfiguredProviders: [],
                    failedProviders: [],
                  },
                };
              }
              if (toolName === "record_target") {
                const rec = input as Record<string, unknown>;
                const [row] = await db
                  .insert(schema.targets)
                  .values({
                    targetType: rec.targetType as "person",
                    displayName: (rec.displayName as string) ?? null,
                    companyName: (rec.companyName as string) ?? null,
                    email: (rec.email as string) ?? null,
                    country: (rec.country as string) ?? null,
                    attributes: (rec.attributes as object) ?? {},
                    sourceProvider: rec.sourceProvider as string,
                    sourceRef: (rec.sourceRef as string) ?? null,
                    lawfulBasis: rec.lawfulBasis as string,
                  })
                  .returning({ id: schema.targets.id });
                return {
                  ok: true,
                  result: { targetId: row.id, phoneHash: null },
                };
              }
              if (toolName === "draft_outreach") {
                const d = input as Record<string, unknown>;
                const [row] = await db
                  .insert(schema.outreachDrafts)
                  .values({
                    targetId: d.targetId as string,
                    channel: d.channel as "email",
                    language: d.language as "en",
                    subject: (d.subject as string) ?? null,
                    body: d.body as string,
                    grounding: (d.grounding as unknown) ?? [],
                  })
                  .returning({ id: schema.outreachDrafts.id });
                return {
                  ok: true,
                  result: { draftId: row.id, status: "draft" },
                };
              }
              throw new Error(`unexpected tool dispatched: ${toolName}`);
            }
          );

          // The run must terminate without throwing for any pool / N shape.
          await expect(
            runProspectingBatch(db, { batchRunId: runId }, {} as never)
          ).resolves.toBeUndefined();

          const [run] = await db
            .select()
            .from(schema.prospectingBatchRuns)
            .where(eq(schema.prospectingBatchRuns.id, runId))
            .limit(1);

          const queueItems = await db
            .select()
            .from(schema.prospectingQueueItems)
            .where(eq(schema.prospectingQueueItems.batchRunId, runId));
          const coldCount = queueItems.filter(
            (q) => q.eligibility === "cold_eligible"
          ).length;

          // (b) Terminates: the run always reaches `completed`.
          expect(run.status).toBe("completed");

          // (a) Bounded: never more than N cold-eligible Queued_Items.
          expect(coldCount).toBeLessThanOrEqual(targetCount);

          // (c) Exact stop condition: N produced when the pool is large enough,
          // otherwise the whole (exhausted) pool drained.
          expect(coldCount).toBe(Math.min(targetCount, pool.length));
        }
      ),
      { numRuns: NUM_RUNS }
    );
  }, 60000);
});
