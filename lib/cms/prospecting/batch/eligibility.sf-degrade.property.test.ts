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
import { evaluateCandidate, type EligibilityRun } from "./eligibility";

// ── CRM_Check is mocked so we drive the degradation modes deterministically ──
// `evaluateCandidate` calls `checkCrmForContact` (gate 4); we replace it with a
// vi.fn so each generated case can return an UNCONFIGURED (`configured:false`)
// or a TRANSIENT (`configured:true` + `note`) result without standing up
// Salesforce. The eligibility module imports it from "../crm-check"; this mock
// is hoisted to replace that module before the module under test loads it.
vi.mock("../crm-check", () => ({
  checkCrmForContact: vi.fn(),
}));
import { checkCrmForContact, type CrmCheckResult } from "../crm-check";
const mockedCheck = vi.mocked(checkCrmForContact);

/**
 * Property 19 — Salesforce degradation (Requirements 11.3, 11.4, 11.5).
 *
 * Gate 4 of the eligibility pipeline (`evaluateCandidate`,
 * `lib/cms/prospecting/batch/eligibility.ts`) interprets the CRM existence
 * pre-check by its DEGRADATION semantics. This property pins the behaviour when
 * Salesforce cannot give an authoritative answer — it is UNCONFIGURED
 * (`configured:false`, credentials absent) or TRANSIENTLY unavailable
 * (`configured:true` + a `note`, e.g. a network error / API limit):
 *
 *   (a) **SF unconfigured + NO local match → `cold_eligible`** (Req 11.3): the
 *       candidate is CRM-unverified and is NOT warm-routed on the unrun check.
 *
 *   (b) **SF unconfigured + LOCAL party / leads_mirror match → `warm_path` via
 *       `local_party`** (Req 11.5): an unconfigured Salesforce does NOT by itself
 *       block warm-path routing; an existing local match is independent grounds
 *       and still warm-routes (and never via `crm`).
 *
 *   (c) **SF transient + NO local match → `cold_eligible`** (Req 11.4): a
 *       transient failure is treated as CRM-unverified for this pass, NOT as
 *       unconfigured — the candidate is not warm-routed on the unrun check, and
 *       the (configured) check was actually attempted.
 *
 *   (d) **SF transient + LOCAL match → `warm_path` via `local_party`**: the same
 *       local fallback applies under a transient failure.
 *
 * In every generated case the candidate is otherwise clear: NOT opted out, has a
 * lawful basis, NOT claimed by another rep, and within send-cap budget — so the
 * ONLY decisive factor is the SF-degradation handling under test.
 *
 * Req 11.6 (an unconfigured-SF send enqueues to the SF_Outbox rather than
 * failing) is exercised at the send / route layer (task 8.x), not at this
 * eligibility unit; it is covered by the route-level tests and is intentionally
 * out of scope for this pure-decision property.
 *
 * The properties run against a REAL Drizzle handle over an in-memory Postgres
 * (pg-mem) with the real `drizzle/0040_agentic_prospecting_batch.sql` applied
 * (so the claim + send-counter reads execute genuine SQL), plus minimal stubs
 * for the pre-existing tables the eligibility gates read (`parties`,
 * `party_identities`, `leads_mirror`, `prospect_optouts`). The harness mirrors
 * the sibling `send-cap.exactly-once.property.test.ts` (statement-breakpoint
 * splitter + `gen_random_uuid()` registration + node-postgres adapter wiring).
 *
 * Tag: Feature: agentic-prospecting-batch, Property 19: Salesforce degradation
 */

const NUM_RUNS = Number(process.env.PBT_RUNS ?? 25);
const MIGRATION_FILE = "0040_agentic_prospecting_batch.sql";
const ASOF = "2026-01-15T00:00:00.000Z";

// PHONE_HASH_SALT is required by the claim / opt-out / dedupe identity helpers
// (`computePhoneHash`); set a fixed test salt so phone hashing is deterministic.
process.env.PHONE_HASH_SALT = process.env.PHONE_HASH_SALT ?? "sf-degrade-test-salt";

// Minimal stubs for the tables 0040 references (FKs) + the pre-existing party /
// opt-out tables the eligibility gates read. `parties` / `party_identities` /
// `leads_mirror` back `resolveLeadByMatchKeys` (the local-match warm route);
// `prospect_optouts` backs `isOptedOut` (gate 1).
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
  CREATE TABLE "parties" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "type" text NOT NULL DEFAULT 'person',
    "name" text,
    "language" text DEFAULT 'en',
    "demo" boolean NOT NULL DEFAULT false,
    "created_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "party_identities" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "party_id" uuid NOT NULL REFERENCES "parties"("id") ON DELETE CASCADE,
    "kind" text NOT NULL,
    "value" text NOT NULL,
    "verified_at" timestamp
  );
  CREATE INDEX "party_identities_value_idx" ON "party_identities" ("kind", "value");
  CREATE TABLE "leads_mirror" (
    "party_id" uuid PRIMARY KEY REFERENCES "parties"("id") ON DELETE CASCADE,
    "sf_lead_id" text,
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
`;

/** Stand up a fresh pg-mem with the prerequisites + 0040 applied + Drizzle. */
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
  // rows, but pg-mem returns the EXISTING row. `claimTarget` keys "fresh claim"
  // off a non-empty RETURNING, so restore faithful semantics: if no row was
  // actually inserted, strip the erroneously-returned row.
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
 * Seed an existing LOCAL party whose `email` identity matches the candidate, so
 * `resolveLeadByMatchKeys` resolves a `match` (the independent warm-route
 * grounds of Req 11.5). Email is normalized (lower-cased + trimmed) exactly as
 * the dedupe lookup normalizes it before matching.
 */
function seedLocalMatch(mem: IMemoryDb, email: string): void {
  const partyId = randomUUID();
  const normalized = email.trim().toLowerCase();
  mem.public.none(`INSERT INTO parties (id) VALUES ('${partyId}')`);
  mem.public.none(
    `INSERT INTO party_identities (party_id, kind, value) VALUES ('${partyId}', 'email', '${normalized}')`
  );
  mem.public.none(
    `INSERT INTO leads_mirror (party_id, sf_lead_id) VALUES ('${partyId}', 'SF-${partyId.slice(0, 8)}')`
  );
}

// ── CRM degradation result builders ──────────────────────────────────────────

/** SF unconfigured: credentials absent — the check could not run (Req 11.3). */
function unconfiguredCrm(email: string): CrmCheckResult {
  return {
    configured: false,
    found: false,
    matches: [],
    checkedEmail: email,
    note: "Salesforce is not configured — proceeding without a CRM check.",
  };
}

/**
 * SF configured but transiently unavailable: the (configured) check was
 * attempted and could not complete — a `note` is set while `configured:true`
 * (Req 11.4). This must be treated as transient/CRM-unverified, NOT unconfigured.
 */
function transientCrm(email: string): CrmCheckResult {
  return {
    configured: true,
    found: false,
    matches: [],
    checkedEmail: email,
    note: "CRM check could not complete: ECONNRESET",
  };
}

// ── Generators ───────────────────────────────────────────────────────────────

// Valid email (passes the dedupe `isEmail` check): a uuid local part (lowercase,
// no spaces/`@`) + a dotted domain. Already lower-case, so it matches the
// normalized form the dedupe/opt-out stores key on.
const emailArb = fc
  .tuple(
    fc.uuid(),
    fc.constantFrom("example.com", "mail.co", "corp.io", "fund.ae")
  )
  .map(([local, domain]) => `${local}@${domain}`);

// Optional, always-normalizable UAE-style phone ("0" + 9 national digits →
// +9715…). `undefined` exercises the email-only identity path.
const phoneArb = fc.option(
  fc.integer({ min: 500000000, max: 599999999 }).map((n) => `0${n}`),
  { nil: undefined }
);

// A non-empty lawful basis so gate 2 (lawful-basis present?) always passes.
const lawfulBasisArb = fc.constantFrom(
  "legitimate_interest",
  "consent",
  "contract"
);

interface CandidateSpec {
  email: string;
  phone?: string;
  lawfulBasis: string;
}

const candidateSpecArb: fc.Arbitrary<CandidateSpec> = fc.record({
  email: emailArb,
  phone: phoneArb,
  lawfulBasis: lawfulBasisArb,
});

/** Build a discovered candidate (`ProviderResult`) from a generated spec. */
function makeCandidate(spec: CandidateSpec): ProviderResult {
  return {
    targetType: "person",
    displayName: "Generated Candidate",
    companyName: "Acme Family Office",
    title: "Managing Partner",
    email: spec.email,
    phone: spec.phone,
    country: "AE",
    attributes: {
      email: {
        value: spec.email,
        source: "apollo",
        asOf: ASOF,
        lawfulBasis: spec.lawfulBasis,
      },
    },
    sourceProvider: "apollo",
    sourceRef: "apollo-ref-1",
    lawfulBasis: spec.lawfulBasis,
  };
}

/** A clear run context: pure-rep scope, no cluster, no configured cap. The
 *  owner rep is seeded into `users` so the cross-rep claim's `owner_rep` FK
 *  resolves. */
function makeRun(mem: IMemoryDb): EligibilityRun {
  const ownerRep = randomUUID();
  const id = randomUUID();
  mem.public.none(`INSERT INTO users (id) VALUES ('${ownerRep}')`);
  // The claim row's `batch_run_id` FK references this run.
  mem.public.none(
    `INSERT INTO prospecting_batch_runs (id, owner_rep, subject, target_count, rerun_key) ` +
      `VALUES ('${id}', '${ownerRep}', '{}'::jsonb, 10, '${id}')`
  );
  return {
    id,
    ownerRep,
    clusterId: null,
    periodBucket: "2026-01-15",
    repCap: null,
    clusterCap: null,
  };
}

describe("Feature: agentic-prospecting-batch, Property 19: Salesforce degradation", () => {
  beforeEach(() => {
    mockedCheck.mockReset();
  });

  it("(a) SF unconfigured + NO local match → cold_eligible (CRM-unverified, not warm-routed on the unrun check) — Req 11.3", async () => {
    await fc.assert(
      fc.asyncProperty(candidateSpecArb, async (spec) => {
        backup.restore(); // no local match seeded
        const candidate = makeCandidate(spec);
        mockedCheck.mockClear();
        mockedCheck.mockResolvedValueOnce(unconfiguredCrm(spec.email));

        const decision = await evaluateCandidate(db, makeRun(mem), candidate);

        // CRM-unverified but NOT warm-routed on the unrun check → cold-eligible.
        expect(decision.kind).toBe("cold_eligible");
        if (decision.kind === "cold_eligible") {
          expect(decision.lawfulBasis).toBe(spec.lawfulBasis);
          expect(decision.dataSource).toBe("apollo");
        }
        // The check was consulted by email (the gate ran).
        expect(mockedCheck).toHaveBeenCalledTimes(1);
        expect(mockedCheck).toHaveBeenCalledWith({ email: spec.email });
      }),
      { numRuns: NUM_RUNS }
    );
  }, 60000);

  it("(b) SF unconfigured + LOCAL party match → warm_path via local_party (local match still warm-routes) — Req 11.5", async () => {
    await fc.assert(
      fc.asyncProperty(candidateSpecArb, async (spec) => {
        backup.restore();
        seedLocalMatch(mem, spec.email);
        const candidate = makeCandidate(spec);
        mockedCheck.mockResolvedValueOnce(unconfiguredCrm(spec.email));

        const decision = await evaluateCandidate(db, makeRun(mem), candidate);

        // A local party / leads_mirror match is independent grounds for a warm
        // route even with SF unconfigured — and never via the unrun CRM check.
        expect(decision.kind).toBe("warm_path");
        if (decision.kind === "warm_path") {
          expect(decision.via).toBe("local_party");
        }
      }),
      { numRuns: NUM_RUNS }
    );
  }, 60000);

  it("(c) SF transient (configured:true + note) + NO local match → cold_eligible (treated as transient, not unconfigured; not warm-routed) — Req 11.4", async () => {
    await fc.assert(
      fc.asyncProperty(candidateSpecArb, async (spec) => {
        backup.restore(); // no local match seeded
        const candidate = makeCandidate(spec);
        const crm = transientCrm(spec.email);
        mockedCheck.mockClear();
        mockedCheck.mockResolvedValueOnce(crm);

        const decision = await evaluateCandidate(db, makeRun(mem), candidate);

        // A transient failure is CRM-unverified for this pass — the candidate is
        // not warm-routed on the unrun check, exactly like the unconfigured case.
        expect(decision.kind).toBe("cold_eligible");
        // The transient result is distinctly CONFIGURED (a note while the
        // credentials are present) — it is NOT the unconfigured signal.
        expect(crm.configured).toBe(true);
        expect(crm.note).toBeDefined();
        expect(mockedCheck).toHaveBeenCalledTimes(1);
        expect(mockedCheck).toHaveBeenCalledWith({ email: spec.email });
      }),
      { numRuns: NUM_RUNS }
    );
  }, 60000);

  it("(d) SF transient + LOCAL match → warm_path via local_party (local fallback applies under a transient failure) — Req 11.5", async () => {
    await fc.assert(
      fc.asyncProperty(candidateSpecArb, async (spec) => {
        backup.restore();
        seedLocalMatch(mem, spec.email);
        const candidate = makeCandidate(spec);
        mockedCheck.mockResolvedValueOnce(transientCrm(spec.email));

        const decision = await evaluateCandidate(db, makeRun(mem), candidate);

        expect(decision.kind).toBe("warm_path");
        if (decision.kind === "warm_path") {
          expect(decision.via).toBe("local_party");
        }
      }),
      { numRuns: NUM_RUNS }
    );
  }, 60000);
});
