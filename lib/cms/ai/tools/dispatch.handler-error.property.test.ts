import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import fc from "fast-check";

/**
 * Property test for handler errors being RETURNED, not THROWN (task 1.13).
 *
 *   **Feature: agentic-foundation, Property 9: For any handler that throws or
 *   returns a structured error, dispatchTool resolves to { ok: false, error }
 *   and never throws, so the agent receives the structured error and the run
 *   remains active.**
 *
 * **Validates: Requirements 3.6**
 *
 * The dispatcher is the audited boundary "the hands": on a handler throw or a
 * handler-surfaced structured error it resolves to a structured
 * `{ ok: false, error: { code: "handler_error", ... } }` rather than throwing,
 * so the Mastra agent receives the structured error as the tool result and the
 * agent run stays active and keeps reasoning (Req 3.6; design §Components #2,
 * Property 9).
 *
 * In this codebase a tool handler surfaces an error by THROWING it — a bare
 * `Error`, an `Error` subclass, an `Error` carrying structured fields (`code`,
 * `details`), a plain structured error object (`{ code, message }`), or a
 * non-`Error` primitive. `dispatchTool`'s try/catch converts every such throw
 * into the same structured `handler_error` result. This property asserts that
 * mapping holds for ALL of those shapes and that the dispatcher NEVER throws.
 *
 * Harness mirrors `dispatch.property.test.ts` / `dispatch.isolation.property.test.ts`
 * (node-postgres adapter over pg-mem with migration 0029 applied) so the real
 * audit SQL path runs. `getTool` is stubbed (via a hoisted holder the property
 * sets per case) to inject a tool whose handler throws the generated value; the
 * stub reuses a real granted voice permission under the static `agent:voice-lead`
 * grant so the permission gate passes without RBAC seeding, and `requiresOtp` is
 * false so the OTP gate is skipped — the handler is always reached. The LLM
 * gateway and Salesforce adapter are mocked so no network is hit.
 */

// ── Hoisted holder: the property sets the stub tool getTool() returns. ────────
const stub = vi.hoisted(() => ({
  tool: undefined as unknown,
}));

// ── LLM gateway mock — registry imports it at module load; never hit network. ─
vi.mock("../gateway", () => ({
  generateCompletion: vi.fn(async () => "Mocked rationale."),
}));

// ── Salesforce adapter mock — the registry load chain must not reach CRM. ─────
vi.mock("../../tickets/crm/salesforce", () => {
  class MockSalesforceAdapter {
    name = "salesforce";
    authenticate = vi.fn();
    createCase = vi.fn();
    updateCase = vi.fn();
    getCaseStatus = vi.fn();
  }
  return {
    SalesforceAdapter: MockSalesforceAdapter,
    withRetry: vi.fn((fn: () => unknown) => fn()),
  };
});

// ── Registry mock — keep every real export, override only getTool. ────────────
// getTool returns the stub tool the property installs for the current case.
vi.mock("./registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./registry")>();
  return {
    ...actual,
    getTool: () => stub.tool,
  };
});

import * as schema from "../../schema";
import { auditLog } from "../../schema";
import type { Database } from "../../db";
import type { IdentityResult } from "../identity";
import { dispatchTool } from "./dispatch";
import {
  VOICE_AGENT_ACTOR,
  toolPermission,
  type ToolContext,
  type ToolDef,
} from "./registry";
import type { ToolName } from "../../voice/contracts";

const NUM_RUNS = 100;
const MIGRATION_FILE = "0029_demonic_mandrill.sql";

// audit_log with a `text` user_id so the string actor `agent:voice-lead`
// persists (the dispatcher records the actor string, not a uuid session).
const PREREQUISITE_SQL = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "email" text);
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "email" text);
  CREATE TABLE "ai_conversations" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "participant_type" text NOT NULL DEFAULT 'visitor',
    "language" text NOT NULL DEFAULT 'en',
    "status" text NOT NULL DEFAULT 'active',
    "otp_verification_state" text NOT NULL DEFAULT 'not_required',
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "ai_appointments" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "reference_number" text NOT NULL UNIQUE,
    "contact_name" text NOT NULL,
    "appointment_type" text NOT NULL,
    "scheduled_date" date NOT NULL,
    "scheduled_time" time NOT NULL,
    "status" text NOT NULL DEFAULT 'confirmed',
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

// ── Context: agent identity, visitor caller, unverified — handler is reached. ─
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

/**
 * Build a stub tool whose handler runs `body` (which throws). The stub reuses a
 * real granted voice permission so the static `agent:voice-lead` grant clears
 * the permission gate, and `requiresOtp` is false so the OTP gate is skipped —
 * the handler is always reached. `z.any()` input accepts any generated input.
 */
function throwingTool(body: () => never): ToolDef<ToolName> {
  return {
    name: "update_qualification" as ToolName,
    inputSchema: z.any(),
    outputSchema: z.any(),
    requiresOtp: false,
    permission: toolPermission("update_qualification"),
    handler: async () => body(),
  } as unknown as ToolDef<ToolName>;
}

/** A stub tool whose handler succeeds — used to prove the dispatcher stays usable. */
function successTool(): ToolDef<ToolName> {
  return {
    name: "update_qualification" as ToolName,
    inputSchema: z.any(),
    outputSchema: z.any(),
    requiresOtp: false,
    permission: toolPermission("update_qualification"),
    handler: async () => ({ ok: true }),
  } as unknown as ToolDef<ToolName>;
}

// ── Generators: a handler-error "thrower" of many shapes ──────────────────────
//
// Covers a bare Error, Error subclasses, an Error carrying structured fields, a
// plain structured error object ({ code, message }), and non-Error primitives —
// the full space of "throws or returns a structured error". Each maps to a
// nullary function that throws the generated value when invoked.

class StructuredError extends Error {
  code: string;
  details: unknown;
  constructor(message: string, code: string, details: unknown) {
    super(message);
    this.name = "StructuredError";
    this.code = code;
    this.details = details;
  }
}

const throwerArb: fc.Arbitrary<() => never> = fc.oneof(
  // bare Error
  fc.string().map((m) => () => {
    throw new Error(m);
  }),
  // Error subclasses
  fc.string().map((m) => () => {
    throw new TypeError(m);
  }),
  fc.string().map((m) => () => {
    throw new RangeError(m);
  }),
  // Error carrying structured fields (a "structured error")
  fc
    .record({ m: fc.string(), code: fc.string(), details: fc.anything() })
    .map(({ m, code, details }) => () => {
      throw new StructuredError(m, code, details);
    }),
  // plain structured error object thrown (a "structured error")
  fc
    .record({ code: fc.string(), message: fc.string() })
    .map((obj) => () => {
      throw obj;
    }),
  // non-Error primitives
  fc.string().map((s) => () => {
    throw s;
  }),
  fc.integer().map((n) => () => {
    throw n;
  }),
  fc.constant(() => {
    throw null;
  }),
  fc.constant(() => {
    throw undefined;
  })
) as fc.Arbitrary<() => never>;

// ── Property 9 ────────────────────────────────────────────────────────────────

describe("dispatchTool — Property 9: handler errors are returned, not thrown (Req 3.6)", () => {
  it("resolves to { ok: false, error: handler_error } and never throws, for every throw shape; the dispatcher stays usable", async () => {
    const { db } = buildDb();

    await fc.assert(
      fc.asyncProperty(
        throwerArb,
        fc.anything(),
        async (thrower, input) => {
          // Install the throwing handler for this case.
          stub.tool = throwingTool(thrower);

          // The dispatcher must NEVER throw — it must resolve to a result.
          let threw = false;
          let result: Awaited<ReturnType<typeof dispatchTool>> | undefined;
          try {
            result = await dispatchTool(
              db,
              "update_qualification",
              input,
              freshCtx()
            );
          } catch {
            threw = true;
          }
          expect(threw).toBe(false);
          expect(result).toBeDefined();

          // The handler error is surfaced as a structured { ok: false, error }.
          expect(result!.ok).toBe(false);
          if (!result!.ok) {
            expect(result!.error.code).toBe("handler_error");
            expect(typeof result!.error.message).toBe("string");
          }

          // The run remains active: a subsequent dispatch still works — the
          // dispatcher was not left in a broken state by the prior throw.
          stub.tool = successTool();
          const next = await dispatchTool(
            db,
            "update_qualification",
            {},
            freshCtx()
          );
          expect(next.ok).toBe(true);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

// ── Explicit examples ─────────────────────────────────────────────────────────

describe("dispatchTool handler errors — explicit examples (Req 3.6)", () => {
  it("a handler that throws a bare Error resolves to { ok: false, handler_error } with the message preserved", async () => {
    const { db } = buildDb();
    stub.tool = throwingTool(() => {
      throw new Error("boom: slot already taken");
    });

    const result = await dispatchTool(
      db,
      "update_qualification",
      { partyId: randomUUID() },
      freshCtx()
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("handler_error");
      expect(result.error.message).toBe("boom: slot already taken");
    }
  });

  it("a handler that throws a plain structured error object resolves to { ok: false, handler_error } and does not throw", async () => {
    const { db } = buildDb();
    stub.tool = throwingTool(() => {
      throw { code: "conflict", message: "structured failure" } as never;
    });

    let threw = false;
    let result: Awaited<ReturnType<typeof dispatchTool>> | undefined;
    try {
      result = await dispatchTool(db, "update_qualification", {}, freshCtx());
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result!.ok).toBe(false);
    if (!result!.ok) expect(result!.error.code).toBe("handler_error");
  });

  it("audits the failed dispatch exactly once under the agent actor", async () => {
    const { db } = buildDb();
    stub.tool = throwingTool(() => {
      throw new Error("kaboom");
    });

    await dispatchTool(db, "update_qualification", {}, freshCtx());

    const rows = await db
      .select({ userId: auditLog.userId, action: auditLog.action })
      .from(auditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(VOICE_AGENT_ACTOR);
    expect(rows[0].action).toBe("update_qualification");
  });
});
