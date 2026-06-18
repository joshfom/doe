import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import fc from "fast-check";

/**
 * Property test for the per-agent RBAC permission gate (task 1.10 — a
 * non-optional CC-OTP boundary test).
 *
 *   **Feature: agentic-foundation, Property 8: For any agent identity lacking
 *   the RBAC permission required by a Catalog_Entry whose input is valid,
 *   dispatchTool returns permission_denied, never invokes the handler, and
 *   leaves all persistent state unchanged.**
 *
 * **Validates: Requirements 3.4, 3.5, 11.3**
 *
 * This guards the dispatcher's third pipeline step — the RBAC permission check
 * (`dispatch.ts` step 3, after Zod validation and before the OTP gate and the
 * handler). The dispatcher resolves a non-static agent identity through the
 * real RBAC engine (`loadUserRoles` → `resolvePermissions` → `hasPermission`),
 * so the test seeds REAL `roles` / `permissions` / `role_permissions` /
 * `user_roles` rows under pg-mem and proves that, for an identity that lacks
 * the tool's required `voice:tool:<name>` permission (either holding no roles
 * at all, or holding a role with only unrelated permissions), every otherwise
 * schema-valid dispatch is denied:
 *
 *   1. the dispatch resolves to `{ ok: false, error.code: "permission_denied" }`
 *      (Req 3.4, 11.3);
 *   2. the Catalog_Entry handler is NEVER invoked (asserted with a spy on the
 *      registry handler — `getTool` returns the registry entry by reference, so
 *      the dispatcher calls exactly this function object) (Req 3.5); and
 *   3. all persistent business state is unchanged — the seeded `leads_mirror`
 *      baseline is byte-identical afterward and no appointment is written
 *      (Req 3.5).
 *
 * The well-known static identity `agent:voice-lead` is deliberately excluded:
 * it carries an in-process grant of every voice tool permission and therefore
 * never lacks permission. Generated identities are uuids (the agent's RBAC
 * principal id) so they resolve through the engine exactly as a real
 * RBAC-seeded agent would.
 *
 * Harness mirrors `dispatch.isolation.property.test.ts` / `dispatch.property.test.ts`
 * (node-postgres adapter over pg-mem with migration 0029 applied) so the real
 * SQL paths of the RBAC engine run. The LLM gateway and Salesforce adapter are
 * mocked at module load (the handler never runs, but the registry imports them).
 */

// ── LLM gateway mock — registry imports it at module load; never hit network. ─
vi.mock("../gateway", () => ({
  generateCompletion: vi.fn(async () => "Mocked rationale."),
}));

// ── Salesforce adapter mock — handlers must never reach CRM during a dispatch. ─
const sfSpies = {
  authenticate: vi.fn(),
  createCase: vi.fn(),
  updateCase: vi.fn(),
  getCaseStatus: vi.fn(),
};
vi.mock("../../tickets/crm/salesforce", () => {
  class MockSalesforceAdapter {
    name = "salesforce";
    authenticate = sfSpies.authenticate;
    createCase = sfSpies.createCase;
    updateCase = sfSpies.updateCase;
    getCaseStatus = sfSpies.getCaseStatus;
  }
  return {
    SalesforceAdapter: MockSalesforceAdapter,
    withRetry: vi.fn((fn: () => unknown) => fn()),
  };
});

import * as schema from "../../schema";
import {
  aiAppointments,
  leadsMirror,
  parties,
  roles,
  permissions,
  rolePermissions,
  userRoles,
} from "../../schema";
import type { Database } from "../../db";
import type { IdentityResult } from "../identity";
import { dispatchTool } from "./dispatch";
import { VOICE_AGENT_ACTOR, toolRegistry, type ToolContext } from "./registry";
import { TOOL_NAMES, type ToolName } from "../../voice/contracts";

const NUM_RUNS = 100;
const MIGRATION_FILE = "0029_demonic_mandrill.sql";

// Base tables migration 0029 ALTERs / references, plus the RBAC tables the
// dispatcher's permission check resolves against (`roles`, `permissions`,
// `role_permissions`, `user_roles`) and `audit_log`. The RBAC tables are
// hand-declared without foreign keys (mirroring the prerequisite-table pattern
// in the sibling dispatch tests) so the test can seed agent identities, roles,
// and permissions freely. `audit_log.user_id` is `text`: the dispatcher records
// the string actor (the agent's identity) as the audited user, never a uuid
// session, so a `text` column lets the denial audit insert persist.
const PREREQUISITE_SQL = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "email" text);
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "email" text);
  CREATE TABLE "ai_conversations" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "participant_name" text,
    "participant_phone" text,
    "participant_email" text,
    "participant_type" text NOT NULL DEFAULT 'visitor',
    "client_id" uuid,
    "tenant_id" uuid,
    "channel" text,
    "language" text NOT NULL DEFAULT 'en',
    "status" text NOT NULL DEFAULT 'active',
    "handoff_summary" jsonb,
    "otp_verification_state" text NOT NULL DEFAULT 'not_required',
    "resolved_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "ai_appointments" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "reference_number" text NOT NULL UNIQUE,
    "conversation_id" uuid,
    "client_id" uuid,
    "tenant_id" uuid,
    "contact_name" text NOT NULL,
    "contact_email" text,
    "contact_phone" text,
    "appointment_type" text NOT NULL,
    "scheduled_date" date NOT NULL,
    "scheduled_time" time NOT NULL,
    "status" text NOT NULL DEFAULT 'confirmed',
    "notes" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "ai_messages" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
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
`;

function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Stand up pg-mem with migration 0029 applied and return a drizzle handle. */
function buildDb(): { mem: IMemoryDb; db: Database } {
  const mem = newDb();

  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });
  mem.public.registerFunction({
    name: "pg_notify",
    args: [DataType.text, DataType.text],
    returns: DataType.text,
    implementation: () => "",
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

// ── Baseline business state ───────────────────────────────────────────────────

const BASELINE_PARTY_NAME = "BASELINE_PARTY";
const BASELINE_BUDGET = "BASELINE_BUDGET_1.0-1.5M";

/**
 * Seed a non-empty business-state baseline (a party + its lead-mirror row) so
 * "leaves all persistent state unchanged" is a meaningful assertion: a denied
 * dispatch must leave this row byte-identical and create no appointment.
 */
async function seedBaseline(db: Database): Promise<string> {
  const partyId = randomUUID();
  await db
    .insert(parties)
    .values({ id: partyId, type: "person", name: BASELINE_PARTY_NAME, language: "en" });
  await db.insert(leadsMirror).values({
    partyId,
    tier: "WARM",
    budgetBand: BASELINE_BUDGET,
  });
  return partyId;
}

/** Capture the mutable business tables a handler could write to, as a string. */
async function snapshotBusinessState(db: Database): Promise<string> {
  const mirror = await db.select().from(leadsMirror);
  const appts = await db.select().from(aiAppointments);
  return JSON.stringify({ mirror, appts });
}

// ── Seeding agent identities that LACK the required permission ────────────────

type LackMode = "no_roles" | "unrelated_role";

/**
 * Unrelated permissions an agent may hold while still lacking ANY
 * `voice:tool:<name>` permission. None share the `voice` resource and none is a
 * wildcard, so `hasPermission` (exact / `resource:*` / `*:*`) can never match a
 * voice tool permission from this set.
 */
const UNRELATED_PERMS: ReadonlyArray<[string, string]> = [
  ["pages", "read"],
  ["blog", "write"],
  ["tickets", "view"],
  ["units", "read"],
];

/**
 * Seed a generated agent identity so it provably lacks the tool permission.
 *  - "no_roles": the identity has no `user_roles` rows → resolves to no perms.
 *  - "unrelated_role": the identity holds one role granting only the unrelated
 *    permissions above → resolves to a non-empty perm set that still excludes
 *    every `voice:tool:<name>`.
 */
async function seedAgentLackingPermission(
  db: Database,
  agentId: string,
  mode: LackMode
): Promise<void> {
  if (mode === "no_roles") return;

  const roleId = randomUUID();
  await db.insert(roles).values({
    id: roleId,
    name: `unrelated-${roleId.slice(0, 8)}`,
    displayName: "Unrelated role",
    userType: "employee",
  });

  for (const [resource, action] of UNRELATED_PERMS) {
    const permissionId = randomUUID();
    await db.insert(permissions).values({ id: permissionId, resource, action });
    await db
      .insert(rolePermissions)
      .values({ id: randomUUID(), roleId, permissionId });
  }

  await db.insert(userRoles).values({ id: randomUUID(), userId: agentId, roleId });
}

// ── Input generators (schema-VALID inputs, so the dispatch reaches step 3) ─────

const idArb = fc.uuid();

/**
 * A schema-VALID input for each tool: the dispatch must pass Zod validation
 * (step 2) to reach the RBAC permission check (step 3). The handler never runs
 * (permission is denied first), so these inputs only need to satisfy the schema.
 */
const validInputArbs: Record<ToolName, fc.Arbitrary<unknown>> = {
  get_lead_context: fc.record({ partyId: idArb }),
  update_qualification: fc.record({ partyId: idArb }),
  score_lead: fc.record({ partyId: idArb }),
  check_viewing_slots: fc.record({
    project: fc.string({ minLength: 1, maxLength: 12 }),
  }),
  book_viewing: fc.record({ partyId: idArb, slotId: idArb }),
  assign_rep: fc.record({ partyId: idArb }),
  send_whatsapp_brief: fc.record({ repId: idArb, partyId: idArb }),
  queue_report_email: fc.record({
    requesterEmail: fc.constant("ops@doe.test"),
    scope: fc.constantFrom("exec", "rep"),
    period: fc.constantFrom("overall", "2025-W10"),
  }),
  log_outcome: fc.record({
    repId: idArb,
    partyId: idArb,
    freeText: fc.string({ minLength: 1, maxLength: 20 }),
  }),
  get_pipeline_summary: fc.record({
    scope: fc.constantFrom("exec", "rep"),
    period: fc.constant("overall"),
  }),
};

const toolNameArb = fc.constantFrom(...TOOL_NAMES);
const lackModeArb = fc.constantFrom<LackMode>("no_roles", "unrelated_role");

interface DispatchSpec {
  toolName: ToolName;
  input: unknown;
  mode: LackMode;
}

const specArb: fc.Arbitrary<DispatchSpec> = fc
  .tuple(toolNameArb, lackModeArb)
  .chain(([toolName, mode]) =>
    validInputArbs[toolName].map((input) => ({ toolName, input, mode }))
  );

// The dispatching agent is a uuid RBAC principal (never the statically-granted
// `agent:voice-lead`). A uuid never equals that string, so every generated
// identity is resolved through the RBAC engine.
const agentIdArb = fc.uuid();

const VISITOR: IdentityResult = { type: "visitor", units: [] };

// ── Property 8 ────────────────────────────────────────────────────────────────

describe("dispatchTool — Property 8: permission gate denies, never runs handler, no state change (Req 3.4, 3.5, 11.3)", () => {
  it("for any agent identity lacking the required permission and valid input, returns permission_denied, never invokes the handler, and leaves business state unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(specArb, agentIdArb, async (spec, agentId) => {
        const { db } = buildDb();
        await seedBaseline(db);
        await seedAgentLackingPermission(db, agentId, spec.mode);

        // Spy on the exact registry handler the dispatcher will look up via
        // getTool (same object reference) to prove it is never invoked.
        const handlerSpy = vi.spyOn(toolRegistry[spec.toolName], "handler");

        const before = await snapshotBusinessState(db);

        try {
          const ctx: ToolContext = {
            actor: agentId,
            conversationId: randomUUID(),
            identity: VISITOR,
            language: "en",
            otpVerificationState: "not_required",
          };

          const result = await dispatchTool(db, spec.toolName, spec.input, ctx);

          // 1. Denied with the permission_denied code (Req 3.4, 11.3).
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.code).toBe("permission_denied");
          }

          // 2. The handler was never invoked (Req 3.5).
          expect(handlerSpy).not.toHaveBeenCalled();

          // 3. All persistent business state is unchanged (Req 3.5).
          const after = await snapshotBusinessState(db);
          expect(after).toBe(before);
        } finally {
          handlerSpy.mockRestore();
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

// ── Explicit examples ─────────────────────────────────────────────────────────

describe("dispatchTool permission gate — explicit examples (Req 3.4, 3.5, 11.3)", () => {
  it("an identity with NO roles is denied a mutating tool; no mirror row is written and the handler does not run", async () => {
    const { db } = buildDb();
    await seedBaseline(db);
    const agentId = randomUUID();

    const handlerSpy = vi.spyOn(toolRegistry.update_qualification, "handler");
    try {
      const before = await snapshotBusinessState(db);

      const result = await dispatchTool(
        db,
        "update_qualification",
        { partyId: randomUUID(), budgetBand: "2.5-3.0M" },
        {
          actor: agentId,
          conversationId: randomUUID(),
          identity: VISITOR,
          otpVerificationState: "not_required",
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("permission_denied");
      expect(handlerSpy).not.toHaveBeenCalled();
      expect(await snapshotBusinessState(db)).toBe(before);
    } finally {
      handlerSpy.mockRestore();
    }
  });

  it("an identity holding only unrelated permissions is still denied an OTP-gated personal-data tool (permission is checked before the OTP gate)", async () => {
    const { db } = buildDb();
    await seedBaseline(db);
    const agentId = randomUUID();
    await seedAgentLackingPermission(db, agentId, "unrelated_role");

    const handlerSpy = vi.spyOn(toolRegistry.get_lead_context, "handler");
    try {
      const result = await dispatchTool(
        db,
        "get_lead_context",
        { partyId: randomUUID() },
        {
          actor: agentId,
          conversationId: randomUUID(),
          identity: VISITOR,
          // Even a "verified" state cannot help: the permission check (step 3)
          // runs before the OTP gate (step 4), so the code is permission_denied.
          otpVerificationState: "verified",
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("permission_denied");
      expect(handlerSpy).not.toHaveBeenCalled();
    } finally {
      handlerSpy.mockRestore();
    }
  });

  it("the statically-granted voice agent is NOT denied (sanity: the gate denies only identities that lack the permission)", async () => {
    const { db } = buildDb();
    const partyId = await seedBaseline(db);

    // The voice agent holds every voice tool permission via its in-process
    // grant, so update_qualification proceeds and writes the mirror row.
    const result = await dispatchTool(
      db,
      "update_qualification",
      { partyId, budgetBand: "3.0-3.5M" },
      {
        actor: VOICE_AGENT_ACTOR,
        conversationId: randomUUID(),
        identity: VISITOR,
        otpVerificationState: "not_required",
      }
    );

    expect(result.ok).toBe(true);
  });
});
