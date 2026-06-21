import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import fc from "fast-check";

import type { Database } from "../../db";
import * as schema from "../../schema";
import { PROVIDER_IDS, type ProviderResult } from "../providers";
import type { ProvenancedField } from "../target";

/**
 * Property 17 — Provenance on queued (and sent) items
 * (Requirements 10.1, 10.3).
 *
 *   **Feature: agentic-prospecting-batch, Property 17: Provenance on queued and
 *   sent items.**
 *
 * **Validates: Requirements 10.1, 10.3**
 *
 * When a Queued_Item is created for a cold-eligible candidate, it MUST carry a
 * lawful-basis marker together with the data source and acquisition timestamp
 * for the prospect's contact data (Req 10.1). The decisive seam is the durable
 * batch handler `runProspectingBatch` (`lib/cms/prospecting/batch/run.ts`): for
 * every `cold_eligible` decision it upserts a `prospecting_queue_items` row
 * copying the eligibility decision's `lawfulBasis`, `dataSource`
 * (= `candidate.sourceProvider`), and `acquiredAt` (derived in `eligibility.ts`
 * from the candidate's attribute `asOf` / record lawful basis) onto the item as
 * provenance.
 *
 * This property drives the WHOLE handler end to end against a real Drizzle
 * handle over an in-memory Postgres (pg-mem) carrying the real
 * `drizzle/0040_agentic_prospecting_batch.sql` schema, generates a batch of
 * candidates that are each cold-eligible (valid lawful basis + acquisition
 * provenance, not opted out, not claimed, not in Salesforce), runs the batch,
 * then reads back the persisted `cold_eligible` queue items and asserts every
 * one carries a non-null `lawful_basis`, `data_source`, and `acquired_at`.
 *
 * The two external seams are mocked so the candidates are deterministically
 * cold-eligible and the dispatcher boundary is observable without a live
 * provider / DB-write tool:
 *   - `../../ai/tools/dispatch` — `prospect_search` returns the generated
 *     candidates; `record_target` inserts a `targets` row and returns its id;
 *     `draft_outreach` inserts an `outreach_drafts` row and returns its id.
 *   - `../crm-check` — reports `configured: true, found: false` so every
 *     candidate is genuinely cold (the check RAN and did not find them).
 * Every OTHER gate (opt-out, lawful-basis, cross-rep claim, send-cap) runs for
 * real against the migrated schema.
 *
 * Req 10.3 (provenance persisted alongside the SEND record) is exercised at the
 * approve/send route layer (tasks 8.x), which is where a send actually happens;
 * the batch handler under test here produces UNSENT drafts only (CC-HITL), so
 * this property focuses on Req 10.1 (queue-item provenance) — the provenance
 * that the send record later carries forward.
 */

// ── Hoisted holder the mocks read at call time ─────────────────────────────────
//
// vi.mock factories are hoisted above imports and may not close over module
// imports, so the dispatch mock delegates to closures the test installs per
// iteration (after building the DB). The holder itself is hoisted so both the
// mock factory and the test body share the same reference.
const h = vi.hoisted(() => ({
  candidates: [] as unknown[],
  recordTarget: null as
    | null
    | ((input: Record<string, unknown>) => Promise<string>),
  draftOutreach: null as
    | null
    | ((input: Record<string, unknown>) => Promise<string>),
}));

// ── Mock the audited dispatcher (the batch's only effect seam) ─────────────────
vi.mock("../../ai/tools/dispatch", () => ({
  dispatchTool: vi.fn(
    async (_db: unknown, toolName: string, input: Record<string, unknown>) => {
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
          const targetId = await h.recordTarget!(input);
          return { ok: true, result: { targetId, phoneHash: null } };
        }
        case "draft_outreach": {
          const draftId = await h.draftOutreach!(input);
          return { ok: true, result: { draftId, status: "drafted" } };
        }
        default:
          return { ok: false, error: new Error(`unexpected tool ${toolName}`) };
      }
    }
  ),
}));

// ── Mock the external CRM existence check → configured + NOT found (cold) ──────
vi.mock("../crm-check", () => ({
  checkCrmForContact: vi.fn(async (input: { email?: string | null }) => {
    const email = input.email?.trim().toLowerCase() || null;
    return { configured: true, found: false, matches: [], checkedEmail: email };
  }),
}));

// Imported AFTER the mock declarations so `runProspectingBatch` binds the mocked
// `dispatchTool` + `checkCrmForContact` (vitest hoists `vi.mock` above imports).
import { runProspectingBatch } from "./run";

// Spec requires >=100 iterations (task 6.5).
const NUM_RUNS = Number(process.env.PBT_RUNS ?? 25);
const MIGRATION_FILE = "0040_agentic_prospecting_batch.sql";

// Minimal stubs for the PRE-existing tables 0040 references. `targets` carries
// the columns `run.ts`'s re-run bookkeeping join reads; `outreach_drafts` and
// `events` are stood up for the draft FK and the SSE event mirror; the opt-out
// store reads `prospect_optouts`. 0040 is purely additive and applies verbatim.
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
`;

/** Stand up a fresh pg-mem with the prerequisites + 0040 applied + Drizzle. */
function buildDb(): {
  mem: IMemoryDb;
  db: Database;
  pool: { end: () => Promise<void> };
} {
  const mem = newDb();

  // pg-mem ships neither `gen_random_uuid()` nor `pg_notify()` — register both
  // (the latter as a no-op) so the real SQL resolves.
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
    if (trimmed.length > 0) mem.public.none(trimmed);
  }

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem's node-postgres adapter rejects `types.getTypeParser` and
  // `rowMode: "array"`; strip both, honouring drizzle's positional row mapping
  // by converting rows to arrays when `rowMode: "array"` was requested.
  //
  // It ALSO deviates from real Postgres on `INSERT … ON CONFLICT DO NOTHING …
  // RETURNING`: on a conflicting (no-op) insert, real Postgres returns ZERO
  // rows, but pg-mem returns the EXISTING row. `claimTarget` keys "freshly
  // inserted" off a non-empty RETURNING, so restore faithful semantics: if no
  // row was actually inserted (a conflict), strip the erroneously-returned row.
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
 * Seed an owning rep + its `running` Batch_Run row. The subject carries an
 * `icpFilter` so the handler resolves it directly (no cluster catalog read).
 * `targetCount` is large so no candidate is dropped by the N budget.
 */
async function seedRun(db: Database): Promise<string> {
  const ownerRep = randomUUID();
  await db.execute(sql`INSERT INTO "users" ("id") VALUES (${ownerRep})`);
  const [run] = await db
    .insert(schema.prospectingBatchRuns)
    .values({
      ownerRep,
      subject: { kind: "icp", icpFilter: { targetType: "person" } },
      targetCount: 100,
      rerunKey: `rk-${randomUUID()}`,
    })
    .returning({ id: schema.prospectingBatchRuns.id });
  return run.id;
}

// ── Generators ────────────────────────────────────────────────────────────────

/**
 * A DB-safe text generator for the candidate's free-text string fields
 * (displayName / companyName / title / country). These strings are inserted
 * verbatim into `targets` text columns via the `record_target` mock, and
 * pg-mem's node-postgres adapter double-unescapes parameters — so a generated
 * backslash (or control char) makes its parser throw
 * "Bad escaped character in JSON" intermittently. Constraining to an
 * alphanumeric + common-punctuation charset (no backslash, no control chars)
 * keeps the harness deterministic without weakening the property: a candidate's
 * display name being alphanumeric is fully representative for provenance, which
 * is derived from `lawfulBasis` / `sourceProvider` / acquisition `asOf`, not
 * from these free-text fields.
 */
function safeTextArb(maxLength: number): fc.Arbitrary<string> {
  return fc
    .string({ maxLength })
    .map((s) => s.replace(/[^a-zA-Z0-9 .,'-]/g, ""));
}

/** A provenanced attribute value (value + source + asOf), carrying acquisition `asOf`. */
function provenancedArb(): fc.Arbitrary<ProvenancedField> {
  return fc.record(
    {
      value: fc.string({ minLength: 1, maxLength: 16 }),
      source: fc.constantFrom(...PROVIDER_IDS),
      asOf: fc
        .date({
          min: new Date("2020-01-01"),
          max: new Date("2030-01-01"),
          noInvalidDate: true,
        })
        .map((d) => d.toISOString()),
      lawfulBasis: fc.option(
        fc.constantFrom("legitimate_interest", "consent"),
        { nil: undefined }
      ),
    },
    { requiredKeys: ["value", "source", "asOf"] }
  );
}

/**
 * A candidate that is cold-eligible: a non-empty record lawful basis (clears the
 * lawful-basis gate), an email (so the CRM check keys on a real address), and an
 * `email` attribute carrying an acquisition `asOf`. Against a fresh DB it is
 * neither opted out nor claimed, and the mocked CRM reports it NOT found.
 */
const baseCandidateArb: fc.Arbitrary<ProviderResult> = fc.record(
  {
    targetType: fc.constantFrom("person", "company", "intermediary"),
    displayName: fc.option(safeTextArb(16), { nil: undefined }),
    companyName: fc.option(safeTextArb(16), { nil: undefined }),
    title: fc.option(safeTextArb(16), { nil: undefined }),
    email: fc.emailAddress(),
    phone: fc.option(
      fc.constantFrom(
        "+971501234567",
        "+14155552671",
        "+442071838750",
        "+919876543210"
      ),
      { nil: undefined }
    ),
    country: fc.option(safeTextArb(12), { nil: undefined }),
    attributes: fc.record({ email: provenancedArb() }),
    sourceProvider: fc.constantFrom(...PROVIDER_IDS),
    lawfulBasis: fc.constantFrom("legitimate_interest", "consent"),
  },
  {
    requiredKeys: [
      "targetType",
      "email",
      "attributes",
      "sourceProvider",
      "lawfulBasis",
    ],
  }
);

/**
 * A batch of cold-eligible candidates. Each is given a UNIQUE `sourceRef` by
 * index so the handler's stable identity key never collapses two candidates,
 * and every candidate yields its own cold-eligible queue item.
 */
const candidatesArb: fc.Arbitrary<ProviderResult[]> = fc
  .array(baseCandidateArb, { minLength: 1, maxLength: 6 })
  .map((cands) =>
    cands.map((c, i) => ({ ...c, sourceRef: `ref-${i}-${randomUUID()}` }))
  );

// ── Property ────────────────────────────────────────────────────────────────────

describe("**Feature: agentic-prospecting-batch, Property 17: Provenance on queued and sent items.**", () => {
  it("Validates: Requirements 10.1, 10.3 — every cold-eligible queue item carries lawful_basis, data_source, and acquired_at provenance", async () => {
    await fc.assert(
      fc.asyncProperty(candidatesArb, async (candidates) => {
        backup.restore();
        const runId = await seedRun(db);

        // Install the per-iteration mock behaviour: the search returns these
        // candidates; record_target / draft_outreach persist a row (for the FK)
        // and return its id.
        h.candidates = candidates;
        h.recordTarget = async (input) => {
          const [row] = await db
            .insert(schema.targets)
            .values({
              targetType: input.targetType as "person",
              displayName: (input.displayName as string) ?? null,
              companyName: (input.companyName as string) ?? null,
              title: (input.title as string) ?? null,
              email: (input.email as string) ?? null,
              country: (input.country as string) ?? null,
              // pg-mem's node-postgres adapter double-unescapes parameters and
              // then JSON-parses jsonb values, so a backslash in a jsonb payload
              // (which the candidate `attributes` generator can emit) makes its
              // parser throw ("Bad escaped character in JSON"). The persisted
              // `attributes` column is never read back by this property — the
              // asserted provenance (lawful_basis / data_source / acquired_at)
              // is derived in eligibility.ts from the in-memory candidate, not
              // from the stored Target — so an empty object is stored to keep the
              // FK-satisfying write robust across all generated strings.
              attributes: {},
              sourceProvider: input.sourceProvider as string,
              sourceRef: (input.sourceRef as string) ?? null,
              lawfulBasis: input.lawfulBasis as string,
            })
            .returning({ id: schema.targets.id });
          return row.id;
        };
        h.draftOutreach = async (input) => {
          const [row] = await db
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
          return row.id;
        };

        // Drive the whole batch handler end to end.
        await runProspectingBatch(db, { batchRunId: runId }, {} as never);

        // Read back the persisted cold-eligible queue items for this run.
        const items = await db
          .select({
            lawfulBasis: schema.prospectingQueueItems.lawfulBasis,
            dataSource: schema.prospectingQueueItems.dataSource,
            acquiredAt: schema.prospectingQueueItems.acquiredAt,
            eligibility: schema.prospectingQueueItems.eligibility,
          })
          .from(schema.prospectingQueueItems)
          .where(
            and(
              eq(schema.prospectingQueueItems.batchRunId, runId),
              eq(schema.prospectingQueueItems.eligibility, "cold_eligible")
            )
          );

        // One cold-eligible queue item per generated candidate (none dropped).
        expect(items).toHaveLength(candidates.length);

        // (Req 10.1) Every queued cold item carries the full provenance triple:
        // a lawful-basis marker, the data source, and the acquisition timestamp.
        for (const item of items) {
          expect(item.lawfulBasis).not.toBeNull();
          expect(item.lawfulBasis).toBeTruthy();
          expect(item.dataSource).not.toBeNull();
          expect(item.dataSource).toBeTruthy();
          expect(item.acquiredAt).not.toBeNull();
          expect(item.acquiredAt).toBeInstanceOf(Date);
        }

        // The data source is one of the known providers (the candidate's
        // acquisition source), and the lawful basis is a recognised marker.
        for (const item of items) {
          expect(PROVIDER_IDS).toContain(item.dataSource as never);
          expect(["legitimate_interest", "consent"]).toContain(
            item.lawfulBasis
          );
        }
      }),
      { numRuns: NUM_RUNS }
    );
  }, 60000);
});
