import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import fc from "fast-check";

/**
 * Property test for the one NEW Reporting capability `query_leads`
 * (Design §Components #2 "The Lead_Query_Tool", task 2.2).
 *
 *   // Feature: agentic-reporting-twin, Property 6: Lead query is role-scoped,
 *   bounded, and oldest-first
 *
 *   *For any* generated `leads_mirror` dataset, requesting role, and structured
 *   filter (tier, stage, staleness in 1..365 days), `query_leads` returns only
 *   records the role permits, at most 100 records, ordered by
 *   `last_interaction_at` ascending (oldest last-interaction first), and every
 *   returned record matches the filter.
 *
 * **Validates: Requirements 1.4, 3.4, 10.1**
 *
 * The property exercises the REAL `query_leads` Catalog_Entry handler — the
 * "execute" step that is the only place DB access happens for this read — over
 * `pg-mem` seeded with a random `leads_mirror` board, a random requesting role
 * (org-wide `exec` vs a rep-level caller), and a random structured filter. The
 * dispatcher's RBAC/OTP boundary is owned + property-tested by S1 and consumed
 * unchanged (Requirement 16.4); this property pins the handler's own contract:
 *
 *   1. **Role-scoped (Req 3.4):** a rep-level caller (no org-wide permission)
 *      only ever sees rows assigned to its OWN rep id, regardless of the filter;
 *      an `exec` caller honours an explicit `filter.repId`.
 *   2. **Bounded (Req 1.4, 10.1):** at most `min(limit, 100)` records, and
 *      `truncatedAt` equals the applied cap.
 *   3. **Oldest-first (Req 10.1):** results are ordered by `last_interaction_at`
 *      ascending; when the matching set exceeds the cap, the returned set is the
 *      oldest matching records (every returned record is at least as old as
 *      every withheld matching record).
 *   4. **Filter-correct:** every returned record matches the requested tier,
 *      stage, and staleness threshold; and when the matching set fits under the
 *      cap, the returned set is exactly the permitted matching set (no permitted
 *      row dropped, no extra row surfaced).
 *
 * ── Harness ──────────────────────────────────────────────────────────────────
 *
 * `pg-mem` (node-postgres adapter) with migration `0029` (parties /
 * party_identities / leads_mirror / reps …) applied statement-by-statement over
 * stub FK tables, plus the four RBAC tables (`roles`, `permissions`,
 * `role_permissions`, `user_roles`) created inline so the handler's real
 * role-resolution (`loadUserRoles` → `resolvePermissions` → `hasPermission`)
 * runs against the in-memory DB. Time is frozen so the staleness threshold is
 * deterministic to the day. The schema is built once and restored between
 * iterations for speed.
 */

// ── Iteration count (spec floor: ≥100) ────────────────────────────────────────
const NUM_RUNS = Number(process.env.PBT_NUM_RUNS ?? 100);

import * as schema from "../../schema";
import {
  leadsMirror,
  parties,
  partyIdentities,
  reps,
  roles,
  permissions,
  rolePermissions,
  userRoles,
} from "../../schema";
import type { Database } from "../../db";
import type { ToolContext } from "./registry";
import {
  reportingCapabilityEntries,
  REPORTING_AGENT_ACTOR,
} from "./reporting-capabilities";

// ── Frozen time so the staleness threshold is deterministic to the day ─────────
const DAY_MS = 24 * 60 * 60 * 1000;
const FIXED_NOW = Date.UTC(2025, 0, 15, 12, 0, 0); // 2025-01-15T12:00:00Z

// ── pg-mem harness (mirrors lead-capabilities.property.test.ts) ────────────────

const MIGRATION_0029 = "0029_demonic_mandrill.sql";

// 0029 ALTERs ai_appointments / ai_conversations / ai_messages and references
// ai_clients / ai_tenants via FK, so stub those before applying it. The four
// RBAC tables are NOT created by 0029 — create them inline (with `user_id` as
// plain text and no users FK) so the handler's permission resolution runs for
// real against the requesting agent's `ctx.userId`.
const PREREQUISITE_SQL = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_appointments" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_conversations" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_messages" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "roles" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" text NOT NULL,
    "display_name" text NOT NULL,
    "description" text,
    "user_type" text NOT NULL,
    "is_system" boolean NOT NULL DEFAULT false,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "permissions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "resource" text NOT NULL,
    "action" text NOT NULL,
    "description" text
  );
  CREATE TABLE "role_permissions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "role_id" uuid NOT NULL,
    "permission_id" uuid NOT NULL
  );
  CREATE TABLE "user_roles" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" text NOT NULL,
    "role_id" uuid NOT NULL,
    "granted_by" uuid,
    "granted_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE UNIQUE INDEX "permissions_resource_action_idx" ON "permissions" ("resource","action");
  CREATE UNIQUE INDEX "role_permissions_unique_idx" ON "role_permissions" ("role_id","permission_id");
  CREATE UNIQUE INDEX "user_roles_unique_idx" ON "user_roles" ("user_id","role_id");
`;

/** Split a Drizzle migration into individual statements. */
function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .flatMap((chunk) =>
      chunk
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .split(";")
    )
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function applyMigration(mem: IMemoryDb, file: string): void {
  const sql = readFileSync(join(process.cwd(), "drizzle", file), "utf-8");
  for (const stmt of splitStatements(sql)) {
    mem.public.none(stmt);
  }
}

/** Stand up pg-mem with 0029 + the RBAC tables and a drizzle handle. */
function buildDb(): { mem: IMemoryDb; db: Database } {
  const mem = newDb();

  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });

  mem.public.none(PREREQUISITE_SQL);
  applyMigration(mem, MIGRATION_0029);

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem's node-postgres adapter rejects `types.getTypeParser` and
  // `rowMode: "array"`; strip both, mirroring the sibling dispatch tests.
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

// ── The query_leads handler under test ─────────────────────────────────────────

const queryLeadsEntry = reportingCapabilityEntries.find(
  (e) => e.name === "query_leads"
);
if (!queryLeadsEntry) {
  throw new Error("query_leads catalog entry not found in reporting capabilities");
}

interface ReturnedLead {
  partyId: string;
  tier: string | null;
  stage: string | null;
  lastInteractionAt: string | null;
  assignedRepId: string | null;
  phoneHash: string | null;
}

async function invokeQueryLeads(
  db: Database,
  ctx: ToolContext,
  rawInput: unknown
): Promise<{ leads: ReturnedLead[]; truncatedAt: number }> {
  // Validate + apply defaults through the entry's own Zod schema, exactly as
  // the dispatcher would before the handler's execute step runs.
  const input = queryLeadsEntry!.inputSchema.parse(rawInput);
  const out = await queryLeadsEntry!.handler(db, ctx, input);
  // The output schema must also hold for every returned shape.
  return queryLeadsEntry!.outputSchema.parse(out) as {
    leads: ReturnedLead[];
    truncatedAt: number;
  };
}

// ── Fixed RBAC identities ──────────────────────────────────────────────────────

const EXEC_USER_ID = "11111111-1111-1111-1111-111111111111";
const EXEC_ROLE_ID = "22222222-2222-2222-2222-222222222222";
const EXEC_PERM_ID = "33333333-3333-3333-3333-333333333333";
/** Mirrors EXEC_REPORTING_PERMISSION in reporting-capabilities.ts. */
const EXEC_REPORTING_RESOURCE = "report";
const EXEC_REPORTING_ACTION = "scope:exec";

const STAGES = ["new", "contacted", "qualified", "won"] as const;
const TIERS = ["HOT", "WARM", "NURTURE"] as const;
const REP_COUNT = 3;

// ── Generators (structural, mapped to real UUIDs at execution time) ────────────

interface GenLead {
  repIndex: number; // -1 = unassigned
  tier: (typeof TIERS)[number] | null;
  stage: (typeof STAGES)[number] | null;
  daysAgo: number;
  hasPhone: boolean;
}

const leadArb: fc.Arbitrary<GenLead> = fc.record({
  repIndex: fc.integer({ min: -1, max: REP_COUNT - 1 }),
  tier: fc.option(fc.constantFrom(...TIERS), { nil: null }),
  stage: fc.option(fc.constantFrom(...STAGES), { nil: null }),
  daysAgo: fc.integer({ min: 0, max: 400 }),
  hasPhone: fc.boolean(),
});

type Requester =
  | { kind: "exec" }
  | { kind: "rep"; repIndex: number };

const requesterArb: fc.Arbitrary<Requester> = fc.oneof(
  fc.constant<Requester>({ kind: "exec" }),
  fc
    .integer({ min: 0, max: REP_COUNT - 1 })
    .map<Requester>((repIndex) => ({ kind: "rep", repIndex }))
);

interface GenFilter {
  tier?: (typeof TIERS)[number];
  stage?: (typeof STAGES)[number];
  staleDaysOlderThan?: number;
  repIndexFilter?: number; // only honoured for an exec requester
}

const filterArb: fc.Arbitrary<GenFilter> = fc.record({
  tier: fc.option(fc.constantFrom(...TIERS), { nil: undefined }),
  stage: fc.option(fc.constantFrom(...STAGES), { nil: undefined }),
  staleDaysOlderThan: fc.option(fc.integer({ min: 1, max: 365 }), {
    nil: undefined,
  }),
  repIndexFilter: fc.option(fc.integer({ min: 0, max: REP_COUNT - 1 }), {
    nil: undefined,
  }),
});

const caseArb = fc.record({
  leads: fc.array(leadArb, { minLength: 0, maxLength: 40 }),
  requester: requesterArb,
  filter: filterArb,
  limit: fc.integer({ min: 1, max: 100 }),
});

// ── Property 6 ──────────────────────────────────────────────────────────────

describe("query_leads — Property 6: role-scoped, bounded, oldest-first (Req 1.4, 3.4, 10.1)", () => {
  let mem: IMemoryDb;
  let db: Database;
  let backup: ReturnType<IMemoryDb["backup"]>;

  beforeAll(() => {
    ({ mem, db } = buildDb());
    backup = mem.backup();
    // Freeze JS time so the staleness threshold (now − N days) is deterministic.
    // Only Date is faked; timers are left real to avoid hangs in async code.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(FIXED_NOW));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("returns only role-permitted, filter-matching records, at most min(limit,100), oldest last-interaction first", async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async ({ leads, requester, filter, limit }) => {
        // Reset to the freshly-migrated empty schema for this iteration.
        backup.restore();

        // Three reps to assign leads to.
        const repIds = Array.from({ length: REP_COUNT }, () => randomUUID());
        for (let i = 0; i < REP_COUNT; i++) {
          await db
            .insert(reps)
            .values({ id: repIds[i], name: `Rep ${i}`, capacity: 3 });
        }

        // Seed an org-wide (exec) reporting role bound to EXEC_USER_ID. A
        // rep-level caller is simply a userId with no role rows (empty perms).
        await db.insert(roles).values({
          id: EXEC_ROLE_ID,
          name: "exec-reporting",
          displayName: "Exec Reporting",
          userType: "employee",
        });
        await db.insert(permissions).values({
          id: EXEC_PERM_ID,
          resource: EXEC_REPORTING_RESOURCE,
          action: EXEC_REPORTING_ACTION,
        });
        await db
          .insert(rolePermissions)
          .values({ roleId: EXEC_ROLE_ID, permissionId: EXEC_PERM_ID });
        await db
          .insert(userRoles)
          .values({ userId: EXEC_USER_ID, roleId: EXEC_ROLE_ID });

        // Seed the lead board. Track each lead's resolved facts for the oracle.
        interface Seeded {
          partyId: string;
          tier: string | null;
          stage: string | null;
          assignedRepId: string | null;
          daysAgo: number;
          time: number;
          phoneHash: string | null;
        }
        const seeded: Seeded[] = [];
        for (let i = 0; i < leads.length; i++) {
          const l = leads[i];
          const partyId = randomUUID();
          const assignedRepId = l.repIndex === -1 ? null : repIds[l.repIndex];
          const time = FIXED_NOW - l.daysAgo * DAY_MS;
          const phoneHash = l.hasPhone ? `phash-${i}-${randomUUID().slice(0, 8)}` : null;

          await db
            .insert(parties)
            .values({ id: partyId, type: "person", language: "en" });
          await db.insert(leadsMirror).values({
            partyId,
            tier: l.tier ?? undefined,
            stage: l.stage ?? undefined,
            assignedRepId: assignedRepId ?? undefined,
            lastInteractionAt: new Date(time),
          });
          if (phoneHash) {
            await db
              .insert(partyIdentities)
              .values({ partyId, kind: "phone_hash", value: phoneHash });
          }

          seeded.push({
            partyId,
            tier: l.tier,
            stage: l.stage,
            assignedRepId,
            daysAgo: l.daysAgo,
            time,
            phoneHash,
          });
        }

        // Build the requesting context + the structured tool input.
        const isExec = requester.kind === "exec";
        const ctx: ToolContext = {
          actor: REPORTING_AGENT_ACTOR,
          userId: isExec ? EXEC_USER_ID : repIds[requester.repIndex],
        };
        const filterRepId =
          isExec && filter.repIndexFilter !== undefined
            ? repIds[filter.repIndexFilter]
            : undefined;
        const rawInput = {
          filter: {
            ...(filter.tier !== undefined ? { tier: filter.tier } : {}),
            ...(filter.stage !== undefined ? { stage: filter.stage } : {}),
            ...(filter.staleDaysOlderThan !== undefined
              ? { staleDaysOlderThan: filter.staleDaysOlderThan }
              : {}),
            ...(filterRepId !== undefined ? { repId: filterRepId } : {}),
          },
          limit,
        };

        // ── The oracle: the role-clamped rep id and the matching predicate ──
        // exec → honours an explicit filter.repId (else all reps);
        // rep   → clamped to its OWN rep id regardless of any filter.
        const repIdClamp = isExec ? filterRepId : repIds[requester.repIndex];

        const matches = (s: Seeded): boolean => {
          if (repIdClamp !== undefined && s.assignedRepId !== repIdClamp)
            return false;
          if (filter.tier !== undefined && s.tier !== filter.tier) return false;
          if (filter.stage !== undefined && s.stage !== filter.stage)
            return false;
          if (filter.staleDaysOlderThan !== undefined) {
            // last_interaction_at strictly older than (now − N days)
            // ⟺ daysAgo > N (deterministic under frozen time).
            if (!(s.daysAgo > filter.staleDaysOlderThan)) return false;
          }
          return true;
        };
        const matching = seeded.filter(matches);
        const effectiveLimit = Math.min(limit, 100);
        const expectedCount = Math.min(matching.length, effectiveLimit);

        // ── Invoke ──────────────────────────────────────────────────────────
        const { leads: returned, truncatedAt } = await invokeQueryLeads(
          db,
          ctx,
          rawInput
        );

        const seededById = new Map(seeded.map((s) => [s.partyId, s]));
        const dayOffset = (iso: string | null): number =>
          iso === null
            ? Number.POSITIVE_INFINITY
            : Math.round((FIXED_NOW - new Date(iso).getTime()) / DAY_MS);

        // (1) Bounded — at most the applied cap; truncatedAt reflects it.
        expect(returned.length).toBeLessThanOrEqual(100);
        expect(returned.length).toBe(expectedCount);
        expect(truncatedAt).toBe(effectiveLimit);

        // (2) Every returned record is a permitted, filter-matching seeded row
        //     whose fields are surfaced verbatim (qualification facts + hash).
        for (const r of returned) {
          const s = seededById.get(r.partyId);
          expect(s).toBeDefined();
          if (!s) continue;
          expect(matches(s)).toBe(true); // role-scoped + filter-correct
          expect(r.tier).toBe(s.tier);
          expect(r.stage).toBe(s.stage);
          expect(r.assignedRepId).toBe(s.assignedRepId);
          expect(r.phoneHash).toBe(s.phoneHash);
          expect(dayOffset(r.lastInteractionAt)).toBe(s.daysAgo);
          // Role-scoping spelled out: a rep-level caller never sees another
          // rep's row.
          if (!isExec) {
            expect(r.assignedRepId).toBe(repIds[requester.repIndex]);
          }
        }

        // (3) Oldest last-interaction first — non-decreasing time across results
        //     (equivalently, non-increasing daysAgo).
        for (let i = 1; i < returned.length; i++) {
          const prev = new Date(returned[i - 1].lastInteractionAt!).getTime();
          const curr = new Date(returned[i].lastInteractionAt!).getTime();
          expect(prev).toBeLessThanOrEqual(curr);
        }

        // (4) Selection correctness:
        //   - under the cap → returned set is EXACTLY the permitted matching set;
        //   - over the cap  → returned are the OLDEST matching records (every
        //     returned record is at least as old as every withheld match).
        const returnedIds = new Set(returned.map((r) => r.partyId));
        if (matching.length <= effectiveLimit) {
          expect(returnedIds).toEqual(new Set(matching.map((s) => s.partyId)));
        } else {
          const returnedMaxTime = Math.max(
            ...returned.map((r) => new Date(r.lastInteractionAt!).getTime())
          );
          const withheld = matching.filter((s) => !returnedIds.has(s.partyId));
          const withheldMinTime = Math.min(...withheld.map((s) => s.time));
          // oldest-first: every returned record is no newer than any withheld
          // matching record (ties permitted).
          expect(returnedMaxTime).toBeLessThanOrEqual(withheldMinTime);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
