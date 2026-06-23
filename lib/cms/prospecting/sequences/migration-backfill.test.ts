import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";

/**
 * Backfill semantics — migration 0043 (task 9.2).
 *
 * Asserts the backfill DML appended to `drizzle/0043_prospecting_sequences.sql`
 * (task 9.1) migrates legacy ONE-SHOT `prospecting_sequences` rows onto the new
 * lifecycle/cadence model (design §Data Models "Migration of existing one-shot
 * rows", Decisions 7; Requirements 3.1, 4.1):
 *   - `status` is backfilled from the legacy `mode` (`draft`→`draft`,
 *     `live`→`live`);
 *   - the cadence / cap defaults are set (`refresh_interval_minutes = 1440`,
 *     `enrollment_cap = 200`, `enrollment_period = 'month'`);
 *   - a `live` row receives `next_refresh_at = now()`, every other status stays
 *     unscheduled (`null`);
 *   - `target_count` is preserved verbatim as the per-refresh batch size.
 *
 * The legacy rows are inserted into the BASE `prospecting_sequences` table
 * (mode + target_count, no lifecycle columns) BEFORE the 0043 migration runs, so
 * the ALTERs + backfill execute against pre-existing data exactly as on a live
 * DB. Re-running the migration is asserted idempotent (a row advanced past the
 * default is never clobbered).
 */

const SEQUENCE_MIGRATION_FILE = "0043_prospecting_sequences.sql";

// The base (0041) one-shot sequences table plus the two tables 0043's enrollment
// ledger FKs reference — the additive ground 0043 extends.
const BASE_SQL = `
  CREATE TABLE "targets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
  );
  CREATE TABLE "prospecting_batch_runs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
  );
  CREATE TABLE "prospecting_sequences" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "owner_rep" uuid NOT NULL,
    "name" text NOT NULL,
    "description" text,
    "subject" jsonb NOT NULL,
    "target_count" integer NOT NULL DEFAULT 10,
    "mode" text NOT NULL DEFAULT 'draft',
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
`;

function migrationStatements(): string[] {
  const migration = readFileSync(
    join(process.cwd(), "drizzle", SEQUENCE_MIGRATION_FILE),
    "utf-8"
  );
  return migration
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Apply the WHOLE 0043 migration (DDL + backfill). */
function applyMigration(mem: IMemoryDb): void {
  for (const statement of migrationStatements()) mem.public.none(statement);
}

/**
 * Re-apply ONLY the backfill UPDATE statements. On real Postgres re-running the
 * full migration is safe (its DDL is `IF NOT EXISTS`), but pg-mem cannot re-run
 * `CREATE TABLE IF NOT EXISTS` on an existing table, so the idempotency of the
 * DATA backfill (the part this test targets) is exercised on its own.
 */
function applyBackfill(mem: IMemoryDb): void {
  for (const statement of migrationStatements()) {
    if (/^UPDATE /i.test(statement)) mem.public.none(statement);
  }
}


interface SeqRow {
  id: string;
  status: string | null;
  mode: string;
  target_count: number;
  refresh_interval_minutes: number | null;
  enrollment_cap: number | null;
  enrollment_period: string | null;
  next_refresh_at: Date | null;
}

function readSeq(mem: IMemoryDb, id: string): SeqRow {
  return mem.public.many(
    `SELECT id, status, mode, target_count, refresh_interval_minutes, ` +
      `enrollment_cap, enrollment_period, next_refresh_at ` +
      `FROM "prospecting_sequences" WHERE id = '${id}'`
  )[0] as SeqRow;
}

let mem!: IMemoryDb;
let draftId!: string;
let liveId!: string;

beforeEach(() => {
  mem = newDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });
  mem.public.registerFunction({
    name: "now",
    returns: DataType.timestamptz,
    implementation: () => new Date(),
    impure: true,
  });

  mem.public.none(BASE_SQL);

  // Seed two LEGACY one-shot rows BEFORE the migration runs: a draft (mode=draft,
  // target_count=7) and a live (mode=live, target_count=25).
  draftId = randomUUID();
  liveId = randomUUID();
  mem.public.none(
    `INSERT INTO "prospecting_sequences" ("id","owner_rep","name","subject","target_count","mode") ` +
      `VALUES ('${draftId}', '${randomUUID()}', 'Legacy draft', '{"kind":"icp"}'::jsonb, 7, 'draft')`
  );
  mem.public.none(
    `INSERT INTO "prospecting_sequences" ("id","owner_rep","name","subject","target_count","mode") ` +
      `VALUES ('${liveId}', '${randomUUID()}', 'Legacy live', '{"kind":"icp"}'::jsonb, 25, 'live')`
  );
});

describe("migration 0043 — backfill of existing one-shot rows (Req 3.1, 4.1)", () => {
  it("backfills status from mode, sets defaults, schedules live rows, and preserves target_count", () => {
    applyMigration(mem);

    const draft = readSeq(mem, draftId);
    const live = readSeq(mem, liveId);

    // (Req 3.1) status backfilled from mode.
    expect(draft.status).toBe("draft");
    expect(live.status).toBe("live");

    // Cadence / cap defaults set on both.
    for (const row of [draft, live]) {
      expect(Number(row.refresh_interval_minutes)).toBe(1440);
      expect(Number(row.enrollment_cap)).toBe(200);
      expect(row.enrollment_period).toBe("month");
    }

    // (Req 4.1) a live row is scheduled; a draft row stays unscheduled.
    expect(live.next_refresh_at).not.toBeNull();
    expect(draft.next_refresh_at).toBeNull();

    // target_count preserved verbatim as the per-refresh batch size (no fixed-N stop).
    expect(Number(draft.target_count)).toBe(7);
    expect(Number(live.target_count)).toBe(25);
  });

  it("is idempotent — a second migration run leaves the backfilled values intact", () => {
    applyMigration(mem);
    const liveSlot = readSeq(mem, liveId).next_refresh_at;

    applyBackfill(mem);

    const draft = readSeq(mem, draftId);
    const live = readSeq(mem, liveId);
    expect(draft.status).toBe("draft");
    expect(live.status).toBe("live");
    // The scheduled slot is not re-stamped on a re-run (still set, unchanged).
    expect(live.next_refresh_at).not.toBeNull();
    expect(new Date(live.next_refresh_at as Date).getTime()).toBe(
      new Date(liveSlot as Date).getTime()
    );
    expect(Number(draft.target_count)).toBe(7);
    expect(Number(live.target_count)).toBe(25);
  });

  it("does not clobber a row already advanced past the default by the new lifecycle", () => {
    applyMigration(mem);
    // Simulate a row paused via the new lifecycle (status=paused, mode kept in sync).
    mem.public.none(
      `UPDATE "prospecting_sequences" SET "status" = 'paused', "mode" = 'draft' WHERE id = '${liveId}'`
    );

    // Re-running the backfill must NOT resurrect it to 'live' from mode.
    applyBackfill(mem);

    expect(readSeq(mem, liveId).status).toBe("paused");
  });
});
