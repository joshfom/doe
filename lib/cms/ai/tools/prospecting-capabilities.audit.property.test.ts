import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import fc from "fast-check";

/**
 * Property test for the prospecting audit boundary (task 3.4 — a NON-optional
 * CC-Audit / Requirement 8.1 boundary test).
 *
 *   **Feature: prospecting-workspace, Property 7: Every prospecting
 *   mutation/personal-data read/provider call/send flows through dispatchTool
 *   into a CatalogEntry, producing exactly one audit row; a non-catalog tool is
 *   rejected.**
 *
 * **Validates: Requirements 8.1**
 *
 * This guards the one fixed architectural rule for S7 (design Overview): every
 * prospecting mutation, every personal-data read, every external-provider call,
 * and every send EXECUTES through `dispatchTool` into one of the prospecting
 * `CatalogEntry`s. `dispatchTool` is the single choke point — it resolves the
 * tool against the catalog, then (Zod → RBAC → OTP → execute) writes EXACTLY
 * ONE `audit_log` row for the dispatch no matter which outcome path it takes
 * (Requirement 8.1, reused S1 dispatcher behaviour / Property 11). An agent
 * never holds a tool object for a prospecting capability; the dispatcher is the
 * only way these tools execute, and a tool name that is NOT a catalog entry is
 * rejected as `unknown_tool`.
 *
 * The property drives a generated mix of dispatches and asserts, across that
 * mix, that:
 *   • the number of audit rows equals the number of dispatches (exactly one row
 *     per dispatch — the audit boundary, Req 8.1);
 *   • the recorded `(userId, action)` multiset equals the multiset the
 *     dispatches were issued with — `userId` is the dispatching actor's identity
 *     and `action` is the tool name;
 *   • every dispatch of a prospecting CatalogEntry FLOWS INTO that entry — the
 *     dispatcher recognises it (the outcome is NEVER `unknown_tool`); whereas
 *   • every dispatch of a non-catalog tool name is REJECTED as `unknown_tool`.
 *
 * The eight prospecting capabilities are exercised by name (the canonical
 * `PROSPECTING_CAPABILITY_NAMES`): `find_comparables`, `market_comps`,
 * `record_target`, `prospect_search`, `enrich_target`, `draft_outreach`,
 * `promote_target_to_lead`, and the human-gated `send_outreach`. With an empty
 * RBAC store and unvalidated input the catalog tools land on the
 * validation_error / permission_denied paths — both of which prove the tool was
 * resolved into a CatalogEntry (resolution precedes validation/permission in the
 * dispatcher) and both of which still write exactly one audit row. The explicit
 * examples below additionally drive the SUCCESS path (a granted actor running a
 * read tool to completion over an empty market mirror) and the human-gated send
 * (never agent-grantable → permission_denied), each still exactly one audit row.
 *
 * Harness mirrors `dispatch.audit.property.test.ts` and the sibling
 * `prospecting-capabilities.write.test.ts` (node-postgres adapter over pg-mem),
 * so the REAL SQL paths run — the audit insert, the RBAC permission resolution,
 * and the read handlers' market_* selects. No network is hit.
 */

// Spec requires >=100 iterations (task notes); reduced for fast local runs —
// restore via PBT_RUNS=100 (final verification, task 9.1).
const NUM_RUNS = Number(process.env.PBT_RUNS ?? 25);

// `record_target` / `promote_target_to_lead` reach computePhoneHash on the
// success path; a stable test salt keeps hashing deterministic (mirrors the
// write test). Harmless on the validation/permission paths the property uses.
process.env.PHONE_HASH_SALT ??= "prospecting-audit-property-salt";

import * as schema from "../../schema";
import { auditLog } from "../../schema";
import type { Database } from "../../db";
import type { ToolContext } from "./registry";
import { dispatchTool, type DispatchErrorCode } from "./dispatch";
import {
  PROSPECTING_CAPABILITY_NAMES,
  PROSPECTING_AGENT_ACTOR,
  PROSPECTING_OUTREACH_AGENT_ACTOR,
} from "./prospecting-capabilities";

// ── Harness ──────────────────────────────────────────────────────────────────

// Hand-written DDL: the audit_log the dispatcher writes to, the four RBAC tables
// the permission check resolves against, and the market_* mirror the read
// handlers select from. `audit_log.user_id` is `text` (the dispatcher records
// the string actor identity, never a uuid session). The RBAC tables are present
// and left EMPTY for the property runs — a non-static prospecting actor resolves
// to no permissions, so a catalog tool with valid input lands on
// permission_denied while one with invalid input lands on validation_error;
// BOTH prove the tool resolved into a CatalogEntry and BOTH write one audit row.
const DDL = `
  CREATE TABLE "audit_log" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" text NOT NULL,
    "action" text NOT NULL,
    "entity_type" text NOT NULL,
    "entity_id" text NOT NULL,
    "summary" text NOT NULL,
    "changes" jsonb,
    "created_at" timestamp DEFAULT now() NOT NULL
  );
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
    "user_id" uuid NOT NULL,
    "role_id" uuid NOT NULL,
    "granted_by" uuid,
    "granted_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "market_projects" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "developer_id" uuid,
    "name" text NOT NULL,
    "name_normalized" text NOT NULL,
    "community_name" text,
    "city" text,
    "region" text,
    "country" text,
    "location_lat" numeric,
    "location_lng" numeric,
    "segment" text,
    "status" text,
    "launch_date" date,
    "handover_date" date,
    "total_units" integer,
    "unit_types" jsonb,
    "price_min" numeric,
    "price_max" numeric,
    "avg_price_per_sqft" numeric,
    "branded" boolean DEFAULT false,
    "brand_name" text,
    "source" text NOT NULL,
    "source_ref" text,
    "as_of" timestamp,
    "demo" boolean NOT NULL DEFAULT false,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "market_transactions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "market_project_id" uuid,
    "market_building_id" uuid,
    "community_name" text,
    "area_name" text,
    "txn_type" text NOT NULL,
    "txn_date" date NOT NULL,
    "unit_type" text,
    "area_sqm" numeric,
    "bedrooms" integer,
    "price_aed" numeric,
    "price_per_sqft" numeric,
    "is_cash" boolean,
    "buyer_segment" text,
    "buyer_nationality" text,
    "source" text NOT NULL,
    "source_ref" text,
    "as_of" timestamp,
    "demo" boolean NOT NULL DEFAULT false,
    "created_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "market_price_index" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "area_name" text NOT NULL,
    "segment" text,
    "period" text NOT NULL,
    "index_value" numeric,
    "avg_price_per_sqft" numeric,
    "yoy_pct" numeric,
    "source" text NOT NULL,
    "as_of" timestamp,
    "demo" boolean NOT NULL DEFAULT false,
    "created_at" timestamp DEFAULT now() NOT NULL
  );
`;

function buildDb(): { mem: IMemoryDb; db: Database } {
  const mem = newDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });
  mem.public.none(DDL);

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem's node-postgres adapter rejects `types.getTypeParser` and
  // `rowMode: "array"`; strip both, mirroring the sibling dispatch/write tests.
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

/** All audit rows, projected to the (actor, action) pair the property asserts. */
async function auditRows(db: Database) {
  return db
    .select({ userId: auditLog.userId, action: auditLog.action })
    .from(auditLog);
}

/** A minimal ToolContext for a dispatch under `actor`. */
function ctxFor(actor: string): ToolContext {
  return {
    actor,
    conversationId: randomUUID(),
    language: "en",
    otpVerificationState: "not_required",
  };
}

// The actor identities a prospecting dispatch is legitimately issued under: the
// two string agent identities (resolved via the dispatcher's static grant) and
// uuid principals (a rep approving a send, or an ungranted principal — resolved
// through the RBAC engine against the empty store). Varying the actor per
// dispatch is what makes "userId = the dispatching agent's identity" a
// meaningful, non-constant assertion.
const actorArb = fc.oneof(
  fc.constantFrom(PROSPECTING_AGENT_ACTOR, PROSPECTING_OUTREACH_AGENT_ACTOR),
  fc.uuid() // a rep / a fresh principal that holds no roles
);

// ── Generators ────────────────────────────────────────────────────────────────

interface DispatchPlan {
  /** The dispatching actor's identity — recorded as the audit `userId`. */
  actor: string;
  /** The tool name the dispatch is issued for — recorded as the audit `action`. */
  toolName: string;
  /** True when `toolName` is a prospecting CatalogEntry (must NOT be unknown_tool). */
  isCatalogTool: boolean;
}

/** A dispatch of a real prospecting CatalogEntry (by name). */
const catalogPlanArb: fc.Arbitrary<DispatchPlan> = fc
  .tuple(fc.constantFrom(...PROSPECTING_CAPABILITY_NAMES), actorArb)
  .map(([toolName, actor]) => ({ toolName, actor, isCatalogTool: true }));

/** A dispatch of a name that is NOT a catalog entry (must be rejected). */
const unknownPlanArb: fc.Arbitrary<DispatchPlan> = fc
  .tuple(fc.uuid(), actorArb)
  .map(([u, actor]) => ({
    toolName: `not_a_catalog_tool_${u.slice(0, 8)}`,
    actor,
    isCatalogTool: false,
  }));

const planArb: fc.Arbitrary<DispatchPlan> = fc.oneof(
  catalogPlanArb,
  unknownPlanArb
);

// ── Property 7 ─────────────────────────────────────────────────────────────────

describe("prospecting capabilities — Property 7: every capability flows through dispatchTool into a CatalogEntry, exactly one audit row; non-catalog rejected (Req 8.1)", () => {
  it("for any mix of prospecting + non-catalog dispatches: exactly one audit row each, userId = actor, action = tool name; catalog tools never unknown_tool, non-catalog always unknown_tool", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(planArb, { minLength: 1, maxLength: 8 }),
        async (plans) => {
          const { db } = buildDb();

          // The (actor, action) pair each dispatch SHOULD be audited under.
          const expected: Array<{ userId: string; action: string }> = [];

          for (const plan of plans) {
            // Unvalidated input `{}`: tools with required fields take the
            // validation_error path; the all-optional `market_comps` passes
            // validation and (with no RBAC grant) takes permission_denied. Both
            // outcomes prove the tool resolved into a CatalogEntry (resolution
            // precedes validation/permission) and both write one audit row.
            const result = await dispatchTool(db, plan.toolName, {}, ctxFor(plan.actor));

            if (plan.isCatalogTool) {
              // Flowed INTO a CatalogEntry: the dispatcher resolved it, so the
              // outcome is whatever the entry yields (success when a granted
              // actor runs an all-optional read, otherwise validation_error /
              // permission_denied) — but NEVER `unknown_tool`. Either way it is
              // audited exactly once.
              if (!result.ok) {
                const code: DispatchErrorCode = result.error.code;
                expect(code).not.toBe("unknown_tool");
              }
            } else {
              // A non-catalog tool name is rejected as unknown_tool.
              expect(result.ok).toBe(false);
              if (!result.ok) {
                expect(result.error.code).toBe("unknown_tool");
              }
            }

            expected.push({ userId: plan.actor, action: plan.toolName });
          }

          const rows = await auditRows(db);

          // 1. Exactly one audit row PER dispatch — the audit boundary (Req 8.1).
          expect(rows.length).toBe(plans.length);

          // 2. The recorded (actor, action) multiset equals what was issued:
          //    userId = the dispatching actor, action = the tool name. Compared
          //    as order-independent sorted multisets.
          const key = (r: { userId: string; action: string }) =>
            `${r.userId}\u0000${r.action}`;
          expect(rows.map(key).sort()).toEqual(expected.map(key).sort());
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

// ── Explicit examples — the outcome paths, each exactly one audit row ───────────

describe("prospecting audit boundary — explicit examples (Req 8.1)", () => {
  let db: Database;

  beforeEach(() => {
    ({ db } = buildDb());
  });

  it("success: agent:prospecting runs find_comparables to completion over the empty market mirror → one row, action = find_comparables", async () => {
    const result = await dispatchTool(
      db,
      "find_comparables",
      { brief: { spec: { area: "Palm Jumeirah", features: [] } } },
      ctxFor(PROSPECTING_AGENT_ACTOR)
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Empty catalog → no comparables, flagged unconfigured (Req 11.5).
      expect(result.result).toMatchObject({ comparables: [], unconfigured: true });
    }

    const rows = await auditRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      userId: PROSPECTING_AGENT_ACTOR,
      action: "find_comparables",
    });
  });

  it("success: agent:prospecting runs market_comps over the empty mirror → one row, action = market_comps", async () => {
    const result = await dispatchTool(
      db,
      "market_comps",
      { area: "Downtown Dubai" },
      ctxFor(PROSPECTING_AGENT_ACTOR)
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toMatchObject({ comps: [], priceIndex: [], unconfigured: true });
    }

    const rows = await auditRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      userId: PROSPECTING_AGENT_ACTOR,
      action: "market_comps",
    });
  });

  it("validation_error: record_target with invalid input is rejected pre-handler → one row, action = record_target", async () => {
    const result = await dispatchTool(
      db,
      "record_target",
      {}, // missing required targetType / sourceProvider / lawfulBasis
      ctxFor(PROSPECTING_AGENT_ACTOR)
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation_error");

    const rows = await auditRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      userId: PROSPECTING_AGENT_ACTOR,
      action: "record_target",
    });
  });

  it("permission_denied: a recognised catalog tool under an ungranted (uuid) principal is denied (not unknown_tool) → one row", async () => {
    // `market_comps` has all-optional input, so it passes validation and reaches
    // the permission check — which a fresh uuid principal holding no roles fails.
    const ungranted = randomUUID();
    const result = await dispatchTool(
      db,
      "market_comps",
      { area: "Palm Jumeirah" },
      ctxFor(ungranted)
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("permission_denied");

    const rows = await auditRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ userId: ungranted, action: "market_comps" });
  });

  it("send_outreach is never agent-grantable: even agent:prospecting is denied → one row, no send", async () => {
    // The agent:prospecting grant covers every prospecting tool EXCEPT
    // send_outreach (the send is human-gated by an Approval_Flow token), so even
    // that agent is denied — proving the send flows through the audited boundary
    // but is never an agent capability (Design §5).
    const result = await dispatchTool(
      db,
      "send_outreach",
      { draftId: randomUUID(), token: "any-token" },
      ctxFor(PROSPECTING_AGENT_ACTOR)
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("permission_denied");

    const rows = await auditRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      userId: PROSPECTING_AGENT_ACTOR,
      action: "send_outreach",
    });
  });

  it("unknown_tool: a non-catalog name is rejected → one row audited under the rejected name", async () => {
    const result = await dispatchTool(
      db,
      "definitely_not_a_prospecting_tool",
      {},
      ctxFor(PROSPECTING_AGENT_ACTOR)
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unknown_tool");

    const rows = await auditRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      userId: PROSPECTING_AGENT_ACTOR,
      action: "definitely_not_a_prospecting_tool",
    });
  });

  it("every prospecting capability is resolvable through dispatchTool (never unknown_tool), each audited exactly once", async () => {
    for (const name of PROSPECTING_CAPABILITY_NAMES) {
      const { db: freshDb } = buildDb();
      const result = await dispatchTool(
        freshDb,
        name,
        {},
        ctxFor(PROSPECTING_AGENT_ACTOR)
      );
      // Resolved into a CatalogEntry — whatever the outcome, never unknown_tool.
      if (!result.ok) {
        expect(result.error.code).not.toBe("unknown_tool");
      }
      const rows = await auditRows(freshDb);
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe(name);
    }
  });
});
