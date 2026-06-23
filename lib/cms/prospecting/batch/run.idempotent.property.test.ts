import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  beforeAll,
  afterAll,
} from "vitest";
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

// ── The dispatcher is mocked so the search result (and the Target / draft
//    writes) are driven by the generator, not by real providers (CC-Audit:
//    every prospecting effect in run.ts goes through `dispatchTool`). The
//    handler imports it from "../../ai/tools/dispatch"; this hoisted mock
//    replaces that module before run.ts loads it.
vi.mock("../../ai/tools/dispatch", () => ({
  dispatchTool: vi.fn(),
}));
import { dispatchTool } from "../../ai/tools/dispatch";
const mockedDispatch = vi.mocked(dispatchTool);

// ── CRM_Check is mocked CONFIGURED + NOT-FOUND (the check actually ran), so a
//    present candidate that clears the other compliance gates is cold-eligible.
vi.mock("../crm-check", () => ({
  checkCrmForContact: vi.fn(),
}));
import { checkCrmForContact, type CrmCheckResult } from "../crm-check";
const mockedCrm = vi.mocked(checkCrmForContact);

import { runProspectingBatch } from "./run";

/**
 * Property 15 — Idempotent re-run (Requirements 9.2, 9.3, 9.4).
 *
 *   **Feature: agentic-prospecting-batch, Property 15: Idempotent re-run.**
 *
 * **Validates: Requirements 9.2, 9.3, 9.4**
 *
 * *For any* Batch_Run, re-running it with the same deterministic `rerun_key`
 * (here: the SAME `batchRunId` row, against the SAME `pg-mem` DB) produces **no
 * duplicate** targets, Queued_Items, or Outreach_Drafts: an already-evaluated
 * candidate reuses its prior result rather than recording a fresh Target /
 * draft / queue item, and any side effect or external send keyed by the same
 * idempotency key resolves to at most one record / at most one send (Req 9.2,
 * 9.3, 9.4).
 *
 * The decisive seam is `runProspectingBatch` (`lib/cms/prospecting/batch/run.ts`):
 *   - `loadExistingQueue` joins each prior `prospecting_queue_items` row to its
 *     `targets` row, reconstructing the candidate provider-identity key, so the
 *     per-candidate loop SKIPS any candidate already worked in a prior run
 *     (`seenKeys.has(candidateKey(candidate))`), resuming the cold-eligible
 *     count so N is never exceeded across re-runs;
 *   - queue items are upserted on the unique `(batch_run_id, target_id)`, so a
 *     re-run that did reach a candidate reuses its prior row instead of
 *     duplicating it.
 *
 * The property drives the WHOLE handler end to end TWICE against ONE Drizzle
 * handle over an in-memory Postgres (pg-mem) carrying the real
 * `drizzle/0040_agentic_prospecting_batch.sql` schema, then asserts:
 *   - targets / queue-item / draft row counts after run 2 == after run 1
 *     (row-count stability — no duplicates, Req 9.2);
 *   - exactly one queue item per `(batch_run_id, target_id)` (the unique
 *     idempotency key, Req 9.2);
 *   - `draft_outreach` is dispatched no more times after run 2 than after run 1
 *     — the same candidate identity yields at most one draft (the idempotency
 *     key that a later send / SF side effect carries forward, Req 9.3, 9.4).
 *
 * The two external seams are mocked so the candidates are deterministically
 * cold-eligible and the dispatcher boundary is observable:
 *   - `../../ai/tools/dispatch` — `prospect_search` returns the SAME candidate
 *     pool on BOTH runs; `record_target` returns a STABLE `targetId` for the
 *     same candidate identity (a per-iteration identity → id Map, inserting a
 *     `targets` row only on first sight); `draft_outreach` inserts an
 *     `outreach_drafts` row and returns its id.
 *   - `../crm-check` — reports `configured:true, found:false` so every candidate
 *     is genuinely cold (the check RAN and did not find them).
 * Every OTHER gate (opt-out, lawful-basis, cross-rep claim, send-cap) runs for
 * real against the migrated schema — including the cross-rep claim's
 * `ON CONFLICT DO NOTHING`, whose own-rep re-claim is itself idempotent.
 *
 * Tag: Feature: agentic-prospecting-batch, Property 15: Idempotent re-run
 */

const NUM_RUNS = Number(process.env.PBT_RUNS ?? 25);
const MIGRATION_FILE = "0040_agentic_prospecting_batch.sql";
const ASOF = "2026-01-15T00:00:00.000Z";

// `claimTarget` / `isOptedOut` salt-hash phones via `computePhoneHash`, which
// requires PHONE_HASH_SALT. A deterministic test salt keeps hashing stable.
process.env.PHONE_HASH_SALT =
  process.env.PHONE_HASH_SALT ?? "run-idempotent-property-test-salt";

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

  const migration = readFileSync(
    join(process.cwd(), "drizzle", MIGRATION_FILE),
    "utf-8"
  );
  for (const statement of migration.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) {
      mem.public.none(trimmed);
    }
  }
  // The sequences feature (migration 0041) added `sequence_id` to
  // prospecting_batch_runs; this harness applies only 0040, so add the column
  // so `loadBatchRun`'s SELECT resolves.
  mem.public.none(
    'ALTER TABLE "prospecting_batch_runs" ADD COLUMN "sequence_id" uuid'
  );

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
// DB would, without re-instantiating pg-mem (and leaking an adapter pool) ~100
// times per property — the instantiation volume that made the suite flaky.
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
 * without any cluster resolution. Returns the run id. The SAME row is driven
 * twice — the re-run keys off this single persisted run (its stable `rerun_key`
 * + its `(batch_run_id, target_id)` queue uniqueness).
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

/** SF configured + the check ran + found nobody → present candidate is cold. */
function notFoundCrm(email: string | null): CrmCheckResult {
  return { configured: true, found: false, matches: [], checkedEmail: email };
}

/**
 * A stable identity key for a candidate, mirroring `run.ts`'s `candidateKey`:
 * prefer the provider `sourceRef`, then the normalized email. Used by the
 * `record_target` mock to return a STABLE `targetId` for the same identity.
 */
function identityKey(c: ProviderResult): string {
  if (c.sourceRef) return `ref:${c.sourceProvider}:${c.sourceRef}`;
  if (c.email) return `email:${c.email.trim().toLowerCase()}`;
  return `name:${(c.displayName ?? c.companyName ?? "").trim().toLowerCase()}`;
}

/** A cold-eligible candidate with a unique identity (`sourceRef`). */
function makeCandidate(
  provider: (typeof PROVIDER_IDS)[number],
  idx: number
): ProviderResult {
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
        source: provider,
        asOf: ASOF,
        lawfulBasis: "legitimate_interest",
      },
    },
    sourceProvider: provider,
    sourceRef: `${provider}-${idx}-${u}`,
    lawfulBasis: "legitimate_interest",
  };
}

// ── Generators ───────────────────────────────────────────────────────────────

/**
 * A pool of cold-eligible candidates, each with a UNIQUE provider identity so
 * the handler's stable identity key never collapses two of them. The SAME pool
 * is returned by `prospect_search` on both runs.
 */
const poolArb: fc.Arbitrary<ProviderResult[]> = fc
  .array(
    fc.record({
      provider: fc.constantFrom(...PROVIDER_IDS),
      count: fc.integer({ min: 1, max: 3 }),
    }),
    { minLength: 1, maxLength: 4 }
  )
  .map((specs) => {
    const out: ProviderResult[] = [];
    let i = 0;
    for (const { provider, count } of specs) {
      for (let k = 0; k < count; k++) out.push(makeCandidate(provider, i++));
    }
    return out;
  });

// Target count N: spans below, at, and above the pool size so idempotency is
// asserted whether the run is N-bounded or pool-exhausted.
const nArb = fc.integer({ min: 1, max: 10 });

describe("**Feature: agentic-prospecting-batch, Property 15: Idempotent re-run.**", () => {
  beforeEach(() => {
    mockedDispatch.mockReset();
    mockedCrm.mockReset();
  });

  it("Validates: Requirements 9.2, 9.3, 9.4 — re-running the same batch creates no duplicate targets / queue items / drafts and yields at most one draft (send key) per candidate identity", async () => {
    await fc.assert(
      fc.asyncProperty(poolArb, nArb, async (pool, n) => {
        backup.restore();
        const runId = seedRun(mem, n);

        // The mocked CRM check always ran + found nobody → present candidate is
        // cold-eligible.
        mockedCrm.mockImplementation(async (input: { email?: string | null }) =>
          notFoundCrm(input.email ?? null)
        );

        // STABLE record_target: a per-iteration identity → targetId Map. On
        // first sight of an identity it inserts a `targets` row and caches the
        // id; on every subsequent call for the SAME identity it returns the
        // cached id WITHOUT inserting — so the `targets` row count is driven by
        // distinct identities, never by how many times the batch is run. This
        // lets `loadExistingQueue`'s join reconstruct the same candidate key on
        // the 2nd run and dedupe.
        const targetIdByIdentity = new Map<string, string>();
        let draftDispatchCount = 0;

        mockedDispatch.mockImplementation(
          async (
            _db: Database,
            toolName: string,
            input: unknown
          ): Promise<DispatchResult> => {
            if (toolName === "prospect_search") {
              // SAME candidate pool on both runs.
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
              const key = identityKey({
                sourceProvider: rec.sourceProvider as ProviderResult["sourceProvider"],
                sourceRef: (rec.sourceRef as string) ?? undefined,
                email: (rec.email as string) ?? undefined,
                displayName: (rec.displayName as string) ?? undefined,
                companyName: (rec.companyName as string) ?? undefined,
              } as ProviderResult);

              const cached = targetIdByIdentity.get(key);
              if (cached) {
                return { ok: true, result: { targetId: cached, phoneHash: null } };
              }

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
              targetIdByIdentity.set(key, row.id);
              return { ok: true, result: { targetId: row.id, phoneHash: null } };
            }
            if (toolName === "draft_outreach") {
              draftDispatchCount += 1;
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
              return { ok: true, result: { draftId: row.id, status: "draft" } };
            }
            throw new Error(`unexpected tool dispatched: ${toolName}`);
          }
        );

        // ── Run 1 ──────────────────────────────────────────────────────────
        await runProspectingBatch(db, { batchRunId: runId }, {} as never);

        const after1 = await snapshot(db, runId);
        const draftsDispatchedAfter1 = draftDispatchCount;

        // ── Run 2 (same row, same DB, same candidate pool) ─────────────────
        await runProspectingBatch(db, { batchRunId: runId }, {} as never);

        const after2 = await snapshot(db, runId);

        // (Req 9.2) Row-count stability — re-running creates no duplicate
        // targets, queue items, or outreach drafts.
        expect(after2.targetCount).toBe(after1.targetCount);
        expect(after2.queueItemCount).toBe(after1.queueItemCount);
        expect(after2.draftCount).toBe(after1.draftCount);

        // (Req 9.2) Exactly one queue item per (batch_run_id, target_id): the
        // unique idempotency key reused, never duplicated, on re-run.
        expect(after2.distinctTargetIds).toBe(after2.queueItemCount);

        // (Req 9.3, 9.4) The same candidate identity yields at most one draft —
        // the idempotency key a later SF side effect / external send carries
        // forward. Run 2 dispatches no further drafts (the candidates are reused
        // before any draft is produced).
        expect(draftDispatchCount).toBe(draftsDispatchedAfter1);

        // Sanity: a cold-eligible item was produced for at least one candidate
        // (the run did real work, not a vacuous no-op).
        expect(after1.queueItemCount).toBeGreaterThan(0);
        expect(after1.queueItemCount).toBeLessThanOrEqual(
          Math.min(pool.length, n)
        );
      }),
      { numRuns: NUM_RUNS }
    );
  }, 60000);
});

interface RunSnapshot {
  targetCount: number;
  queueItemCount: number;
  draftCount: number;
  distinctTargetIds: number;
}

/** Read back the persisted row counts after a run for stability comparison. */
async function snapshot(db: Database, runId: string): Promise<RunSnapshot> {
  const allTargets = await db.select({ id: schema.targets.id }).from(schema.targets);
  const allDrafts = await db
    .select({ id: schema.outreachDrafts.id })
    .from(schema.outreachDrafts);
  const items = await db
    .select({ targetId: schema.prospectingQueueItems.targetId })
    .from(schema.prospectingQueueItems)
    .where(eq(schema.prospectingQueueItems.batchRunId, runId));

  const distinct = new Set(items.map((i) => i.targetId));

  return {
    targetCount: allTargets.length,
    queueItemCount: items.length,
    draftCount: allDrafts.length,
    distinctTargetIds: distinct.size,
  };
}
