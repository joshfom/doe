import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { newDb, DataType } from "pg-mem";
import { drizzle } from "drizzle-orm/pg-proxy";

import * as schema from "../schema";
import { crmSyncLog } from "../schema";
import type { Database } from "../db";
import { recordSync, type SyncEntry } from "./sync-ledger";

/**
 * Unit tests for the best-effort Sync_Ledger writer (salesforce-lead-core task
 * 6.5).
 *
 * `recordSync` records exactly one `crm_sync_log` row per call, but it is
 * BEST-EFFORT: a ledger write failure (FK violation, transient DB error) MUST be
 * caught and swallowed so it never aborts or rolls back the calling business
 * operation (Req 8.6). The first test drives that contract with a stub `db`
 * whose insert path rejects — `recordSync` must still resolve. The second is a
 * happy path over a real in-memory Postgres (pg-mem) asserting one row lands
 * with `external_ref_id` NULL when `externalRefId` is omitted (Req 8.3, 8.4).
 *
 * **Validates: Requirements 8.6**
 */

const baseEntry: SyncEntry = {
  direction: "inbound",
  action: "lead",
  status: "success",
};

describe("recordSync — best-effort, non-fatal on write failure (Req 8.6)", () => {
  it("resolves without throwing when the insert REJECTS (async)", async () => {
    const insert = vi.fn(() => ({
      values: vi.fn(() =>
        Promise.reject(new Error("simulated transient DB failure"))
      ),
    }));
    const db = { insert } as unknown as Database;

    // The failure must be swallowed — the promise resolves, no throw escapes.
    await expect(recordSync(db, baseEntry)).resolves.toBeUndefined();
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("resolves without throwing when the insert THROWS synchronously", async () => {
    const insert = vi.fn(() => ({
      values: vi.fn(() => {
        throw new Error("simulated synchronous DB failure");
      }),
    }));
    const db = { insert } as unknown as Database;

    await expect(recordSync(db, baseEntry)).resolves.toBeUndefined();
    expect(insert).toHaveBeenCalledTimes(1);
  });
});

/**
 * Stand up a fresh in-memory Postgres with a `crm_sync_log` table in its
 * post-S2 (ticket_id-nullable) shape and return a Drizzle handle bound to it.
 * Mirrors the pg-mem + pg-proxy harness used by the dedupe / outbox tests.
 */
function buildLedgerDb(): Database {
  const mem = newDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });

  mem.public.none(`
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
  `);

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

  return drizzle(executor as never, { schema }) as unknown as Database;
}

describe("recordSync — happy path persists one row (Req 8.3, 8.4)", () => {
  it("inserts exactly one row with external_ref_id NULL when omitted", async () => {
    const db = buildLedgerDb();

    await recordSync(db, {
      direction: "inbound",
      action: "lead",
      status: "success",
    });

    const rows = await db.select().from(crmSyncLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ticketId: null,
      direction: "inbound",
      action: "lead",
      status: "success",
      externalRefId: null,
      errorMessage: null,
    });
  });

  it("stores the supplied external_ref_id when known", async () => {
    const db = buildLedgerDb();

    await recordSync(db, {
      direction: "outbound",
      action: "task",
      status: "success",
      externalRefId: "00T000000000001",
    });

    const rows = await db.select().from(crmSyncLog);
    expect(rows).toHaveLength(1);
    expect(rows[0].externalRefId).toBe("00T000000000001");
  });
});
