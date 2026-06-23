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
import { enrollmentConsumed, periodBucket } from "./enrollment";

// ── The dispatcher is mocked so the candidate pool (and the Target / draft
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

import { runProspectingBatch } from "../batch/run";

/**
 * Property 4 — Enrollment is at most once per Sequence per prospect
 * (Requirements 3.4, 5.1, 5.2, 5.3, 11.4).
 *
 *   **Feature: prospecting-sequences, Property 4: Enrollment is at most once
 *   per Sequence per prospect.**
 *
 * **Validates: Requirements 3.4, 5.1, 5.2, 5.3, 11.4**
 *
 * *For any* Sequence and *any* series of Refresh_Runs over OVERLAPPING candidate
 * pools — including a refresh retried after a terminal failure — each distinct
 * prospect identity is enrolled AT MOST ONCE: the
 * `prospecting_sequence_enrollments` ledger holds at most one row per
 * `(sequence_id, identity)` (Req 5.1, 5.2), no duplicate Queued_Item is created
 * for an already-enrolled prospect (Req 3.4, 5.2), a refresh retried after a
 * failure produces the same enrollment outcome as a single successful run
 * (Req 5.3), and the period enrollment count increments exactly once per
 * Enrollment (Req 11.4).
 *
 * The decisive seam is the sequence-scoped branch of `runProspectingBatch`
 * (`lib/cms/prospecting/batch/run.ts`) plus the enrollment ledger
 * (`lib/cms/prospecting/sequences/enrollment.ts`):
 *   - `loadSequenceEnrollments(db, sequenceId)` rebuilds the dedupe `seenKeys`
 *     set from the WHOLE Sequence's ledger (not one run's queue), so a prospect
 *     enrolled by ANY prior refresh is skipped before any Target / draft / queue
 *     work is done (Req 5.1, 5.2);
 *   - `insertEnrollment` writes one ledger row with `ON CONFLICT (sequence_id,
 *     match_kind, match_value) DO NOTHING`, so a retried refresh is idempotent
 *     and the period count (a `COUNT(*)` over `(sequence_id, period_bucket)`)
 *     increments exactly once per enrollment (Req 5.3, 11.4);
 *   - the queue-item upsert is keyed `(batch_run_id, target_id)`, so even a
 *     re-run that reaches a candidate reuses its prior row rather than
 *     duplicating it (Req 3.4).
 *
 * Harness (the `run.idempotent.property.test.ts` pattern): the WHOLE handler is
 * driven end to end against ONE Drizzle handle over an in-memory Postgres
 * (pg-mem) carrying the real `drizzle/0040_agentic_prospecting_batch.sql`
 * (batch / queue / claim / send-cap / activity tables) AND the real
 * `drizzle/0043_prospecting_sequences.sql` (the Sequence lifecycle columns and
 * the `prospecting_sequence_enrollments` ledger). A seeded `prospecting_batch_runs`
 * row carries `sequence_id` so the sequence-scoped branch runs.
 *
 * The two external seams are mocked so the candidates are deterministically
 * cold-eligible and the dispatcher boundary is observable:
 *   - `../../ai/tools/dispatch` — `prospect_search` returns the refresh's pool;
 *     `record_target` returns a STABLE `targetId` for the same candidate identity
 *     (a per-iteration identity → id Map, inserting a `targets` row only on first
 *     sight) so the same prospect maps to one Target across refreshes;
 *     `draft_outreach` inserts an `outreach_drafts` row — and, when armed, THROWS
 *     to simulate a terminal refresh failure (the retried-after-failure pass).
 *   - `../crm-check` — reports `configured:true, found:false` so every candidate
 *     is genuinely cold (the check RAN and did not find them).
 * Every OTHER gate (opt-out, lawful-basis, cross-rep claim, send-cap) runs for
 * real against the migrated schema.
 *
 * Tag: Feature: prospecting-sequences, Property 4: Enrollment is at most once
 * per Sequence per prospect
 */

// The design mandates a minimum of 100 iterations for every property test; clamp
// the configurable run count so it can be raised but never fall below the floor.
const NUM_RUNS = Math.max(100, Number(process.env.PBT_RUNS ?? 100));
const BATCH_MIGRATION_FILE = "0040_agentic_prospecting_batch.sql";
const SEQUENCE_MIGRATION_FILE = "0043_prospecting_sequences.sql";
// A fixed, mid-month creation instant so every Refresh_Run derives the SAME
// monthly enrollment period bucket (stable regardless of server timezone).
const ASOF_TS = "2026-01-15 00:00:00";
const ASOF_DATE = new Date("2026-01-15T00:00:00.000Z");

// `claimTarget` / `isOptedOut` salt-hash phones via `computePhoneHash`, which
// requires PHONE_HASH_SALT. A deterministic test salt keeps hashing stable.
process.env.PHONE_HASH_SALT =
  process.env.PHONE_HASH_SALT ?? "enrollment-atmostonce-property-test-salt";

// Minimal stubs for the PRE-existing tables the migrations reference (FKs) plus
// the `prospect_optouts` table (0038) the eligibility gate reads and the
// `events` table the SSE mirror writes to. `prospecting_sequences` is the base
// one-shot table (0041) stubbed with its pre-0043 columns; migration 0043 then
// ALTERs in the lifecycle / cadence / enrollment columns verbatim.
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
  CREATE TABLE "prospecting_sequences" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "owner_rep" uuid NOT NULL REFERENCES "users"("id"),
    "name" text NOT NULL,
    "description" text,
    "subject" jsonb NOT NULL,
    "target_count" integer NOT NULL DEFAULT 10,
    "mode" text NOT NULL DEFAULT 'draft',
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
`;

/** Apply a `--> statement-breakpoint`-split migration file to the pg-mem db. */
function applyMigration(mem: IMemoryDb, file: string): void {
  const sql = readFileSync(join(process.cwd(), "drizzle", file), "utf-8");
  for (const statement of sql.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) {
      mem.public.none(trimmed);
    }
  }
}

/** Stand up a fresh pg-mem with 0040 + 0043 applied + a real Drizzle handle. */
function buildDb(): {
  mem: IMemoryDb;
  db: Database;
  pool: { end: () => Promise<void> };
} {
  const mem = newDb();

  // pg-mem ships neither `gen_random_uuid()`, `pg_notify()`, nor a timestamptz
  // `now()`; register all three (the notify as a no-op) so the real SQL, the
  // event mirror, and the ledger's `created_at` DEFAULT resolve. Impure so each
  // row gets a fresh value rather than a single cached one.
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

  // 0040 — the agentic-batch tables (batch runs, queue items, claims, send
  // counters / ledger, activity). It does NOT add `sequence_id` to
  // prospecting_batch_runs (that landed in 0041); add it here so the
  // sequence-scoped branch of `runProspectingBatch` resolves.
  applyMigration(mem, BATCH_MIGRATION_FILE);
  mem.public.none(
    'ALTER TABLE "prospecting_batch_runs" ADD COLUMN "sequence_id" uuid REFERENCES "prospecting_sequences"("id") ON DELETE CASCADE'
  );
  // 0043 — the Sequence lifecycle / cadence columns and the enrollment ledger.
  applyMigration(mem, SEQUENCE_MIGRATION_FILE);

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem's node-postgres adapter rejects `types.getTypeParser` and
  // `rowMode: "array"`; strip both, honouring drizzle's positional row mapping
  // by converting rows to arrays when `rowMode: "array"` was requested.
  //
  // It ALSO deviates from real Postgres on `INSERT … ON CONFLICT DO NOTHING …
  // RETURNING`: on a conflicting (no-op) insert, real Postgres returns ZERO
  // rows, but pg-mem returns the EXISTING row. That deviation would defeat the
  // idempotency guard (`insertEnrollment` / `claimTarget` key "already there"
  // off an empty RETURNING), so faithful semantics are restored: for such a
  // statement compare the target table's row count before/after; if no row was
  // actually inserted (a conflict), strip the erroneously-returned row so
  // RETURNING is empty — exactly as Postgres behaves.
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

/** SF configured + the check ran + found nobody → present candidate is cold. */
function notFoundCrm(email: string | null): CrmCheckResult {
  return { configured: true, found: false, matches: [], checkedEmail: email };
}

/**
 * A stable identity key for a candidate, mirroring `enrollmentIdentity` /
 * `candidateKey` precedence: prefer the provider `sourceRef`, then the
 * normalized email. Used by the `record_target` mock to return a STABLE
 * `targetId` for the same identity across refreshes.
 */
function identityKey(c: Pick<ProviderResult, "sourceProvider" | "sourceRef" | "email">): string {
  if (c.sourceRef) return `ref:${c.sourceProvider}:${c.sourceRef}`;
  if (c.email) return `email:${c.email.trim().toLowerCase()}`;
  return `name:`;
}

/**
 * A cold-eligible candidate with a UNIQUE, STABLE provider identity (`sourceRef`)
 * so the same universe entry collides on the ledger's
 * `(sequence_id, match_kind, match_value)` index whenever it reappears in a
 * later refresh — exercising the cross-refresh dedupe.
 */
function makeCandidate(
  provider: (typeof PROVIDER_IDS)[number],
  idx: number
): ProviderResult {
  const u = randomUUID();
  const email = `${u}@example.com`;
  return {
    targetType: "person",
    displayName: `Candidate ${idx}-${u.slice(0, 8)}`,
    companyName: `Acme ${u.slice(0, 4)}`,
    title: "Managing Partner",
    email,
    country: "AE",
    attributes: {
      email: {
        value: email,
        source: provider,
        asOf: "2026-01-10T00:00:00.000Z",
        lawfulBasis: "legitimate_interest",
      },
    },
    sourceProvider: provider,
    sourceRef: `${provider}-${idx}-${u}`,
    lawfulBasis: "legitimate_interest",
  };
}

/**
 * Seed one `prospecting_sequences` row in `live` status with a resolvable ICP
 * subject, a generous enrollment cap (so the cap never bounds these scenarios),
 * and a monthly period. Returns the sequence id + owner rep.
 */
function seedSequence(
  mem: IMemoryDb,
  targetCount: number
): { sequenceId: string; ownerRep: string } {
  const ownerRep = randomUUID();
  const sequenceId = randomUUID();
  mem.public.none(`INSERT INTO "users" ("id") VALUES ('${ownerRep}')`);
  const subject = JSON.stringify({
    kind: "icp",
    icpFilter: { targetType: "person" },
  });
  mem.public.none(
    `INSERT INTO "prospecting_sequences" ` +
      `("id", "owner_rep", "name", "subject", "target_count", "mode", ` +
      `"status", "refresh_interval_minutes", "enrollment_cap", "enrollment_period") ` +
      `VALUES ('${sequenceId}', '${ownerRep}', 'Continuous campaign', ` +
      `'${subject}'::jsonb, ${targetCount}, 'live', 'live', 1440, 100000, 'month')`
  );
  return { sequenceId, ownerRep };
}

/**
 * Seed one `prospecting_batch_runs` row linked to `sequenceId` (a Refresh_Run).
 * Created at the fixed `ASOF_TS` so every refresh derives the same monthly
 * enrollment bucket. Returns the run id.
 */
function seedRefreshRun(
  mem: IMemoryDb,
  args: { sequenceId: string; ownerRep: string; targetCount: number }
): string {
  const id = randomUUID();
  const subject = JSON.stringify({
    kind: "icp",
    icpFilter: { targetType: "person" },
  });
  mem.public.none(
    `INSERT INTO "prospecting_batch_runs" ` +
      `("id", "owner_rep", "sequence_id", "subject", "target_count", "rerun_key", "created_at") ` +
      `VALUES ('${id}', '${args.ownerRep}', '${args.sequenceId}', '${subject}'::jsonb, ` +
      `${args.targetCount}, 'seq:${args.sequenceId}:refresh:${id}', '${ASOF_TS}')`
  );
  return id;
}

// ── Generators ───────────────────────────────────────────────────────────────

/**
 * A scenario: a universe of distinct prospect identities, and a series of
 * refreshes each discovering a (possibly overlapping) subset of that universe.
 * Index 0 is forced into EVERY refresh so cross-refresh overlap (and the
 * at-most-once dedupe path) is exercised on every run. Each refresh may be
 * flagged to fail terminally on its 2nd cold draft (a partial-progress failure)
 * before being retried.
 */
interface RefreshSpec {
  /** Universe indices (besides the always-present index 0) this refresh sees. */
  extraPicks: number[];
  /** Force a terminal failure on the Nth cold draft of the first attempt. */
  failOnDraft: boolean;
}

const scenarioArb = fc.integer({ min: 1, max: 6 }).chain((universeSize) =>
  fc.record({
    universeSize: fc.constant(universeSize),
    refreshes: fc.array(
      fc.record({
        extraPicks: fc.uniqueArray(
          fc.integer({ min: 0, max: universeSize - 1 }),
          { maxLength: universeSize }
        ),
        failOnDraft: fc.boolean(),
      }),
      { minLength: 2, maxLength: 4 }
    ),
  })
);

describe("**Feature: prospecting-sequences, Property 4: Enrollment is at most once per Sequence per prospect.**", () => {
  beforeEach(() => {
    mockedDispatch.mockReset();
    mockedCrm.mockReset();
  });

  it("Validates: Requirements 3.4, 5.1, 5.2, 5.3, 11.4 — overlapping refreshes (incl. a retried-after-failure pass) enroll each prospect at most once, never duplicate its Queued_Item, and increment the period count exactly once", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ universeSize, refreshes }) => {
        backup.restore();

        // The per-refresh size is set generously so a refresh enrolls every NEW
        // cold candidate it sees (the at-most-once guarantee is independent of
        // N, but this keeps the union fully enrolled for a crisp count check).
        const targetCount = universeSize + 1;
        const { sequenceId, ownerRep } = seedSequence(mem, targetCount);

        // The universe of distinct, stable, cold-eligible identities. The SAME
        // objects are reused across refreshes, so a reappearing identity is a
        // genuine duplicate the ledger must collapse.
        const universe = Array.from({ length: universeSize }, (_, i) =>
          makeCandidate(PROVIDER_IDS[i % PROVIDER_IDS.length], i)
        );

        // Every CRM check ran and found nobody → present candidate is cold.
        mockedCrm.mockImplementation(async (input: { email?: string | null }) =>
          notFoundCrm(input.email ?? null)
        );

        // ── Dispatcher mock (shared across this iteration's refreshes) ────────
        // `prospect_search` returns whatever pool the current refresh set;
        // `record_target` returns a STABLE targetId per identity (one `targets`
        // row per distinct prospect, reused across refreshes); `draft_outreach`
        // inserts a draft — and THROWS when armed, to force a terminal failure.
        const targetIdByIdentity = new Map<string, string>();
        let currentPool: ProviderResult[] = [];
        let draftCount = 0;
        let armedFailAt: number | null = null;

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
                  candidates: currentPool,
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
              });
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
              draftCount += 1;
              if (armedFailAt !== null && draftCount === armedFailAt) {
                // Simulate a terminal mid-refresh failure: any prior candidates
                // are already enrolled (committed), this one is not. The handler
                // stamps the run `failed` and rethrows.
                throw new Error("forced terminal refresh failure");
              }
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

        // The union of identities discovered across ALL refreshes — every one is
        // cold-eligible and within N + cap, so each must end up enrolled exactly
        // once across the whole Sequence.
        const enrolledUniverseIdx = new Set<number>();

        // ── Drive each refresh: a (possibly failing) attempt, then a retry ────
        for (const spec of refreshes) {
          const picks = new Set<number>([0, ...spec.extraPicks]);
          for (const i of picks) enrolledUniverseIdx.add(i);
          const pool = [...picks].map((i) => universe[i]);

          const runId = seedRefreshRun(mem, {
            sequenceId,
            ownerRep,
            targetCount,
          });

          // Attempt 1 — armed to throw on the 2nd cold draft when flagged, so at
          // least one enrollment commits before the failure (partial progress).
          currentPool = pool;
          draftCount = 0;
          armedFailAt = spec.failOnDraft ? 2 : null;
          try {
            await runProspectingBatch(db, { batchRunId: runId }, {} as never);
          } catch {
            // Expected only on a forced terminal failure; the retry below
            // reproduces the same enrollment outcome (Req 5.3).
          }

          // Retry attempt — never armed. A clean re-run of the same refresh:
          // already-enrolled candidates are skipped via the ledger, the rest are
          // enrolled, and nothing is duplicated (Req 5.3).
          currentPool = pool;
          draftCount = 0;
          armedFailAt = null;
          await runProspectingBatch(db, { batchRunId: runId }, {} as never);
        }

        const expectedEnrollments = enrolledUniverseIdx.size;

        // ── Read back the whole-Sequence state ────────────────────────────────
        const ledgerRows = await db
          .select({
            matchKind: schema.prospectingSequenceEnrollments.matchKind,
            matchValue: schema.prospectingSequenceEnrollments.matchValue,
            targetId: schema.prospectingSequenceEnrollments.targetId,
          })
          .from(schema.prospectingSequenceEnrollments)
          .where(
            eq(schema.prospectingSequenceEnrollments.sequenceId, sequenceId)
          );

        // (Req 5.1, 5.2) At most one ledger row per (sequence_id, identity): the
        // distinct identity count equals the total ledger row count — no identity
        // is enrolled twice across any number of overlapping refreshes / retries.
        const distinctIdentities = new Set(
          ledgerRows.map((r) => `${r.matchKind}:${r.matchValue}`)
        );
        expect(distinctIdentities.size).toBe(ledgerRows.length);

        // Every discovered (cold-eligible) identity is enrolled exactly once.
        expect(ledgerRows.length).toBe(expectedEnrollments);

        // (Req 11.4) The period enrollment count increments exactly once per
        // Enrollment — the monthly bucket's COUNT(*) equals the distinct
        // enrollments (no double-count on overlap or retry).
        const bucket = periodBucket("month", ASOF_DATE);
        expect(await enrollmentConsumed(db, sequenceId, bucket)).toBe(
          expectedEnrollments
        );

        // ── Queued_Item invariants across all of the Sequence's runs ──────────
        const runRows = await db
          .select({ id: schema.prospectingBatchRuns.id })
          .from(schema.prospectingBatchRuns)
          .where(eq(schema.prospectingBatchRuns.sequenceId, sequenceId));
        const runIds = new Set(runRows.map((r) => r.id));

        const allQueueItems = await db
          .select({
            batchRunId: schema.prospectingQueueItems.batchRunId,
            targetId: schema.prospectingQueueItems.targetId,
            eligibility: schema.prospectingQueueItems.eligibility,
          })
          .from(schema.prospectingQueueItems);
        const coldItems = allQueueItems.filter(
          (i) => runIds.has(i.batchRunId) && i.eligibility === "cold_eligible"
        );

        // (Req 3.4, 5.2) No duplicate Queued_Item for an already-enrolled
        // prospect: each enrolled Target has exactly ONE cold Queued_Item across
        // the WHOLE Sequence (a later refresh that re-sees it creates none), so
        // the distinct enrolled targets equal the cold-item count and the
        // enrollment count.
        const coldTargets = new Set(coldItems.map((i) => i.targetId));
        expect(coldTargets.size).toBe(coldItems.length);
        expect(coldItems.length).toBe(expectedEnrollments);

        // The ledger's enrolled targets are exactly the cold-queued targets.
        const ledgerTargets = new Set(ledgerRows.map((r) => r.targetId));
        expect(ledgerTargets.size).toBe(coldTargets.size);
      }),
      { numRuns: NUM_RUNS }
    );
  }, 120000);
});
