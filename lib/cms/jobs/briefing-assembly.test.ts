import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/pg-proxy";

import type { Database } from "@/lib/cms/db";
import * as schema from "@/lib/cms/schema";
import { briefingCache } from "@/lib/cms/schema";
import {
  createBriefingAssemblyHandler,
  type BriefingAssemblyPayload,
} from "./briefing-assembly";
import type { JobContext } from "./index";
import {
  readBriefingCache,
  type CacheKey,
} from "@/lib/cms/agents/home/briefing-cache";
import { briefingJobKey } from "@/lib/cms/agents/home/jobkey";
import type { Briefing, BriefingWindow } from "@/lib/cms/agents/home/types";
import type {
  BriefingInput,
  BriefingResult,
} from "@/lib/cms/agents/workflows/briefing-workflow";

/**
 * Focused unit test for the `briefing_assembly` job handler (task 10.2).
 *
 * Drives the REAL handler from `createBriefingAssemblyHandler(deps)` over an
 * in-memory Postgres (`pg-mem` + the real migration `drizzle/0037_briefing_cache.sql`)
 * with an INJECTED fake `assemble` that returns a canned `{ ok:true, briefing }`,
 * and the REAL `writeBriefingCache` (the default) against pg-mem — so the cache
 * round-trip through the `briefing_cache` table's `jsonb` column is genuine and
 * no real dispatcher / catalog is needed.
 *
 * **Validates: Requirements 3.5, 5.1** (Design §Error Handling; §Components #3/#4)
 *
 * Three behaviours the handler pins:
 *   • Pre-warm writes a SERVABLE entry (Req 5.1): after one run, `readBriefingCache`
 *     returns a non-expired Briefing byte-identical to the assembled one.
 *   • Idempotent re-run (Req 5.1; spine idempotency by `briefingJobKey`): running
 *     the handler twice for the same (userId, window, periodDate) leaves exactly
 *     ONE cache row (upsert by PK) and the served entry is still valid — a re-run
 *     is a no-op/refresh.
 *   • Failure path (Req 3.6/3.7): an `assemble` returning `{ ok:false }` makes the
 *     handler throw and writes NO cache entry (a read returns null).
 *
 * pg-mem harness mirrors the sibling jsonb harness
 * `lib/cms/agents/home/briefing-cache.property.test.ts`: it uses Drizzle's
 * pg-proxy driver (params bound separately) so the assembled-Briefing `jsonb`
 * round-trips through pg-mem without its SQL lexer choking on the value text.
 */

const MIGRATION_FILE = "0037_briefing_cache.sql";

/** Stand up pg-mem with the briefing_cache migration applied + a drizzle handle. */
function buildDb(): { mem: IMemoryDb; db: Database } {
  const mem = newDb();

  // Register gen_random_uuid for parity with sibling harnesses (harmless here).
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });

  const migrationSql = readFileSync(
    join(process.cwd(), "drizzle", MIGRATION_FILE),
    "utf-8"
  );
  // 0037 carries no `--> statement-breakpoint`; pg-mem runs the
  // CREATE TABLE + CREATE INDEX (both `IF NOT EXISTS`) from the one string.
  mem.public.none(migrationSql);

  // pg-proxy driver over pg-mem: binds params separately, so the assembled
  // Briefing `jsonb` value is never interpolated into the SQL text.
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
  return { mem, db };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID = "11111111-1111-1111-1111-111111111111";
const WINDOW: BriefingWindow = "morning";
const PERIOD_DATE = "2025-03-14";

const KEY: CacheKey = { userId: USER_ID, window: WINDOW, periodDate: PERIOD_DATE };

/** A canned, already-assembled Briefing for the fixture key (no backslashes). */
function cannedBriefing(): Briefing {
  return {
    userId: USER_ID,
    window: WINDOW,
    periodDate: PERIOD_DATE,
    greeting: "Good morning",
    recap: {
      completed: [
        {
          id: "task-done-1",
          kind: "task",
          title: "Call back the Bayn enquiry",
          status: "done",
          dueAt: null,
          leadPhoneHash: null,
        },
      ],
      outstanding: [],
    },
    stack: [
      {
        id: "task-open-1",
        kind: "task",
        title: "Prepare today's viewing list",
        status: "open",
        dueAt: "2025-03-14T09:00:00.000Z",
        leadPhoneHash: null,
      },
    ],
    figures: [
      {
        metricId: "open_leads",
        scopeId: "rep:agent-1",
        period: "2025-03-14",
        value: 7,
        available: true,
      },
    ],
    invitesAdd: true,
    assembledAt: "2025-03-14T06:30:00.000Z",
  };
}

/** The job payload mirroring the canned key. */
const PAYLOAD: BriefingAssemblyPayload = {
  userId: USER_ID,
  window: WINDOW,
  periodDate: PERIOD_DATE,
  roles: ["rep"],
};

/** A JobContext keyed by the same `briefingJobKey` the spine enqueues under. */
const CTX: JobContext = {
  jobId: "job-1",
  jobKey: briefingJobKey(USER_ID, WINDOW, PERIOD_DATE),
  kind: "briefing_assembly",
  partyId: null,
};

/** All rows currently in `briefing_cache` (for counting). */
async function allCacheRows(db: Database) {
  return db.select().from(briefingCache);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("briefing_assembly handler (task 10.2)", () => {
  let db: Database;

  beforeEach(() => {
    ({ db } = buildDb());
  });

  it("pre-warms a servable, non-expired cache entry byte-identical to the assembled Briefing (Req 5.1)", async () => {
    const briefing = cannedBriefing();
    let calls = 0;
    const assemble = async (input: BriefingInput): Promise<BriefingResult> => {
      calls += 1;
      expect(input.userId).toBe(USER_ID);
      expect(input.window).toBe(WINDOW);
      expect(input.periodDate).toBe(PERIOD_DATE);
      return { ok: true, briefing };
    };

    const handler = createBriefingAssemblyHandler({ assemble });
    await handler(db, PAYLOAD, CTX);

    // The assembler ran exactly once, and the cache now holds a servable entry.
    expect(calls).toBe(1);
    const served = await readBriefingCache(db, KEY, new Date());
    expect(served).not.toBeNull();
    // Byte-identical to what was assembled (figure parity included, Req 5.7).
    expect(served).toEqual(briefing);
  });

  it("is idempotent: a re-run under the same jobKey leaves exactly one valid cache row (Req 5.1; spine idempotency)", async () => {
    const briefing = cannedBriefing();
    const assemble = async (): Promise<BriefingResult> => ({
      ok: true,
      briefing,
    });
    const handler = createBriefingAssemblyHandler({ assemble });

    // Run the handler twice for the same (userId, window, periodDate) / jobKey.
    await handler(db, PAYLOAD, CTX);
    await handler(db, PAYLOAD, CTX);

    // Upsert by the (user_id, window, period_date) PK ⇒ exactly ONE row.
    const rows = await allCacheRows(db);
    expect(rows).toHaveLength(1);

    // The served entry is still valid / non-expired and unchanged.
    const served = await readBriefingCache(db, KEY, new Date());
    expect(served).toEqual(briefing);
  });

  it("on assembly failure throws and writes no cache entry (Req 3.6/3.7)", async () => {
    const assemble = async (): Promise<BriefingResult> => ({
      ok: false,
      reason: "assembly_failed",
    });
    const handler = createBriefingAssemblyHandler({ assemble });

    await expect(handler(db, PAYLOAD, CTX)).rejects.toThrow(/assembly failed/i);

    // No partial pre-warm: the read is a miss.
    const served = await readBriefingCache(db, KEY, new Date());
    expect(served).toBeNull();
    const rows = await allCacheRows(db);
    expect(rows).toHaveLength(0);
  });
});
