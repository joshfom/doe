import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import fc from "fast-check";

/**
 * Property test for identity / OTP isolation on the voice tool path (task 9.3).
 *
 *   Property 5 — OTP / identity isolation preserved (Req 13.1, 13.2): for ALL
 *   callers whose identity is a VISITOR, or whose conversation is NOT
 *   `otpVerificationState === "verified"`, dispatching an OTP-gated tool
 *   (`get_lead_context`, which RETURNS the caller's personal lead/account data)
 *   is INTERCEPTED by the OTP gate — the handler never runs and NO client /
 *   tenant / payment data is returned (the dispatch yields an `otp_required`
 *   error with no `result` payload). Only a RECOGNISED caller (client/tenant)
 *   on a VERIFIED conversation receives the gated data.
 *
 *   This mirrors the text-path isolation asserted in `ai/chat.test.ts`
 *   ("personal query from unverified client triggers OTP prompt instead of
 *   RAG"; "personal query from verified client proceeds"): the SAME
 *   `handleOtpGate` makes the proceed/intercept decision, so the voice path's
 *   isolation guarantee is identical to the text path's.
 *
 * **Validates: Requirements 13.1, 13.2**
 *
 * Harness mirrors `dispatch.property.test.ts` / `registry.test.ts` (node-postgres
 * adapter over pg-mem with migration 0029 applied) so the real SQL paths of the
 * gate (`handleOtpGate` → `lookupEmail`) and the handler (`buildCallContext`)
 * run. `ai_clients` / `ai_tenants` carry an `email` column so the gate's
 * unverified-recognised email lookup resolves instead of throwing.
 */

// ── LLM gateway mock — registry imports it at module load; never hit network. ─
vi.mock("../gateway", () => ({
  generateCompletion: vi.fn(async () => "Mocked rationale."),
}));

// ── Salesforce adapter mock — proves the gated read never reaches Salesforce. ─
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
import { parties, leadsMirror, reps } from "../../schema";
import type { Database } from "../../db";
import type { IdentityResult } from "../identity";
import type { OtpVerificationState } from "../otp";
import { dispatchTool } from "./dispatch";
import { VOICE_AGENT_ACTOR, type ToolContext } from "./registry";

const NUM_RUNS = 30;
const MIGRATION_FILE = "0029_demonic_mandrill.sql";

// Sentinel personal-data markers seeded onto the lead mirror. The isolation
// assertion proves NONE of these ever appear in a gated (intercepted) dispatch
// result — i.e. no client/tenant/payment data leaks to a visitor/unverified
// caller (Req 13.1).
const SECRET_NAME = "SECRET_NAME_d3adbeef";
const SECRET_BUDGET = "SECRET_BUDGET_2.5-3.0M";
const SECRET_PROJECT = "SECRET_PROJECT_Bayn";
const SECRET_SUMMARY = "SECRET_SUMMARY_discussed_handover";
const SECRETS = [SECRET_NAME, SECRET_BUDGET, SECRET_PROJECT, SECRET_SUMMARY];

// Base tables migration 0029 ALTERs / references. `ai_clients` / `ai_tenants`
// carry `email` so the gate's unverified-recognised lookupEmail resolves.
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
    "user_id" uuid NOT NULL,
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

// ── Seeding ───────────────────────────────────────────────────────────────────

type IdentityKind = "visitor" | "client" | "tenant";

/**
 * Seed the personal lead profile (the data the OTP gate must protect) onto a
 * fresh party + leads_mirror, and return the `partyId` to dispatch with plus
 * the `IdentityResult` for the ctx.
 *
 * Recognised callers (client/tenant) carry a clientId/tenantId but NO matching
 * `ai_clients`/`ai_tenants` row: on the unverified path the gate's `lookupEmail`
 * then returns null and still intercepts (no data is returned), which is
 * exactly the isolation guarantee under test; on the verified path the gate
 * proceeds before any email lookup occurs.
 */
async function seedCaller(
  db: Database,
  kind: IdentityKind,
  language: "en" | "ar"
): Promise<{ partyId: string; identity: IdentityResult }> {
  const partyId = randomUUID();
  const repId = randomUUID();

  await db
    .insert(parties)
    .values({ id: partyId, type: "person", name: SECRET_NAME, language });

  await db.insert(reps).values({
    id: repId,
    name: "Rep Aisha",
    languages: ["en", "ar"],
    projects: [SECRET_PROJECT],
    capacity: 3,
    openHotCount: 1,
  });

  await db.insert(leadsMirror).values({
    partyId,
    tier: "HOT",
    budgetBand: SECRET_BUDGET,
    projectInterest: SECRET_PROJECT,
    assignedRepId: repId,
    lastInteractionSummary: SECRET_SUMMARY,
  });

  if (kind === "client") {
    return {
      partyId,
      identity: { type: "client", clientId: randomUUID(), units: [] },
    };
  }

  if (kind === "tenant") {
    return {
      partyId,
      identity: { type: "tenant", tenantId: randomUUID(), units: [] },
    };
  }

  return { partyId, identity: { type: "visitor", units: [] } };
}

/** Assert no seeded personal sentinel leaked into a (gated) dispatch result. */
function expectNoSecretLeak(result: unknown): void {
  const serialized = JSON.stringify(result) ?? "";
  for (const secret of SECRETS) {
    expect(serialized).not.toContain(secret);
  }
}

// ── Generators ─────────────────────────────────────────────────────────────────

const identityKindArb: fc.Arbitrary<IdentityKind> = fc.constantFrom(
  "visitor",
  "client",
  "tenant"
);
const otpStateArb = fc.constantFrom(
  "not_required",
  "pending",
  "expired",
  "verified"
) as fc.Arbitrary<OtpVerificationState>;
const languageArb = fc.constantFrom("en", "ar") as fc.Arbitrary<"en" | "ar">;

// ── Property 5 ───────────────────────────────────────────────────────────────

describe("dispatchTool — Property 5: OTP / identity isolation preserved (Req 13.1, 13.2)", () => {
  it("a visitor OR any non-verified caller is gated (no client/tenant/payment data); only a recognised + verified caller receives it", async () => {
    await fc.assert(
      fc.asyncProperty(
        identityKindArb,
        otpStateArb,
        languageArb,
        async (kind, otpState, language) => {
          for (const spy of Object.values(sfSpies)) spy.mockClear();

          const { db } = buildDb();
          const { partyId, identity } = await seedCaller(db, kind, language);

          const ctx: ToolContext = {
            actor: VOICE_AGENT_ACTOR,
            conversationId: randomUUID(),
            identity,
            language,
            otpVerificationState: otpState,
          };

          const result = await dispatchTool(
            db,
            "get_lead_context",
            { partyId },
            ctx
          );

          // Isolation rule: gated unless the caller is a recognised
          // (client/tenant) identity on a VERIFIED conversation.
          const shouldReceiveData =
            kind !== "visitor" && otpState === "verified";

          if (shouldReceiveData) {
            // Recognised + verified → the gate proceeds and the personal lead
            // context is returned.
            expect(result.ok).toBe(true);
            if (result.ok) {
              const ctxResult = result.result as { known: boolean; partyId: string };
              expect(ctxResult.known).toBe(true);
              expect(ctxResult.partyId).toBe(partyId);
              // The personal data IS present for the cleared caller.
              expect(JSON.stringify(result.result)).toContain(SECRET_BUDGET);
            }
          } else {
            // Visitor OR not verified → intercepted, NO data returned.
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.error.code).toBe("otp_required");
            }
            expectNoSecretLeak(result);
          }

          // The gated read never touches Salesforce (mirror-only isolation).
          const sfCalls = Object.values(sfSpies).reduce(
            (sum, spy) => sum + spy.mock.calls.length,
            0
          );
          expect(sfCalls).toBe(0);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

// ── Explicit examples (mirror ai/chat.test.ts isolation cases) ─────────────────

describe("dispatchTool OTP isolation — explicit examples (Req 13.1, 13.2)", () => {
  it("visitor asking for personal data is intercepted, no lead data returned", async () => {
    const { db } = buildDb();
    const { partyId } = await seedCaller(db, "visitor", "en");

    const result = await dispatchTool(
      db,
      "get_lead_context",
      { partyId },
      {
        actor: VOICE_AGENT_ACTOR,
        conversationId: randomUUID(),
        identity: { type: "visitor", units: [] },
        otpVerificationState: "not_required",
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("otp_required");
    expectNoSecretLeak(result);
  });

  it("recognised but UNVERIFIED client is intercepted (prompted for OTP), no lead data returned", async () => {
    const { db } = buildDb();
    const { partyId, identity } = await seedCaller(db, "client", "en");

    const result = await dispatchTool(
      db,
      "get_lead_context",
      { partyId },
      {
        actor: VOICE_AGENT_ACTOR,
        conversationId: randomUUID(),
        identity,
        otpVerificationState: "pending",
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("otp_required");
    expectNoSecretLeak(result);
  });

  it("recognised + VERIFIED client receives the gated lead context", async () => {
    const { db } = buildDb();
    const { partyId, identity } = await seedCaller(db, "client", "en");

    const result = await dispatchTool(
      db,
      "get_lead_context",
      { partyId },
      {
        actor: VOICE_AGENT_ACTOR,
        conversationId: randomUUID(),
        identity,
        otpVerificationState: "verified",
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const ctxResult = result.result as { known: boolean; partyId: string };
      expect(ctxResult.known).toBe(true);
      expect(ctxResult.partyId).toBe(partyId);
      expect(JSON.stringify(result.result)).toContain(SECRET_BUDGET);
    }
  });
});
