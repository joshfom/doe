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
import { PROVIDER_IDS } from "../../prospecting/providers";
import type { DispatchResult } from "../../ai/tools/dispatch";

/**
 * Property 20 — The pre-run preview is side-effect-free
 * (Requirements 14.2, 14.3, 14.4).
 *
 *   **Feature: agentic-prospecting-batch, Property 20: The pre-run preview is
 *   side-effect-free.**
 *
 * **Validates: Requirements 14.2, 14.3, 14.4**
 *
 * *For any* resolvable subject (cluster ref or ICP filter) and any (edited)
 * Buyer_Hypothesis, a `POST /api/prospecting/preview` call:
 *   - returns AT MOST the configured sample size of read-only, `phoneHash`-only
 *     prospect rows + at most the configured count of example Sample_Messages
 *     (Req 14.2, 14.4);
 *   - writes NO rows to `targets`, `prospecting_queue_items`, or
 *     `outreach_drafts` (Req 14.3, 14.4 — illustrative only, never persisted);
 *   - consumes NO Send_Cap — neither `prospecting_send_counters` nor
 *     `prospecting_send_ledger` gains a row, and the `recordSend` /
 *     `incrementScope` counters are never called (Req 14.3);
 *   - sends NOTHING — no write/send tool (`record_target`, `draft_outreach`,
 *     `approve_outreach`, `send_outreach`) is ever dispatched; the only audited
 *     reads are `find_comparables` and `prospect_search` (Req 14.3, 14.4,
 *     CC-HITL).
 *
 * The decisive seam is the shared `POST /api/prospecting/preview` route
 * (`lib/cms/api/routes/prospecting.ts`, task 12.1). It composes its sample
 * messages via the grounded `generateCompletion` path — NOT the `draft_outreach`
 * catalog tool — precisely so that a preview never persists an `outreach_drafts`
 * row. This property pins that contract: it drives the EXISTING Elysia app
 * in-process via `app.handle(new Request(...))` (mirroring the sibling
 * `prospecting.batches.test.ts` / `prospecting.queue.test.ts` harness) against a
 * REAL in-memory Postgres (pg-mem) carrying the real
 * `drizzle/0040_agentic_prospecting_batch.sql` schema (the same DB-backed
 * pattern the other property tests in this spec use), then asserts the row
 * counts of every write table are still ZERO after the preview.
 *
 * The external seams are mocked (the established fakes, reused — never
 * reinvented):
 *   - `../../db` — a getter returning the LIVE pg-mem Drizzle handle, so any
 *     accidental write the route attempts actually lands in pg-mem and is caught
 *     by the post-preview row-count assertions;
 *   - `../../ai/tools/dispatch` — `find_comparables` / `prospect_search` return
 *     generator-driven comparables / candidates; ANY other tool name is recorded
 *     as a forbidden write/send dispatch (asserted empty);
 *   - `../../ai/gateway` — `generateCompletion` returns a deterministic message
 *     so composition never hits the network (and never persists a draft);
 *   - `../../prospecting/batch/send-cap` — `recordSend` / `incrementScope` are
 *     spies, asserted never called (no Send_Cap consumption);
 *   - `../../prospecting/own-subject` — `resolveComparisonSpec` returns a spec
 *     for cluster subjects without touching the DB;
 *   - `../../rbac/middleware` — an authenticated `leads:read` rep.
 *
 * Tag: Feature: agentic-prospecting-batch, Property 20: The pre-run preview is side-effect-free
 */

// Min 100 iterations (mandatory PBT). PBT_RUNS may raise it, never lower it.
const NUM_RUNS = Math.max(100, Number(process.env.PBT_RUNS ?? 100));
const MIGRATION_FILE = "0040_agentic_prospecting_batch.sql";
const ASOF = "2026-01-15T00:00:00.000Z";

// `candidateToSampleProspect` salt-hashes phones via `computePhoneHash`, which
// requires PHONE_HASH_SALT. A deterministic test salt keeps hashing stable.
process.env.PHONE_HASH_SALT =
  process.env.PHONE_HASH_SALT ?? "preview-side-effect-free-property-test-salt";

// The route's preview surface caps (kept in sync with `prospecting.ts`).
const PREVIEW_SAMPLE_SIZE = 6;
const PREVIEW_MESSAGE_COUNT = 3;

// ── Hoisted holder: shared spies + the live pg-mem db handle ─────────────────

const h = vi.hoisted(() => {
  const fn = vi.fn;
  return {
    // The live pg-mem Drizzle handle, assigned in beforeAll, read by the `db`
    // mock's getter at request time.
    db: null as unknown,
    // Tool names dispatched, in order — asserted to contain ONLY read tools.
    dispatched: [] as string[],
    // The result `find_comparables` / `prospect_search` resolve to (per iter).
    comparables: [] as unknown[],
    candidates: [] as unknown[],
    // Guardrail spies (asserted never called — no Send_Cap consumption).
    recordSend: fn(async () => ({})),
    incrementScope: fn(async () => ({})),
    capExhausted: fn(async () => false),
    // Subject resolver for cluster subjects (no DB read).
    resolveComparisonSpec: fn(async () => ({
      spec: { area: "Dubai", segment: "branded_residence", features: [] },
      coords: null,
      provenance: {},
      gaps: [],
    })),
    // Deterministic message composition — never hits the network, never writes.
    generateCompletion: fn(async () =>
      JSON.stringify({
        subject: "An opportunity in the Bayn community",
        body: "Dear investor,\n\nA short, grounded note.\n\nWarm regards,",
      })
    ),
  };
});

vi.mock("../../db", () => ({
  get db() {
    return h.db as Database;
  },
}));

// RBAC: an authenticated employee rep with leads:read (no deny path needed here
// — Property 20 is about side effects, not authorization).
vi.mock("../../rbac/middleware", () => {
  const { Elysia } = require("elysia");
  return {
    identityGuard: new Elysia({ name: "identityGuard" }).derive(
      { as: "scoped" },
      () => ({ userId: "rep-user-id", userType: "employee", isActive: true })
    ),
    requirePermission: () =>
      new Elysia({ name: "requirePermission:leads:read" }).derive(
        { as: "scoped" },
        () => ({ resolvedPermissions: ["leads:read"] })
      ),
  };
});

// The audited boundary — `find_comparables` / `prospect_search` are the ONLY
// reads a preview performs; ANY other dispatched tool is a forbidden write/send.
vi.mock("../../ai/tools/dispatch", () => ({
  dispatchTool: vi.fn(
    async (
      _db: unknown,
      toolName: string
    ): Promise<DispatchResult> => {
      h.dispatched.push(toolName);
      if (toolName === "find_comparables") {
        return {
          ok: true,
          result: { comparables: h.comparables, unconfigured: false },
        } as DispatchResult;
      }
      if (toolName === "prospect_search") {
        return {
          ok: true,
          result: {
            candidates: h.candidates,
            unconfiguredProviders: [],
            failedProviders: [],
            rateLimitedProviders: [],
          },
        } as DispatchResult;
      }
      // record_target / draft_outreach / approve_outreach / send_outreach etc.
      // A preview must NEVER reach here.
      return { ok: true, result: {} } as DispatchResult;
    }
  ),
}));
vi.mock("../../ai/tools/prospecting-capabilities", () => ({
  PROSPECTING_AGENT_ACTOR: "agent:prospecting",
  PROSPECTING_OUTREACH_AGENT_ACTOR: "agent:outreach",
}));

// Grounded composition gateway — deterministic, offline, never persists.
vi.mock("../../ai/gateway", () => ({
  generateCompletion: h.generateCompletion,
}));

// Send-cap collaborators — spies asserted never called (no Send_Cap consumed).
vi.mock("../../prospecting/batch/send-cap", () => ({
  recordSend: h.recordSend,
  incrementScope: h.incrementScope,
  capExhausted: h.capExhausted,
}));

// Cluster subject resolution — returns a spec without touching the DB.
vi.mock("../../prospecting/own-subject", () => ({
  resolveComparisonSpec: h.resolveComparisonSpec,
}));

// Collaborators the preview route does NOT touch — mocked so imports stay lean.
vi.mock("../../prospecting/optout", () => ({ isOptedOut: vi.fn(async () => false) }));
vi.mock("../../prospecting/batch/claim", () => ({ releaseClaim: vi.fn() }));
vi.mock("../../prospecting/batch/activity", () => ({ readActivity: vi.fn(async () => []) }));
vi.mock("../../prospecting/crm-check", () => ({ checkCrmForContact: vi.fn() }));
vi.mock("../../jobs", () => ({ enqueueJob: vi.fn() }));
vi.mock("../../realtime/events", () => ({ publishEvent: vi.fn() }));
vi.mock("../../realtime/subscribe", () => ({ streamEvents: vi.fn() }));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { Elysia } from "elysia";
import { prospectingRoutes } from "./prospecting";

async function callPreview(
  body: unknown
): Promise<{ status: number; body: any }> {
  const app = new Elysia().use(prospectingRoutes);
  const res = await app.handle(
    new Request("http://localhost/prospecting/preview", {
      method: "POST",
      headers: {
        Cookie: "ora_session=valid",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
  );
  return { status: res.status, body: await res.json() };
}

// ── pg-mem harness (mirrors the spec's other DB-backed property tests) ───────

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
  CREATE TABLE "events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "type" text NOT NULL,
    "payload" jsonb,
    "at" timestamp DEFAULT now() NOT NULL
  );
`;

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

  const migration = readFileSync(
    join(process.cwd(), "drizzle", MIGRATION_FILE),
    "utf-8"
  );
  for (const statement of migration.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) mem.public.none(trimmed);
  }
  // 0041 (sequences) added `sequence_id` to prospecting_batch_runs; this harness
  // applies only 0040, so add the column for schema parity.
  mem.public.none(
    'ALTER TABLE "prospecting_batch_runs" ADD COLUMN "sequence_id" uuid'
  );

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem's node-postgres adapter rejects `types.getTypeParser` and
  // `rowMode: "array"`; strip both, honouring drizzle's positional row mapping.
  const originalQuery = pool.query.bind(pool);
  pool.query = ((config: unknown, values?: unknown, cb?: unknown) => {
    if (config && typeof config === "object" && !Array.isArray(config)) {
      const cfg = config as Record<string, unknown>;
      const wantArray = cfg.rowMode === "array";
      const clean = { ...cfg };
      delete clean.rowMode;
      delete clean.types;
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

let mem!: IMemoryDb;
let dbPool!: { end: () => Promise<void> };
let backup!: { restore: () => void };

beforeAll(() => {
  const built = buildDb();
  mem = built.mem;
  dbPool = built.pool;
  h.db = built.db;
  backup = mem.backup();
});

afterAll(async () => {
  await dbPool?.end?.();
});

/** Count rows in a write table directly via pg-mem (bypasses the route). */
function countRows(table: string): number {
  return Number(
    (mem.public.many(`SELECT count(*) AS c FROM "${table}"`) as Array<{
      c: number | string;
    }>)[0].c
  );
}

// ── Generators ───────────────────────────────────────────────────────────────

/** A SQL-grounded comparable row, shaped as `deriveHypothesis` / grounding read. */
const comparableArb: fc.Arbitrary<unknown> = fc.record({
  marketProjectId: fc.uuid(),
  name: fc.constantFrom("Bayn Tower", "Marina Vista", "Palm Residence"),
  communityName: fc.option(fc.constantFrom("Bayn", "Marina"), { nil: null }),
  segment: fc.option(fc.constantFrom("branded_residence", "waterfront"), {
    nil: null,
  }),
  score: fc.float({ min: 0, max: 1, noNaN: true }),
  stats: fc.record({
    buyerSegmentMix: fc.record({
      value: fc.array(
        fc.record({
          segment: fc.constantFrom("end_user", "investor", "family_office"),
          count: fc.integer({ min: 1, max: 50 }),
          pct: fc.integer({ min: 1, max: 100 }),
        }),
        { minLength: 0, maxLength: 4 }
      ),
      source: fc.constant("market_transactions"),
      asOf: fc.constant(ASOF),
    }),
  }),
});

/** A raw provider candidate (carries a raw phone — must surface as hash only). */
const candidateArb: fc.Arbitrary<unknown> = fc.record(
  {
    targetType: fc.constant("person"),
    displayName: fc.option(fc.string({ minLength: 1, maxLength: 24 }), {
      nil: undefined,
    }),
    companyName: fc.option(fc.string({ minLength: 1, maxLength: 24 }), {
      nil: undefined,
    }),
    title: fc.option(fc.constantFrom("Founder", "MD", "CFO"), {
      nil: undefined,
    }),
    email: fc.option(fc.emailAddress(), { nil: undefined }),
    // Raw phone in plausible E.164 so the route hashes it; sometimes absent.
    phone: fc.option(
      fc
        .integer({ min: 500000000, max: 599999999 })
        .map((n) => `+9715${n}`),
      { nil: undefined }
    ),
    country: fc.option(fc.constantFrom("AE", "IN", "GB"), { nil: undefined }),
    sourceProvider: fc.constantFrom(...PROVIDER_IDS),
    lawfulBasis: fc.constant("legitimate_interest"),
  },
  { requiredKeys: ["targetType", "sourceProvider", "lawfulBasis"] }
);

/** An (edited) Buyer_Hypothesis the rep might re-preview with (Req 14.5). */
const hypothesisArb: fc.Arbitrary<unknown> = fc.record({
  segments: fc.array(fc.constantFrom("investor", "end_user", "family_office"), {
    maxLength: 4,
  }),
  feederMarkets: fc.array(fc.constantFrom("India", "UK", "KSA"), {
    maxLength: 3,
  }),
  titles: fc.array(fc.constantFrom("Founder", "Investor", "MD"), {
    maxLength: 3,
  }),
  wealthSignals: fc.array(fc.constantFrom("liquidity event", "high net worth"), {
    maxLength: 2,
  }),
  evidence: fc.constant([]),
  confidence: fc.constantFrom("low", "medium", "high"),
});

/** A random resolvable subject: an ICP filter or a cluster reference. */
const subjectArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.record({
    kind: fc.constant("icp"),
    icpFilter: fc.record(
      {
        targetType: fc.constant("person"),
        titles: fc.array(fc.constantFrom("Founder", "Investor", "MD"), {
          maxLength: 3,
        }),
        geography: fc.array(fc.constantFrom("India", "UK", "KSA"), {
          maxLength: 3,
        }),
        keywords: fc.array(fc.constantFrom("investor", "waterfront"), {
          maxLength: 2,
        }),
      },
      { requiredKeys: ["targetType"] }
    ),
  }),
  fc.record({ kind: fc.constant("cluster"), clusterId: fc.uuid() })
);

const WRITE_OR_SEND_TOOLS = [
  "record_target",
  "draft_outreach",
  "approve_outreach",
  "send_outreach",
  "enrich_target",
  "promote_target_to_lead",
];

describe("**Feature: agentic-prospecting-batch, Property 20: The pre-run preview is side-effect-free.**", () => {
  beforeEach(() => {
    h.recordSend.mockClear();
    h.incrementScope.mockClear();
    h.capExhausted.mockClear();
  });

  it("Validates: Requirements 14.2, 14.3, 14.4 — a preview returns at most the sample size of read-only prospect rows + example drafts and writes no targets / queue items / outreach_drafts rows, consumes no Send_Cap, and sends nothing", async () => {
    await fc.assert(
      fc.asyncProperty(
        subjectArb,
        fc.array(comparableArb, { maxLength: 8 }),
        fc.array(candidateArb, { maxLength: 12 }),
        fc.option(hypothesisArb, { nil: undefined }),
        async (subject, comparables, candidates, buyerHypothesis) => {
          backup.restore();
          h.dispatched = [];
          h.comparables = comparables;
          h.candidates = candidates;

          const { status, body } = await callPreview({
            subject,
            ...(buyerHypothesis ? { buyerHypothesis } : {}),
          });

          // The preview resolves successfully (never a write/error dead-end).
          expect(status).toBe(200);

          // ── Bounded, read-only outputs (Req 14.2, 14.4) ──────────────────
          expect(Array.isArray(body.sampleProspects)).toBe(true);
          expect(body.sampleProspects.length).toBeLessThanOrEqual(
            PREVIEW_SAMPLE_SIZE
          );
          expect(Array.isArray(body.sampleMessages)).toBe(true);
          expect(body.sampleMessages.length).toBeLessThanOrEqual(
            PREVIEW_MESSAGE_COUNT
          );
          // Every sampled prospect is phoneHash-only — no raw phone field leaks
          // out of the read-only sample (CC-Privacy, read-only sample).
          for (const sp of body.sampleProspects) {
            expect(sp).not.toHaveProperty("phone");
            expect(Object.prototype.hasOwnProperty.call(sp, "phoneHash")).toBe(
              true
            );
          }

          // ── Writes NOTHING (Req 14.3, 14.4) ──────────────────────────────
          expect(countRows("targets")).toBe(0);
          expect(countRows("prospecting_queue_items")).toBe(0);
          expect(countRows("outreach_drafts")).toBe(0);

          // ── Consumes NO Send_Cap (Req 14.3) ──────────────────────────────
          expect(countRows("prospecting_send_counters")).toBe(0);
          expect(countRows("prospecting_send_ledger")).toBe(0);
          expect(h.recordSend).not.toHaveBeenCalled();
          expect(h.incrementScope).not.toHaveBeenCalled();

          // ── Sends NOTHING; only read tools dispatched (Req 14.3, 14.4) ───
          for (const tool of WRITE_OR_SEND_TOOLS) {
            expect(h.dispatched).not.toContain(tool);
          }
          // The only audited dispatches a preview performs are the reads.
          for (const tool of h.dispatched) {
            expect(["find_comparables", "prospect_search"]).toContain(tool);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  }, 120000);
});
