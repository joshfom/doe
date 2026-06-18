import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/pg-proxy";

import * as schema from "../schema";
import { crmSyncLog, leadsMirror } from "../schema";
import type { Database } from "../db";
import type { SalesforceObjectClient } from "../tickets/crm/salesforce-objects";
import { upsertLead } from "../tickets/crm/dedupe";
import {
  pollOnce,
  type PollDeps,
  type QuotaGauge,
  type SfLeadRecord,
  type SoqlRunner,
} from "./inbound-sync";

/**
 * Unit tests for the Inbound_Sync throttle and failure paths (task 5.4).
 *
 * Exercises the three non-happy branches of `pollOnce` against a REAL Drizzle
 * instance backed by an in-memory Postgres (pg-mem):
 *
 *   - **Throttle (Req 6.6).** When the API quota window is at/above 80%, the tick
 *     is skipped: `pollOnce` returns `{ next: cursor, processed: 0 }` and never
 *     calls `query.leadsModifiedSince`, so usage never reaches 100%.
 *   - **Read failure (Req 6.7).** When `leadsModifiedSince` rejects, the failure
 *     is recorded in the Sync_Ledger (`inbound`/`failed`) and the previously
 *     mirrored `leads_mirror` state is left unchanged.
 *   - **Dedupe conflict (Req 6.4).** When a Lead's distinct match keys resolve to
 *     two different Parties, the failure is recorded (`inbound`/`failed`,
 *     `external_ref_id = Lead.Id`), NO `leads_mirror` row is created, and the
 *     prior mirror state is left unchanged.
 *
 * The harness mirrors `lib/cms/tickets/crm/dedupe.idempotence.property.test.ts`:
 * migration 0029 (which creates `parties`, `party_identities`, `leads_mirror`,
 * `reps`) is applied statement-by-statement over pg-mem. `crm_sync_log` is added
 * as a minimal stub in its post-0034 shape (nullable `ticket_id`, no ticket FK)
 * so `recordSync` can insert and the asserted `inbound/failed` ledger rows are
 * observable. `pollOnce` never touches `deps.sf`, so a bare stub object is
 * supplied for the Salesforce client.
 *
 * **Validates: Requirements 6.4, 6.6, 6.7**
 */

// computePhoneHash (reachable via dedupe) reads PHONE_HASH_SALT — set a stable
// test salt even though these tests do not exercise the phone path.
process.env.PHONE_HASH_SALT ??= "inbound-sync-test-salt";

const MIGRATION_FILE = "0029_demonic_mandrill.sql";

// Tables migration 0029 references via FK but does not itself create.
const PREREQUISITE_SQL = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_appointments" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_conversations" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_messages" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
`;

// crm_sync_log in its post-0034 shape: ticket_id nullable, no ticket FK (the
// tickets table is out of scope for this slice). recordSync inserts only the
// direction/action/status/external_ref_id/error_message columns.
const CRM_SYNC_LOG_SQL = `
  CREATE TABLE "crm_sync_log" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "ticket_id" uuid,
    "direction" text NOT NULL,
    "action" text NOT NULL,
    "status" text NOT NULL DEFAULT 'pending',
    "external_ref_id" text,
    "error_message" text,
    "request_payload" jsonb,
    "response_payload" jsonb,
    "attempted_at" timestamp NOT NULL DEFAULT now(),
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

/**
 * Stand up a fresh in-memory Postgres with migration 0029 + the crm_sync_log
 * stub applied, returning a Drizzle handle shaped like the production `Database`.
 */
function buildInboundDb(): { db: Database; mem: IMemoryDb } {
  const mem = newDb();

  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });

  mem.public.none(PREREQUISITE_SQL);

  const migrationSql = readFileSync(
    join(process.cwd(), "drizzle", MIGRATION_FILE),
    "utf-8"
  );
  for (const stmt of splitStatements(migrationSql)) {
    mem.public.none(stmt);
  }

  mem.public.none(CRM_SYNC_LOG_SQL);

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

/** `pollOnce` never reads `deps.sf` on any tested path; a bare stub suffices. */
const SF_STUB = {} as unknown as SalesforceObjectClient;

/** A QuotaGauge fixed at a given usage fraction. */
function quotaAt(fraction: number): QuotaGauge {
  return { usedFraction: () => fraction };
}

/** Snapshot every leads_mirror row, ordered for stable comparison. */
async function snapshotMirror(db: Database) {
  const rows = await db
    .select({
      partyId: leadsMirror.partyId,
      sfLeadId: leadsMirror.sfLeadId,
      stage: leadsMirror.stage,
      projectInterest: leadsMirror.projectInterest,
      source: leadsMirror.source,
      updatedAt: leadsMirror.updatedAt,
    })
    .from(leadsMirror);
  return rows.sort((a, b) => a.partyId.localeCompare(b.partyId));
}

// ── 1. Throttle (Req 6.6) ─────────────────────────────────────────────────────

describe("pollOnce — throttle when quota >= 80% (Req 6.6)", () => {
  it("skips the tick, returns the cursor unchanged, and never reads from Salesforce", async () => {
    const { db } = buildInboundDb();

    // A SOQL runner whose read must NOT be called when throttled.
    const leadsModifiedSince = vi.fn<SoqlRunner["leadsModifiedSince"]>();
    const query: SoqlRunner = { leadsModifiedSince };

    const deps: PollDeps = { db, sf: SF_STUB, query, quota: quotaAt(0.9) };
    const cursor = new Date("2024-01-01T00:00:00.000Z");

    const result = await pollOnce(deps, cursor);

    expect(result).toEqual({ next: cursor, processed: 0 });
    expect(leadsModifiedSince).not.toHaveBeenCalled();

    // No ledger entry is written when the tick is skipped outright.
    const ledger = await db.select().from(crmSyncLog);
    expect(ledger).toHaveLength(0);
  });

  it("reads normally when quota is just below the 80% threshold", async () => {
    const { db } = buildInboundDb();

    const leadsModifiedSince = vi
      .fn<SoqlRunner["leadsModifiedSince"]>()
      .mockResolvedValue([]);
    const query: SoqlRunner = { leadsModifiedSince };

    const deps: PollDeps = { db, sf: SF_STUB, query, quota: quotaAt(0.79) };
    const cursor = new Date("2024-01-01T00:00:00.000Z");

    const result = await pollOnce(deps, cursor);

    expect(leadsModifiedSince).toHaveBeenCalledOnce();
    expect(result).toEqual({ next: cursor, processed: 0 });
  });
});

// ── 2. Read failure (Req 6.7) ─────────────────────────────────────────────────

describe("pollOnce — read failure records inbound/failed and leaves the mirror unchanged (Req 6.7)", () => {
  it("records an inbound/failed ledger entry and does not mutate leads_mirror", async () => {
    const { db } = buildInboundDb();

    // Seed an existing mirrored Lead so we can assert it is left untouched.
    await upsertLead(db, {
      party: { type: "person", name: "Existing", demo: true },
      identities: [{ kind: "email", value: "existing@example.com" }],
      sfLeadId: "00Qexisting",
      mirror: { stage: "Working", source: "web" },
    });

    const before = await snapshotMirror(db);
    expect(before).toHaveLength(1);

    const query: SoqlRunner = {
      leadsModifiedSince: vi
        .fn<SoqlRunner["leadsModifiedSince"]>()
        .mockRejectedValue(new Error("SOQL transport exploded")),
    };

    const deps: PollDeps = { db, sf: SF_STUB, query, quota: quotaAt(0) };
    const cursor = new Date("2024-01-01T00:00:00.000Z");

    const result = await pollOnce(deps, cursor);

    // Cursor unchanged, nothing processed.
    expect(result).toEqual({ next: cursor, processed: 0 });

    // Exactly one inbound/failed ledger entry, no external ref (read never got
    // far enough to know a Salesforce id).
    const ledger = await db.select().from(crmSyncLog);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].direction).toBe("inbound");
    expect(ledger[0].status).toBe("failed");
    expect(ledger[0].externalRefId).toBeNull();
    expect(ledger[0].errorMessage).toBe("SOQL transport exploded");

    // Mirror is field-for-field unchanged.
    const after = await snapshotMirror(db);
    expect(after).toEqual(before);
  });
});

// ── 3. Dedupe conflict (Req 6.4) ──────────────────────────────────────────────

describe("pollOnce — dedupe conflict records inbound/failed and creates no mirror row (Req 6.4)", () => {
  it("records inbound/failed with externalRefId=Lead.Id and leaves the mirror unchanged", async () => {
    const { db } = buildInboundDb();

    // Two distinct parties, each carrying a different exact match key. The
    // inbound Lead below maps its email to party A and its Id to party B, so the
    // resolver must report a conflict (distinct keys → different parties).
    await upsertLead(db, {
      party: { type: "person", name: "Alice", demo: true },
      identities: [{ kind: "email", value: "alice@example.com" }],
    });
    await upsertLead(db, {
      party: { type: "person", name: "Bob", demo: true },
      identities: [{ kind: "sf_lead_id", value: "00Qconflict" }],
    });

    const before = await snapshotMirror(db);
    expect(before).toHaveLength(2);

    // Lead.Id resolves to party B (sf_lead_id), Email resolves to party A.
    const lead: SfLeadRecord = {
      Id: "00Qconflict",
      LastModifiedDate: "2024-06-01T12:00:00.000Z",
      Email: "alice@example.com",
    };

    const query: SoqlRunner = {
      leadsModifiedSince: vi
        .fn<SoqlRunner["leadsModifiedSince"]>()
        .mockResolvedValue([lead]),
    };

    const deps: PollDeps = { db, sf: SF_STUB, query, quota: quotaAt(0) };
    const cursor = new Date("2024-01-01T00:00:00.000Z");

    const result = await pollOnce(deps, cursor);

    // The Lead was read (processed counts the read batch) but the cursor is NOT
    // advanced past a conflicting Lead — it stays pending resolution.
    expect(result.processed).toBe(1);
    expect(result.next).toEqual(cursor);

    // Exactly one inbound/failed ledger entry, tagged with the Salesforce id.
    const ledger = await db.select().from(crmSyncLog);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].direction).toBe("inbound");
    expect(ledger[0].status).toBe("failed");
    expect(ledger[0].externalRefId).toBe("00Qconflict");

    // No new mirror row was created and the prior mirror state is unchanged.
    const after = await snapshotMirror(db);
    expect(after).toEqual(before);
  });
});
