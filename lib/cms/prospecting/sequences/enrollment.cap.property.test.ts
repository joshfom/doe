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
import { and, eq } from "drizzle-orm";
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
//    cold-eligible — exactly the candidates that consume the enrollment cap.
vi.mock("../crm-check", () => ({
  checkCrmForContact: vi.fn(),
}));
import { checkCrmForContact, type CrmCheckResult } from "../crm-check";
const mockedCrm = vi.mocked(checkCrmForContact);

import { runProspectingBatch } from "../batch/run";

/**
 * Property 7 — Enrollment cap bounds enrollment per period
 * (Requirements 3.5, 11.1, 11.2).
 *
 *   **Feature: prospecting-sequences, Property 7: Enrollment cap bounds
 *   enrollment per period.**
 *
 * **Validates: Requirements 3.5, 11.1, 11.2**
 *
 * A Sequence Refresh_Run is the existing `runProspectingBatch` loop with one
 * gated addition when `run.sequenceId` is set: before drafting a cold-eligible
 * candidate it reads the Sequence's remaining enrollment budget for the current
 * period (`enrollmentRemaining`) and, when exhausted, records a `cap_reached`
 * Activity_Log entry and STOPS enrolling for this run — mirroring the existing
 * send-cap stop (design §Components #3 "Refresh_Run extension — enrollment cap").
 * The per-Sequence enrollment ledger (`prospecting_sequence_enrollments`) is both
 * the enrollment-at-most-once guard AND the cap counter: the count of rows for
 * `(sequence_id, period_bucket)` is the consumed enrollment count, so the cap
 * "resets" simply by a new period being a new bucket.
 *
 * The contract under test, for a `live` Sequence carrying a random
 * `enrollment_cap = C` whose single Refresh_Run sweeps a random candidate pool:
 *
 *   (a) **Bounded** — the count of enrollment-ledger rows recorded into the
 *       run's period bucket is ALWAYS `<= C`; a new enrollment never pushes the
 *       period count above the cap (Req 11.1, 11.2).
 *
 *   (b) **Exact stop** — the period count equals `min(C, cold-eligible pool
 *       size)`: the run enrolls the whole pool when it fits under the cap and
 *       otherwise stops at exactly C (Req 3.5).
 *
 *   (c) **Cap-reached recorded** — when (and only when) the pool would exceed the
 *       cap, the run records a `skipped` / `cap_reached` Activity_Log entry once
 *       the cap is reached and stops enrolling (Req 11.2).
 *
 * The run is driven end to end against a REAL Drizzle handle over an in-memory
 * Postgres (pg-mem) carrying the real `drizzle/0040_agentic_prospecting_batch.sql`
 * (batch tables) + the one-shot `prospecting_sequences` table + the real
 * `drizzle/0043_prospecting_sequences.sql` (the lifecycle columns + the
 * enrollment ledger), so `enrollmentRemaining`'s genuine `COUNT(*)` and
 * `insertEnrollment`'s `INSERT … ON CONFLICT DO NOTHING … RETURNING` execute.
 *
 * The two external seams are mocked so every discovered candidate is
 * deterministically cold-eligible and the dispatcher boundary is observable:
 *   - `../../ai/tools/dispatch` — `prospect_search` returns the generated pool;
 *     `record_target` inserts a `targets` row and returns its id; `draft_outreach`
 *     inserts an `outreach_drafts` row and returns its id.
 *   - `../crm-check` — reports `configured: true, found: false` so every
 *     candidate is genuinely cold (the check RAN and did not find them).
 * Every OTHER gate (opt-out, lawful-basis, cross-rep claim, send-cap) runs for
 * real against the migrated schema; NO send cap is configured (unlimited budget)
 * so the enrollment cap is the only bound on cold enrollment.
 *
 * Tag: Feature: prospecting-sequences, Property 7: Enrollment cap bounds
 * enrollment per period
 */

// The design mandates a minimum of 100 iterations for every property test; clamp
// the configurable run count so it can be raised but never fall below the floor.
const NUM_RUNS = Math.max(100, Number(process.env.PBT_RUNS ?? 100));
const MIGRATION_0040 = "0040_agentic_prospecting_batch.sql";
const MIGRATION_0043 = "0043_prospecting_sequences.sql";
const ASOF = "2026-01-15T00:00:00.000Z";

// `claimTarget` / `isOptedOut` salt-hash phones via `computePhoneHash`, which
// requires PHONE_HASH_SALT. A deterministic test salt keeps hashing stable.
process.env.PHONE_HASH_SALT =
  process.env.PHONE_HASH_SALT ?? "enrollment-cap-property-test-salt";

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

// The one-shot `prospecting_sequences` table (drizzle/0041) the Refresh_Run's
// `loadSequence` reads and the enrollment ledger FKs to. 0043 ALTERs it to add
// the lifecycle / cadence / enrollment-cap columns, so only the 0041 base shape
// is stood up here (owner_rep FK omitted — irrelevant to this property).
const SEQUENCES_BASE_SQL = `
  CREATE TABLE "prospecting_sequences" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "owner_rep" uuid NOT NULL,
    "name" text NOT NULL,
    "description" text,
    "subject" jsonb NOT NULL,
    "target_count" integer DEFAULT 10 NOT NULL,
    "mode" text DEFAULT 'draft' NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
`;

/** Apply a migration file's statements (split on the breakpoint marker). */
function applyMigration(mem: IMemoryDb, file: string): void {
  const sql = readFileSync(join(process.cwd(), "drizzle", file), "utf-8");
  for (const statement of sql.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) {
      mem.public.none(trimmed);
    }
  }
}

/** Stand up a fresh pg-mem with 0040 + sequences + 0043 applied + Drizzle. */
function buildDb(): {
  mem: IMemoryDb;
  db: Database;
  pool: { end: () => Promise<void> };
} {
  const mem = newDb();

  // pg-mem ships neither `gen_random_uuid()` nor `pg_notify()` nor a timestamptz
  // `now()`; register all three (pg_notify as a no-op) so the real SQL, the event
  // mirror, and the enrollment ledger's timestamptz DEFAULT all resolve. Impure
  // so each row gets a fresh value rather than one cached value.
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
  applyMigration(mem, MIGRATION_0040);

  // The sequences feature (migration 0041) added `sequence_id` to
  // prospecting_batch_runs and created `prospecting_sequences`; stand both up so
  // `loadBatchRun`'s SELECT resolves and 0043 can ALTER the sequences table.
  mem.public.none(
    'ALTER TABLE "prospecting_batch_runs" ADD COLUMN "sequence_id" uuid'
  );
  mem.public.none(SEQUENCES_BASE_SQL);
  applyMigration(mem, MIGRATION_0043);

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem's node-postgres adapter rejects `types.getTypeParser` and
  // `rowMode: "array"`; strip both, honouring drizzle's positional row mapping
  // by converting rows to arrays when `rowMode: "array"` was requested.
  //
  // It ALSO deviates from real Postgres on `INSERT … ON CONFLICT DO NOTHING …
  // RETURNING`: on a conflicting (no-op) insert, real Postgres returns ZERO
  // rows, but pg-mem returns the EXISTING row. That deviation would defeat the
  // ledger's idempotency guard (`insertEnrollment` keys "already enrolled" off
  // an empty RETURNING) and the cross-rep claim, so faithful semantics are
  // restored here: compare the target table's row count before/after and strip
  // the erroneously-returned row when nothing was actually inserted.
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
// times per property.
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
 * Seed a `live` Sequence with a given `enrollment_cap` and a linked Refresh_Run
 * (`prospecting_batch_runs.sequence_id`). The run's `subject` carries an
 * `icpFilter` so `resolveSubjectToFilter` returns a filter without any cluster
 * resolution. `targetCount` is the per-refresh batch size — set large by the
 * caller so the enrollment cap (not N) is the binding constraint. Returns the
 * ids + period bucket the run will count under.
 */
function seedSequenceRun(
  mem: IMemoryDb,
  cap: number,
  targetCount: number
): { runId: string; sequenceId: string; periodBucket: string } {
  const ownerRep = randomUUID();
  const sequenceId = randomUUID();
  const runId = randomUUID();
  mem.public.none(`INSERT INTO "users" ("id") VALUES ('${ownerRep}')`);

  const subject = JSON.stringify({
    kind: "icp",
    icpFilter: { targetType: "person" },
  });

  // A `live`, monthly-period Sequence carrying the generated enrollment cap.
  mem.public.none(
    `INSERT INTO "prospecting_sequences" ` +
      `("id", "owner_rep", "name", "subject", "mode", "status", "enrollment_cap", "enrollment_period") ` +
      `VALUES ('${sequenceId}', '${ownerRep}', 'Cap Property Seq', '${subject}'::jsonb, 'live', 'live', ${cap}, 'month')`
  );

  // The linked Refresh_Run. `created_at` is left to default (now()), which is the
  // instant the run's monthly period bucket is derived from.
  mem.public.none(
    `INSERT INTO "prospecting_batch_runs" ` +
      `("id", "owner_rep", "sequence_id", "subject", "target_count", "rerun_key") ` +
      `VALUES ('${runId}', '${ownerRep}', '${sequenceId}', '${subject}'::jsonb, ${targetCount}, '${runId}')`
  );

  // The run derives its monthly bucket from `now()` (its created_at) — `YYYY-MM`.
  const now = new Date();
  const periodBucket = `${now.getUTCFullYear()}-${`${now.getUTCMonth() + 1}`.padStart(2, "0")}`;

  return { runId, sequenceId, periodBucket };
}

/** SF configured + the check ran + found nobody → present candidate is cold. */
function notFoundCrm(email: string | null): CrmCheckResult {
  return { configured: true, found: false, matches: [], checkedEmail: email };
}

/** A cold-eligible candidate with a UNIQUE provider identity (`sourceRef`). */
function makeCandidate(idx: number): ProviderResult {
  const u = randomUUID();
  const email = `${u}@example.com`;
  const provider = PROVIDER_IDS[idx % PROVIDER_IDS.length];
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
    // A unique sourceRef per candidate so the ledger identity never collapses
    // two candidates — each cold candidate is its own distinct enrollment.
    sourceRef: `ref-${idx}-${u}`,
    lawfulBasis: "legitimate_interest",
  };
}

/** Wire the mocked dispatcher to feed `pool` and fulfil the Target / draft writes. */
function wireDispatch(pool: ProviderResult[]): void {
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
        return { ok: true, result: { targetId: row.id, phoneHash: null } };
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
        return { ok: true, result: { draftId: row.id, status: "draft" } };
      }
      throw new Error(`unexpected tool dispatched: ${toolName}`);
    }
  );
}

/** Count the enrollment-ledger rows recorded into a Sequence's period bucket. */
async function enrolledInPeriod(
  sequenceId: string,
  periodBucket: string
): Promise<number> {
  const rows = await db
    .select({ id: schema.prospectingSequenceEnrollments.id })
    .from(schema.prospectingSequenceEnrollments)
    .where(
      and(
        eq(schema.prospectingSequenceEnrollments.sequenceId, sequenceId),
        eq(schema.prospectingSequenceEnrollments.periodBucket, periodBucket)
      )
    );
  return rows.length;
}

// ── Generators ───────────────────────────────────────────────────────────────

// A random enrollment cap C (1..10). 1 keeps the cap a tight constraint.
const capArb = fc.integer({ min: 1, max: 10 });

// A random cold-eligible candidate pool size (0..16) — each candidate given a
// unique identity so the pool size equals the count of distinct cold candidates.
// The range spans below, at, and above any generated cap so the bound is asserted
// whether the run is pool-exhausted or cap-stopped.
const poolSizeArb = fc.integer({ min: 0, max: 16 });

describe("Feature: prospecting-sequences, Property 7: Enrollment cap bounds enrollment per period", () => {
  beforeEach(() => {
    mockedDispatch.mockReset();
    mockedCrm.mockReset();
  });

  it("never enrolls more than C per period, stops at exactly min(C, pool), and records cap_reached once the cap is hit (Req 3.5, 11.1, 11.2)", async () => {
    await fc.assert(
      fc.asyncProperty(capArb, poolSizeArb, async (cap, poolSize) => {
        backup.restore();

        // Per-refresh batch size N kept large so the ENROLLMENT CAP — not N — is
        // the binding constraint under test.
        const targetCount = poolSize + cap + 50;
        const { runId, sequenceId, periodBucket } = seedSequenceRun(
          mem,
          cap,
          targetCount
        );

        const pool = Array.from({ length: poolSize }, (_, i) =>
          makeCandidate(i)
        );

        // Every discovered candidate is cold-eligible (the check ran + found none).
        mockedCrm.mockImplementation(async (input: { email?: string | null }) =>
          notFoundCrm(input.email ?? null)
        );
        wireDispatch(pool);

        // The Refresh_Run must terminate without throwing for any cap / pool shape.
        await expect(
          runProspectingBatch(db, { batchRunId: runId }, {} as never)
        ).resolves.toBeUndefined();

        const enrolled = await enrolledInPeriod(sequenceId, periodBucket);

        // (a) Bounded: a new enrollment never pushes the period count above the
        // cap (Req 11.1, 11.2).
        expect(enrolled).toBeLessThanOrEqual(cap);

        // (b) Exact stop: enroll the whole pool when it fits, otherwise stop at C
        // (Req 3.5).
        expect(enrolled).toBe(Math.min(cap, poolSize));

        // (c) Cap-reached Activity_Log entry recorded iff the cap was the binding
        // constraint (the pool would have exceeded it) (Req 11.2). When the pool
        // fits under the cap, no cap_reached entry is recorded.
        const activity = await db
          .select({
            action: schema.prospectingBatchActivity.action,
            reason: schema.prospectingBatchActivity.reason,
          })
          .from(schema.prospectingBatchActivity)
          .where(eq(schema.prospectingBatchActivity.batchRunId, runId));
        const capReachedEntries = activity.filter(
          (a) => a.action === "skipped" && a.reason === "cap_reached"
        );

        if (poolSize > cap) {
          // The cap was reached: the run stopped at C and logged cap_reached.
          expect(enrolled).toBe(cap);
          expect(capReachedEntries.length).toBeGreaterThanOrEqual(1);
        } else {
          // The whole pool fit under the cap → no cap_reached stop was needed.
          expect(capReachedEntries.length).toBe(0);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  }, 120000);
});
