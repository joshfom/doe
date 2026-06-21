// `computePhoneHash` (reached by promote_target_to_lead's match-key building and
// by the conflict-seeding below) reads PHONE_HASH_SALT from the environment; set
// a stable test salt so hashing is deterministic across the suite.
process.env.PHONE_HASH_SALT ??= "prospecting-dedupe-separation-test-salt";

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import fc from "fast-check";

/**
 * Property test for Target↔Lead separation + dedupe-driven promotion (task 7.2 —
 * a non-optional dedupe/separation boundary test).
 *
 *   **Feature: prospecting-workspace, Property 4: A Target is never a tickets row; promote_target_to_lead attaches on match, creates the parties+leads_mirror pairing on new, and creates nothing on conflict/error.**
 *
 * **Validates: Requirements 1.4, 5.1, 5.2, 5.3, 5.4**
 *
 * Promotion is entirely S2 reuse: `promote_target_to_lead` resolves the Target
 * against the party graph with `resolveLeadByMatchKeys` BEFORE creating anything
 * (Req 5.1), then:
 *   • `match`    → attaches to the existing Party, creating NO duplicate Party
 *                  (Req 5.2);
 *   • `new`      → creates the `parties` + `leads_mirror` pairing (Req 5.3);
 *   • `conflict` → creates nothing, retaining the Target (Req 5.4);
 *   • `error`    → creates nothing, retaining the Target (Req 5.4).
 * Across every branch a Target is NEVER represented as a `tickets` row — it lives
 * in `targets`, distinct from a Lead until explicitly promoted (Req 1.4).
 *
 * The property generates a random promotion scenario (`new` / `match` /
 * `conflict` / `error`) over randomized identity keys (email + UAE phone) and
 * asserts the branch's exact party-graph effect AND the universal entity-
 * separation invariant (the `tickets` table stays empty, the Target stays a
 * `targets` row).
 *
 * ── Harness ──────────────────────────────────────────────────────────────────
 *
 * `pg-mem` (node-postgres adapter) over a minimal hand-written DDL — only the
 * tables the promotion handler touches (`parties`, `party_identities`,
 * `leads_mirror`, `targets`, `events`, `sf_outbox`) plus a stub `tickets` table
 * used purely to assert separation. This mirrors the proven write-path harness
 * in `prospecting-capabilities.write.test.ts` (no migration files), so the suite
 * stays lightweight: ONE in-memory db is built once and the touched tables are
 * cleared between runs. The model gateway and Salesforce adapter are mocked so
 * the best-effort S3 routing/DNA handoff never reaches the network.
 */

// Exactly the spec's non-optional property floor: ≥100 iterations. Pinned to the
// floor (not inflated) so the suite stays fast while honoring the boundary.
const NUM_RUNS = 100;

// ── Module mocks — no network, no model, no CRM. Services are NEVER mocked. ────

// loadLeadCapabilities (reached by the best-effort S3 handoff inside the handler)
// imports the LLM gateway at module load; never hit the network.
vi.mock("../gateway", () => ({
  generateCompletion: vi.fn(async () => "Mocked rationale."),
  generateEmbedding: vi.fn(async () => new Array(768).fill(0)),
}));

// The dedupe/outbox chain imports the Salesforce adapter; the promotion handler
// must never reach CRM.
vi.mock("../../tickets/crm/salesforce", () => {
  class MockSalesforceAdapter {
    name = "salesforce";
    authenticate = vi.fn();
    createCase = vi.fn();
    updateCase = vi.fn();
    getCaseStatus = vi.fn();
  }
  return {
    SalesforceAdapter: MockSalesforceAdapter,
    withRetry: vi.fn((fn: () => unknown) => fn()),
  };
});

import * as schema from "../../schema";
import {
  parties,
  partyIdentities,
  leadsMirror,
  targets,
  events,
  sfOutbox,
} from "../../schema";
import type { Database } from "../../db";
import type { ToolContext } from "./registry";
import type { CatalogEntry } from "./catalog";
import {
  prospectingCapabilityEntries,
  PROSPECTING_AGENT_ACTOR,
} from "./prospecting-capabilities";
import { computePhoneHash, normalizePhoneToE164 } from "../../voice/identity";

// ── pg-mem harness (minimal DDL — only what the promotion handler touches) ─────

// `tickets` is a deliberate stub: the entity-separation invariant (Req 1.4)
// asserts it remains EMPTY across every promotion branch — a Target is never a
// tickets row.
const DDL = `
  CREATE TABLE "parties" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "type" text NOT NULL DEFAULT 'person',
    "name" text,
    "language" text DEFAULT 'en',
    "client_id" uuid,
    "tenant_id" uuid,
    "consent_at" timestamp,
    "demo" boolean NOT NULL DEFAULT false,
    "created_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "party_identities" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "party_id" uuid NOT NULL,
    "kind" text NOT NULL,
    "value" text NOT NULL,
    "verified_at" timestamp
  );
  CREATE INDEX "party_identities_value_idx" ON "party_identities" ("kind","value");
  CREATE TABLE "leads_mirror" (
    "party_id" uuid PRIMARY KEY,
    "sf_lead_id" text,
    "stage" text,
    "tier" text,
    "score_reason" text,
    "project_interest" text,
    "unit_interest" text,
    "budget_band" text,
    "source" text,
    "campaign" text,
    "assigned_rep_id" uuid,
    "last_interaction_at" timestamp,
    "last_interaction_summary" text,
    "sla_due_at" timestamp,
    "demo" boolean NOT NULL DEFAULT false,
    "updated_at" timestamp DEFAULT now() NOT NULL
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
  CREATE TABLE "events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "type" text NOT NULL,
    "payload" jsonb,
    "at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "sf_outbox" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "kind" text NOT NULL,
    "job_key" text NOT NULL UNIQUE,
    "payload" jsonb NOT NULL,
    "status" text NOT NULL DEFAULT 'pending',
    "attempts" integer NOT NULL DEFAULT 0,
    "sf_id" text,
    "last_error" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "tickets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
  );
`;

function buildDb(): Database {
  const mem: IMemoryDb = newDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });
  // publishEvent issues `SELECT pg_notify(channel, id)`; pg-mem lacks it.
  mem.public.registerFunction({
    name: "pg_notify",
    args: [DataType.text, DataType.text],
    returns: DataType.text,
    implementation: () => "",
  });
  mem.public.none(DDL);

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem's node-postgres adapter rejects `types.getTypeParser` and
  // `rowMode: "array"`; strip both (mirrors the sibling write/dispatch tests).
  const originalQuery = pool.query.bind(pool);
  pool.query = (config: unknown, values?: unknown, cb?: unknown) => {
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
  };

  return drizzle(pool, { schema }) as unknown as Database;
}

const CTX: ToolContext = { actor: PROSPECTING_AGENT_ACTOR };

function capability(name: string): CatalogEntry {
  const e = prospectingCapabilityEntries.find((c) => c.name === name);
  if (!e) throw new Error(`capability "${name}" not found`);
  return e;
}

type PromoteResult = { resolution: string; partyId: string | null };

async function promote(
  db: Database,
  input: { targetId: string; phone?: string; email?: string; sfLeadId?: string }
): Promise<PromoteResult> {
  return (await capability("promote_target_to_lead").handler(
    db,
    CTX,
    input
  )) as PromoteResult;
}

/** Insert a minimal Target and return its id. */
async function seedTarget(db: Database, email?: string): Promise<string> {
  const [t] = await db
    .insert(targets)
    .values({
      targetType: "person",
      email: email ?? null,
      sourceProvider: "apollo",
      lawfulBasis: "legitimate_interest",
    })
    .returning({ id: targets.id });
  return t.id;
}

/** Clear the touched tables so the single reused db is clean per run. */
async function resetState(db: Database): Promise<void> {
  await db.delete(events);
  await db.delete(sfOutbox);
  await db.delete(leadsMirror);
  await db.delete(partyIdentities);
  await db.delete(targets);
  await db.delete(parties);
  await db.execute(sql`DELETE FROM tickets`);
}

async function ticketCount(db: Database): Promise<number> {
  const rows = (await db.execute(
    sql`SELECT count(*)::int AS n FROM tickets`
  )) as unknown as { rows: { n: number }[] };
  return rows.rows[0].n;
}

// ── Generators ────────────────────────────────────────────────────────────────

type Scenario = "new" | "match" | "conflict" | "error";

const scenarioArb = fc.constantFrom<Scenario>(
  "new",
  "match",
  "conflict",
  "error"
);

// A fresh, valid lower-cased email per case.
const emailArb = fc.uuid().map((u) => `p-${u.slice(0, 8)}@example.com`);

// A plausible UAE E.164 mobile: +9715 + 8 digits → normalizePhoneToE164 succeeds.
const phoneArb = fc
  .integer({ min: 10_000_000, max: 99_999_999 })
  .map((n) => `+9715${n}`);

let db: Database;

beforeAll(() => {
  // One in-memory db for the whole suite (cleared per run) — minimal seeding.
  db = buildDb();
});

beforeEach(async () => {
  await resetState(db);
});

// ── Property 4 ────────────────────────────────────────────────────────────────

describe("prospecting-capabilities — Property 4: Target↔Lead separation + dedupe-driven promotion (Req 1.4, 5.1–5.4)", () => {
  it("attaches on match, creates parties+leads_mirror on new, creates nothing on conflict/error; a Target is never a tickets row", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          scenario: scenarioArb,
          email: emailArb,
          phone: phoneArb,
        }),
        async ({ scenario, email, phone }) => {
          await resetState(db);

          if (scenario === "new") {
            // Fresh identity → resolveLeadByMatchKeys returns `new` →
            // upsertLead creates the parties + leads_mirror pairing (Req 5.3).
            const targetId = await seedTarget(db, email);
            const out = await promote(db, { targetId, email });

            expect(out.resolution).toBe("new");
            expect(out.partyId).not.toBeNull();

            // Exactly one new party + its leads_mirror pairing.
            const allParties = await db.select().from(parties);
            expect(allParties).toHaveLength(1);
            expect(allParties[0].id).toBe(out.partyId);
            const mirror = await db
              .select()
              .from(leadsMirror)
              .where(eq(leadsMirror.partyId, out.partyId!));
            expect(mirror).toHaveLength(1);

            // Target stamped + still a Target (not a ticket).
            const [t] = await db
              .select()
              .from(targets)
              .where(eq(targets.id, targetId));
            expect(t.partyId).toBe(out.partyId);
            expect(t.status).toBe("promoted");
          } else if (scenario === "match") {
            // Pre-seed a party with the email identity → resolver returns
            // `match` → attach to the existing party, create NO duplicate (5.2).
            const [p] = await db
              .insert(parties)
              .values({ type: "person", name: "Existing" })
              .returning({ id: parties.id });
            await db
              .insert(partyIdentities)
              .values({ partyId: p.id, kind: "email", value: email });

            const targetId = await seedTarget(db, email);
            const out = await promote(db, { targetId, email });

            expect(out.resolution).toBe("match");
            expect(out.partyId).toBe(p.id);

            // No duplicate party — still exactly the one we seeded.
            const allParties = await db.select().from(parties);
            expect(allParties).toHaveLength(1);

            const [t] = await db
              .select()
              .from(targets)
              .where(eq(targets.id, targetId));
            expect(t.partyId).toBe(p.id);
            expect(t.status).toBe("promoted");
          } else if (scenario === "conflict") {
            // Two distinct parties: one owning the phone_hash identity, one
            // owning the email identity → the two keys resolve to different
            // parties → `conflict` → create nothing, retain the Target (5.4).
            const [p1] = await db
              .insert(parties)
              .values({ type: "person" })
              .returning({ id: parties.id });
            const [p2] = await db
              .insert(parties)
              .values({ type: "person" })
              .returning({ id: parties.id });
            const phoneHash = computePhoneHash(normalizePhoneToE164(phone));
            await db
              .insert(partyIdentities)
              .values({ partyId: p1.id, kind: "phone_hash", value: phoneHash });
            await db
              .insert(partyIdentities)
              .values({ partyId: p2.id, kind: "email", value: email });

            const targetId = await seedTarget(db, email);
            const out = await promote(db, { targetId, phone, email });

            expect(out.resolution).toBe("conflict");
            expect(out.partyId).toBeNull();

            // No new party, no leads_mirror pairing created.
            const allParties = await db.select().from(parties);
            expect(allParties).toHaveLength(2);
            const mirror = await db.select().from(leadsMirror);
            expect(mirror).toHaveLength(0);

            // The Target is retained, unpromoted.
            const [t] = await db
              .select()
              .from(targets)
              .where(eq(targets.id, targetId));
            expect(t.partyId).toBeNull();
            expect(t.status).toBe("new");
          } else {
            // No match keys → resolver returns `error` → create nothing,
            // retain the Target (Req 5.4).
            const targetId = await seedTarget(db);
            const out = await promote(db, { targetId });

            expect(out.resolution).toBe("error");
            expect(out.partyId).toBeNull();

            const allParties = await db.select().from(parties);
            expect(allParties).toHaveLength(0);
            const mirror = await db.select().from(leadsMirror);
            expect(mirror).toHaveLength(0);

            const [t] = await db
              .select()
              .from(targets)
              .where(eq(targets.id, targetId));
            expect(t.partyId).toBeNull();
            expect(t.status).toBe("new");
          }

          // Universal entity-separation invariant (Req 1.4): across EVERY
          // branch a Target is never represented as a tickets row.
          expect(await ticketCount(db)).toBe(0);
          const allTargets = await db.select().from(targets);
          expect(allTargets).toHaveLength(1);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
