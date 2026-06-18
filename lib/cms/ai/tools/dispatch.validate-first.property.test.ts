import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import fc from "fast-check";

/**
 * Property test for validate-first ordering on the agent tool path (task 1.9).
 *
 *   **Feature: agentic-foundation, Property 7: For any tool input that fails the
 *   entry's Zod schema, dispatchTool returns a validation_error, never invokes
 *   the handler, and leaves all persistent state unchanged — and validation is
 *   decided before the RBAC check.**
 *
 *   **Validates: Requirements 2.10, 3.2, 3.3**
 *
 * The dispatcher pipeline is, in this exact order: resolve → Zod validate →
 * RBAC → OTP → execute → audit (design §Components #2). This property pins the
 * first two stages: when input fails the Catalog_Entry's Zod input schema the
 * dispatch is rejected as `validation_error`, the handler is NEVER run, no
 * handler-mutated persistent state changes, and — critically — the rejection
 * happens BEFORE the RBAC permission check. The ordering is proven by
 * dispatching every invalid input under an agent identity that lacks the
 * required permission: were validation to run after RBAC, that dispatch would
 * surface `permission_denied`; because it surfaces `validation_error` (and the
 * RBAC engine is never consulted), validation is decided first.
 *
 * Harness mirrors `dispatch.property.test.ts` / `dispatch.isolation.property.test.ts`
 * (node-postgres adapter over pg-mem with migration 0029 applied) so the real
 * SQL audit write runs. The RBAC engine is mocked so the chosen agent identity
 * holds NO permissions (and its `loadUserRoles` / `resolvePermissions` calls are
 * observable spies), letting the test assert the engine is never reached on the
 * invalid-input path. The LLM gateway and Salesforce adapter are mocked so no
 * network is hit and no handler can reach CRM.
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

// ── RBAC engine mock — the dispatcher resolves a non-static agent identity's
//    permissions through the engine. We make the test agent hold NO permissions
//    and expose loadUserRoles / resolvePermissions as spies so the test can
//    assert the RBAC check is never reached when input is invalid. hasPermission
//    keeps its real semantics (exact + wildcard) so the deny on the valid-input
//    control is genuine.
// `vi.hoisted` so these spies exist before the (hoisted) rbac engine mock
// factory runs — dispatch.ts imports the engine at its top level, so the
// factory executes during the import phase, ahead of normal `const` init.
const rbacSpies = vi.hoisted(() => ({
  loadUserRoles: vi.fn(async () => [] as unknown[]),
  resolvePermissions: vi.fn(async () => [] as string[]),
}));
vi.mock("../../rbac/engine", () => ({
  loadUserRoles: rbacSpies.loadUserRoles,
  resolvePermissions: rbacSpies.resolvePermissions,
  hasPermission: (perms: string[], required: string): boolean => {
    if (perms.includes(required)) return true;
    if (perms.includes("*:*")) return true;
    const colonIdx = required.indexOf(":");
    if (colonIdx === -1) return false;
    return perms.includes(`${required.slice(0, colonIdx)}:*`);
  },
}));

import * as schema from "../../schema";
import { auditLog, leadsMirror, aiAppointments, viewingSlots } from "../../schema";
import type { Database } from "../../db";
import type { IdentityResult } from "../identity";
import { dispatchTool } from "./dispatch";
import { getTool, toolRegistry, type ToolContext } from "./registry";
import { TOOL_NAMES, type ToolName } from "../../voice/contracts";

const NUM_RUNS = 100;
const MIGRATION_FILE = "0029_demonic_mandrill.sql";

/**
 * The dispatching agent identity for this property. It is NOT the static
 * voice-lead actor, so the dispatcher resolves its permissions through the
 * (mocked) RBAC engine — which grants it nothing. Any dispatch that reaches the
 * RBAC stage with this actor is therefore `permission_denied`. That is exactly
 * what lets an invalid input prove ordering: it must short-circuit to
 * `validation_error` before this denial can occur.
 */
const NO_PERMISSION_ACTOR = "agent:text-lead";

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

const VISITOR: IdentityResult = { type: "visitor", units: [] };

function ctxFor(): ToolContext {
  return {
    actor: NO_PERMISSION_ACTOR,
    conversationId: randomUUID(),
    identity: VISITOR,
    language: "en",
    otpVerificationState: "not_required",
  };
}

// ── Invalid-input generators ──────────────────────────────────────────────────

/**
 * A non-object primitive. Every Catalog_Entry input schema is a `z.object(...)`,
 * so a primitive fails `safeParse` for ALL tools regardless of their fields.
 * Arrays are excluded because an all-optional object schema accepts `[]`.
 */
const primitiveInvalidArb: fc.Arbitrary<unknown> = fc.constantFrom(
  42,
  -1,
  0,
  "not-an-object",
  "",
  null,
  undefined,
  true,
  false
);

/**
 * A well-shaped object that nonetheless VIOLATES a known field constraint of
 * the named tool (a required string given a number, an email field given a
 * non-email, or an enum given an out-of-set value). This exercises real
 * field-level schema validation rather than only the object-shape gate, and is
 * guaranteed invalid because each violated field is required / constrained.
 */
const perToolInvalidObjectArb: Record<ToolName, fc.Arbitrary<unknown>> = {
  get_lead_context: fc.record({ partyId: fc.integer() }),
  update_qualification: fc.record({ partyId: fc.integer() }),
  score_lead: fc.record({ partyId: fc.integer() }),
  check_viewing_slots: fc.record({ project: fc.integer() }),
  book_viewing: fc.record({ partyId: fc.integer(), slotId: fc.integer() }),
  assign_rep: fc.record({ partyId: fc.integer() }),
  send_whatsapp_brief: fc.record({ repId: fc.integer(), partyId: fc.integer() }),
  queue_report_email: fc.record({
    requesterEmail: fc.constantFrom("not-an-email", "@", "x@", "missing"),
    scope: fc.integer(),
  }),
  log_outcome: fc.record({
    repId: fc.integer(),
    partyId: fc.integer(),
    freeText: fc.integer(),
  }),
  get_pipeline_summary: fc.record({
    scope: fc.constantFrom("not-a-scope", "admin", "1"),
  }),
};

const toolNameArb = fc.constantFrom(...TOOL_NAMES);

interface DispatchSpec {
  toolName: ToolName;
  input: unknown;
}

const specArb: fc.Arbitrary<DispatchSpec> = toolNameArb.chain((toolName) =>
  fc
    .oneof(primitiveInvalidArb, perToolInvalidObjectArb[toolName])
    .map((input) => ({ toolName, input }))
);

// ── Handler spies — prove no handler is EVER invoked on the invalid path ──────

const handlerSpies = TOOL_NAMES.map((name) =>
  vi.spyOn(toolRegistry[name], "handler")
);

function clearAllSpies(): void {
  for (const s of handlerSpies) s.mockClear();
  rbacSpies.loadUserRoles.mockClear();
  rbacSpies.resolvePermissions.mockClear();
}

// ── Property 7 ────────────────────────────────────────────────────────────────

describe("dispatchTool — Property 7: validate-first (Req 2.10, 3.2, 3.3)", () => {
  it("any input failing the entry's Zod schema yields validation_error, never runs the handler, leaves handler state unchanged, and is decided before the RBAC check", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(specArb, { minLength: 1, maxLength: 6 }),
        async (specs) => {
          clearAllSpies();
          const { db } = buildDb();

          for (const spec of specs) {
            // Guard: the generator must actually produce schema-invalid input —
            // this keeps the property faithful to "input that fails the schema".
            const tool = getTool(spec.toolName)!;
            expect(tool.inputSchema.safeParse(spec.input).success).toBe(false);

            const result = await dispatchTool(
              db,
              spec.toolName,
              spec.input,
              ctxFor()
            );

            // (a) Rejected as a validation_error — NOT permission_denied, even
            //     though the actor lacks the permission (ordering proof).
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.error.code).toBe("validation_error");
            }
          }

          // (b) No handler was ever invoked.
          for (const s of handlerSpies) {
            expect(s).not.toHaveBeenCalled();
          }

          // (c) Validation was decided BEFORE the RBAC check: the engine was
          //     never consulted for any of these invalid dispatches.
          expect(rbacSpies.loadUserRoles).not.toHaveBeenCalled();
          expect(rbacSpies.resolvePermissions).not.toHaveBeenCalled();

          // (d) Persistent handler-mutated state is unchanged — no mirror rows,
          //     no appointments, no slots were written by any handler.
          const mirror = await db.select({ p: leadsMirror.partyId }).from(leadsMirror);
          const appts = await db.select({ id: aiAppointments.id }).from(aiAppointments);
          const slots = await db.select({ id: viewingSlots.id }).from(viewingSlots);
          expect(mirror).toHaveLength(0);
          expect(appts).toHaveLength(0);
          expect(slots).toHaveLength(0);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

// ── Explicit examples ─────────────────────────────────────────────────────────

describe("dispatchTool validate-first — explicit examples (Req 2.10, 3.2, 3.3)", () => {
  it("invalid input from an actor LACKING the permission still yields validation_error (not permission_denied)", async () => {
    clearAllSpies();
    const { db } = buildDb();

    const result = await dispatchTool(
      db,
      "update_qualification",
      { partyId: 123 }, // partyId must be a string → fails Zod
      ctxFor()
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation_error");

    // RBAC engine never consulted: validation short-circuited before it.
    expect(rbacSpies.loadUserRoles).not.toHaveBeenCalled();
    expect(rbacSpies.resolvePermissions).not.toHaveBeenCalled();
    expect(toolRegistry.update_qualification.handler).not.toHaveBeenCalled();
  });

  it("control: VALID input from the same no-permission actor reaches and is blocked by the RBAC check (permission_denied), proving the actor truly lacks permission and that ordering matters", async () => {
    clearAllSpies();
    const { db } = buildDb();

    const result = await dispatchTool(
      db,
      "check_viewing_slots",
      { project: "Bayn" }, // schema-valid → proceeds past validation
      ctxFor()
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("permission_denied");

    // The RBAC check WAS reached for valid input — the contrast that proves
    // validation runs first for the invalid case above.
    expect(rbacSpies.loadUserRoles).toHaveBeenCalled();
    expect(toolRegistry.check_viewing_slots.handler).not.toHaveBeenCalled();
  });

  it("invalid input writes no handler-mutated state (handler never runs)", async () => {
    clearAllSpies();
    const { db } = buildDb();

    const result = await dispatchTool(
      db,
      "book_viewing",
      { partyId: 1, slotId: 2 }, // both must be strings → fails Zod
      ctxFor()
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation_error");

    const appts = await db.select({ id: aiAppointments.id }).from(aiAppointments);
    expect(appts).toHaveLength(0);
    expect(toolRegistry.book_viewing.handler).not.toHaveBeenCalled();
  });

  it("still audits exactly one row per invalid dispatch (the dispatch completed and was recorded)", async () => {
    clearAllSpies();
    const { db } = buildDb();

    await dispatchTool(db, "score_lead", 42, ctxFor());

    const rows = await db
      .select({ userId: auditLog.userId, action: auditLog.action })
      .from(auditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(NO_PERMISSION_ACTOR);
    expect(rows[0].action).toBe("score_lead");
  });
});
