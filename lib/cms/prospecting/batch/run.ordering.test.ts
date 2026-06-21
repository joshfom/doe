import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

import type { Database } from "../../db";
import * as schema from "../../schema";
import { PROVIDER_IDS, type ProviderResult } from "../providers";
import type { DispatchResult } from "../../ai/tools/dispatch";

/**
 * Unit test — Ordering: CRM_Check runs before any cold draft (task 6.7).
 *
 * **Validates: Requirements 2.2** — "WHEN a candidate prospect is discovered,
 * THE Batch_Run SHALL run the CRM_Check (`lib/cms/prospecting/crm-check.ts`) on
 * the candidate BEFORE drafting any outreach."
 *
 * The batch handler `runProspectingBatch` (`lib/cms/prospecting/batch/run.ts`)
 * routes every candidate through `evaluateCandidate`
 * (`lib/cms/prospecting/batch/eligibility.ts`) — whose gate 4 calls
 * `checkCrmForContact` — BEFORE the cold-eligible branch dispatches
 * `draft_outreach`. This test pins that ordering by spying on both seams and
 * recording the call order into a single shared array, then asserting `crm`
 * appears before the first `dispatch:draft_outreach`.
 *
 * A second example pins the all-providers-unconfigured degradation: when
 * `prospect_search` returns zero candidates with only unconfigured/failed
 * markers, the run completes with reason `unconfigured_providers`, produces zero
 * queue items, and `dispatch:draft_outreach` never appears in the order array.
 *
 * The two external seams are mocked (the dispatcher and the CRM check) so the
 * candidate is deterministically cold-eligible and the ordering is observable
 * without a live provider / DB-write tool; every OTHER gate (opt-out,
 * lawful-basis, cross-rep claim, send-cap) runs for real against the migrated
 * `drizzle/0040_agentic_prospecting_batch.sql` schema in pg-mem. The harness
 * mirrors the sibling `run.degrade.property.test.ts`.
 */

// ── A single shared order array both spies push into ───────────────────────────
const h = vi.hoisted(() => ({ order: [] as string[] }));

// ── Mock the audited dispatcher: record every dispatch into the order array ────
vi.mock("../../ai/tools/dispatch", () => ({
  dispatchTool: vi.fn(),
}));
import { dispatchTool } from "../../ai/tools/dispatch";
const mockedDispatch = vi.mocked(dispatchTool);

// ── Mock the CRM existence check: record `crm` into the order array ────────────
vi.mock("../crm-check", () => ({
  checkCrmForContact: vi.fn(),
}));
import { checkCrmForContact, type CrmCheckResult } from "../crm-check";
const mockedCrm = vi.mocked(checkCrmForContact);

import { runProspectingBatch } from "./run";

const MIGRATION_FILE = "0040_agentic_prospecting_batch.sql";
const ASOF = "2026-01-15T00:00:00.000Z";

// `claimTarget` / `isOptedOut` salt-hash phones via `computePhoneHash`, which
// requires PHONE_HASH_SALT. A deterministic test salt keeps hashing stable.
process.env.PHONE_HASH_SALT =
  process.env.PHONE_HASH_SALT ?? "run-ordering-test-salt";

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
function buildDb(): { mem: IMemoryDb; db: Database } {
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

  const sqlText = readFileSync(
    join(process.cwd(), "drizzle", MIGRATION_FILE),
    "utf-8"
  );
  for (const statement of sqlText.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) {
      mem.public.none(trimmed);
    }
  }

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem's node-postgres adapter rejects `types.getTypeParser` and
  // `rowMode: "array"`; strip both, honouring drizzle's positional row mapping
  // by converting rows to arrays when `rowMode: "array"` was requested. It ALSO
  // deviates from real Postgres on `INSERT … ON CONFLICT DO NOTHING …
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
  return { mem, db };
}

/**
 * Seed a `prospecting_batch_runs` row (and its owner) with an ICP subject that
 * already carries an `icpFilter`, so `resolveSubjectToFilter` returns a filter
 * without any cluster resolution. Returns the run id.
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

/** A single cold-eligible candidate with a stable identity. */
function makeColdCandidate(): ProviderResult {
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
        source: PROVIDER_IDS[0],
        asOf: ASOF,
        lawfulBasis: "legitimate_interest",
      },
    },
    sourceProvider: PROVIDER_IDS[0],
    sourceRef: `${PROVIDER_IDS[0]}-${u}`,
    lawfulBasis: "legitimate_interest",
  };
}

/** SF configured + the check ran + found nobody → the candidate is cold. */
function notFoundCrm(email: string | null): CrmCheckResult {
  return { configured: true, found: false, matches: [], checkedEmail: email };
}

/**
 * The dispatcher mock: records each tool call into the shared order array as
 * `dispatch:<toolName>`, fulfilling the Target / draft writes for a present
 * candidate. `search` is the `prospect_search` result for this run.
 */
function installDispatch(
  db: Database,
  search: {
    candidates: ProviderResult[];
    unconfiguredProviders: string[];
    failedProviders: string[];
  }
): void {
  mockedDispatch.mockImplementation(
    async (
      _db: Database,
      toolName: string,
      input: unknown
    ): Promise<DispatchResult> => {
      h.order.push(`dispatch:${toolName}`);
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
}

describe("Feature: agentic-prospecting-batch — batch run ordering (CRM before draft)", () => {
  beforeEach(() => {
    h.order = [];
    mockedDispatch.mockReset();
    mockedCrm.mockReset();
  });

  it("runs the CRM_Check before dispatching draft_outreach for a cold-eligible candidate (Req 2.2)", async () => {
    const { mem, db } = buildDb();
    const runId = seedRun(mem, 100);
    const candidate = makeColdCandidate();

    // The CRM check records `crm` into the shared order array and reports the
    // candidate not found (so it stays cold-eligible).
    mockedCrm.mockImplementation(async (input: { email?: string | null }) => {
      h.order.push("crm");
      return notFoundCrm(input.email ?? null);
    });

    installDispatch(db, {
      candidates: [candidate],
      unconfiguredProviders: [],
      failedProviders: [],
    });

    await runProspectingBatch(db, { batchRunId: runId }, {} as never);

    // The candidate was both CRM-checked and cold-drafted.
    expect(h.order).toContain("crm");
    expect(h.order).toContain("dispatch:draft_outreach");

    // (Req 2.2) The CRM_Check must run BEFORE the first cold draft dispatch.
    const crmIndex = h.order.indexOf("crm");
    const draftIndex = h.order.indexOf("dispatch:draft_outreach");
    expect(crmIndex).toBeLessThan(draftIndex);

    // And no draft is ever dispatched before the CRM check (defensive: the
    // FIRST draft dispatch is preceded by a crm entry).
    const firstDraft = h.order.indexOf("dispatch:draft_outreach");
    expect(h.order.slice(0, firstDraft)).toContain("crm");

    // One cold-eligible queue item was produced for the candidate.
    const items = await db
      .select()
      .from(schema.prospectingQueueItems)
      .where(eq(schema.prospectingQueueItems.batchRunId, runId));
    expect(items.filter((q) => q.eligibility === "cold_eligible")).toHaveLength(
      1
    );
  }, 60000);

  it("never dispatches draft_outreach when all providers are unconfigured (Req 2.2, 11.2)", async () => {
    const { mem, db } = buildDb();
    const runId = seedRun(mem, 100);

    // The CRM check would record `crm` if it were ever reached — it should not
    // be, because discovery degrades before any candidate is evaluated.
    mockedCrm.mockImplementation(async (input: { email?: string | null }) => {
      h.order.push("crm");
      return notFoundCrm(input.email ?? null);
    });

    // prospect_search returns zero candidates with only unconfigured/failed
    // markers (every configured provider unavailable).
    installDispatch(db, {
      candidates: [],
      unconfiguredProviders: [...PROVIDER_IDS],
      failedProviders: [],
    });

    await runProspectingBatch(db, { batchRunId: runId }, {} as never);

    // The run completed with the all-providers-unconfigured degradation reason.
    const [run] = await db
      .select()
      .from(schema.prospectingBatchRuns)
      .where(eq(schema.prospectingBatchRuns.id, runId))
      .limit(1);
    expect(run.status).toBe("completed");
    expect(run.reason).toBe("unconfigured_providers");

    // Zero queue items and NO draft was ever dispatched.
    const items = await db
      .select()
      .from(schema.prospectingQueueItems)
      .where(eq(schema.prospectingQueueItems.batchRunId, runId));
    expect(items).toHaveLength(0);
    expect(h.order).not.toContain("dispatch:draft_outreach");

    // The only dispatch was the discovery search itself.
    expect(h.order).toEqual(["dispatch:prospect_search"]);
  }, 60000);
});
