import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/pg-proxy";
import { eq } from "drizzle-orm";
import fc from "fast-check";

import * as schema from "../../schema";
import type { Database } from "../../db";
import { leadsMirror, parties } from "../../schema";
import { computePhoneHash, normalizePhoneToE164 } from "../../voice/identity";
import { upsertLead, type MatchKey } from "./dedupe";

/**
 * Property test for the Lead/Ticket entity separation (task 7.3).
 *
 * **Feature: salesforce-lead-core, Property 11: For any Lead, it is represented as a parties row plus its leads_mirror row and never as a tickets row, and the only ticket↔Lead link is tickets.lead_party_id.**
 *
 * **Validates: Requirements 13.2, 13.4, 13.6**
 *
 * The entity separation (design §Entity separation, Requirement 13):
 *
 *   - A **Lead** is the pairing of a `parties` row with its `leads_mirror` row
 *     keyed by `party_id`. A Lead is NEVER a `tickets` row.
 *   - A **Ticket** links to a Lead ONLY through the nullable `tickets.lead_party_id`
 *     column (migration 0032). A Ticket with a non-null `lead_party_id` is a
 *     Lead_Task; a null value leaves it an Internal_Ticket with no Lead link.
 *   - The `request_type` enum is NOT used to represent the ticket↔Lead link — a
 *     Ticket becomes a Lead_Task purely by setting `lead_party_id`, regardless of
 *     its `request_type` (including the legacy `lead_inquiry` value).
 *
 * The test runs against a REAL Drizzle instance over an in-memory Postgres
 * (pg-mem). Migration 0029 (which creates `parties`, `party_identities`,
 * `leads_mirror`, `reps`) is applied statement-by-statement exactly as the
 * migration runner does (mirroring `dedupe.idempotence.property.test.ts`). The
 * `tickets` table is created by an earlier migration that cannot be replayed
 * under pg-mem (it enables the `vector`/pgvector extension), so we stand up a
 * minimal `tickets` stub (id, request_type) and then apply the S2 migration
 * `drizzle/0032_lead_ticket_link.sql` to add the real `tickets.lead_party_id`
 * column + FK to `parties` + index — exercising the actual entity-separation
 * migration.
 */

process.env.PHONE_HASH_SALT ??= "entity-separation-test-salt";

// ≥100 iterations as mandated for this non-optional property.
const NUM_RUNS = 100;

const MIGRATION_0029 = "0029_demonic_mandrill.sql";
const MIGRATION_0032 = "0032_lead_ticket_link.sql";

// Tables migration 0029 references via FK but does not itself create.
const PREREQUISITE_SQL = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_appointments" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_conversations" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_messages" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
`;

// Minimal `tickets` stub — only the columns this test needs. The real
// `lead_party_id` column + FK + index are added by replaying 0032 below.
const TICKETS_STUB_SQL = `
  CREATE TABLE "tickets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "request_type" text NOT NULL DEFAULT 'general_inquiry'
  );
`;

/** Split a Drizzle migration into individual statements (statement-breakpoint markers + semicolons). */
function splitStatements(sql: string): string[] {
  // Strip whole-line SQL comments FIRST — a comment may itself contain a `;`
  // (0032 does), which would otherwise corrupt the semicolon split below.
  const withoutComments = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  return withoutComments
    .split(/-->\s*statement-breakpoint/)
    .flatMap((chunk) => chunk.split(";"))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function readMigration(name: string): string {
  return readFileSync(join(process.cwd(), "drizzle", name), "utf-8");
}

interface TestDb {
  db: Database;
  mem: IMemoryDb;
  client: { query: (q: { text: string; values?: unknown[] }) => Promise<{ rows: Record<string, unknown>[] }> };
}

/**
 * Stand up a fresh in-memory Postgres with 0029 applied, a minimal `tickets`
 * stub, and 0032 applied (adding `tickets.lead_party_id`). Returns a Drizzle
 * handle plus the raw pg-mem client for parameterized `tickets` queries.
 */
function buildSeparationDb(): TestDb {
  const mem = newDb();

  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });

  mem.public.none(PREREQUISITE_SQL);

  for (const stmt of splitStatements(readMigration(MIGRATION_0029))) {
    mem.public.none(stmt);
  }

  // Minimal tickets stub, then the real S2 link migration.
  mem.public.none(TICKETS_STUB_SQL);
  for (const stmt of splitStatements(readMigration(MIGRATION_0032))) {
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

  return { db, mem, client };
}

// ── Raw `tickets` helpers (parameterized via the pg-mem client) ───────────────

async function insertTicket(
  client: TestDb["client"],
  requestType: string,
  leadPartyId: string | null
): Promise<string> {
  const res = await client.query({
    text: `INSERT INTO "tickets" ("request_type", "lead_party_id") VALUES ($1, $2) RETURNING "id"`,
    values: [requestType, leadPartyId],
  });
  return res.rows[0].id as string;
}

async function ticketLeadPartyId(
  client: TestDb["client"],
  ticketId: string
): Promise<string | null> {
  const res = await client.query({
    text: `SELECT "lead_party_id" FROM "tickets" WHERE "id" = $1`,
    values: [ticketId],
  });
  return (res.rows[0]?.lead_party_id ?? null) as string | null;
}

/** All ticket ids whose lead_party_id links them to the given Lead (party). */
async function leadTaskIdsForParty(
  client: TestDb["client"],
  partyId: string
): Promise<string[]> {
  const res = await client.query({
    text: `SELECT "id" FROM "tickets" WHERE "lead_party_id" = $1`,
    values: [partyId],
  });
  return res.rows.map((r) => r.id as string);
}

async function ticketRowCount(client: TestDb["client"]): Promise<number> {
  const res = await client.query({ text: `SELECT count(*)::int AS n FROM "tickets"` });
  return res.rows[0].n as number;
}

async function ticketExistsWithId(
  client: TestDb["client"],
  id: string
): Promise<boolean> {
  const res = await client.query({
    text: `SELECT 1 FROM "tickets" WHERE "id" = $1`,
    values: [id],
  });
  return res.rows.length > 0;
}

// ── Drizzle existence checks for the Lead representation ───────────────────────

async function partyExists(db: Database, partyId: string): Promise<boolean> {
  const rows = await db
    .select({ id: parties.id })
    .from(parties)
    .where(eq(parties.id, partyId))
    .limit(1);
  return rows.length > 0;
}

async function leadsMirrorExists(db: Database, partyId: string): Promise<boolean> {
  const rows = await db
    .select({ partyId: leadsMirror.partyId })
    .from(leadsMirror)
    .where(eq(leadsMirror.partyId, partyId))
    .limit(1);
  return rows.length > 0;
}

// ── Generators ─────────────────────────────────────────────────────────────

// A spread of request_type values INCLUDING the legacy `lead_inquiry` shim — to
// prove the ticket↔Lead link never depends on request_type.
const requestTypeArb = fc.constantFrom(
  "general_inquiry",
  "lead_inquiry",
  "noc",
  "move_in",
  "maintenance_request",
  "site_visit_booking",
  "handover_appointment"
);

const poolPhone = (i: number) => `+9715${String(2000000 + i).padStart(7, "0")}`;
const poolEmail = (i: number) => `lead${i}@example.com`;

describe("entity separation — Property 11: Lead = parties + leads_mirror, never a ticket (Req 13.2, 13.4, 13.6)", () => {
  it("represents a Lead only as parties + leads_mirror, and links a ticket to it ONLY via tickets.lead_party_id, independent of request_type", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Lead identity slot (keeps generated phone/email distinct & valid).
        fc.integer({ min: 0, max: 100000 }),
        // Lead mirror fields.
        fc.record({
          stage: fc.option(fc.constantFrom("new", "working", "qualified"), { nil: undefined }),
          tier: fc.option(fc.constantFrom("HOT", "WARM", "NURTURE"), { nil: undefined }),
          projectInterest: fc.option(fc.constantFrom("Bayn", "Marina", "Hills"), { nil: undefined }),
        }),
        // request_type for the Lead_Task ticket (arbitrary — must not affect linking).
        requestTypeArb,
        // request_type for the Internal_Ticket (arbitrary — incl. lead_inquiry).
        requestTypeArb,
        async (slot, mirror, leadTaskReqType, internalReqType) => {
          const { db, client } = buildSeparationDb();

          // ── Create an arbitrary Lead: a parties row + its leads_mirror row. ──
          const e164 = normalizePhoneToE164(poolPhone(slot));
          const identities: MatchKey[] = [
            { kind: "phone_hash", value: computePhoneHash(e164) },
            { kind: "email", value: poolEmail(slot) },
          ];
          const { partyId, created } = await upsertLead(db, {
            party: { type: "person", demo: true },
            identities,
            mirror,
          });

          // (1) The Lead is represented as a parties row + its leads_mirror row.
          expect(created).toBe(true);
          expect(await partyExists(db, partyId)).toBe(true);
          expect(await leadsMirrorExists(db, partyId)).toBe(true);

          // (1b) The Lead is NEVER stored as a tickets row: creating a Lead
          // produces zero tickets, and the Lead's party id is not a ticket id.
          expect(await ticketRowCount(client)).toBe(0);
          expect(await ticketExistsWithId(client, partyId)).toBe(false);
          expect(await leadTaskIdsForParty(client, partyId)).toEqual([]);

          // ── A Ticket linked to the Lead (a Lead_Task). ──
          const leadTaskId = await insertTicket(client, leadTaskReqType, partyId);

          // (2) The ONLY link is tickets.lead_party_id.
          expect(await ticketLeadPartyId(client, leadTaskId)).toBe(partyId);
          expect(await leadTaskIdsForParty(client, partyId)).toEqual([leadTaskId]);
          // The Lead's representation is unchanged — still parties + leads_mirror,
          // and the ticket is a distinct row (the Lead is not the ticket).
          expect(leadTaskId).not.toBe(partyId);
          expect(await partyExists(db, partyId)).toBe(true);
          expect(await leadsMirrorExists(db, partyId)).toBe(true);

          // ── An Internal_Ticket (lead_party_id null). ──
          const internalId = await insertTicket(client, internalReqType, null);

          // (3) An Internal_Ticket is not associated with any Lead.
          expect(await ticketLeadPartyId(client, internalId)).toBeNull();
          // It never appears among the Lead's linked tickets.
          expect(await leadTaskIdsForParty(client, partyId)).not.toContain(internalId);

          // (4) The link never relies on a request_type value:
          //   - The Internal_Ticket is NOT a Lead_Task even when its request_type
          //     is the legacy `lead_inquiry` shim — because lead_party_id is null.
          //   - The Lead_Task IS linked regardless of its (arbitrary) request_type
          //     — linking is determined solely by lead_party_id.
          const linked = await leadTaskIdsForParty(client, partyId);
          expect(linked).toEqual([leadTaskId]); // exactly the lead_party_id-linked row
          expect(linked).not.toContain(internalId);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
