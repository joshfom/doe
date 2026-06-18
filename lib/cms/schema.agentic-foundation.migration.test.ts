import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";

/**
 * Unit test for the Agentic Foundation (S1) schema migration (task 1.2).
 *
 * Applies the Drizzle migration `drizzle/0032_concerned_typhoid_mary.sql` under
 * an in-memory Postgres (pg-mem) and asserts:
 *   - the two new tables exist (Requirement 7.1, 7.2, 9.3),
 *   - their expected columns exist with the correct shape,
 *   - the `agent_migration_flags` defaults route to the deterministic path:
 *     `mode` defaults to 'deterministic', `enabled` defaults to false, and
 *     `proven` defaults to false (Requirement 7.2 / 7.4).
 *
 * The full migration chain (0000–0031) cannot be replayed under pg-mem because
 * migration 0008 enables the `vector` (pgvector) extension, which pg-mem does
 * not support. Task 1.2 only concerns what migration 0032 introduces, so we
 * stand up a minimal stub for the `users` table it references via foreign key,
 * then apply migration 0032 statement-by-statement exactly as the production
 * migration runner (`scripts/migrate-direct.ts`) does.
 *
 * Harness mirrors `lib/cms/schema.migration.test.ts`.
 *
 * Design reference: §Data Models (New tables); Requirements: 7.2
 */

const MIGRATION_FILE = "0032_concerned_typhoid_mary.sql";

// `admin_confirmations.user_id` references `users.id`; stand up the minimal
// pre-existing `users` table the FK constraint depends on.
const PREREQUISITE_SQL = `
  CREATE TABLE "users" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
`;

/** The new tables migration 0032 must create. */
const NEW_TABLES = ["admin_confirmations", "agent_migration_flags"] as const;

/** Expected columns on each new table. */
const NEW_COLUMNS: Record<string, string[]> = {
  admin_confirmations: [
    "token",
    "user_id",
    "kind",
    "args",
    "expires_at",
    "consumed_at",
    "created_at",
  ],
  agent_migration_flags: [
    "capability",
    "mode",
    "enabled",
    "proven",
    "last_divergence_at",
    "updated_at",
  ],
};

/** Split a Drizzle migration into individual statements. */
function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function buildMigratedDb(): IMemoryDb {
  const mem = newDb();

  // pg-mem does not ship `gen_random_uuid()`; register it so DEFAULTs resolve.
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });

  // Stand up the pre-existing `users` table that migration 0032 references.
  mem.public.none(PREREQUISITE_SQL);

  // Apply the real migration, statement-by-statement.
  const migrationPath = join(process.cwd(), "drizzle", MIGRATION_FILE);
  const migrationSql = readFileSync(migrationPath, "utf-8");
  for (const stmt of splitStatements(migrationSql)) {
    mem.public.none(stmt);
  }

  return mem;
}

describe("Agentic Foundation migration 0032 (schema foundations)", () => {
  let mem: IMemoryDb;

  beforeAll(() => {
    mem = buildMigratedDb();
  });

  // ── new tables exist ───────────────────────────────────────────────────────
  describe("new tables exist", () => {
    it.each(NEW_TABLES)('creates the "%s" table', (table) => {
      const rows = mem.public.many(
        `SELECT table_name FROM information_schema.tables`
      ) as Array<{ table_name: string }>;
      const names = new Set(rows.map((r) => r.table_name));
      expect(names.has(table)).toBe(true);
    });
  });

  // ── new columns exist ────────────────────────────────────────────────────────
  describe("new tables have their expected columns", () => {
    for (const [table, columns] of Object.entries(NEW_COLUMNS)) {
      for (const column of columns) {
        it(`adds "${column}" to "${table}"`, () => {
          const rows = mem.public.many(
            `SELECT column_name FROM information_schema.columns
             WHERE table_name = '${table}' AND column_name = '${column}'`
          );
          expect(rows).toHaveLength(1);
        });
      }
    }
  });

  // ── Requirement 7.2 — agent_migration_flags defaults route to deterministic ──
  describe("Requirement 7.2 — agent_migration_flags defaults route to deterministic", () => {
    it("mode defaults to 'deterministic', enabled to false, proven to false", () => {
      const [row] = mem.public.many(
        `INSERT INTO agent_migration_flags (capability)
         VALUES ('create_booking')
         RETURNING capability, mode, enabled, proven`
      ) as Array<{
        capability: string;
        mode: string;
        enabled: boolean;
        proven: boolean;
      }>;

      expect(row.mode).toBe("deterministic");
      expect(row.enabled).toBe(false);
      expect(row.proven).toBe(false);
    });

    it("capability is the primary key (rejects duplicates)", () => {
      mem.public.none(
        `INSERT INTO agent_migration_flags (capability) VALUES ('dup_capability')`
      );
      expect(() =>
        mem.public.none(
          `INSERT INTO agent_migration_flags (capability) VALUES ('dup_capability')`
        )
      ).toThrow();
    });
  });

  // ── admin_confirmations basic shape / defaults ──────────────────────────────
  describe("admin_confirmations defaults", () => {
    it("token defaults via gen_random_uuid() and consumed_at starts null", () => {
      const userId = randomUUID();
      mem.public.none(`INSERT INTO users (id) VALUES ('${userId}')`);

      const [row] = mem.public.many(
        `INSERT INTO admin_confirmations (user_id, kind, args, expires_at)
         VALUES ('${userId}', 'delete_lead', '{}'::jsonb, now())
         RETURNING token, consumed_at`
      ) as Array<{ token: string; consumed_at: string | null }>;

      expect(row.token).toBeTruthy();
      expect(row.consumed_at).toBeNull();
    });
  });
});
