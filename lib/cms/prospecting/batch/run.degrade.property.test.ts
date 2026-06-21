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
//    present candidate that clears the other compliance gates is cold-eligible
//    (its degradation modes are Property 19's concern, not this property's).
vi.mock("../crm-check", () => ({
  checkCrmForContact: vi.fn(),
}));
import { checkCrmForContact, type CrmCheckResult } from "../crm-check";
const mockedCrm = vi.mocked(checkCrmForContact);

import { runProspectingBatch } from "./run";
import { readActivity } from "./activity";

/**
 * Property 18 — Provider degradation (Requirements 11.1, 11.2).
 *
 * `runProspectingBatch` discovers candidates by dispatching `prospect_search`,
 * whose result carries `{ candidates, unconfiguredProviders, failedProviders }`.
 * This property pins the run's behaviour over EVERY shape of that result:
 *
 *   (a) **Some providers available** (Req 11.1): when at least one provider
 *       returned candidates, the run CONTINUES using the remaining providers —
 *       it completes normally (`status = "completed"`, `reason = null`), produces
 *       a cold-eligible Queued_Item per discovered candidate, and records the
 *       unconfigured / failed sources on the `discovered` activity entry rather
 *       than dropping them. One unconfigured / failed provider never blocks the
 *       run while another provider has results.
 *
 *   (b) **Every provider unavailable** (Req 11.2): when NO provider returned
 *       candidates and at least one was unconfigured or failed, the run does NOT
 *       error — it completes with ZERO Queued_Items and an
 *       `unconfigured_providers` reason, and records the unavailable sources.
 *
 * The property runs against a REAL Drizzle handle over an in-memory Postgres
 * (pg-mem) with the real `drizzle/0040_agentic_prospecting_batch.sql` applied,
 * so the genuine batch bookkeeping (run lifecycle, queue upsert, claim, send-cap
 * read, activity log, event publish) executes. The harness mirrors the sibling
 * `send-cap.exactly-once.property.test.ts` / `eligibility.coldeligible.property.test.ts`
 * (statement-breakpoint splitter + `gen_random_uuid()` + `pg_notify()`
 * registration + the node-postgres adapter wiring with faithful
 * `INSERT … ON CONFLICT DO NOTHING … RETURNING` semantics) plus the events
 * table the SSE mirror writes to.
 *
 * Tag: Feature: agentic-prospecting-batch, Property 18: Provider degradation
 */

const NUM_RUNS = Number(process.env.PBT_RUNS ?? 25);
const MIGRATION_FILE = "0040_agentic_prospecting_batch.sql";
const ASOF = "2026-01-15T00:00:00.000Z";

// `claimTarget` / `isOptedOut` salt-hash phones via `computePhoneHash`, which
// requires PHONE_HASH_SALT. A deterministic test salt keeps hashing stable.
process.env.PHONE_HASH_SALT =
  process.env.PHONE_HASH_SALT ?? "run-degrade-property-test-salt";

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
 * without any cluster resolution. `targetCount` is generous so the per-candidate
 * loop never stops early on N. Returns the run id.
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

/** A cold-eligible candidate with a unique identity (`sourceRef`) per provider. */
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

// Each configured provider plays one role for a run: it returns candidates, is
// unconfigured (credentials absent), is failed (threw), or is absent (not part
// of this run). `candidateCount` only matters for the `candidates` role.
const ROLES = ["candidates", "unconfigured", "failed", "absent"] as const;

const providerPlanArb = fc.record({
  role: fc.constantFrom(...ROLES),
  candidateCount: fc.integer({ min: 1, max: 3 }),
});

// A plan over ALL configured providers (`PROVIDER_IDS`), so a run ranges over
// every provider-configured subset — including the all-unconfigured shape.
const planArb = fc.record(
  Object.fromEntries(PROVIDER_IDS.map((p) => [p, providerPlanArb])) as Record<
    (typeof PROVIDER_IDS)[number],
    typeof providerPlanArb
  >
);

interface SearchResult {
  candidates: ProviderResult[];
  unconfiguredProviders: string[];
  failedProviders: string[];
}

/** Translate a generated plan into a `prospect_search` result. */
function planToSearch(plan: Record<string, { role: string; candidateCount: number }>): SearchResult {
  const candidates: ProviderResult[] = [];
  const unconfiguredProviders: string[] = [];
  const failedProviders: string[] = [];

  for (const provider of PROVIDER_IDS) {
    const { role, candidateCount } = plan[provider];
    if (role === "candidates") {
      for (let i = 0; i < candidateCount; i++) {
        candidates.push(makeCandidate(provider, i));
      }
    } else if (role === "unconfigured") {
      unconfiguredProviders.push(provider);
    } else if (role === "failed") {
      failedProviders.push(provider);
    }
  }

  return { candidates, unconfiguredProviders, failedProviders };
}

describe("Feature: agentic-prospecting-batch, Property 18: Provider degradation", () => {
  beforeEach(() => {
    mockedDispatch.mockReset();
    mockedCrm.mockReset();
  });

  it("continues on the remaining providers when some are available and degrades to a zero-item, unconfigured-providers completion when all are unavailable — without erroring (Req 11.1, 11.2)", async () => {
    await fc.assert(
      fc.asyncProperty(planArb, async (plan) => {
        const search = planToSearch(plan);
        const markerCount =
          search.unconfiguredProviders.length + search.failedProviders.length;

        // Only exercise the two contracted shapes: some-available (≥1 candidate)
        // or all-unavailable (no candidate, ≥1 unconfigured/failed marker). The
        // "providers ran and simply found nobody" shape (no candidates, no
        // markers) is not part of this degradation property.
        fc.pre(search.candidates.length > 0 || markerCount > 0);

        backup.restore();
        const runId = seedRun(mem, 100);

        // The mocked CRM check always ran + found nobody, so a present candidate
        // is cold-eligible.
        mockedCrm.mockImplementation(async (input: { email?: string | null }) =>
          notFoundCrm(input.email ?? null)
        );

        // The mocked dispatcher feeds the generated search result and fulfils
        // the Target / draft writes the loop performs for a present candidate.
        mockedDispatch.mockImplementation(
          async (
            _db: Database,
            toolName: string,
            input: unknown
          ): Promise<DispatchResult> => {
            if (toolName === "prospect_search") {
              return { ok: true, result: search };
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

        // The run must NEVER throw under any provider-degradation shape.
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
        const coldItems = queueItems.filter(
          (q) => q.eligibility === "cold_eligible"
        );

        const activity = await readActivity(db, runId);
        const discovered = activity.find((a) => a.action === "discovered");

        // The discovered entry always records the unconfigured / failed sources.
        expect(discovered).toBeDefined();
        const payload = (discovered?.payload ?? {}) as Record<string, unknown>;
        expect(payload.unconfiguredProviders).toEqual(
          search.unconfiguredProviders
        );
        expect(payload.failedProviders).toEqual(search.failedProviders);

        if (search.candidates.length === 0) {
          // ── (b) Every provider unavailable (Req 11.2) ──────────────────────
          // Completes with zero Queued_Items + an unconfigured-providers reason.
          expect(run.status).toBe("completed");
          expect(run.reason).toBe("unconfigured_providers");
          expect(coldItems).toHaveLength(0);
          // The degradation entry is tagged with the same reason.
          expect(discovered?.reason).toBe("unconfigured_providers");
        } else {
          // ── (a) Some providers available (Req 11.1) ────────────────────────
          // The run continues on the remaining providers, completing normally
          // with one cold-eligible Queued_Item per discovered candidate.
          expect(run.status).toBe("completed");
          expect(run.reason).toBeNull();
          expect(coldItems).toHaveLength(search.candidates.length);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  }, 60000);
});
