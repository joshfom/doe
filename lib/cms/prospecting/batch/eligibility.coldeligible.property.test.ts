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
import fc from "fast-check";

import type { Database } from "../../db";
import * as schema from "../../schema";
import type { ProviderResult } from "../providers";

// The external Salesforce existence pre-check is mocked so the CRM-found state
// is driven by the generator rather than by real credentials / network. The
// eligibility module imports it from the SAME "../crm-check" specifier, so this
// mock intercepts its call site too.
vi.mock("../crm-check", () => ({
  checkCrmForContact: vi.fn(),
}));
import { checkCrmForContact } from "../crm-check";
import { evaluateCandidate, type EligibilityRun } from "./eligibility";

const mockedCrm = vi.mocked(checkCrmForContact);

// `claimTarget` / `isOptedOut` salt-hash phone numbers via `computePhoneHash`,
// which requires PHONE_HASH_SALT. Set a deterministic test salt.
process.env.PHONE_HASH_SALT = "eligibility-coldeligible-property-test-salt";

/**
 * Property 2 — Cold-eligible characterization (Requirements 6.1, 6.2, 6.5, 10.2).
 *
 * `evaluateCandidate` classifies a discovered candidate as `cold_eligible`,
 * `warm_path`, or `skip` by running a FIXED sequence of gates and returning the
 * first decisive outcome (opt-out → lawful-basis → cross-rep claim → CRM_Check →
 * send-cap). The universal property under test is the CHARACTERIZATION of
 * cold-eligibility:
 *
 *   a candidate is `cold_eligible`  IFF
 *       not opted-out  ∧  has a lawful basis  ∧  not claimed by another rep
 *       ∧  not found in Salesforce.
 *
 * Otherwise the candidate is excluded — either `skip` (opted out / no lawful
 * basis / claimed by another rep) or `warm_path` (already in Salesforce) — and is
 * NEVER `cold_eligible`, so no cold queue item would be produced for it.
 *
 * Because the gates short-circuit in a fixed order, the EXACT exclusion reason is
 * also pinned to the first failing condition in that order, which the property
 * asserts for stronger coverage.
 *
 * The four states (opted-out / claimed-by-other-rep / CRM-found / has-lawful-
 * basis) are driven independently:
 *   - opted-out      → seed a `prospect_optouts` row on the candidate's email.
 *   - claimed-by-other → seed a `prospecting_target_claims` row owned by a
 *                        DIFFERENT rep on the candidate's email.
 *   - CRM-found       → the mocked `checkCrmForContact` reports `found` with the
 *                       check having run (`configured: true`, no `note`).
 *   - has-lawful-basis → the candidate carries a non-empty `lawfulBasis`.
 *
 * The send-cap gate is held OPEN throughout (no cap configured → unlimited) so it
 * never confounds the characterization; its enforcement is covered by Property 11.
 *
 * The property runs against a REAL Drizzle handle backed by an in-memory Postgres
 * (pg-mem) with the real `drizzle/0040_agentic_prospecting_batch.sql` applied, so
 * the genuine opt-out / claim / cap SQL executes. The harness mirrors the sibling
 * `send-cap.exactly-once.property.test.ts` — including the faithful
 * `INSERT … ON CONFLICT DO NOTHING … RETURNING` semantics that `claimTarget`'s
 * cross-rep collision detection relies on.
 *
 * Tag: Feature: agentic-prospecting-batch, Property 2: Cold-eligible characterization
 */

const NUM_RUNS = Number(process.env.PBT_RUNS ?? 25);
const MIGRATION_FILE = "0040_agentic_prospecting_batch.sql";

// Minimal stubs for the PRE-existing tables 0040 references, plus the
// `prospect_optouts` table (migration 0038) that `isOptedOut` reads. 0040's FKs
// resolve against these: `prospecting_batch_runs.owner_rep` / `*_claims.owner_rep`
// → users, `prospecting_queue_items.target_id` → targets,
// `prospecting_send_ledger.draft_id` → outreach_drafts.
const PREREQUISITE_SQL = `
  CREATE TABLE "users" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
  );
  CREATE TABLE "targets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
  );
  CREATE TABLE "outreach_drafts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "subject" text,
    "body" text
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
`;

/** Stand up a fresh pg-mem with 0040 (+ prerequisites) applied + Drizzle. */
function buildDb(): {
  mem: IMemoryDb;
  db: Database;
  pool: { end: () => Promise<void> };
} {
  const mem = newDb();

  // pg-mem does not ship `gen_random_uuid()`; register it so DEFAULTs resolve.
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
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
  // rows, but pg-mem returns the EXISTING row. That deviation would defeat
  // `claimTarget`'s cross-rep collision detection (it keys "freshly inserted"
  // off a non-empty RETURNING), so faithful semantics are restored here by
  // comparing the target table's row count before/after and stripping the
  // erroneously-returned row when nothing was actually inserted.
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

/** Seed a users row, returning its id (FK anchor for reps/claims). */
function seedUser(mem: IMemoryDb): string {
  const id = randomUUID();
  mem.public.none(`INSERT INTO "users" ("id") VALUES ('${id}')`);
  return id;
}

/** Seed a `prospecting_batch_runs` row owned by `ownerRep`; return its id. */
function seedBatchRun(mem: IMemoryDb, ownerRep: string): string {
  const id = randomUUID();
  mem.public.none(
    `INSERT INTO "prospecting_batch_runs" ` +
      `("id", "owner_rep", "subject", "target_count", "rerun_key") ` +
      `VALUES ('${id}', '${ownerRep}', '{}'::jsonb, 10, '${randomUUID()}')`
  );
  return id;
}

/** Record an email opt-out so `isOptedOut` matches the candidate. */
function seedOptout(mem: IMemoryDb, email: string): void {
  mem.public.none(
    `INSERT INTO "prospect_optouts" ("match_kind", "match_value") ` +
      `VALUES ('email', '${email}')`
  );
}

/** Record a cross-rep claim on the candidate's email owned by a DIFFERENT rep. */
function seedForeignClaim(mem: IMemoryDb, email: string, otherRep: string): void {
  mem.public.none(
    `INSERT INTO "prospecting_target_claims" ` +
      `("match_kind", "match_value", "owner_rep") ` +
      `VALUES ('email', '${email}', '${otherRep}')`
  );
}

// ── Generators ────────────────────────────────────────────────────────────────

// A unique, SQL-safe, already-normalized (lower-case) email per candidate. A
// fresh DB per run plus a unique email keeps seeded opt-outs / claims isolated.
const emailArb = fc.uuid().map((u) => `cand-${u}@example.com`);

// An optional E.164 phone so the candidate sometimes carries a second identity
// key (exercising the salted phone-hash path in opt-out / claim normalization).
const phoneArb = fc.option(
  fc.integer({ min: 500_000_000, max: 599_999_999 }).map((n) => `+971${n}`),
  { nil: undefined }
);

// The four independent states this property ranges over.
const statesArb = fc.record({
  optedOut: fc.boolean(),
  claimedByOther: fc.boolean(),
  crmFound: fc.boolean(),
  hasLawfulBasis: fc.boolean(),
});

describe("Feature: agentic-prospecting-batch, Property 2: Cold-eligible characterization", () => {
  beforeEach(() => {
    mockedCrm.mockReset();
  });

  it("is cold-eligible IFF not-opted-out ∧ has-lawful-basis ∧ not-claimed-by-other ∧ not-in-SF; else skipped/warm with no cold queue item (Req 6.1, 6.2, 6.5, 10.2)", async () => {
    await fc.assert(
      fc.asyncProperty(
        emailArb,
        phoneArb,
        statesArb,
        async (email, phone, states) => {
          const { optedOut, claimedByOther, crmFound, hasLawfulBasis } = states;

          backup.restore();
          const ownerRep = seedUser(mem);
          const otherRep = seedUser(mem);
          const batchRunId = seedBatchRun(mem, ownerRep);

          if (optedOut) seedOptout(mem, email);
          if (claimedByOther) seedForeignClaim(mem, email, otherRep);

          // The mocked CRM check ACTUALLY RAN (configured, no note), so its
          // `found` verdict is authoritative — driving the in-SF state.
          mockedCrm.mockResolvedValue({
            configured: true,
            found: crmFound,
            matches: [],
            checkedEmail: email,
          });

          const candidate: ProviderResult = {
            targetType: "person",
            displayName: "Test Candidate",
            email,
            phone,
            attributes: {},
            sourceProvider: "demo",
            lawfulBasis: hasLawfulBasis ? "gdpr_legitimate_interest" : "",
          };

          const run: EligibilityRun = {
            id: batchRunId,
            ownerRep,
            clusterId: null, // pure ICP run → only the rep cap scope is consulted
            periodBucket: "2026-01-01",
            repCap: null, // unlimited → the send-cap gate stays open (Property 11 covers it)
            clusterCap: null,
          };

          const decision = await evaluateCandidate(db, run, candidate);

          const expectedColdEligible =
            !optedOut && hasLawfulBasis && !claimedByOther && !crmFound;

          // ── The characterization (Req 6.5) ───────────────────────────────
          if (expectedColdEligible) {
            expect(decision.kind).toBe("cold_eligible");
            if (decision.kind === "cold_eligible") {
              // A cold-eligible decision carries the provenance the queue item
              // records (Req 10.1) — derived from the candidate's record.
              expect(decision.lawfulBasis).toBe("gdpr_legitimate_interest");
              expect(decision.dataSource).toBe("demo");
              expect(typeof decision.acquiredAt).toBe("string");
              expect(decision.acquiredAt.length).toBeGreaterThan(0);
            }
          } else {
            // Not all conditions clear → excluded, never cold-eligible, so no
            // cold queue item would be produced for this candidate.
            expect(decision.kind).not.toBe("cold_eligible");
            expect(["skip", "warm_path"]).toContain(decision.kind);
          }

          // ── The exact exclusion reason is pinned to the FIRST failing gate
          //    in the fixed order: opt-out → lawful-basis → claim → CRM. ─────
          if (optedOut) {
            expect(decision).toEqual({ kind: "skip", reason: "opted_out" });
          } else if (!hasLawfulBasis) {
            expect(decision).toEqual({
              kind: "skip",
              reason: "missing_lawful_basis",
            });
          } else if (claimedByOther) {
            expect(decision).toEqual({
              kind: "skip",
              reason: "claimed_by_other_rep",
            });
          } else if (crmFound) {
            expect(decision).toEqual({ kind: "warm_path", via: "crm" });
          } else {
            expect(decision.kind).toBe("cold_eligible");
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  }, 60000);
});
