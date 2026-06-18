import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import fc from "fast-check";
import * as schema from "@/lib/cms/schema";
import { agentMigrationFlags } from "@/lib/cms/schema";
import type { Database } from "@/lib/cms/db";
import {
  routeCapability,
  serveCapability,
  type Capability,
} from "@/lib/cms/agents/migration-switch";

/**
 * Property test for the Migration_Switch (task 5.2).
 *
 * **Feature: agentic-foundation, Property 13: For any per-capability flag
 * configuration, routeCapability returns agent iff mode = "agent" and enabled =
 * true (deterministic otherwise, including unset flags); and for any capability
 * routed to the agent whose handler errors, serveCapability falls back to and
 * returns the deterministic result.**
 *
 * **Validates: Requirements 7.1, 7.2, 7.3, 14.2, 14.3**
 *
 * The property has two halves:
 *   (1) routeCapability returns "agent" iff mode === "agent" && enabled ===
 *       true, and "deterministic" otherwise — including capabilities with NO
 *       flag row at all (Req 7.1, 7.2).
 *   (2) For a capability routed to the agent whose viaAgent handler throws,
 *       serveCapability returns the deterministic result and records the
 *       divergence (lastDivergenceAt stamped) (Req 7.3, 14.2, 14.3).
 *
 * Setup mirrors `lib/cms/jobs/idempotency.property.test.ts`: migration 0032 is
 * applied under an in-memory Postgres (pg-mem) so the real
 * `agent_migration_flags` table exists with its true column shapes and
 * defaults. A drizzle handle is wired onto the same pg-mem instance via its
 * node-postgres adapter so routeCapability / serveCapability / recordDivergence
 * run against genuine SQL (the SELECT and the ON CONFLICT DO UPDATE upsert).
 */

// Reduced fast-check budget — each generated case runs real SQL against a fresh
// table state, so keep run counts modest (per the performance directive) while
// still exceeding the 100-iteration minimum across the two halves.
const NUM_RUNS = 100;

const MIGRATION_FILE = "0032_concerned_typhoid_mary.sql";

// `admin_confirmations.user_id` references `users.id`; stand up the minimal
// pre-existing `users` table the FK constraint in migration 0032 depends on.
const PREREQUISITE_SQL = `
  CREATE TABLE "users" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
`;

// The full Capability space the Migration_Switch can route (Design §Components
// #6). Every property iteration checks routing for ALL of these so unset rows
// are always exercised alongside the generated configuration.
const CAPABILITIES: readonly Capability[] = [
  "create_lead",
  "register_lead",
  "create_ticket",
  "create_booking",
  "cancel_appointment",
  "reschedule_appointment",
  "request_otp",
  "request_handover",
  "navigate",
  "provide_contact",
  "report_overview",
  "report_projects",
  "report_clients",
  "report_leads",
  "report_tickets",
  "report_appointments",
  "admin_destructive",
];

function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Stand up pg-mem with migration 0032 applied and return a drizzle handle. */
function buildDb(): { mem: IMemoryDb; db: Database } {
  const mem = newDb();

  // pg-mem does not ship `gen_random_uuid()`; register it so migration 0032's
  // admin_confirmations DEFAULTs resolve. Marked impure so each row is unique.
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });

  mem.public.none(PREREQUISITE_SQL);

  const migrationSql = readFileSync(
    join(process.cwd(), "drizzle", MIGRATION_FILE),
    "utf-8"
  );
  for (const stmt of splitStatements(migrationSql)) {
    mem.public.none(stmt);
  }

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem's node-postgres adapter rejects two things this drizzle version
  // sends on every query: `types.getTypeParser` (custom result parsers) and
  // `rowMode: "array"`. Strip both and, when drizzle asked for array-mode rows,
  // convert pg-mem's object rows back into positional arrays (in select order)
  // so drizzle's row mapper stays happy. Mirrors the sibling pg-mem tests.
  const originalQuery = pool.query.bind(pool);
  pool.query = (config: unknown, values?: unknown, cb?: unknown) => {
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
  };

  const db = drizzle(pool, { schema }) as unknown as Database;

  return { mem, db };
}

describe('Migration_Switch — Property 13: routing iff "agent"+enabled, agent-error fallback (Req 7.1, 7.2, 7.3, 14.2, 14.3)', () => {
  let db: Database;

  beforeAll(() => {
    ({ db } = buildDb());
  });

  // ── Half 1 ─────────────────────────────────────────────────────────────────
  // For any per-capability flag configuration, routeCapability returns "agent"
  // iff the capability's row has mode === "agent" AND enabled === true;
  // otherwise "deterministic" — including capabilities with no row (Req 7.1, 7.2).
  it('routeCapability returns "agent" iff mode === "agent" && enabled === true (deterministic otherwise, including unset)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // A configuration assigns at most one flag row per capability (PK), so a
        // subset of capabilities are configured and the rest are left unset.
        fc.uniqueArray(
          fc.record({
            capability: fc.constantFrom(...CAPABILITIES),
            mode: fc.constantFrom<"deterministic" | "agent">(
              "deterministic",
              "agent"
            ),
            enabled: fc.boolean(),
          }),
          { selector: (e) => e.capability, maxLength: CAPABILITIES.length }
        ),
        async (config) => {
          // Fresh table state per iteration.
          await db.delete(agentMigrationFlags);

          const now = new Date();
          for (const entry of config) {
            await db.insert(agentMigrationFlags).values({
              capability: entry.capability,
              mode: entry.mode,
              enabled: entry.enabled,
              updatedAt: now,
            });
          }

          const configured = new Map(config.map((e) => [e.capability, e]));

          // Check EVERY capability — configured and unset alike.
          for (const cap of CAPABILITIES) {
            const entry = configured.get(cap);
            const expected =
              entry?.mode === "agent" && entry.enabled
                ? "agent"
                : "deterministic";
            const actual = await routeCapability(db, cap);
            expect(actual).toBe(expected);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // ── Half 2 ─────────────────────────────────────────────────────────────────
  // For any capability routed to the agent whose viaAgent handler throws,
  // serveCapability returns the deterministic result and records a divergence
  // (lastDivergenceAt stamped) (Req 7.3, 14.2, 14.3).
  it("serveCapability falls back to and returns the deterministic result when the agent handler throws, recording divergence", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...CAPABILITIES),
        // The deterministic result the fallback must return verbatim.
        fc.oneof(
          fc.string(),
          fc.integer(),
          fc.boolean(),
          fc.constant(null),
          fc.record({ value: fc.string(), n: fc.integer() })
        ),
        async (cap, deterministicResult) => {
          await db.delete(agentMigrationFlags);

          // Route this capability to the agent path.
          await db.insert(agentMigrationFlags).values({
            capability: cap,
            mode: "agent",
            enabled: true,
            updatedAt: new Date(),
          });
          expect(await routeCapability(db, cap)).toBe("agent");

          let agentInvoked = false;
          let deterministicInvoked = false;

          const result = await serveCapability(
            db,
            cap,
            async () => {
              agentInvoked = true;
              throw new Error("agent handler boom");
            },
            async () => {
              deterministicInvoked = true;
              return deterministicResult;
            }
          );

          // The agent path was attempted, then the deterministic path served
          // the result verbatim.
          expect(agentInvoked).toBe(true);
          expect(deterministicInvoked).toBe(true);
          expect(result).toStrictEqual(deterministicResult);

          // Divergence was recorded: lastDivergenceAt is stamped.
          const [row] = await db
            .select()
            .from(agentMigrationFlags)
            .where(eq(agentMigrationFlags.capability, cap));
          expect(row).toBeDefined();
          expect(row.lastDivergenceAt).not.toBeNull();
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
