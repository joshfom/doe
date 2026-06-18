import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/pg-proxy";
import fc from "fast-check";

/**
 * Property test for the DOE voice prefetch isolation from Salesforce (task 6.5).
 *
 *   Property 4 — Prefetch never touches Salesforce: across an arbitrary mix of
 *     known callers (seeded `parties` + `leads_mirror` + optional `reps` /
 *     `ai_appointments` rows) and unknown callers (random, non-existent
 *     partyIds), `buildCallContext` issues ZERO Salesforce calls. The entire
 *     `SalesforceAdapter` module is mocked so every adapter method is a spy;
 *     after running the prefetch for every generated party the combined spy
 *     call count is 0. `buildCallContext` is additionally asserted to return a
 *     valid `CallContext` — `known === true` for seeded parties, falling back
 *     to `known === false` for missing ones.
 *
 * **Validates: Requirements 3.5**
 *
 * The property runs against a REAL Drizzle instance backed by an in-memory
 * Postgres (pg-mem), applying migration 0029 statement-by-statement exactly as
 * the migration runner does (mirroring events.property.test.ts /
 * identity.property.test.ts). pg-mem ships no `gen_random_uuid()`, so it is
 * registered. `buildCallContext` issues plain selects (no transaction /
 * NOTIFY), so neither a transaction shim nor `pg_notify` is needed. The
 * `ai_appointments` / `ai_conversations` prerequisite stubs carry the base
 * columns the prefetch join reads (migration 0029 only ALTERs them to add the
 * voice-surface columns), so the stubs are richer than prior tests' minimal
 * versions.
 */

// ── Salesforce adapter mock — every method is a spy. ─────────────────────────
//
// `buildCallContext` does not import the SalesforceAdapter at all; mocking the
// whole module and asserting 0 calls is the strongest expression of the
// isolation guarantee (Req 3.5 / design §12): even with a fully-instrumented
// adapter available in the module graph, the prefetch path never reaches it.
const sfSpies = {
  authenticate: vi.fn(),
  createCase: vi.fn(),
  updateCase: vi.fn(),
  getCaseStatus: vi.fn(),
};

vi.mock("../tickets/crm/salesforce", () => {
  class MockSalesforceAdapter {
    name = "salesforce";
    authenticate = sfSpies.authenticate;
    createCase = sfSpies.createCase;
    updateCase = sfSpies.updateCase;
    getCaseStatus = sfSpies.getCaseStatus;
  }
  return {
    SalesforceAdapter: MockSalesforceAdapter,
    withRetry: vi.fn((fn: () => unknown) => fn()),
  };
});

import * as schema from "../schema";
import {
  parties,
  leadsMirror,
  reps,
  aiAppointments,
  aiConversations,
} from "../schema";
import type { Database } from "../db";
import { SalesforceAdapter } from "../tickets/crm/salesforce";
import { buildCallContext } from "./prefetch";

// Reduced fast-check budget — each generated case stands up a fresh in-memory
// DB, so keep run counts and data small for speed (performance directive).
const NUM_RUNS = 25;
const MAX_KNOWN = 4;
const MAX_UNKNOWN = 3;

const MIGRATION_FILE = "0029_demonic_mandrill.sql";

// Pre-existing tables migration 0029 ALTERs / references. `ai_conversations`
// and `ai_appointments` are stubbed with their full BASE columns (matching
// `schema.ts` minus the voice-surface columns migration 0029 ADDs: `sentiment`
// / `summary` / `party_id` on conversations; `rep_id` / `slot_id` /
// `sf_event_id` / `project` on appointments). Drizzle's generated INSERT names
// every schema column (passing `default` for the unspecified ones), so the
// base columns must exist for the seed inserts to run.
const PREREQUISITE_SQL = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_conversations" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "participant_name" text,
    "participant_phone" text,
    "participant_email" text,
    "participant_type" text NOT NULL DEFAULT 'visitor',
    "client_id" uuid,
    "tenant_id" uuid,
    "channel" text,
    "language" text NOT NULL DEFAULT 'en',
    "status" text NOT NULL DEFAULT 'active',
    "handoff_summary" jsonb,
    "otp_verification_state" text NOT NULL DEFAULT 'not_required',
    "resolved_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "ai_appointments" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "reference_number" text NOT NULL UNIQUE,
    "conversation_id" uuid,
    "client_id" uuid,
    "tenant_id" uuid,
    "contact_name" text NOT NULL,
    "contact_email" text,
    "contact_phone" text,
    "appointment_type" text NOT NULL,
    "scheduled_date" date NOT NULL,
    "scheduled_time" time NOT NULL,
    "status" text NOT NULL DEFAULT 'confirmed',
    "notes" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "ai_messages" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
`;

/** Split a Drizzle migration into individual statements. */
function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Stand up a fresh in-memory Postgres with migration 0029 applied and return a
 * Drizzle handle (shaped like the production `Database`) bound to it, using the
 * pg-proxy driver over pg-mem (node-postgres' type parsing + array row-mode are
 * rejected by pg-mem). `buildCallContext` does plain selects, so no transaction
 * shim is required.
 */
function buildPrefetchDb(): { db: Database; mem: IMemoryDb } {
  const mem = newDb();

  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });

  mem.public.none(PREREQUISITE_SQL);

  const migrationPath = join(process.cwd(), "drizzle", MIGRATION_FILE);
  const migrationSql = readFileSync(migrationPath, "utf-8");
  for (const stmt of splitStatements(migrationSql)) {
    mem.public.none(stmt);
  }

  const { Client } = mem.adapters.createPg();
  const client = new Client();

  const executor = async (
    sql: string,
    params: unknown[],
    method: "all" | "execute"
  ): Promise<{ rows: unknown[] }> => {
    const res = await client.query({ text: sql, values: params });
    const objectRows = (res.rows ?? []) as Record<string, unknown>[];
    return {
      rows:
        method === "all"
          ? objectRows.map((row) => Object.values(row))
          : objectRows,
    };
  };

  const db = drizzle(executor as never, { schema }) as unknown as Database;

  return { db, mem };
}

// ── Generators ───────────────────────────────────────────────────────────────

interface KnownPartySpec {
  language: "en" | "ar";
  name?: string;
  tier?: "HOT" | "WARM" | "NURTURE";
  projectInterest?: string;
  source?: string;
  withRep: boolean;
  withAppointment: boolean;
}

const knownPartyArb: fc.Arbitrary<KnownPartySpec> = fc.record({
  language: fc.constantFrom("en", "ar"),
  name: fc.option(fc.string({ minLength: 1, maxLength: 12 }), {
    nil: undefined,
  }),
  tier: fc.option(fc.constantFrom("HOT", "WARM", "NURTURE"), { nil: undefined }),
  projectInterest: fc.option(fc.string({ minLength: 1, maxLength: 12 }), {
    nil: undefined,
  }),
  source: fc.option(fc.string({ minLength: 1, maxLength: 12 }), {
    nil: undefined,
  }),
  withRep: fc.boolean(),
  withAppointment: fc.boolean(),
});

/** Seed one known caller and return its partyId. */
async function seedKnownParty(
  db: Database,
  spec: KnownPartySpec
): Promise<string> {
  const partyId = randomUUID();

  await db.insert(parties).values({
    id: partyId,
    type: "person",
    name: spec.name,
    language: spec.language,
  });

  let assignedRepId: string | undefined;
  if (spec.withRep) {
    assignedRepId = randomUUID();
    await db.insert(reps).values({
      id: assignedRepId,
      name: `Rep ${assignedRepId.slice(0, 4)}`,
      capacity: 3,
      openHotCount: 1,
    });
  }

  await db.insert(leadsMirror).values({
    partyId,
    tier: spec.tier,
    projectInterest: spec.projectInterest,
    source: spec.source,
    assignedRepId,
    lastInteractionSummary: "Discussed budget and timeline.",
  });

  if (spec.withAppointment) {
    const conversationId = randomUUID();
    await db.insert(aiConversations).values({
      id: conversationId,
      partyId,
      channel: "web_call",
      status: "active",
    });
    await db.insert(aiAppointments).values({
      id: randomUUID(),
      referenceNumber: `APT-${randomUUID().slice(0, 8)}`,
      conversationId,
      contactName: spec.name ?? "Caller",
      appointmentType: "site_visit",
      scheduledDate: "2025-06-01",
      scheduledTime: "10:00:00",
      status: "confirmed",
      project: spec.projectInterest ?? "Marina Vista",
    });
  }

  return partyId;
}

// ── Property 4: prefetch never touches Salesforce (Req 3.5) ──────────────────

describe("buildCallContext — Property 4: prefetch never touches Salesforce (Req 3.5)", () => {
  it("issues zero Salesforce calls across known + unknown callers and returns a valid CallContext", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(knownPartyArb, { minLength: 0, maxLength: MAX_KNOWN }),
        fc.array(fc.uuid(), { minLength: 0, maxLength: MAX_UNKNOWN }),
        async (knownSpecs, unknownIds) => {
          // Ensure at least one caller is exercised per case.
          if (knownSpecs.length === 0 && unknownIds.length === 0) {
            knownSpecs = [
              {
                language: "en",
                withRep: false,
                withAppointment: false,
              },
            ];
          }

          // Reset spies for each generated case so counts are per-case.
          for (const spy of Object.values(sfSpies)) spy.mockClear();

          const { db } = buildPrefetchDb();

          // Instantiate the (mocked) adapter so a fully-instrumented Salesforce
          // client exists in the graph — the prefetch must still never call it.
          new SalesforceAdapter();

          const knownIds: string[] = [];
          for (const spec of knownSpecs) {
            knownIds.push(await seedKnownParty(db, spec));
          }

          // Known callers → known === true, partyId echoed back.
          for (const partyId of knownIds) {
            const ctx = await buildCallContext(db, partyId);
            expect(ctx.known).toBe(true);
            expect(ctx.partyId).toBe(partyId);
            expect(ctx.language === "en" || ctx.language === "ar").toBe(true);
          }

          // Unknown callers → fall back to known === false. Skip any id that
          // happens to collide with a seeded party (vanishingly unlikely).
          for (const partyId of unknownIds) {
            if (knownIds.includes(partyId)) continue;
            const ctx = await buildCallContext(db, partyId);
            expect(ctx.known).toBe(false);
          }

          // THE assertion: not a single Salesforce method was called.
          const totalSfCalls = Object.values(sfSpies).reduce(
            (sum, spy) => sum + spy.mock.calls.length,
            0
          );
          expect(totalSfCalls).toBe(0);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
