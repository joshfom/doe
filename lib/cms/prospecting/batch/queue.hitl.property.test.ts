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

// ── The dispatcher is the single seam EVERY prospecting effect crosses
//    (CC-Audit, CC-HITL). This hoisted mock replaces it before run.ts loads,
//    so the test OBSERVES every tool the autonomous loop dispatches and feeds
//    the discovered pool / Target / draft writes. The spy's recorded tool names
//    are the evidence for this property: a send would show up as a
//    `send_outreach` / `approve_outreach` dispatch — and it never does.
vi.mock("../../ai/tools/dispatch", () => ({
  dispatchTool: vi.fn(),
}));
import { dispatchTool } from "../../ai/tools/dispatch";
const mockedDispatch = vi.mocked(dispatchTool);

// ── CRM_Check is mocked CONFIGURED (the check actually ran). Per generated
//    candidate it reports found / not-found, so the pool exercises BOTH the
//    cold-eligible branch (drafts) and the warm-path branch (no draft) — and
//    NEITHER branch may ever send.
vi.mock("../crm-check", () => ({
  checkCrmForContact: vi.fn(),
}));
import { checkCrmForContact, type CrmCheckResult } from "../crm-check";
const mockedCrm = vi.mocked(checkCrmForContact);

import { runProspectingBatch } from "./run";

/**
 * Property 14 — No send without human approval
 * (Requirements 8.1, 13.3).
 *
 *   **Feature: agentic-prospecting-batch, Property 14: No send without human
 *   approval.**
 *
 * **Validates: Requirements 8.1, 13.3**
 *
 * The autonomous Batch_Run produces *drafts only*. No Batch_Run code path sends
 * outreach automatically (Req 8.1, CC-HITL) and the feature implements no
 * auto-send path that bypasses human approval (Req 13.3, CC-HITL). A send
 * happens only later, on the human-driven approval route, dispatched under the
 * approving rep's identity through the `approve_outreach` / `send_outreach`
 * pair — never inside `runProspectingBatch`.
 *
 * This property drives the WHOLE handler end to end against a real Drizzle handle
 * over an in-memory Postgres (pg-mem) carrying the real
 * `drizzle/0040_agentic_prospecting_batch.sql` schema, over a random candidate
 * pool (a mix of cold-eligible and CRM-known warm-path candidates) and a random
 * target count N, and pins on every run:
 *
 *   (a) **No auto-send** — across the ENTIRE batch execution the dispatcher is
 *       NEVER called with `send_outreach` or `approve_outreach`. The only tools
 *       the loop ever dispatches are `prospect_search`, `record_target`, and
 *       `draft_outreach`.
 *   (b) **Drafts only** — whenever the pool contains at least one cold-eligible
 *       candidate (and N > 0), the loop DOES dispatch `draft_outreach` (it
 *       produced unsent drafts), confirming the loop reached the point where a
 *       naive implementation might have sent — and still did not.
 *   (c) **Nothing left the building** — no Queued_Item is ever persisted in a
 *       `sent` status by the autonomous run; the most advanced state a
 *       cold-eligible item reaches is `pending` (awaiting human approval).
 *
 * The dispatcher is mocked as an in-memory ChannelAdapter stand-in: it fulfils
 * the search / Target / draft tools and would record any `send_outreach` /
 * `approve_outreach` call if one ever occurred. No Approval_Flow token is ever
 * minted because the autonomous loop never attempts a send.
 */

const NUM_RUNS = Number(process.env.PBT_RUNS ?? 25);
const MIGRATION_FILE = "0040_agentic_prospecting_batch.sql";
const ASOF = "2026-01-15T00:00:00.000Z";

// The tool names that legitimately appear on the autonomous batch path. A send
// would manifest as a tool name OUTSIDE this set (the two named below).
const ALLOWED_TOOLS = new Set(["prospect_search", "record_target", "draft_outreach"]);
const SEND_TOOLS = new Set(["send_outreach", "approve_outreach"]);

process.env.PHONE_HASH_SALT =
  process.env.PHONE_HASH_SALT ?? "queue-hitl-property-test-salt";

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
  // The sequences feature (migration 0041) added `sequence_id` to
  // prospecting_batch_runs; this harness applies only 0040, so add the column
  // so `loadBatchRun`'s SELECT resolves.
  mem.public.none(
    'ALTER TABLE "prospecting_batch_runs" ADD COLUMN "sequence_id" uuid'
  );

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
 * Seed a `prospecting_batch_runs` row (+ owner) with an ICP subject that already
 * carries an `icpFilter`, so `resolveSubjectToFilter` returns a filter without
 * cluster resolution. Returns the run id.
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

/** SF configured + the check ran; `found` decides cold-eligible vs warm-path. */
function crmResult(email: string | null, found: boolean): CrmCheckResult {
  return {
    configured: true,
    found,
    matches: found
      ? [
          {
            object: "Lead",
            id: randomUUID(),
            name: null,
            email,
            status: "Open",
            company: null,
            owner: null,
            lastActivity: null,
            isConverted: false,
          },
        ]
      : [],
    checkedEmail: email,
  };
}

/** A candidate spec: a unique provider identity + whether the CRM knows it. */
interface CandidateSpec {
  candidate: ProviderResult;
  found: boolean;
}

/** Build a candidate with a UNIQUE identity (`sourceRef` + email) per index. */
function makeCandidate(idx: number, found: boolean): CandidateSpec {
  const u = randomUUID();
  const email = `${u}@example.com`;
  return {
    found,
    candidate: {
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
      sourceRef: `ref-${idx}-${u}`,
      lawfulBasis: "legitimate_interest",
    },
  };
}

// ── Generators ───────────────────────────────────────────────────────────────

// A random pool (0..20) of candidates, each independently cold (found:false) or
// CRM-known warm-path (found:true) — exercising BOTH non-send branches.
const poolArb: fc.Arbitrary<CandidateSpec[]> = fc
  .array(fc.boolean(), { minLength: 0, maxLength: 20 })
  .map((flags) => flags.map((found, i) => makeCandidate(i, found)));

// A random target count N (1..15).
const targetCountArb = fc.integer({ min: 1, max: 15 });

describe("Feature: agentic-prospecting-batch, Property 14: No send without human approval", () => {
  beforeEach(() => {
    mockedDispatch.mockReset();
    mockedCrm.mockReset();
  });

  it("never dispatches a send/approve tool on any batch path, produces drafts only, and persists no sent item (Req 8.1, 13.3)", async () => {
    await fc.assert(
      fc.asyncProperty(poolArb, targetCountArb, async (specs, targetCount) => {
        backup.restore();
        const runId = seedRun(mem, targetCount);

        const pool = specs.map((s) => s.candidate);
        const foundByEmail = new Map<string, boolean>(
          specs.map((s) => [s.candidate.email as string, s.found])
        );
        const hasCold = specs.some((s) => !s.found);

        // CRM ran for real per candidate; cold candidates are not found.
        mockedCrm.mockImplementation(async (input: { email?: string | null }) => {
          const email = input.email ?? null;
          const found = email ? (foundByEmail.get(email) ?? false) : false;
          return crmResult(email, found);
        });

        // Every dispatched tool name is recorded here — the property's evidence.
        const dispatched: string[] = [];

        mockedDispatch.mockImplementation(
          async (
            _db: Database,
            toolName: string,
            input: unknown
          ): Promise<DispatchResult> => {
            dispatched.push(toolName);

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

            // Any OTHER tool (notably a send) is fulfilled so the loop would not
            // crash — but its mere appearance in `dispatched` fails the property.
            return { ok: true, result: {} };
          }
        );

        await expect(
          runProspectingBatch(db, { batchRunId: runId }, {} as never)
        ).resolves.toBeUndefined();

        // (a) No auto-send: the dispatcher was never asked to send / approve, and
        // every dispatched tool is on the allowed autonomous-loop set.
        for (const tool of dispatched) {
          expect(SEND_TOOLS.has(tool)).toBe(false);
          expect(ALLOWED_TOOLS.has(tool)).toBe(true);
        }
        expect(dispatched.some((t) => SEND_TOOLS.has(t))).toBe(false);

        // (b) Drafts only: when a cold-eligible candidate exists (and N > 0), the
        // loop reached drafting — the point a naive impl might send — and only
        // drafted.
        if (hasCold && targetCount > 0) {
          expect(dispatched).toContain("draft_outreach");
        }

        // (c) Nothing left the building: no Queued_Item is ever `sent` by the
        // autonomous run; the furthest a cold item advances is `pending`.
        const queueItems = await db
          .select()
          .from(schema.prospectingQueueItems)
          .where(eq(schema.prospectingQueueItems.batchRunId, runId));
        expect(queueItems.some((q) => q.status === "sent")).toBe(false);

        // And no draft is persisted in a `sent` status either.
        const drafts = await db.select().from(schema.outreachDrafts);
        expect(drafts.some((d) => d.status === "sent")).toBe(false);
        expect(drafts.every((d) => d.sentAt === null)).toBe(true);
      }),
      { numRuns: NUM_RUNS }
    );
  }, 60000);
});
