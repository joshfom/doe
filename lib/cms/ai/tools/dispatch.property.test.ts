import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import fc from "fast-check";

/**
 * Property test for tool auditing on the voice tool path (task 9.2).
 *
 *   Property 3 — Every tool call is audited (Req 6.3, 13.3; design §10.6 "P3"):
 *   for ALL `dispatchTool` invocations — whether they succeed, are rejected for
 *   invalid input (Zod validation fails → the handler is NOT run), are OTP-gated,
 *   or fail inside the handler — EXACTLY ONE `auditLog` row is written for the
 *   dispatch, recorded under `actor = "agent:voice-lead"` with the tool name as
 *   the audited action. The single dispatcher (`dispatchTool`) is the only choke
 *   point, so every call flows through `logAudit` exactly once regardless of the
 *   outcome path it takes.
 *
 * **Validates: Requirements 6.3, 13.3**
 *
 * Harness mirrors `dispatch.isolation.property.test.ts` / `registry.test.ts`
 * (node-postgres adapter over pg-mem with migration 0029 applied) so the real
 * SQL paths run. The `audit_log` table is created in PREREQUISITE_SQL with a
 * `text` `user_id` (the dispatcher records the string actor `agent:voice-lead`,
 * not a uuid session) so every dispatch's audit insert persists and the actor /
 * action can be asserted directly. The LLM gateway and Salesforce adapter are
 * mocked so no network is hit and the (mirror-only) handlers never reach CRM.
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
import { auditLog, leadsMirror, parties } from "../../schema";
import type { Database } from "../../db";
import type { IdentityResult } from "../identity";
import { dispatchTool } from "./dispatch";
import { VOICE_AGENT_ACTOR, type ToolContext } from "./registry";
import { TOOL_NAMES, type ToolName } from "../../voice/contracts";

const NUM_RUNS = 25;
const MIGRATION_FILE = "0029_demonic_mandrill.sql";

// Base tables migration 0029 ALTERs / references, plus `audit_log`. `user_id`
// is `text` here: the dispatcher records the string actor `agent:voice-lead`
// (never a uuid user session), so a `text` column lets every dispatch's audit
// insert persist and lets the property assert the actor / action it recorded.
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
  // `rowMode: "array"`; strip both, mirroring registry.test.ts.
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

// ── Context ───────────────────────────────────────────────────────────────────

/**
 * Every dispatch is made under the agent identity on a fresh conversation, with
 * a VISITOR caller and an unverified OTP state. This is the most-restricted
 * caller, so the one OTP-gated tool (`get_lead_context`) is intercepted by the
 * gate — which still produces exactly one audit row, exercising that path too.
 */
const VISITOR: IdentityResult = { type: "visitor", units: [] };

function freshCtx(): ToolContext {
  return {
    actor: VOICE_AGENT_ACTOR,
    conversationId: randomUUID(),
    identity: VISITOR,
    language: "en",
    otpVerificationState: "not_required",
  };
}

// ── Input generators ────────────────────────────────────────────────────────

const idArb = fc.uuid();

/**
 * A schema-VALID input for each tool. Minimal valid objects: the dispatcher
 * passes Zod validation and runs the OTP gate / handler. Handlers that need
 * unseeded rows throw, which the dispatcher catches as `handler_error` — still
 * exactly one audit row, which is the point of the property.
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

/**
 * A schema-INVALID input. Every tool's input schema is a `z.object(...)`, so a
 * non-object primitive fails `safeParse` for ALL tools — validation rejects it
 * before the handler runs (Req 6.2). Arrays are avoided because an all-optional
 * object schema would accept `[]`.
 */
const invalidInputArb: fc.Arbitrary<unknown> = fc.constantFrom(
  42,
  "not-an-object",
  null,
  true
);

const toolNameArb = fc.constantFrom(...TOOL_NAMES);

/** One generated dispatch: a registry tool name with valid or invalid input. */
interface DispatchSpec {
  toolName: ToolName;
  input: unknown;
  valid: boolean;
}

const specArb: fc.Arbitrary<DispatchSpec> = fc
  .tuple(toolNameArb, fc.boolean())
  .chain(([toolName, valid]) =>
    (valid ? validInputArbs[toolName] : invalidInputArb).map((input) => ({
      toolName,
      input,
      valid,
    }))
  );

// ── Property 3 ────────────────────────────────────────────────────────────────

describe("dispatchTool — Property 3: every tool call is audited (Req 6.3, 13.3)", () => {
  it("writes exactly one auditLog row per dispatch — actor=agent:voice-lead, action=tool name — for valid AND invalid inputs", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(specArb, { minLength: 1, maxLength: 5 }),
        async (specs) => {
          const { db } = buildDb();

          // Dispatch each generated call; the dispatcher never throws.
          for (const spec of specs) {
            const result = await dispatchTool(
              db,
              spec.toolName,
              spec.input,
              freshCtx()
            );
            // Invalid input is rejected as validation_error before the handler
            // runs; valid input proceeds (and may then be gated / fail in the
            // handler). Either way the dispatch completed and was audited.
            if (!spec.valid) {
              expect(result.ok).toBe(false);
              if (!result.ok) expect(result.error.code).toBe("validation_error");
            }
          }

          const rows = await db
            .select({ userId: auditLog.userId, action: auditLog.action })
            .from(auditLog);

          // Exactly one audit row PER dispatch — no more, no fewer.
          expect(rows.length).toBe(specs.length);

          // Every row is recorded under the agent actor.
          for (const row of rows) {
            expect(row.userId).toBe(VOICE_AGENT_ACTOR);
          }

          // The audited action is the tool name: per-tool dispatch counts equal
          // per-tool audit-row counts.
          for (const name of TOOL_NAMES) {
            const dispatched = specs.filter((s) => s.toolName === name).length;
            const audited = rows.filter((r) => r.action === name).length;
            expect(audited).toBe(dispatched);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

// ── Explicit examples ─────────────────────────────────────────────────────────

describe("dispatchTool auditing — explicit examples (Req 6.3, 13.3)", () => {
  it("a successful (mirror-write) dispatch writes one audit row with the tool name as action", async () => {
    const { db } = buildDb();
    const partyId = randomUUID();
    // Seed the party so the mirror upsert (FK partyId → parties.id) succeeds.
    await db.insert(parties).values({ id: partyId, type: "person", language: "en" });

    const result = await dispatchTool(
      db,
      "update_qualification",
      { partyId, budgetBand: "2.5-3.0M" },
      freshCtx()
    );

    expect(result.ok).toBe(true);

    const rows = await db
      .select({ userId: auditLog.userId, action: auditLog.action })
      .from(auditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(VOICE_AGENT_ACTOR);
    expect(rows[0].action).toBe("update_qualification");
  });

  it("an invalid-input dispatch still writes exactly one audit row and does NOT run the handler", async () => {
    const { db } = buildDb();

    const result = await dispatchTool(
      db,
      "update_qualification",
      // partyId must be a string — a number fails Zod validation.
      { partyId: 123 },
      freshCtx()
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation_error");

    // Handler not run → no mirror row was written.
    const mirror = await db
      .select({ partyId: leadsMirror.partyId })
      .from(leadsMirror);
    expect(mirror).toHaveLength(0);

    // …but the dispatch was still audited exactly once.
    const rows = await db
      .select({ userId: auditLog.userId, action: auditLog.action })
      .from(auditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(VOICE_AGENT_ACTOR);
    expect(rows[0].action).toBe("update_qualification");
  });

  it("an unknown tool is rejected but still audited exactly once under the agent actor", async () => {
    const { db } = buildDb();

    const result = await dispatchTool(
      db,
      "not_a_real_tool",
      {},
      freshCtx()
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unknown_tool");

    const rows = await db
      .select({ userId: auditLog.userId, action: auditLog.action })
      .from(auditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(VOICE_AGENT_ACTOR);
    expect(rows[0].action).toBe("not_a_real_tool");
  });
});
