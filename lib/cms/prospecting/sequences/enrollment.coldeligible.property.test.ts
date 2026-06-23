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
//    every prospecting effect in run.ts goes through `dispatchTool`). run.ts
//    imports it from "../../ai/tools/dispatch"; this hoisted mock replaces that
//    module before run.ts loads it.
vi.mock("../../ai/tools/dispatch", () => ({
  dispatchTool: vi.fn(),
}));
import { dispatchTool } from "../../ai/tools/dispatch";
const mockedDispatch = vi.mocked(dispatchTool);

// ── CRM_Check is mocked so a candidate's Salesforce-existence outcome is driven
//    by the generator: a `crm_found` candidate reports CONFIGURED + FOUND (→
//    Warm_Path); every other candidate reports CONFIGURED + NOT-FOUND (the check
//    actually ran, so a candidate that clears the other gates is cold-eligible).
vi.mock("../crm-check", () => ({
  checkCrmForContact: vi.fn(),
}));
import { checkCrmForContact, type CrmCheckResult } from "../crm-check";
const mockedCrm = vi.mocked(checkCrmForContact);

import { runProspectingBatch } from "../batch/run";

/**
 * Property 3 — Cold-eligible enrollment (Requirements 3.2, 3.3, 8.1, 9.1, 9.2,
 * 9.3, 12.2).
 *
 *   **Feature: prospecting-sequences, Property 3: Cold-eligible enrollment.**
 *
 * **Validates: Requirements 3.2, 3.3, 8.1, 9.1, 9.2, 9.3, 12.2**
 *
 * *For any* candidate a Refresh_Run discovers, the Refresh_Run creates an
 * Enrollment and a single pending Queued_Item **if and only if** the candidate
 * is Cold-eligible (not in Salesforce per a configured CRM_Check, not opted-out,
 * not claimed by another rep, carries a recorded lawful basis) AND is not already
 * enrolled in the Sequence. An opted-out, other-rep-claimed, or missing-lawful-
 * basis candidate produces no cold Enrollment; a CRM-existing candidate is routed
 * to the Warm_Path (a `warm_path` Queued_Item, never a cold Enrollment); an
 * already-enrolled candidate is skipped (its prior Enrollment is reused, no
 * duplicate). This holds for person, company, and intermediary prospect types
 * (Req 12.2, 8.1).
 *
 * The system under test is the WHOLE `runProspectingBatch`
 * (`lib/cms/prospecting/batch/run.ts`) driven on its SEQUENCE-SCOPED branch
 * (`prospecting_batch_runs.sequence_id` set): it dedupes across the WHOLE
 * Sequence via the `prospecting_sequence_enrollments` ledger
 * (`loadSequenceEnrollments`), runs the unchanged `evaluateCandidate` compliance
 * pipeline (opt-out → lawful-basis → cross-rep claim → CRM_Check), and on each
 * cold enrollment writes one ledger row + upserts one pending queue item.
 *
 * The harness mirrors `batch/run.idempotent.property.test.ts`: the real
 * `drizzle/0040_agentic_prospecting_batch.sql` + `drizzle/0043_prospecting_
 * sequences.sql` migrations are applied to an in-memory Postgres (pg-mem) behind
 * a real Drizzle handle, so the genuine compliance SQL (opt-out lookup, the
 * `ON CONFLICT` cross-rep claim, the `ON CONFLICT DO NOTHING` enrollment insert,
 * the `(batch_run_id, target_id)` queue upsert) all execute for real. Only the
 * two external seams are mocked — the dispatcher (so the candidate pool, the
 * Target write, and the draft are observable + generator-driven) and the
 * CRM_Check (so a candidate's Salesforce-existence is generator-driven).
 *
 * Every per-candidate compliance state is exercised: opt-out rows are pre-seeded
 * into `prospect_optouts`, cross-rep claims into `prospecting_target_claims`
 * (owned by a DIFFERENT rep), CRM-found is keyed by the candidate's email, the
 * missing-lawful-basis case carries an empty `lawfulBasis`, and already-enrolled
 * candidates are pre-seeded into the enrollment ledger. The enrollment cap is
 * left unbounded and the per-refresh size N is set above the pool so the
 * if-and-only-if is asserted cleanly without a cap/N truncation.
 *
 * Tag: Feature: prospecting-sequences, Property 3: Cold-eligible enrollment
 */

// The design mandates a minimum of 100 iterations for every property test; clamp
// the configurable run count so it can be raised but never fall below the floor.
const NUM_RUNS = Math.max(100, Number(process.env.PBT_RUNS ?? 100));
const ASOF = "2026-01-15T00:00:00.000Z";

// `claimTarget` / `isOptedOut` salt-hash phones via `computePhoneHash`, which
// requires PHONE_HASH_SALT. A deterministic test salt keeps hashing stable.
process.env.PHONE_HASH_SALT =
  process.env.PHONE_HASH_SALT ?? "enrollment-coldeligible-property-test-salt";

// Minimal stubs for the PRE-existing tables the migrations reference by FK:
//   - `users`            — owner_rep of runs/claims/sequences.
//   - `targets`          — the recorded prospect (FK of queue items + ledger).
//   - `outreach_drafts`  — the AI draft (FK of queue items); 0040 ALTERs it.
//   - `prospect_optouts` — the opt-out store the eligibility gate reads (0038).
//   - `events`           — the SSE mirror `publishBatch` writes to.
//   - `prospecting_sequences` — the parent Sequence; 0043 ADD COLUMNs the
//     lifecycle/cadence/cap columns onto this base table (owned by 0041).
// 0040 + 0043 are purely additive over these.
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
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
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

/** Stand up a fresh pg-mem with the prerequisites + 0040 + 0043 + Drizzle. */
function buildDb(): {
  mem: IMemoryDb;
  db: Database;
  pool: { end: () => Promise<void> };
} {
  const mem = newDb();

  // pg-mem ships neither `gen_random_uuid()` nor `pg_notify()`; register both
  // (the latter as a no-op) so the real SQL + the event mirror resolve. A
  // timestamptz `now()` is registered so 0043's `timestamptz DEFAULT now()`
  // ledger column resolves (impure so each row gets a fresh value).
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

  for (const file of [
    "0040_agentic_prospecting_batch.sql",
    "0043_prospecting_sequences.sql",
  ]) {
    const migration = readFileSync(join(process.cwd(), "drizzle", file), "utf-8");
    for (const statement of migration.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) mem.public.none(trimmed);
    }
  }

  // The sequences feature added `sequence_id` to prospecting_batch_runs in a
  // later migration than 0040; add it here so `loadBatchRun`'s SELECT resolves
  // and the run can be driven on its sequence-scoped branch.
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
  // rows, but pg-mem returns the EXISTING row. The cross-rep claim and the
  // enrollment ledger both key "fresh insert" off a non-empty RETURNING, so
  // faithful semantics are restored here.
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

// ── Candidate model + generators ──────────────────────────────────────────────

/** The compliance state a generated candidate is forced into. */
type Kind = "cold" | "opted_out" | "claimed" | "crm_found" | "no_lawful_basis";

const KINDS: Kind[] = [
  "cold",
  "opted_out",
  "claimed",
  "crm_found",
  "no_lawful_basis",
];

const TARGET_TYPES = ["person", "company", "intermediary"] as const;

/** A generated candidate spec — its compliance state + prospect type. */
interface Spec {
  kind: Kind;
  targetType: (typeof TARGET_TYPES)[number];
  provider: (typeof PROVIDER_IDS)[number];
  alreadyEnrolled: boolean;
}

/** A built candidate: the provider result + the spec + derived identities. */
interface BuiltCandidate {
  spec: Spec;
  candidate: ProviderResult;
  /** Normalized email (the opt-out / claim match value). */
  email: string;
  /** Provider ref identity match value (`{provider}:{sourceRef}`). */
  refValue: string;
}

const specArb: fc.Arbitrary<Spec> = fc.record({
  kind: fc.constantFrom(...KINDS),
  targetType: fc.constantFrom(...TARGET_TYPES),
  provider: fc.constantFrom(...PROVIDER_IDS),
  alreadyEnrolled: fc.boolean(),
});

const poolArb: fc.Arbitrary<Spec[]> = fc.array(specArb, {
  minLength: 1,
  maxLength: 8,
});

/** Build a unique cold-shaped candidate from a spec (a `sourceRef` per index). */
function buildCandidate(spec: Spec, idx: number): BuiltCandidate {
  const u = randomUUID();
  const email = `cand-${idx}-${u.slice(0, 8)}@example.com`.toLowerCase();
  const sourceRef = `${spec.provider}-${idx}-${u}`;
  const candidate: ProviderResult = {
    targetType: spec.targetType,
    displayName: `Candidate ${u.slice(0, 8)}`,
    companyName: `Acme ${u.slice(0, 4)}`,
    title: "Managing Partner",
    email,
    country: "AE",
    attributes: {
      email: {
        value: email,
        source: spec.provider,
        asOf: ASOF,
        lawfulBasis: "legitimate_interest",
      },
    },
    sourceProvider: spec.provider,
    sourceRef,
    // The missing-lawful-basis case carries an EMPTY record-level basis so the
    // eligibility gate 2 skips it; every other kind carries a real basis.
    lawfulBasis: spec.kind === "no_lawful_basis" ? "" : "legitimate_interest",
  };
  return { spec, candidate, email, refValue: `${spec.provider}:${sourceRef}` };
}

/** SF configured + the check ran + found/not-found by the generator's intent. */
function crmResult(email: string | null, found: boolean): CrmCheckResult {
  return { configured: true, found, matches: [], checkedEmail: email };
}

/**
 * Seed a sequence-scoped `prospecting_batch_runs` row + its parent Sequence and
 * owning rep. The per-refresh size N is set ABOVE the pool and the enrollment
 * cap is left unbounded (null) so neither truncates the if-and-only-if. Returns
 * the run id, the sequence id, and the owning rep id.
 */
function seedSequenceRun(
  mem: IMemoryDb,
  perRefreshSize: number
): { runId: string; sequenceId: string; ownerRep: string } {
  const ownerRep = randomUUID();
  const sequenceId = randomUUID();
  const runId = randomUUID();
  mem.public.none(`INSERT INTO "users" ("id") VALUES ('${ownerRep}')`);

  const subject = JSON.stringify({
    kind: "icp",
    icpFilter: { targetType: "person" },
  });
  mem.public.none(
    `INSERT INTO "prospecting_sequences" ` +
      `("id", "owner_rep", "name", "subject", "target_count", "mode", "status", "enrollment_cap", "enrollment_period") ` +
      `VALUES ('${sequenceId}', '${ownerRep}', 'Seq', '${subject}'::jsonb, ${perRefreshSize}, 'live', 'live', NULL, 'month')`
  );
  mem.public.none(
    `INSERT INTO "prospecting_batch_runs" ` +
      `("id", "owner_rep", "sequence_id", "subject", "target_count", "rerun_key") ` +
      `VALUES ('${runId}', '${ownerRep}', '${sequenceId}', '${subject}'::jsonb, ${perRefreshSize}, '${runId}')`
  );
  return { runId, sequenceId, ownerRep };
}

describe("**Feature: prospecting-sequences, Property 3: Cold-eligible enrollment.**", () => {
  beforeEach(() => {
    mockedDispatch.mockReset();
    mockedCrm.mockReset();
  });

  it("Validates: Requirements 3.2, 3.3, 8.1, 9.1, 9.2, 9.3, 12.2 — a Refresh_Run enrolls + queues a single pending item iff cold-eligible and not already enrolled; opted-out/other-claimed/no-lawful-basis produce no cold enrollment, CRM-existing routes to Warm_Path", async () => {
    await fc.assert(
      fc.asyncProperty(poolArb, async (specs) => {
        backup.restore();

        const built = specs.map((s, i) => buildCandidate(s, i));
        const pool = built.map((b) => b.candidate);

        const { runId, sequenceId, ownerRep } = seedSequenceRun(
          mem,
          pool.length + 5
        );

        // A DIFFERENT rep who pre-claims the `claimed` candidates (cross-rep
        // dedupe, Req 9.2). FK → users.
        const otherRep = randomUUID();
        mem.public.none(`INSERT INTO "users" ("id") VALUES ('${otherRep}')`);

        // A prior target the pre-seeded ledger rows can reference (FK anchor).
        const priorTargetId = randomUUID();
        mem.public.none(
          `INSERT INTO "targets" ("id", "target_type", "source_provider", "lawful_basis") ` +
            `VALUES ('${priorTargetId}', 'person', 'demo', 'legitimate_interest')`
        );

        // ── Pre-seed each candidate's compliance state ────────────────────────
        const crmFoundEmails = new Set<string>();
        for (const b of built) {
          if (b.spec.kind === "opted_out") {
            mem.public.none(
              `INSERT INTO "prospect_optouts" ("match_kind", "match_value") ` +
                `VALUES ('email', '${b.email}')`
            );
          }
          if (b.spec.kind === "claimed") {
            mem.public.none(
              `INSERT INTO "prospecting_target_claims" ("match_kind", "match_value", "owner_rep") ` +
                `VALUES ('email', '${b.email}', '${otherRep}')`
            );
          }
          if (b.spec.kind === "crm_found") {
            crmFoundEmails.add(b.email);
          }
          if (b.spec.alreadyEnrolled) {
            // Pre-enrolled by a prior refresh of THIS Sequence — added to the
            // sequence-wide dedupe set so the candidate is skipped entirely.
            mem.public.none(
              `INSERT INTO "prospecting_sequence_enrollments" ` +
                `("sequence_id", "match_kind", "match_value", "target_id", "batch_run_id", "period_bucket") ` +
                `VALUES ('${sequenceId}', 'ref', '${b.refValue}', '${priorTargetId}', '${runId}', 'prior')`
            );
          }
        }

        // CRM: configured + ran; found only for the `crm_found` emails.
        mockedCrm.mockImplementation(async (input: { email?: string | null }) => {
          const email = input.email ?? null;
          const found =
            email !== null && crmFoundEmails.has(email.trim().toLowerCase());
          return crmResult(email, found);
        });

        // Dispatcher: `prospect_search` returns the pool; `record_target`
        // inserts a Target row (stable per identity) and returns its id;
        // `draft_outreach` inserts an unsent draft and returns its id.
        const targetIdByRef = new Map<string, string>();
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
              const refKey = `${rec.sourceProvider}:${rec.sourceRef}`;
              const cached = targetIdByRef.get(refKey);
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
              targetIdByRef.set(refKey, row.id);
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

        // ── Run ONE sequence-scoped refresh ───────────────────────────────────
        await runProspectingBatch(db, { batchRunId: runId }, {} as never);

        // ── Expected outcomes per spec ────────────────────────────────────────
        // Cold enrollment iff cold AND not already enrolled.
        const expectColdRefs = new Set(
          built
            .filter((b) => b.spec.kind === "cold" && !b.spec.alreadyEnrolled)
            .map((b) => b.refValue)
        );
        // CRM-existing (not already enrolled) routes to Warm_Path.
        const expectWarmRefs = new Set(
          built
            .filter((b) => b.spec.kind === "crm_found" && !b.spec.alreadyEnrolled)
            .map((b) => b.refValue)
        );
        // The ledger should hold exactly the new cold enrollments PLUS the
        // pre-seeded already-enrolled rows (each prospect at most once).
        const expectLedgerRefs = new Set<string>(expectColdRefs);
        for (const b of built) {
          if (b.spec.alreadyEnrolled) expectLedgerRefs.add(b.refValue);
        }

        // ── Assert: the enrollment ledger ─────────────────────────────────────
        const ledger = await db
          .select({
            matchKind: schema.prospectingSequenceEnrollments.matchKind,
            matchValue: schema.prospectingSequenceEnrollments.matchValue,
          })
          .from(schema.prospectingSequenceEnrollments)
          .where(
            eq(schema.prospectingSequenceEnrollments.sequenceId, sequenceId)
          );

        // Every ledger row is a `ref` identity, recorded at most once.
        const ledgerRefs = ledger.map((r) => r.matchValue);
        expect(new Set(ledgerRefs).size).toBe(ledgerRefs.length); // no dup rows
        expect(new Set(ledgerRefs)).toEqual(expectLedgerRefs);

        // ── Assert: the queue items ───────────────────────────────────────────
        const items = await db
          .select({
            eligibility: schema.prospectingQueueItems.eligibility,
            status: schema.prospectingQueueItems.status,
            sourceProvider: schema.targets.sourceProvider,
            sourceRef: schema.targets.sourceRef,
          })
          .from(schema.prospectingQueueItems)
          .innerJoin(
            schema.targets,
            eq(schema.targets.id, schema.prospectingQueueItems.targetId)
          )
          .where(eq(schema.prospectingQueueItems.batchRunId, runId));

        const refOf = (r: { sourceProvider: string | null; sourceRef: string | null }) =>
          `${r.sourceProvider}:${r.sourceRef}`;

        // Cold-eligible queue items: exactly one PENDING item per expected cold
        // ref, and no others (Req 3.2, 3.3 — the single pending Queued_Item iff).
        const coldItems = items.filter((i) => i.eligibility === "cold_eligible");
        for (const i of coldItems) {
          expect(i.status).toBe("pending");
        }
        const coldRefs = coldItems.map(refOf);
        expect(new Set(coldRefs).size).toBe(coldRefs.length); // single per prospect
        expect(new Set(coldRefs)).toEqual(expectColdRefs);

        // Warm-path queue items: exactly the CRM-existing candidates, routed to
        // the Warm_Path rather than cold-enrolled (Req 9.3).
        const warmRefs = items
          .filter((i) => i.eligibility === "warm_path")
          .map(refOf);
        expect(new Set(warmRefs)).toEqual(expectWarmRefs);

        // No warm-path candidate was cold-enrolled (no ledger leakage, Req 9.3).
        for (const ref of expectWarmRefs) {
          expect(expectLedgerRefs.has(ref)).toBe(false);
        }

        // Excluded candidates (opted-out / claimed / missing-lawful-basis, and
        // not already enrolled) produce NO queue item at all (Req 9.1, 9.2).
        const excludedRefs = built
          .filter(
            (b) =>
              !b.spec.alreadyEnrolled &&
              (b.spec.kind === "opted_out" ||
                b.spec.kind === "claimed" ||
                b.spec.kind === "no_lawful_basis")
          )
          .map((b) => b.refValue);
        const allItemRefs = new Set(items.map(refOf));
        for (const ref of excludedRefs) {
          expect(allItemRefs.has(ref)).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  }, 120000);
});
