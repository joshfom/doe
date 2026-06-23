import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";

/**
 * Migration smoke test for the prospecting-sequences increment (task 1.4).
 *
 * Applies the real `drizzle/0043_prospecting_sequences.sql` migration under an
 * in-memory Postgres (pg-mem) and asserts the strictly-additive schema it
 * introduces:
 *   - the seven NEW nullable columns on the pre-existing `prospecting_sequences`
 *     table: `status`, `refresh_interval_minutes`, `last_refreshed_at`,
 *     `next_refresh_at`, `enrollment_cap`, `enrollment_period`, `archived_at`
 *     (Req 1.1, 4.4, 4.5, 11.1, 11.3)
 *   - the NEW table `prospecting_sequence_enrollments` with its columns
 *     (the per-Sequence enrollment ledger, Req 5.1, 5.2)
 *   - the unique `(sequence_id, match_kind, match_value)` index that enrolls a
 *     prospect in a given Sequence at most once across all its refreshes
 *     (Req 5.1, 5.2) and the supporting `(sequence_id, period_bucket)` index
 *     that backs the fast enrollment-cap count (Req 11.3).
 *
 * 0043 is purely additive and references the PRE-existing `prospecting_sequences`
 * (ALTER TABLE target), `targets`, and `prospecting_batch_runs` tables (FK
 * targets of the new ledger table). Those tables are owned by earlier
 * migrations, so they are stood up here as minimal stubs so the real migration
 * applies verbatim and its references resolve. The cross-table shapes themselves
 * are out of scope here.
 *
 * Harness mirrors the sibling `migration-0040.test.ts`:
 *   - the `--> statement-breakpoint` splitter + verbatim apply, and
 *   - the `gen_random_uuid()` registration pg-mem lacks.
 *
 * Design reference: §Data Models (changed table + new table).
 * Requirements: 5.1.
 */

const MIGRATION_FILE = "0043_prospecting_sequences.sql";

// Minimal stubs for the PRE-existing tables 0043 references. `prospecting_sequences`
// is the ALTER TABLE target (and FK target of `prospecting_sequence_enrollments.sequence_id`);
// `targets` is the FK target of `prospecting_sequence_enrollments.target_id`;
// `prospecting_batch_runs` is the FK target of
// `prospecting_sequence_enrollments.batch_run_id`.
const PREREQUISITE_SQL = `
  CREATE TABLE "prospecting_sequences" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "owner_rep" uuid,
    "name" text,
    "mode" text
  );
  CREATE TABLE "targets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
  );
  CREATE TABLE "prospecting_batch_runs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
  );
`;

function buildMigratedDb(): IMemoryDb {
  const mem = newDb();

  // pg-mem does not ship `gen_random_uuid()`; register it so DEFAULTs resolve.
  // Mark impure so each row gets a fresh uuid rather than a cached single value.
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });

  // pg-mem does not ship `now()` returning timestamptz by default in all paths;
  // register it so column DEFAULT now() resolves on the ledger table.
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

  // Drizzle separates statements with the `--> statement-breakpoint` marker;
  // apply each statement in order (mirrors the sibling migration harness).
  for (const statement of sql.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) {
      mem.public.none(trimmed);
    }
  }

  return mem;
}

/** Does a column exist on a table? (information_schema is supported by pg-mem.) */
function columnExists(mem: IMemoryDb, table: string, column: string): boolean {
  const rows = mem.public.many(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = '${table}' AND column_name = '${column}'`
  );
  return rows.length === 1;
}

/** Insert a minimal sequence and return its id. */
function seedSequence(mem: IMemoryDb): string {
  const id = randomUUID();
  mem.public.none(`INSERT INTO prospecting_sequences (id) VALUES ('${id}')`);
  return id;
}

/** Insert a minimal target and return its id. */
function seedTarget(mem: IMemoryDb): string {
  const id = randomUUID();
  mem.public.none(`INSERT INTO targets (id) VALUES ('${id}')`);
  return id;
}

/** Insert a minimal batch run and return its id. */
function seedBatchRun(mem: IMemoryDb): string {
  const id = randomUUID();
  mem.public.none(`INSERT INTO prospecting_batch_runs (id) VALUES ('${id}')`);
  return id;
}

/** Insert an enrollment ledger row; returns nothing (throws on constraint violation). */
function seedEnrollment(
  mem: IMemoryDb,
  args: {
    sequenceId: string;
    matchKind: string;
    matchValue: string;
    targetId: string;
    batchRunId: string;
    periodBucket?: string;
  }
): void {
  const id = randomUUID();
  mem.public.none(
    `INSERT INTO prospecting_sequence_enrollments
       (id, sequence_id, match_kind, match_value, target_id, batch_run_id, period_bucket)
     VALUES ('${id}', '${args.sequenceId}', '${args.matchKind}', '${args.matchValue}',
             '${args.targetId}', '${args.batchRunId}', '${args.periodBucket ?? "2026-01"}')`
  );
}

describe("Prospecting sequences migration 0043 (additive schema)", () => {
  let mem: IMemoryDb;

  beforeAll(() => {
    mem = buildMigratedDb();
  });

  // ── new table exists ──────────────────────────────────────────────────────────
  describe("tables", () => {
    it("creates the prospecting_sequence_enrollments table", () => {
      const rows = mem.public.many(
        `SELECT table_name FROM information_schema.tables`
      ) as Array<{ table_name: string }>;
      const names = new Set(rows.map((r) => r.table_name));
      expect(names.has("prospecting_sequence_enrollments")).toBe(true);
    });
  });

  // ── additive columns exist ────────────────────────────────────────────────────
  describe("columns", () => {
    const EXPECTED_COLUMNS: Array<[string, string]> = [
      // prospecting_sequences — additive lifecycle / cadence / enrollment columns
      ["prospecting_sequences", "status"],
      ["prospecting_sequences", "refresh_interval_minutes"],
      ["prospecting_sequences", "last_refreshed_at"],
      ["prospecting_sequences", "next_refresh_at"],
      ["prospecting_sequences", "enrollment_cap"],
      ["prospecting_sequences", "enrollment_period"],
      ["prospecting_sequences", "archived_at"],
      // prospecting_sequence_enrollments — the per-Sequence enrollment ledger
      ["prospecting_sequence_enrollments", "id"],
      ["prospecting_sequence_enrollments", "sequence_id"],
      ["prospecting_sequence_enrollments", "match_kind"],
      ["prospecting_sequence_enrollments", "match_value"],
      ["prospecting_sequence_enrollments", "target_id"],
      ["prospecting_sequence_enrollments", "batch_run_id"],
      ["prospecting_sequence_enrollments", "period_bucket"],
      ["prospecting_sequence_enrollments", "created_at"],
    ];

    it.each(EXPECTED_COLUMNS)('"%s" has the "%s" column', (table, column) => {
      expect(columnExists(mem, table, column)).toBe(true);
    });
  });

  // ── additive prospecting_sequences columns default sanely ─────────────────────
  describe("prospecting_sequences additive columns", () => {
    it("defaults status to 'draft' and applies cadence / cap / period defaults (Req 1.1, 4.5, 11.1, 11.3)", () => {
      const id = seedSequence(mem);
      const [row] = mem.public.many(
        `SELECT status, refresh_interval_minutes, enrollment_cap, enrollment_period,
                last_refreshed_at, next_refresh_at, archived_at
           FROM prospecting_sequences WHERE id = '${id}'`
      ) as Array<{
        status: string;
        refresh_interval_minutes: number;
        enrollment_cap: number;
        enrollment_period: string;
        last_refreshed_at: Date | null;
        next_refresh_at: Date | null;
        archived_at: Date | null;
      }>;
      expect(row.status).toBe("draft");
      expect(row.refresh_interval_minutes).toBe(1440);
      expect(row.enrollment_cap).toBe(200);
      expect(row.enrollment_period).toBe("month");
      // nullable bookkeeping columns are null until first refresh / archive
      expect(row.last_refreshed_at).toBeNull();
      expect(row.next_refresh_at).toBeNull();
      expect(row.archived_at).toBeNull();
    });
  });

  // ── indexes exist (best-effort introspection) ─────────────────────────────────
  describe("indexes", () => {
    it("prospecting_sequence_enrollments has the unique (sequence_id, match_kind, match_value) index (Req 5.1, 5.2)", () => {
      const indices = mem.public
        .getTable("prospecting_sequence_enrollments")
        .listIndices() as Array<{ name?: string; unique?: boolean }>;
      const ix = indices.find(
        (i) => i.name === "prospecting_sequence_enrollments_seq_match_ux"
      );
      expect(ix).toBeDefined();
      expect(ix?.unique).toBe(true);
    });

    it("prospecting_sequence_enrollments has the (sequence_id, period_bucket) index (Req 11.3)", () => {
      const indices = mem.public
        .getTable("prospecting_sequence_enrollments")
        .listIndices() as Array<{ name?: string; unique?: boolean }>;
      const ix = indices.find(
        (i) => i.name === "prospecting_sequence_enrollments_seq_period_idx"
      );
      expect(ix).toBeDefined();
    });
  });

  // ── unique constraint behaves ─────────────────────────────────────────────────
  describe("enrollment-at-most-once unique constraint", () => {
    it("rejects a duplicate (sequence_id, match_kind, match_value) enrollment (Req 5.1, 5.2)", () => {
      const sequenceId = seedSequence(mem);
      const targetA = seedTarget(mem);
      const targetB = seedTarget(mem);
      const runA = seedBatchRun(mem);
      const runB = seedBatchRun(mem);

      seedEnrollment(mem, {
        sequenceId,
        matchKind: "email",
        matchValue: "a@example.com",
        targetId: targetA,
        batchRunId: runA,
      });

      // A second refresh re-discovering the same identity must be rejected by the
      // unique index — the ON CONFLICT DO NOTHING insert relies on this.
      expect(() =>
        seedEnrollment(mem, {
          sequenceId,
          matchKind: "email",
          matchValue: "a@example.com",
          targetId: targetB,
          batchRunId: runB,
        })
      ).toThrow();
    });

    it("allows the same identity under a different Sequence (index is composite, Req 5.1)", () => {
      const sequenceA = seedSequence(mem);
      const sequenceB = seedSequence(mem);
      const targetId = seedTarget(mem);
      const runId = seedBatchRun(mem);

      seedEnrollment(mem, {
        sequenceId: sequenceA,
        matchKind: "email",
        matchValue: "shared@example.com",
        targetId,
        batchRunId: runId,
      });

      expect(() =>
        seedEnrollment(mem, {
          sequenceId: sequenceB,
          matchKind: "email",
          matchValue: "shared@example.com",
          targetId,
          batchRunId: runId,
        })
      ).not.toThrow();
    });

    it("allows the same value under a different match_kind within a Sequence (index is composite)", () => {
      const sequenceId = seedSequence(mem);
      const targetId = seedTarget(mem);
      const runId = seedBatchRun(mem);

      seedEnrollment(mem, {
        sequenceId,
        matchKind: "email",
        matchValue: "shared-value",
        targetId,
        batchRunId: runId,
      });

      expect(() =>
        seedEnrollment(mem, {
          sequenceId,
          matchKind: "phone_hash",
          matchValue: "shared-value",
          targetId,
          batchRunId: runId,
        })
      ).not.toThrow();
    });
  });
});
