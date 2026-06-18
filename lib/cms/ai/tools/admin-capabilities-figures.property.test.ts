import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import fc from "fast-check";
import * as schema from "@/lib/cms/schema";
import type { Database } from "@/lib/cms/db";
import type { ToolContext } from "@/lib/cms/ai/tools/registry";
import type { CatalogEntry } from "@/lib/cms/ai/tools/catalog";
import {
  ADMIN_AGENT_ACTOR,
  adminReportCapabilities,
} from "@/lib/cms/ai/tools/admin-capabilities";

/**
 * Property test for "figures from SQL" (task 4.3).
 *
 * **Feature: agentic-foundation, Property 15: For any {scope, period} request,
 * the figure an agent reports equals the value computed by the corresponding
 * metrics_* view (no recomputation in JS or the model), and two reads of the
 * same {scope, period} return equal figures.**
 *
 * **Validates: Requirements 9.2, 13.1, 13.2, 13.3**
 *
 * Per task 4.2's note, the repo's `metrics_*` views are voice lead-pipeline
 * metrics; the admin report Catalog_Entries in `admin-capabilities.ts` instead
 * compute every figure **in SQL** over base tables (`count(*)::int`, `GROUP BY`,
 * windowed `WHERE`). This test validates the actual SQL the handlers run: the
 * figure a report handler returns equals the value computed by an INDEPENDENT
 * SQL query over the same seeded data (so the handler performs no arithmetic in
 * JS — Req 13.2), and two reads of the same {scope, period} return equal figures
 * (determinism — Req 13.3).
 *
 * Harness (mirrors `lib/cms/jobs/idempotency.property.test.ts`): a fresh in-memory
 * Postgres (pg-mem) is wired to a real Drizzle handle via the node-postgres
 * adapter so the handlers run their genuine SQL. The full migration chain cannot
 * be replayed under pg-mem (migration 0008 enables the unsupported `vector`
 * extension), so — exactly as the sibling pg-mem tests do — we stand up minimal
 * tables carrying only the columns these handlers read. `gen_random_uuid()` is
 * registered because pg-mem does not ship it.
 */

// ≥100 iterations as required for property tests; each run reseeds a small,
// bounded dataset so the run stays fast.
const NUM_RUNS = 100;

// Only the columns the report handlers actually read. Drizzle never issues
// `SELECT *`, so a minimal table shape is sufficient and faithful.
const TABLES_SQL = `
  CREATE TABLE "projects" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "status" text NOT NULL DEFAULT 'planning'
  );
  CREATE TABLE "ai_clients" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
  );
  CREATE TABLE "tickets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "request_type" text NOT NULL DEFAULT 'general_inquiry',
    "status" text NOT NULL DEFAULT 'open',
    "created_at" timestamp NOT NULL DEFAULT now()
  );
  CREATE TABLE "ai_appointments" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "status" text NOT NULL DEFAULT 'confirmed',
    "scheduled_date" date NOT NULL
  );
  -- Salesforce Lead Core (S2, task 7.1): lead figures are sourced from the
  -- metrics_leads SQL view over leads_mirror, NOT the retired
  -- request_type = 'lead_inquiry' ticket shim. The real view (day, tier,
  -- lead_count) is defined in drizzle/0035_lead_metrics_views.sql; the
  -- view-over-leads_mirror derivation is exercised by Property 10 (task 7.2).
  -- Here -- mirroring how pipeline-summary.test.ts stands metrics_* views up
  -- as minimal tables under pg-mem -- metrics_leads is a standin table carrying
  -- only the columns the report handlers read, so the genuine handler SQL
  -- (COALESCE(SUM(lead_count),0) FROM metrics_leads [WHERE day ...]) runs and we
  -- can assert the handler performs no JS arithmetic.
  CREATE TABLE "metrics_leads" (
    "day" date NOT NULL,
    "tier" text,
    "lead_count" integer NOT NULL DEFAULT 0
  );
`;

const PROJECT_STATUSES = [
  "planning",
  "pre_launch",
  "selling",
  "under_construction",
  "handover",
  "completed",
  "archived",
] as const;

const TICKET_STATUSES = [
  "open",
  "assigned",
  "in_progress",
  "resolved",
  "closed",
] as const;

const TICKET_REQUEST_TYPES = [
  "general_inquiry",
  "lead_inquiry",
  "noc",
  "maintenance_request",
  "site_visit_booking",
] as const;

const APPOINTMENT_STATUSES = [
  "confirmed",
  "cancelled",
  "rescheduled",
  "completed",
] as const;

/** Stand up pg-mem with the minimal tables and a Drizzle handle over them. */
function buildDb(): { mem: IMemoryDb; db: Database } {
  const mem = newDb();

  // pg-mem does not ship gen_random_uuid(); register it (impure so each row
  // gets a distinct value rather than a cached one).
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });

  mem.public.none(TABLES_SQL);

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem's node-postgres adapter rejects `types.getTypeParser` and
  // `rowMode: "array"` that this Drizzle version sends; strip them and convert
  // object rows back to positional arrays when array-mode was requested.
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

/** A single read-only `{ status, count }` row as the byStatus reports return it. */
interface StatusCount {
  status: string;
  count: number;
}

/** Normalise a byStatus array to a status→count record (order/representation independent). */
function byStatusToRecord(rows: StatusCount[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { status, count } of rows) out[status] = Number(count);
  return out;
}

/** Read a single integer figure via an INDEPENDENT raw-SQL query. */
async function sqlCount(
  db: Database,
  query: ReturnType<typeof sql>
): Promise<number> {
  const result = (await db.execute(query)) as { rows: Record<string, unknown>[] };
  return Number(result.rows[0]?.c ?? 0);
}

/** Read a status→count breakdown via an INDEPENDENT raw-SQL query. */
async function sqlByStatus(
  db: Database,
  table: string,
  where?: ReturnType<typeof sql>
): Promise<Record<string, number>> {
  const base = sql`SELECT status, count(*)::int AS c FROM ${sql.identifier(table)}`;
  const query = where
    ? sql`${base} WHERE ${where} GROUP BY status`
    : sql`${base} GROUP BY status`;
  const result = (await db.execute(query)) as { rows: Record<string, unknown>[] };
  const out: Record<string, number> = {};
  for (const row of result.rows) out[String(row.status)] = Number(row.c);
  return out;
}

describe("Feature: agentic-foundation, Property 15: For any {scope, period} request, the figure an agent reports equals the value computed by the corresponding metrics_* view (no recomputation in JS or the model), and two reads of the same {scope, period} return equal figures.", () => {
  let db: Database;
  let mem: IMemoryDb;
  const ctx: ToolContext = { actor: ADMIN_AGENT_ACTOR };

  // Look up each report Catalog_Entry by name.
  const reports = new Map<string, CatalogEntry>(
    adminReportCapabilities.map((e) => [e.name, e])
  );

  beforeAll(() => {
    ({ db, mem } = buildDb());
  });

  beforeEach(() => {
    // Reset every table so each generated case is an isolated dataset.
    mem.public.none(
      `DELETE FROM tickets; DELETE FROM ai_appointments; DELETE FROM projects; DELETE FROM ai_clients; DELETE FROM metrics_leads;`
    );
  });

  /** Run a report handler with its input validated through the entry's schema. */
  async function runReport(
    name: string,
    input: Record<string, unknown> = {}
  ): Promise<Record<string, unknown>> {
    const entry = reports.get(name);
    if (!entry) throw new Error(`missing report entry: ${name}`);
    const parsed = entry.inputSchema.parse(input);
    return (await entry.handler(db, ctx, parsed)) as Record<string, unknown>;
  }

  it("every report figure equals an independent SQL computation and is identical across two reads", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom(...PROJECT_STATUSES), { maxLength: 8 }),
        fc.nat({ max: 8 }), // number of CRM clients
        fc.array(
          fc.record({
            requestType: fc.constantFrom(...TICKET_REQUEST_TYPES),
            status: fc.constantFrom(...TICKET_STATUSES),
            day: fc.integer({ min: 1, max: 28 }), // 2025-01-DD
          }),
          { maxLength: 10 }
        ),
        fc.array(
          fc.record({
            status: fc.constantFrom(...APPOINTMENT_STATUSES),
            day: fc.integer({ min: 1, max: 28 }), // 2025-01-DD
          }),
          { maxLength: 10 }
        ),
        // metrics_leads rows (the SQL view over leads_mirror, modeled as a
        // standin table). Lead figures are summed from `lead_count` per
        // (day, tier) group — exactly what the report handlers query.
        fc.array(
          fc.record({
            tier: fc.constantFrom("HOT", "WARM", "NURTURE"),
            day: fc.integer({ min: 1, max: 28 }), // 2025-01-DD
            leadCount: fc.nat({ max: 5 }),
          }),
          { maxLength: 10 }
        ),
        // The {period} of the request: an optional inclusive date window.
        fc.option(
          fc
            .tuple(fc.integer({ min: 1, max: 28 }), fc.integer({ min: 1, max: 28 }))
            .map(([a, b]) => (a <= b ? [a, b] : [b, a])),
          { nil: undefined }
        ),
        async (projectRows, clientCount, ticketRows, apptRows, leadRows, window) => {
          // Fresh dataset per case.
          mem.public.none(
            `DELETE FROM tickets; DELETE FROM ai_appointments; DELETE FROM projects; DELETE FROM ai_clients; DELETE FROM metrics_leads;`
          );

          // ── Seed arbitrary rows ──────────────────────────────────────────
          for (const status of projectRows) {
            await db.execute(
              sql`INSERT INTO projects (status) VALUES (${status})`
            );
          }
          for (let i = 0; i < clientCount; i++) {
            await db.execute(
              sql`INSERT INTO ai_clients (id) VALUES (${randomUUID()})`
            );
          }
          for (const t of ticketRows) {
            const createdAt = `2025-01-${String(t.day).padStart(2, "0")}T12:00:00.000Z`;
            await db.execute(
              sql`INSERT INTO tickets (request_type, status, created_at) VALUES (${t.requestType}, ${t.status}, ${createdAt})`
            );
          }
          for (const a of apptRows) {
            const scheduledDate = `2025-01-${String(a.day).padStart(2, "0")}`;
            await db.execute(
              sql`INSERT INTO ai_appointments (status, scheduled_date) VALUES (${a.status}, ${scheduledDate})`
            );
          }
          for (const l of leadRows) {
            const day = `2025-01-${String(l.day).padStart(2, "0")}`;
            await db.execute(
              sql`INSERT INTO metrics_leads (day, tier, lead_count) VALUES (${day}, ${l.tier}, ${l.leadCount})`
            );
          }

          const windowInput = window
            ? {
                startDate: `2025-01-${String(window[0]).padStart(2, "0")}`,
                endDate: `2025-01-${String(window[1]).padStart(2, "0")}`,
              }
            : {};

          // ── report_overview ──────────────────────────────────────────────
          const overview = await runReport("report_overview");
          expect(Number(overview.projects)).toBe(
            await sqlCount(db, sql`SELECT count(*)::int AS c FROM projects`)
          );
          expect(Number(overview.clients)).toBe(
            await sqlCount(db, sql`SELECT count(*)::int AS c FROM ai_clients`)
          );
          expect(Number(overview.leads)).toBe(
            await sqlCount(
              db,
              sql`SELECT COALESCE(SUM(lead_count), 0)::int AS c FROM metrics_leads`
            )
          );
          expect(Number(overview.openTickets)).toBe(
            await sqlCount(
              db,
              sql`SELECT count(*)::int AS c FROM tickets WHERE status IN ('open', 'assigned', 'in_progress')`
            )
          );
          expect(Number(overview.activeAppointments)).toBe(
            await sqlCount(
              db,
              sql`SELECT count(*)::int AS c FROM ai_appointments WHERE status IN ('confirmed', 'rescheduled')`
            )
          );

          // ── report_projects ──────────────────────────────────────────────
          const projectsReport = await runReport("report_projects");
          expect(Number(projectsReport.total)).toBe(
            await sqlCount(db, sql`SELECT count(*)::int AS c FROM projects`)
          );
          expect(byStatusToRecord(projectsReport.byStatus as StatusCount[])).toEqual(
            await sqlByStatus(db, "projects")
          );

          // ── report_clients ───────────────────────────────────────────────
          const clientsReport = await runReport("report_clients");
          expect(Number(clientsReport.clients)).toBe(
            await sqlCount(db, sql`SELECT count(*)::int AS c FROM ai_clients`)
          );

          // ── report_tickets ───────────────────────────────────────────────
          const ticketsReport = await runReport("report_tickets");
          expect(Number(ticketsReport.total)).toBe(
            await sqlCount(db, sql`SELECT count(*)::int AS c FROM tickets`)
          );
          expect(byStatusToRecord(ticketsReport.byStatus as StatusCount[])).toEqual(
            await sqlByStatus(db, "tickets")
          );

          // ── report_leads (windowed by {period} on the metrics_leads day) ──
          const leadsReport = await runReport("report_leads", windowInput);
          const leadsConds: ReturnType<typeof sql>[] = [];
          if (windowInput.startDate) {
            leadsConds.push(sql`day >= ${windowInput.startDate}`);
          }
          if (windowInput.endDate) {
            leadsConds.push(sql`day <= ${windowInput.endDate}`);
          }
          const leadsWhere = leadsConds.length
            ? sql` WHERE ${sql.join(leadsConds, sql` AND `)}`
            : sql``;
          expect(Number(leadsReport.leads)).toBe(
            await sqlCount(
              db,
              sql`SELECT COALESCE(SUM(lead_count), 0)::int AS c FROM metrics_leads${leadsWhere}`
            )
          );

          // ── report_appointments (windowed by {period} on scheduled_date) ──
          const apptReport = await runReport("report_appointments", windowInput);
          const apptConds: ReturnType<typeof sql>[] = [];
          if (windowInput.startDate) {
            apptConds.push(sql`scheduled_date >= ${windowInput.startDate}`);
          }
          if (windowInput.endDate) {
            apptConds.push(sql`scheduled_date <= ${windowInput.endDate}`);
          }
          const apptWhere =
            apptConds.length > 0
              ? sql.join(apptConds, sql` AND `)
              : undefined;
          const apptTotalQuery = apptWhere
            ? sql`SELECT count(*)::int AS c FROM ai_appointments WHERE ${apptWhere}`
            : sql`SELECT count(*)::int AS c FROM ai_appointments`;
          expect(Number(apptReport.total)).toBe(await sqlCount(db, apptTotalQuery));
          expect(byStatusToRecord(apptReport.byStatus as StatusCount[])).toEqual(
            await sqlByStatus(db, "ai_appointments", apptWhere)
          );

          // ── Determinism: two reads of the same {scope, period} are equal ──
          for (const [name, input] of [
            ["report_overview", {}],
            ["report_projects", {}],
            ["report_clients", {}],
            ["report_tickets", {}],
            ["report_leads", windowInput],
            ["report_appointments", windowInput],
          ] as const) {
            const first = await runReport(name, input);
            const second = await runReport(name, input);
            // Normalise byStatus ordering (ties may reorder) before comparison.
            const norm = (r: Record<string, unknown>) =>
              Array.isArray(r.byStatus)
                ? { ...r, byStatus: byStatusToRecord(r.byStatus as StatusCount[]) }
                : r;
            expect(norm(first)).toEqual(norm(second));
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
