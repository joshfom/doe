import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/pg-proxy";
import { asc } from "drizzle-orm";
import fc from "fast-check";

import * as schema from "../schema";
import { leadsMirror } from "../schema";
import type { Database } from "../db";
import { SF_OBJECT_CONFIG } from "../tickets/crm/sf-config";
import type { SalesforceObjectClient } from "../tickets/crm/salesforce-objects";
import {
  pollOnce,
  type PollDeps,
  type QuotaGauge,
  type SfLeadRecord,
  type SoqlRunner,
} from "./inbound-sync";

/**
 * Property test for inbound-sync idempotence (task 5.3).
 *
 * **Feature: salesforce-lead-core, Property 5: For any Salesforce Lead change re-processed any number of times, leads_mirror is left field-for-field identical to processing it once.**
 *
 * **Validates: Requirements 6.5**
 *
 * `pollOnce` reads a batch of changed Salesforce Leads and folds each into the
 * party graph + `leads_mirror` via the conservative dedupe helpers
 * (`resolveLeadByMatchKeys` → `linkSfLeadId` → `upsertLeadsMirror`). Every write
 * is an upsert keyed by `party_id`, so re-processing the SAME set of changes any
 * number of times must leave `leads_mirror` field-for-field identical to
 * processing it once (Req 6.5).
 *
 * This test runs the real `pollOnce` against a REAL Drizzle instance backed by
 * an in-memory Postgres (pg-mem), applying migration 0029 (which creates
 * `parties`, `party_identities`, `leads_mirror`, `reps`) statement-by-statement
 * exactly as the migration runner does — mirroring the established harness in
 * `lib/cms/outbox/jobkey-at-most-once.property.test.ts` and
 * `lib/cms/tickets/crm/dedupe.idempotence.property.test.ts`. The full migration
 * chain cannot be replayed under pg-mem because earlier migrations enable the
 * `vector` (pgvector) extension, so we apply only 0029 over minimal prerequisite
 * stub tables for its FK targets.
 *
 * `crm_sync_log` is NOT created by 0029 (it predates it and is only altered by
 * the S2 migration 0034, which makes `crm_sync_log.ticket_id` nullable). Because
 * `pollOnce` records best-effort ledger entries via `recordSync`, we add a
 * minimal `crm_sync_log` stub in its post-0034 (nullable `ticket_id`) shape so
 * those inserts succeed. The ledger write is non-fatal to the sync regardless,
 * but the mirror writes — the subject of this property — must succeed cleanly.
 *
 * ON `updated_at`. `leads_mirror.updated_at` is a bookkeeping write-timestamp
 * that `upsertLead` / `linkSfLeadId` stamp with `new Date()` on EVERY upsert, so
 * it necessarily differs between the first and a later processing. It carries no
 * mirrored Salesforce data. Requirement 6.5 is about the mirrored STATE — the
 * Salesforce-derived fields — being idempotent, not about an internal write
 * clock. We therefore assert field-for-field identity over every SUBSTANTIVE
 * column (`sf_lead_id`, `stage`, `tier`, `project_interest`, `source`, … and the
 * `party_id` key) and exclude only `updated_at` from the equality.
 */

// `computePhoneHash` (reached through the dedupe path) reads PHONE_HASH_SALT from
// the environment; set a stable test salt so hashing is deterministic.
process.env.PHONE_HASH_SALT ??= "inbound-sync-idempotence-test-salt";

/** ≥100 iterations as mandated for the non-optional inbound-idempotence property. */
const NUM_RUNS = 100;

const MIGRATION_FILE = "0029_demonic_mandrill.sql";

/** Configured Salesforce field API names for the Lead object (env-overridable). */
const LEAD_FIELDS = SF_OBJECT_CONFIG.Lead.fields;

// Tables migration 0029 references via FK / ALTERs but does not itself create.
// Stubbed in their minimal shape so 0029's statements resolve cleanly, PLUS a
// `crm_sync_log` stub (nullable `ticket_id`, post-0034 shape) so `recordSync`
// inserts succeed.
const PREREQUISITE_SQL = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_appointments" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_conversations" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_messages" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "crm_sync_log" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "ticket_id" uuid,
    "direction" text NOT NULL,
    "action" text NOT NULL,
    "status" text DEFAULT 'pending' NOT NULL,
    "external_ref_id" text,
    "error_message" text,
    "request_payload" jsonb,
    "response_payload" jsonb,
    "attempted_at" timestamp DEFAULT now() NOT NULL,
    "completed_at" timestamp
  );
`;

/** Split a Drizzle migration into individual statements. */
function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Read + parse the migration once; applying it per-run is the per-iteration cost.
const MIGRATION_STATEMENTS = splitStatements(
  readFileSync(join(process.cwd(), "drizzle", MIGRATION_FILE), "utf-8")
);

/**
 * Stand up a fresh in-memory Postgres with migration 0029 (+ prerequisite stubs)
 * applied and return a Drizzle handle (shaped like the production `Database`)
 * bound to it, via Drizzle's pg-proxy driver over pg-mem.
 */
function buildDb(): { db: Database; mem: IMemoryDb } {
  const mem = newDb();

  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });

  mem.public.none(PREREQUISITE_SQL);
  for (const stmt of MIGRATION_STATEMENTS) {
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

// ── Stub dependencies ─────────────────────────────────────────────────────────

/**
 * A `SoqlRunner` that returns a FIXED batch of Leads regardless of the cursor —
 * exactly "re-processing the same Salesforce change" (Req 6.5). The returned
 * array is a fresh copy each call so `pollOnce` can never mutate the source.
 */
function makeRunner(records: SfLeadRecord[]): SoqlRunner {
  return {
    async leadsModifiedSince(): Promise<SfLeadRecord[]> {
      return records.map((r) => ({ ...r }));
    },
  };
}

/** A `QuotaGauge` below the 80% throttle threshold so the tick always runs. */
function makeQuota(fraction: number): QuotaGauge {
  return { usedFraction: () => fraction };
}

/**
 * A `SalesforceObjectClient` stand-in. `pollOnce` never dereferences it for the
 * Lead path (it reads through the injected `SoqlRunner`), so any access is a
 * contract violation — surface it loudly rather than silently returning.
 */
const sfClientStub = new Proxy(
  {},
  {
    get(_t, prop) {
      throw new Error(
        `pollOnce must not dereference SalesforceObjectClient.${String(prop)} on the Lead path`
      );
    },
  }
) as unknown as SalesforceObjectClient;

// ── SfLeadRecord generators ────────────────────────────────────────────────────
//
// Small pools of identities so the dedupe paths (new / match / conflict) all get
// exercised: sharing an email or sf id across records forces matches, and a
// record whose sf id and email point at two different parties forces a conflict.
// Phones are valid E.164 (so the hash path runs) but are NEVER stored — phone is
// matched only via its salted hash, never persisted (CC-Privacy).

const SF_ID_POOL = 8;
const EMAIL_POOL = 5;
const PHONE_POOL = 5;

const sfId = (i: number) => `00Q00000000${i}AAA`;
const email = (i: number) => `lead${i}@example.com`;
const phone = (i: number) => `+9715${String(1000000 + i).padStart(7, "0")}`;

const STATUSES = ["Open", "Working", "Qualified", "Unqualified"] as const;
const INTERESTS = ["Bayn", "Marina", "Hills", "Downtown"] as const;
const SOURCES = ["Web", "Referral", "Walk-in", "Phone"] as const;

const optIdx = (max: number) =>
  fc.option(fc.integer({ min: 0, max: max - 1 }), { nil: undefined });

/** One generated Salesforce Lead record, keyed by the CONFIGURED SF API names. */
const sfLeadRecordArb = fc
  .record({
    idIdx: fc.integer({ min: 0, max: SF_ID_POOL - 1 }),
    emailIdx: optIdx(EMAIL_POOL),
    phoneIdx: optIdx(PHONE_POOL),
    statusIdx: fc.integer({ min: 0, max: STATUSES.length - 1 }),
    interestIdx: fc.integer({ min: 0, max: INTERESTS.length - 1 }),
    sourceIdx: fc.integer({ min: 0, max: SOURCES.length - 1 }),
    first: fc.constantFrom("Ada", "Lin", "Omar", "Sara", ""),
    last: fc.constantFrom("Lovelace", "Turing", "Hopper", ""),
    // Distinct day offsets keep LastModifiedDate values well-formed + ordered.
    dayOffset: fc.integer({ min: 0, max: 90 }),
  })
  .map(
    ({
      idIdx,
      emailIdx,
      phoneIdx,
      statusIdx,
      interestIdx,
      sourceIdx,
      first,
      last,
      dayOffset,
    }): SfLeadRecord => {
      const lastModified = new Date(
        Date.UTC(2024, 0, 1) + dayOffset * 24 * 60 * 60 * 1000
      ).toISOString();

      const record: SfLeadRecord = {
        Id: sfId(idIdx),
        LastModifiedDate: lastModified,
        [LEAD_FIELDS.status]: STATUSES[statusIdx],
        [LEAD_FIELDS.projectInterest]: INTERESTS[interestIdx],
        [LEAD_FIELDS.source]: SOURCES[sourceIdx],
      };
      if (first) record[LEAD_FIELDS.firstName] = first;
      if (last) record[LEAD_FIELDS.lastName] = last;
      if (emailIdx !== undefined) record[LEAD_FIELDS.email] = email(emailIdx);
      if (phoneIdx !== undefined) record[LEAD_FIELDS.phone] = phone(phoneIdx);
      return record;
    }
  );

// ── Mirror snapshot ─────────────────────────────────────────────────────────

/** A `leads_mirror` row with the volatile `updated_at` bookkeeping clock removed. */
type MirrorSnapshotRow = Omit<typeof leadsMirror.$inferSelect, "updatedAt">;

/**
 * Snapshot every `leads_mirror` row (all substantive columns, ordered by
 * `party_id`), dropping only the volatile `updated_at` write-timestamp.
 */
async function snapshotMirror(db: Database): Promise<MirrorSnapshotRow[]> {
  const rows = await db
    .select()
    .from(leadsMirror)
    .orderBy(asc(leadsMirror.partyId));
  return rows.map(({ updatedAt: _ignored, ...rest }) => rest);
}

// ── The property ──────────────────────────────────────────────────────────────

describe("pollOnce — Property 5: inbound sync idempotence (Req 6.5)", () => {
  it("leaves leads_mirror field-for-field identical when the same Salesforce Lead changes are re-processed any number of times", async () => {
    await fc.assert(
      fc.asyncProperty(
        // A batch of changed Leads with DISTINCT Salesforce Ids. A real
        // `leadsModifiedSince` SOQL query returns a SET of distinct Lead
        // sObjects — the same record Id can never appear twice in one result —
        // so we constrain the generated batch to unique Ids (shared emails /
        // phones across distinct-Id records are still generated, exercising the
        // new / match / conflict dedupe paths).
        fc.uniqueArray(sfLeadRecordArb, {
          minLength: 1,
          maxLength: 8,
          selector: (r) => r.Id,
        }),
        // A quota fraction strictly below the 0.8 throttle threshold so the tick
        // is NEVER throttled (otherwise the mirror would never be written).
        fc.integer({ min: 0, max: 79 }).map((p) => p / 100),
        // Re-process the same batch this many EXTRA times after the first run.
        fc.integer({ min: 1, max: 3 }),
        async (records, quotaFraction, extraRuns) => {
          const { db } = buildDb();
          const deps: PollDeps = {
            db,
            sf: sfClientStub,
            query: makeRunner(records),
            quota: makeQuota(quotaFraction),
          };

          // Always poll from the same cursor: the runner ignores it and returns
          // the same batch, so every tick re-processes the identical changes.
          const cursor = new Date(0);

          // (1) Process the batch ONCE and snapshot the resulting mirror state.
          await pollOnce(deps, cursor);
          const afterOnce = await snapshotMirror(db);

          // (2) Re-process the SAME batch one or more additional times.
          for (let i = 0; i < extraRuns; i++) {
            await pollOnce(deps, cursor);
          }
          const afterMany = await snapshotMirror(db);

          // (3) The mirror is field-for-field identical (updated_at excluded).
          expect(afterMany).toEqual(afterOnce);
        }
      ),
      { numRuns: NUM_RUNS }
    );
    // Each iteration stands up a fresh in-memory Postgres and applies migration
    // 0029, so 100 runs comfortably exceed the 5s default — give it room.
  }, 120_000);
});
