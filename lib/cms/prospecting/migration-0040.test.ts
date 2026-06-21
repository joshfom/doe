import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";

/**
 * Migration smoke test for the agentic-prospecting-batch increment (task 1.4).
 *
 * Applies the real `drizzle/0040_agentic_prospecting_batch.sql` migration under
 * an in-memory Postgres (pg-mem) and asserts the strictly-additive schema it
 * introduces:
 *   - the six NEW tables `prospecting_batch_runs`, `prospecting_queue_items`,
 *     `prospecting_target_claims`, `prospecting_send_counters`,
 *     `prospecting_send_ledger`, `prospecting_batch_activity` with their columns
 *   - the additive nullable `outreach_drafts` columns `ai_original_subject` and
 *     `ai_original_body`
 *   - the unique constraints / indexes the design depends on:
 *       · `prospecting_batch_runs.rerun_key` UNIQUE (re-run idempotency, Req 9.1)
 *       · `prospecting_queue_items (batch_run_id, target_id)` UNIQUE (Req 9.2)
 *       · `prospecting_target_claims (match_kind, match_value)` UNIQUE (Req 6.2)
 *       · `prospecting_send_ledger (draft_id, scope_kind)` UNIQUE (Req 7.6)
 *       · `prospecting_send_counters` composite PK
 *         `(scope_kind, scope_id, period_bucket)` (Req 7.1, 7.4, 7.5)
 *
 * 0040 is purely additive and references the PRE-existing `users`, `targets`,
 * and `outreach_drafts` tables (FK targets + the `outreach_drafts` ADD COLUMNs).
 * Those tables are owned by earlier migrations, so they are stood up here as
 * minimal stubs so the real migration applies verbatim and its references
 * resolve. The cross-table shapes themselves are out of scope here.
 *
 * Harness mirrors the sibling `migration-0039.test.ts`:
 *   - the `--> statement-breakpoint` splitter + verbatim apply, and
 *   - the `gen_random_uuid()` registration pg-mem lacks.
 *
 * Design reference: §Data Models (all new tables + additive columns).
 * Requirements: 1.3.
 */

const MIGRATION_FILE = "0040_agentic_prospecting_batch.sql";

// Minimal stubs for the PRE-existing tables 0040 references. `users` is the FK
// target of `*.owner_rep`; `targets` is the FK target of
// `prospecting_queue_items.target_id`; `outreach_drafts` is the FK target of
// `prospecting_queue_items.draft_id` / `prospecting_send_ledger.draft_id` and
// receives the new `ai_original_*` columns.
const PREREQUISITE_SQL = `
  CREATE TABLE "users" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
  );
  CREATE TABLE "targets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
  );
  CREATE TABLE "outreach_drafts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "subject" text,
    "body" text
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

/** Insert a minimal user and return its id. */
function seedUser(mem: IMemoryDb): string {
  const id = randomUUID();
  mem.public.none(`INSERT INTO users (id) VALUES ('${id}')`);
  return id;
}

/** Insert a minimal target and return its id. */
function seedTarget(mem: IMemoryDb): string {
  const id = randomUUID();
  mem.public.none(`INSERT INTO targets (id) VALUES ('${id}')`);
  return id;
}

/** Insert a minimal outreach_draft and return its id. */
function seedDraft(mem: IMemoryDb): string {
  const id = randomUUID();
  mem.public.none(`INSERT INTO outreach_drafts (id) VALUES ('${id}')`);
  return id;
}

/** Insert a minimal batch run and return its id. */
function seedBatchRun(mem: IMemoryDb, ownerRep: string, rerunKey: string): string {
  const id = randomUUID();
  mem.public.none(
    `INSERT INTO prospecting_batch_runs (id, owner_rep, subject, target_count, rerun_key)
     VALUES ('${id}', '${ownerRep}', '{"kind":"icp"}', 5, '${rerunKey}')`
  );
  return id;
}

describe("Agentic prospecting batch migration 0040 (additive schema)", () => {
  let mem: IMemoryDb;

  beforeAll(() => {
    mem = buildMigratedDb();
  });

  // ── tables exist ─────────────────────────────────────────────────────────────
  describe("tables", () => {
    const NEW_TABLES = [
      "prospecting_batch_runs",
      "prospecting_queue_items",
      "prospecting_target_claims",
      "prospecting_send_counters",
      "prospecting_send_ledger",
      "prospecting_batch_activity",
    ];

    it.each(NEW_TABLES)('creates the "%s" table', (table) => {
      const rows = mem.public.many(
        `SELECT table_name FROM information_schema.tables`
      ) as Array<{ table_name: string }>;
      const names = new Set(rows.map((r) => r.table_name));
      expect(names.has(table)).toBe(true);
    });
  });

  // ── columns exist ────────────────────────────────────────────────────────────
  describe("columns", () => {
    const EXPECTED_COLUMNS: Array<[string, string]> = [
      // prospecting_batch_runs
      ["prospecting_batch_runs", "owner_rep"],
      ["prospecting_batch_runs", "subject"],
      ["prospecting_batch_runs", "cluster_id"],
      ["prospecting_batch_runs", "target_count"],
      ["prospecting_batch_runs", "status"],
      ["prospecting_batch_runs", "rerun_key"],
      ["prospecting_batch_runs", "reason"],
      // prospecting_queue_items
      ["prospecting_queue_items", "batch_run_id"],
      ["prospecting_queue_items", "target_id"],
      ["prospecting_queue_items", "draft_id"],
      ["prospecting_queue_items", "eligibility"],
      ["prospecting_queue_items", "skip_reason"],
      ["prospecting_queue_items", "fit_score"],
      ["prospecting_queue_items", "fit_rationale"],
      ["prospecting_queue_items", "lawful_basis"],
      ["prospecting_queue_items", "data_source"],
      ["prospecting_queue_items", "acquired_at"],
      ["prospecting_queue_items", "status"],
      // prospecting_target_claims
      ["prospecting_target_claims", "match_kind"],
      ["prospecting_target_claims", "match_value"],
      ["prospecting_target_claims", "owner_rep"],
      ["prospecting_target_claims", "batch_run_id"],
      ["prospecting_target_claims", "queue_item_id"],
      // prospecting_send_counters
      ["prospecting_send_counters", "scope_kind"],
      ["prospecting_send_counters", "scope_id"],
      ["prospecting_send_counters", "period_bucket"],
      ["prospecting_send_counters", "consumed"],
      ["prospecting_send_counters", "cap"],
      // prospecting_send_ledger
      ["prospecting_send_ledger", "draft_id"],
      ["prospecting_send_ledger", "scope_kind"],
      ["prospecting_send_ledger", "scope_id"],
      ["prospecting_send_ledger", "period_bucket"],
      // prospecting_batch_activity
      ["prospecting_batch_activity", "batch_run_id"],
      ["prospecting_batch_activity", "seq"],
      ["prospecting_batch_activity", "action"],
      ["prospecting_batch_activity", "reason"],
      ["prospecting_batch_activity", "target_id"],
      ["prospecting_batch_activity", "payload"],
      // outreach_drafts — additive AI-original retention columns
      ["outreach_drafts", "ai_original_subject"],
      ["outreach_drafts", "ai_original_body"],
    ];

    it.each(EXPECTED_COLUMNS)('"%s" has the "%s" column', (table, column) => {
      expect(columnExists(mem, table, column)).toBe(true);
    });
  });

  // ── outreach_drafts additive columns are nullable ────────────────────────────
  describe("outreach_drafts additive columns", () => {
    it("allows inserting a draft with NULL ai_original_* (additive nullable, Req 4.2)", () => {
      const id = randomUUID();
      expect(() =>
        mem.public.none(`INSERT INTO outreach_drafts (id) VALUES ('${id}')`)
      ).not.toThrow();

      const [row] = mem.public.many(
        `SELECT ai_original_subject, ai_original_body FROM outreach_drafts WHERE id = '${id}'`
      ) as Array<{ ai_original_subject: string | null; ai_original_body: string | null }>;
      expect(row.ai_original_subject).toBeNull();
      expect(row.ai_original_body).toBeNull();
    });
  });

  // ── indexes exist (best-effort introspection) ────────────────────────────────
  describe("indexes", () => {
    it("prospecting_batch_runs has the unique rerun_key index", () => {
      const indices = mem.public
        .getTable("prospecting_batch_runs")
        .listIndices() as Array<{ name?: string; unique?: boolean }>;
      const ix = indices.find(
        (i) => i.name === "prospecting_batch_runs_rerun_key_ux"
      );
      expect(ix).toBeDefined();
      expect(ix?.unique).toBe(true);
    });

    it("prospecting_queue_items has the unique (batch_run_id, target_id) index", () => {
      const indices = mem.public
        .getTable("prospecting_queue_items")
        .listIndices() as Array<{ name?: string; unique?: boolean }>;
      const ix = indices.find(
        (i) => i.name === "prospecting_queue_items_run_target_ux"
      );
      expect(ix).toBeDefined();
      expect(ix?.unique).toBe(true);
    });

    it("prospecting_target_claims has the unique (match_kind, match_value) index", () => {
      const indices = mem.public
        .getTable("prospecting_target_claims")
        .listIndices() as Array<{ name?: string; unique?: boolean }>;
      const ix = indices.find(
        (i) => i.name === "prospecting_target_claims_match_ux"
      );
      expect(ix).toBeDefined();
      expect(ix?.unique).toBe(true);
    });

    it("prospecting_send_ledger has the unique (draft_id, scope_kind) index", () => {
      const indices = mem.public
        .getTable("prospecting_send_ledger")
        .listIndices() as Array<{ name?: string; unique?: boolean }>;
      const ix = indices.find(
        (i) => i.name === "prospecting_send_ledger_draft_scope_ux"
      );
      expect(ix).toBeDefined();
      expect(ix?.unique).toBe(true);
    });
  });

  // ── unique constraints behave ─────────────────────────────────────────────────
  describe("unique constraints", () => {
    it("rejects a duplicate rerun_key on prospecting_batch_runs (Req 9.1)", () => {
      const rep = seedUser(mem);
      seedBatchRun(mem, rep, "rep:subject:abc");
      expect(() => seedBatchRun(mem, rep, "rep:subject:abc")).toThrow();
    });

    it("rejects a duplicate (batch_run_id, target_id) queue item (Req 9.2)", () => {
      const rep = seedUser(mem);
      const runId = seedBatchRun(mem, rep, "rep:subject:queue-dup");
      const targetId = seedTarget(mem);
      mem.public.none(
        `INSERT INTO prospecting_queue_items (batch_run_id, target_id, eligibility)
         VALUES ('${runId}', '${targetId}', 'cold_eligible')`
      );
      expect(() =>
        mem.public.none(
          `INSERT INTO prospecting_queue_items (batch_run_id, target_id, eligibility)
           VALUES ('${runId}', '${targetId}', 'warm_path')`
        )
      ).toThrow();
    });

    it("allows the same target under a different batch run (index is composite)", () => {
      const rep = seedUser(mem);
      const runA = seedBatchRun(mem, rep, "rep:subject:run-a");
      const runB = seedBatchRun(mem, rep, "rep:subject:run-b");
      const targetId = seedTarget(mem);
      mem.public.none(
        `INSERT INTO prospecting_queue_items (batch_run_id, target_id, eligibility)
         VALUES ('${runA}', '${targetId}', 'cold_eligible')`
      );
      expect(() =>
        mem.public.none(
          `INSERT INTO prospecting_queue_items (batch_run_id, target_id, eligibility)
           VALUES ('${runB}', '${targetId}', 'cold_eligible')`
        )
      ).not.toThrow();
    });

    it("rejects a duplicate (match_kind, match_value) target claim (Req 6.2)", () => {
      const rep = seedUser(mem);
      mem.public.none(
        `INSERT INTO prospecting_target_claims (match_kind, match_value, owner_rep)
         VALUES ('email', 'a@example.com', '${rep}')`
      );
      expect(() =>
        mem.public.none(
          `INSERT INTO prospecting_target_claims (match_kind, match_value, owner_rep)
           VALUES ('email', 'a@example.com', '${rep}')`
        )
      ).toThrow();
    });

    it("allows the same value under a different match_kind (key is composite)", () => {
      const rep = seedUser(mem);
      mem.public.none(
        `INSERT INTO prospecting_target_claims (match_kind, match_value, owner_rep)
         VALUES ('email', 'shared-value', '${rep}')`
      );
      expect(() =>
        mem.public.none(
          `INSERT INTO prospecting_target_claims (match_kind, match_value, owner_rep)
           VALUES ('phone_hash', 'shared-value', '${rep}')`
        )
      ).not.toThrow();
    });

    it("rejects a duplicate (draft_id, scope_kind) send-ledger row (Req 7.6)", () => {
      const draftId = seedDraft(mem);
      mem.public.none(
        `INSERT INTO prospecting_send_ledger (draft_id, scope_kind, scope_id, period_bucket)
         VALUES ('${draftId}', 'rep', 'rep-1', '2026-01-15')`
      );
      expect(() =>
        mem.public.none(
          `INSERT INTO prospecting_send_ledger (draft_id, scope_kind, scope_id, period_bucket)
           VALUES ('${draftId}', 'rep', 'rep-2', '2026-01-16')`
        )
      ).toThrow();
    });

    it("allows the same draft to count once per distinct scope_kind (rep + cluster independent, Req 7.6)", () => {
      const draftId = seedDraft(mem);
      mem.public.none(
        `INSERT INTO prospecting_send_ledger (draft_id, scope_kind, scope_id, period_bucket)
         VALUES ('${draftId}', 'rep', 'rep-1', '2026-01-15')`
      );
      expect(() =>
        mem.public.none(
          `INSERT INTO prospecting_send_ledger (draft_id, scope_kind, scope_id, period_bucket)
           VALUES ('${draftId}', 'cluster', 'cluster-1', '2026-01-15')`
        )
      ).not.toThrow();
    });

    it("rejects a duplicate (scope_kind, scope_id, period_bucket) send counter (composite PK, Req 7.1)", () => {
      mem.public.none(
        `INSERT INTO prospecting_send_counters (scope_kind, scope_id, period_bucket, consumed)
         VALUES ('rep', 'rep-99', '2026-02-01', 1)`
      );
      expect(() =>
        mem.public.none(
          `INSERT INTO prospecting_send_counters (scope_kind, scope_id, period_bucket, consumed)
           VALUES ('rep', 'rep-99', '2026-02-01', 5)`
        )
      ).toThrow();
    });

    it("allows the same scope under a different period bucket (PK is composite, Req 7.4)", () => {
      mem.public.none(
        `INSERT INTO prospecting_send_counters (scope_kind, scope_id, period_bucket, consumed)
         VALUES ('rep', 'rep-100', '2026-02-01', 1)`
      );
      expect(() =>
        mem.public.none(
          `INSERT INTO prospecting_send_counters (scope_kind, scope_id, period_bucket, consumed)
           VALUES ('rep', 'rep-100', '2026-02-02', 1)`
        )
      ).not.toThrow();
    });
  });
});
