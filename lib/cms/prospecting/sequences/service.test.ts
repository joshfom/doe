import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";

import type { Database } from "../../db";
import * as schema from "../../schema";
import type { BatchSubject } from "../batch/rerun-key";
import {
  clampRefreshInterval,
  createDraftSequence,
  updateSequenceConfig,
  DEFAULT_ENROLLMENT_CAP,
  DEFAULT_ENROLLMENT_PERIOD,
  DEFAULT_REFRESH_INTERVAL_MINUTES,
  MIN_REFRESH_INTERVAL_MINUTES,
} from "./service";

/**
 * Unit tests for the Sequence service (task 2.5).
 *
 * These exercise the owner-scoped persistence helpers in `service.ts` against a
 * REAL Drizzle handle backed by an in-memory Postgres (pg-mem), so the genuine
 * `INSERT … RETURNING` / `UPDATE … RETURNING` SQL the routes rely on actually
 * runs. They assert the create-time defaults and validation, the 60-minute
 * Refresh_Frequency clamp, and the `next_refresh_at` recompute on a cadence edit:
 *
 *   - create defaults: a new Sequence persists `status='draft'`,
 *     `enrollment_cap=200`, `enrollment_period='month'`, and
 *     `refresh_interval_minutes=1440` when no cadence is supplied
 *     (Req 1.2, 2.5, 2.7, 11.1, 11.3);
 *   - name validation: an empty / whitespace-only name is rejected with
 *     `invalid_name` and NO row is created (Req 2.5, 2.9);
 *   - cadence clamp: a sub-60-minute interval is clamped up to the 60-minute
 *     minimum (Req 2.7);
 *   - cadence edit: editing a `live` Sequence's Refresh_Frequency recomputes
 *     `next_refresh_at = now + interval` (Req 10.3).
 *
 * The pg-mem harness mirrors the sibling `enrollment.periods.property.test.ts`:
 * it stands up the PRE-existing tables 0043 ALTERs/references (`users` — the
 * `owner_rep` FK target; the full one-shot `prospecting_sequences` base table
 * from migration 0041; `targets`; `prospecting_batch_runs`), then applies the
 * real `drizzle/0043_prospecting_sequences.sql` so the additive lifecycle /
 * cadence / enrollment columns the service writes exist. The node-postgres
 * adapter wrapper strips pg-mem's unsupported `types` / `rowMode: "array"` and
 * honours drizzle's positional row mapping.
 *
 * _Requirements: 2.5, 2.7, 2.9, 10.3_
 */

const MIGRATION_FILE = "0043_prospecting_sequences.sql";

// Minimal stubs for the PRE-existing tables 0043 references, PLUS the full
// one-shot `prospecting_sequences` base table from migration 0041 (the service
// inserts every column the production schema declares, so the base table must
// carry `subject`, `target_count`, `mode`, and the timestamps, not just the id /
// owner_rep / name stub the migration smoke test uses). `users` is the
// `owner_rep` FK target; `targets` and `prospecting_batch_runs` are the FK
// targets of the new enrollment ledger 0043 creates.
const PREREQUISITE_SQL = `
  CREATE TABLE "users" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
  );
  CREATE TABLE "prospecting_sequences" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "owner_rep" uuid NOT NULL REFERENCES "users"("id"),
    "name" text NOT NULL,
    "description" text,
    "subject" jsonb NOT NULL,
    "target_count" integer DEFAULT 10 NOT NULL,
    "mode" text DEFAULT 'draft' NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "targets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
  );
  CREATE TABLE "prospecting_batch_runs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
  );
`;

/** Stand up a fresh pg-mem with the base tables + 0043 applied + a Drizzle handle. */
function buildDb(): {
  mem: IMemoryDb;
  db: Database;
  pool: { end: () => Promise<void> };
} {
  const mem = newDb();

  // pg-mem ships neither `gen_random_uuid()` nor a timestamptz `now()`; register
  // both so the column DEFAULTs resolve. Impure so each row gets a fresh value.
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

// ── Shared pg-mem harness ────────────────────────────────────────────────────
// Build the in-memory Postgres + Drizzle handle ONCE for the file, then revert
// to the empty-data restore point before each test for isolation.
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

beforeEach(() => {
  backup.restore();
});

/** Insert a minimal owning rep and return its id (the `owner_rep` FK anchor). */
function seedUser(): string {
  const id = randomUUID();
  mem.public.none(`INSERT INTO users (id) VALUES ('${id}')`);
  return id;
}

/** A subject that resolves to a filter (carries a clusterId) — passes the guard. */
const resolvableSubject: Partial<BatchSubject> = {
  kind: "cluster",
  clusterId: "cluster-123",
};

/** Count the persisted Sequence rows (to assert a rejected create persists none). */
function sequenceCount(): number {
  return Number(
    (
      mem.public.many(
        `SELECT count(*) AS c FROM prospecting_sequences`
      ) as Array<{ c: number | string }>
    )[0].c
  );
}

describe("createDraftSequence — defaults", () => {
  it("persists status='draft', cap=200, period='month', interval=1440 with no cadence supplied (Req 1.2, 2.7, 11.1, 11.3)", async () => {
    const ownerRep = seedUser();

    const result = await createDraftSequence(db, {
      ownerRep,
      name: "Q1 Penthouse buyers",
      subject: resolvableSubject,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.sequence.status).toBe("draft");
    expect(result.sequence.mode).toBe("draft");
    expect(result.sequence.enrollmentCap).toBe(DEFAULT_ENROLLMENT_CAP);
    expect(result.sequence.enrollmentCap).toBe(200);
    expect(result.sequence.enrollmentPeriod).toBe(DEFAULT_ENROLLMENT_PERIOD);
    expect(result.sequence.enrollmentPeriod).toBe("month");
    expect(result.sequence.refreshIntervalMinutes).toBe(
      DEFAULT_REFRESH_INTERVAL_MINUTES
    );
    expect(result.sequence.refreshIntervalMinutes).toBe(1440);
    // A draft is not scheduled — next_refresh_at is set on publish.
    expect(result.sequence.nextRefreshAt).toBeNull();
    expect(result.sequence.ownerRep).toBe(ownerRep);
    expect(result.sequence.name).toBe("Q1 Penthouse buyers");
  });
});

describe("createDraftSequence — name validation (Req 2.5, 2.9)", () => {
  it("rejects an empty name with invalid_name and creates no row", async () => {
    const ownerRep = seedUser();

    const result = await createDraftSequence(db, {
      ownerRep,
      name: "",
      subject: resolvableSubject,
    });

    expect(result).toEqual({ ok: false, code: "invalid_name" });
    expect(sequenceCount()).toBe(0);
  });

  it("rejects a whitespace-only name with invalid_name and creates no row", async () => {
    const ownerRep = seedUser();

    const result = await createDraftSequence(db, {
      ownerRep,
      name: "   \t  ",
      subject: resolvableSubject,
    });

    expect(result).toEqual({ ok: false, code: "invalid_name" });
    expect(sequenceCount()).toBe(0);
  });

  it("rejects a missing name with invalid_name and creates no row", async () => {
    const ownerRep = seedUser();

    const result = await createDraftSequence(db, {
      ownerRep,
      subject: resolvableSubject,
    });

    expect(result).toEqual({ ok: false, code: "invalid_name" });
    expect(sequenceCount()).toBe(0);
  });
});

describe("createDraftSequence — sub-60-minute cadence clamp (Req 2.7)", () => {
  it("clamps a sub-60-minute interval up to the 60-minute minimum", async () => {
    const ownerRep = seedUser();

    const result = await createDraftSequence(db, {
      ownerRep,
      name: "Hourly-ish",
      subject: resolvableSubject,
      refreshIntervalMinutes: 30,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sequence.refreshIntervalMinutes).toBe(
      MIN_REFRESH_INTERVAL_MINUTES
    );
    expect(result.sequence.refreshIntervalMinutes).toBe(60);
  });

  it("honours an at-or-above-minimum interval as given", async () => {
    const ownerRep = seedUser();

    const result = await createDraftSequence(db, {
      ownerRep,
      name: "Weekly",
      subject: resolvableSubject,
      refreshIntervalMinutes: 10080,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sequence.refreshIntervalMinutes).toBe(10080);
  });
});

describe("clampRefreshInterval — pure clamp (Req 2.7)", () => {
  it("clamps any sub-60 positive value to 60", () => {
    expect(clampRefreshInterval(1)).toBe(60);
    expect(clampRefreshInterval(59)).toBe(60);
    expect(clampRefreshInterval(60)).toBe(60);
  });

  it("floors fractional inputs to an integer", () => {
    expect(clampRefreshInterval(120.9)).toBe(120);
  });

  it("falls back to the daily default for absent / non-positive / non-numeric input", () => {
    expect(clampRefreshInterval(undefined)).toBe(DEFAULT_REFRESH_INTERVAL_MINUTES);
    expect(clampRefreshInterval(0)).toBe(DEFAULT_REFRESH_INTERVAL_MINUTES);
    expect(clampRefreshInterval(-5)).toBe(DEFAULT_REFRESH_INTERVAL_MINUTES);
    expect(clampRefreshInterval("not a number")).toBe(
      DEFAULT_REFRESH_INTERVAL_MINUTES
    );
  });
});

describe("updateSequenceConfig — next_refresh_at recompute on cadence edit (Req 10.3)", () => {
  it("recomputes next_refresh_at = now + interval when a live Sequence's cadence changes", async () => {
    const ownerRep = seedUser();

    const created = await createDraftSequence(db, {
      ownerRep,
      name: "Live campaign",
      subject: resolvableSubject,
      refreshIntervalMinutes: 1440,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Make the Sequence `live` so the cadence recompute is meaningful — set
    // status='live' directly to keep this test focused on updateSequenceConfig.
    mem.public.none(
      `UPDATE prospecting_sequences SET status = 'live', mode = 'live' WHERE id = '${created.sequence.id}'`
    );
    const liveSeq = { ...created.sequence, status: "live" as const, mode: "live" as const };

    const now = new Date("2026-02-01T00:00:00.000Z");
    const newIntervalMinutes = 120;

    const result = await updateSequenceConfig(
      db,
      liveSeq,
      { refreshIntervalMinutes: newIntervalMinutes },
      now
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sequence.refreshIntervalMinutes).toBe(newIntervalMinutes);
    const expectedNext = new Date(now.getTime() + newIntervalMinutes * 60_000);
    expect(result.sequence.nextRefreshAt?.getTime()).toBe(expectedNext.getTime());
  });

  it("clamps a sub-60-minute cadence edit and recomputes next_refresh_at from the clamped interval", async () => {
    const ownerRep = seedUser();

    const created = await createDraftSequence(db, {
      ownerRep,
      name: "Live campaign 2",
      subject: resolvableSubject,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    mem.public.none(
      `UPDATE prospecting_sequences SET status = 'live', mode = 'live' WHERE id = '${created.sequence.id}'`
    );
    const liveSeq = { ...created.sequence, status: "live" as const, mode: "live" as const };

    const now = new Date("2026-03-10T12:00:00.000Z");

    const result = await updateSequenceConfig(
      db,
      liveSeq,
      { refreshIntervalMinutes: 15 },
      now
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 15 is clamped up to the 60-minute minimum, and the recompute uses 60.
    expect(result.sequence.refreshIntervalMinutes).toBe(60);
    const expectedNext = new Date(now.getTime() + 60 * 60_000);
    expect(result.sequence.nextRefreshAt?.getTime()).toBe(expectedNext.getTime());
  });

  it("does not schedule a non-live Sequence on a cadence edit (next_refresh_at stays null)", async () => {
    const ownerRep = seedUser();

    const created = await createDraftSequence(db, {
      ownerRep,
      name: "Still a draft",
      subject: resolvableSubject,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const now = new Date("2026-04-01T00:00:00.000Z");

    const result = await updateSequenceConfig(
      db,
      created.sequence,
      { refreshIntervalMinutes: 240 },
      now
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sequence.refreshIntervalMinutes).toBe(240);
    // A draft is not actively scheduled — the cadence is stored but no slot set.
    expect(result.sequence.nextRefreshAt).toBeNull();
  });
});
