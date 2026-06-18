import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import fc from "fast-check";

/**
 * Property test for exactly-one-audit per dispatch (task 1.12 — a non-optional
 * CC-Audit boundary test).
 *
 *   **Feature: agentic-foundation, Property 11: For any dispatch outcome
 *   (success, unknown_tool, validation_error, permission_denied, otp_required,
 *   or handler_error), exactly one auditLog row is written, with actor equal to
 *   the dispatching agent's identity and action equal to the tool name.**
 *
 * **Validates: Requirements 10.1, 10.2**
 *
 * This guards the dispatcher's final, non-negotiable invariant (`dispatch.ts`
 * step 5 / design Property 11): no matter WHICH of the five rejection paths a
 * dispatch takes, or whether it succeeds, EXACTLY ONE `audit_log` row is
 * written for the dispatch (Req 10.1) — recorded under `userId = ctx.actor`
 * (the dispatching agent's identity) with the tool name as the `action`
 * (Req 10.2). `dispatchTool` is the single choke point, so every call flows
 * through `logAudit` exactly once regardless of the outcome path it takes.
 *
 * The property drives ALL SIX outcomes the dispatcher can produce and asserts,
 * across a generated mix of them, that the number of audit rows equals the
 * number of dispatches and that the multiset of recorded `(actor, action)`
 * pairs equals the multiset the dispatches were issued with:
 *
 *   • success           — a recognised actor runs a tool whose handler succeeds
 *                         (`update_qualification` over a seeded party).
 *   • unknown_tool       — a tool name absent from the registry is rejected
 *                         (audited under the rejected name itself).
 *   • validation_error   — a real tool receives a non-object input that fails
 *                         its Zod schema; the handler never runs.
 *   • permission_denied  — a uuid agent identity holding no RBAC roles lacks the
 *                         tool's `voice:tool:<name>` permission.
 *   • otp_required       — a visitor calls the OTP-gated `get_lead_context`; the
 *                         gate intercepts before the handler runs.
 *   • handler_error      — `book_viewing` is asked to book a slot that does not
 *                         exist; the handler throws and is caught.
 *
 * The actor is intentionally VARIED per dispatch (the statically-granted
 * `agent:voice-lead` for the paths it can reach, a fresh uuid principal for the
 * permission-denied path), which is what makes "actor equal to the dispatching
 * agent's identity" a meaningful, non-constant assertion (Req 10.2).
 *
 * Harness mirrors `dispatch.property.test.ts` / `dispatch.permission.property.test.ts`
 * (node-postgres adapter over pg-mem with migration 0029 applied) so the real
 * SQL paths — the audit insert and the RBAC permission resolution — run. The
 * LLM gateway and Salesforce adapter are mocked at module load (the registry
 * imports them); no network is hit and no handler reaches CRM.
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
import { auditLog, parties } from "../../schema";
import type { Database } from "../../db";
import type { IdentityResult } from "../identity";
import { dispatchTool, type DispatchErrorCode } from "./dispatch";
import { VOICE_AGENT_ACTOR, type ToolContext } from "./registry";

const NUM_RUNS = 100;
const MIGRATION_FILE = "0029_demonic_mandrill.sql";

// Base tables migration 0029 ALTERs / references, plus `audit_log` and the RBAC
// tables the dispatcher's permission check resolves against (`roles`,
// `permissions`, `role_permissions`, `user_roles`). The RBAC tables are present
// but left EMPTY: the permission-denied path uses a uuid identity that holds no
// roles, so `loadUserRoles` resolves to an empty permission set and the tool's
// `voice:tool:<name>` permission is denied. `audit_log.user_id` is `text`: the
// dispatcher records the string actor (the dispatching agent's identity) as the
// audited user — never a uuid session — so a `text` column lets every
// dispatch's audit insert persist and lets the property assert the actor.
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

// ── Outcome model ──────────────────────────────────────────────────────────────

const VISITOR: IdentityResult = { type: "visitor", units: [] };

/** The six dispatch outcomes the dispatcher can produce. */
type Outcome =
  | "success"
  | "unknown_tool"
  | "validation_error"
  | "permission_denied"
  | "otp_required"
  | "handler_error";

/**
 * A single generated dispatch, fully resolved: the outcome it should produce,
 * the actor it is issued under, the tool name that should be audited as the
 * `action`, the raw input, and the context. `seededPartyId` is filled in at
 * dispatch time for the success path (which needs a real party row).
 */
interface DispatchPlan {
  outcome: Outcome;
  /** The dispatching agent's identity — recorded as the audit `userId`. */
  actor: string;
  /** The tool name the dispatch is issued for — recorded as the audit `action`. */
  toolName: string;
  /** Whether the input is resolved up-front or needs the seeded party id. */
  input: unknown | "USE_SEEDED_PARTY";
  identity: IdentityResult;
  otpVerificationState: ToolContext["otpVerificationState"];
  /** The structured error code the dispatch must return (undefined ⇒ ok). */
  expectedCode?: DispatchErrorCode;
}

const idArb = fc.uuid();
const budgetArb = fc.constantFrom("1.0-1.5M", "2.5-3.0M", "3.0-3.5M", "5.0M+");

/**
 * Build a generator for one outcome. Every plan carries the actor and tool
 * name the dispatch will be audited under, so the property can compare the
 * recorded `(actor, action)` multiset against what it issued.
 */
const planArb: fc.Arbitrary<DispatchPlan> = fc.oneof(
  // success — recognised actor runs a handler that succeeds (over a seeded party).
  budgetArb.map((budgetBand) => ({
    outcome: "success" as const,
    actor: VOICE_AGENT_ACTOR,
    toolName: "update_qualification",
    input: "USE_SEEDED_PARTY" as const,
    extraBudget: budgetBand,
    identity: VISITOR,
    otpVerificationState: "not_required" as const,
    expectedCode: undefined,
  })).map((p) => ({
    ...p,
    // Carry the generated budget through the seeded-party resolver.
    input: { __seededParty: true, budgetBand: (p as { extraBudget: string }).extraBudget },
  })),

  // unknown_tool — a tool name absent from the registry (never a real name).
  fc.uuid().map((u) => ({
    outcome: "unknown_tool" as const,
    actor: VOICE_AGENT_ACTOR,
    toolName: `unknown_tool_${u.slice(0, 8)}`,
    input: {},
    identity: VISITOR,
    otpVerificationState: "not_required" as const,
    expectedCode: "unknown_tool" as const,
  })),

  // validation_error — a real tool with a non-object input that fails Zod.
  fc
    .tuple(
      fc.constantFrom("update_qualification", "score_lead", "assign_rep", "book_viewing"),
      fc.constantFrom(42, "not-an-object", null, true)
    )
    .map(([toolName, input]) => ({
      outcome: "validation_error" as const,
      actor: VOICE_AGENT_ACTOR,
      toolName,
      input,
      identity: VISITOR,
      otpVerificationState: "not_required" as const,
      expectedCode: "validation_error" as const,
    })),

  // permission_denied — a uuid principal with no roles lacks the permission.
  fc
    .tuple(
      fc.uuid(),
      fc.constantFrom("update_qualification", "score_lead", "assign_rep", "get_lead_context"),
      idArb
    )
    .map(([agentId, toolName, partyId]) => ({
      outcome: "permission_denied" as const,
      actor: agentId,
      toolName,
      input: { partyId },
      identity: VISITOR,
      otpVerificationState: "not_required" as const,
      expectedCode: "permission_denied" as const,
    })),

  // otp_required — a visitor calls the OTP-gated get_lead_context.
  idArb.map((partyId) => ({
    outcome: "otp_required" as const,
    actor: VOICE_AGENT_ACTOR,
    toolName: "get_lead_context",
    input: { partyId },
    identity: VISITOR,
    otpVerificationState: "not_required" as const,
    expectedCode: "otp_required" as const,
  })),

  // handler_error — book a slot that does not exist; the handler throws.
  fc.tuple(idArb, idArb).map(([partyId, slotId]) => ({
    outcome: "handler_error" as const,
    actor: VOICE_AGENT_ACTOR,
    toolName: "book_viewing",
    input: { partyId, slotId },
    identity: VISITOR,
    otpVerificationState: "not_required" as const,
    expectedCode: "handler_error" as const,
  }))
);

// ── Property 11 ─────────────────────────────────────────────────────────────

describe("dispatchTool — Property 11: exactly one audit row per dispatch, correct actor + action (Req 10.1, 10.2)", () => {
  it("for any mix of the six outcomes, writes exactly one auditLog row per dispatch, userId = actor and action = tool name", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(planArb, { minLength: 1, maxLength: 6 }),
        async (plans) => {
          const { db } = buildDb();

          // The success path needs a real party row (leads_mirror.party_id FK).
          const seededPartyId = randomUUID();
          await db
            .insert(parties)
            .values({ id: seededPartyId, type: "person", language: "en" });

          // The (actor, action) pair each dispatch SHOULD be audited under.
          const expected: Array<{ userId: string; action: string }> = [];

          for (const plan of plans) {
            // Resolve the success path's input against the seeded party.
            const rawInput = plan.input as
              | { __seededParty?: true; budgetBand?: string }
              | unknown;
            const input =
              rawInput &&
              typeof rawInput === "object" &&
              (rawInput as { __seededParty?: true }).__seededParty
                ? {
                    partyId: seededPartyId,
                    budgetBand: (rawInput as { budgetBand?: string }).budgetBand,
                  }
                : plan.input;

            const ctx: ToolContext = {
              actor: plan.actor,
              conversationId: randomUUID(),
              identity: plan.identity,
              language: "en",
              otpVerificationState: plan.otpVerificationState,
            };

            const result = await dispatchTool(db, plan.toolName, input, ctx);

            // The outcome matches the plan: ok for success, the expected
            // structured error code otherwise — so all six paths are exercised.
            if (plan.expectedCode === undefined) {
              expect(result.ok).toBe(true);
            } else {
              expect(result.ok).toBe(false);
              if (!result.ok) {
                expect(result.error.code).toBe(plan.expectedCode);
              }
            }

            expected.push({ userId: plan.actor, action: plan.toolName });
          }

          const rows = await db
            .select({ userId: auditLog.userId, action: auditLog.action })
            .from(auditLog);

          // 1. Exactly one audit row PER dispatch — no more, no fewer (Req 10.1).
          expect(rows.length).toBe(plans.length);

          // 2. The recorded (actor, action) multiset equals what was issued:
          //    userId = the dispatching agent's identity, action = the tool name
          //    (Req 10.2). Compare as order-independent sorted multisets.
          const key = (r: { userId: string; action: string }) =>
            `${r.userId}\u0000${r.action}`;
          expect(rows.map(key).sort()).toEqual(expected.map(key).sort());
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

// ── Explicit examples — one per outcome ────────────────────────────────────────

describe("dispatchTool exactly-one-audit — explicit examples, one per outcome (Req 10.1, 10.2)", () => {
  async function auditRows(db: Database) {
    return db
      .select({ userId: auditLog.userId, action: auditLog.action })
      .from(auditLog);
  }

  function voiceCtx(): ToolContext {
    return {
      actor: VOICE_AGENT_ACTOR,
      conversationId: randomUUID(),
      identity: VISITOR,
      language: "en",
      otpVerificationState: "not_required",
    };
  }

  it("success: one row, action = tool name, actor = the agent identity", async () => {
    const { db } = buildDb();
    const partyId = randomUUID();
    await db.insert(parties).values({ id: partyId, type: "person", language: "en" });

    const result = await dispatchTool(
      db,
      "update_qualification",
      { partyId, budgetBand: "2.5-3.0M" },
      voiceCtx()
    );
    expect(result.ok).toBe(true);

    const rows = await auditRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(VOICE_AGENT_ACTOR);
    expect(rows[0].action).toBe("update_qualification");
  });

  it("unknown_tool: one row, audited under the rejected tool name", async () => {
    const { db } = buildDb();
    const result = await dispatchTool(db, "not_a_real_tool", {}, voiceCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unknown_tool");

    const rows = await auditRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(VOICE_AGENT_ACTOR);
    expect(rows[0].action).toBe("not_a_real_tool");
  });

  it("validation_error: one row, handler never runs", async () => {
    const { db } = buildDb();
    const result = await dispatchTool(
      db,
      "update_qualification",
      { partyId: 123 }, // partyId must be a string → fails Zod
      voiceCtx()
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation_error");

    const rows = await auditRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(VOICE_AGENT_ACTOR);
    expect(rows[0].action).toBe("update_qualification");
  });

  it("permission_denied: one row, audited under the denied agent identity", async () => {
    const { db } = buildDb();
    const agentId = randomUUID(); // a uuid principal with no roles
    const result = await dispatchTool(
      db,
      "update_qualification",
      { partyId: randomUUID(), budgetBand: "2.5-3.0M" },
      { ...voiceCtx(), actor: agentId }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("permission_denied");

    const rows = await auditRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(agentId);
    expect(rows[0].action).toBe("update_qualification");
  });

  it("otp_required: one row for an intercepted OTP-gated read", async () => {
    const { db } = buildDb();
    const result = await dispatchTool(
      db,
      "get_lead_context",
      { partyId: randomUUID() },
      voiceCtx() // visitor, not_required → gate intercepts
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("otp_required");

    const rows = await auditRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(VOICE_AGENT_ACTOR);
    expect(rows[0].action).toBe("get_lead_context");
  });

  it("handler_error: one row when the handler throws", async () => {
    const { db } = buildDb();
    const result = await dispatchTool(
      db,
      "book_viewing",
      { partyId: randomUUID(), slotId: randomUUID() }, // slot does not exist
      voiceCtx()
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("handler_error");

    const rows = await auditRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(VOICE_AGENT_ACTOR);
    expect(rows[0].action).toBe("book_viewing");
  });
});
