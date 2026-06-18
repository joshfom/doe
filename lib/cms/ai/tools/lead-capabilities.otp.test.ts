import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";

/**
 * Focused unit test for the OTP/permission gate on `enrich_lead_read`
 * (task 3.4).
 *
 *   Unit test the OTP gate on `enrich_lead_read`: an unverified OR an
 *   under-permissioned caller returns no gated personal data and runs no
 *   handler (reuse S1 dispatcher behaviour).
 *
 * **Validates: Requirements 12.6**
 *
 * `enrich_lead_read` is the single `requiresOtp: true` lead-engine
 * Catalog_Entry — the Enrichment_Agent's gated personal-data read (name,
 * language, tier, interests, last-interaction summary, salted phone hash). Per
 * Req 12.6, IF a Catalog_Entry returns gated personal data and the caller is
 * NOT OTP-verified OR lacks the required RBAC permission, THEN the dispatcher
 * must: run no handler, perform no mutation, return NO gated personal data, and
 * return a denial indication.
 *
 * Unlike the Property-10 boundary test (`lead-capabilities.property.test.ts`),
 * this test pins down the two gated-caller shapes directly and adds the two
 * assertions Req 12.6 turns on — that the handler function object is NEVER
 * invoked, and that NONE of the seeded personal sentinels leak into the result:
 *
 *   (a) an unverified caller — the granted enrichment agent identity (so the
 *       RBAC permission check passes) on a non-verified, visitor conversation,
 *       so the OTP gate (dispatcher step 4) is the only thing deciding to
 *       intercept → `otp_required`; and
 *   (b) an under-permissioned caller — a real lead agent that is NOT granted
 *       `lead:tool:enrich_lead_read` (the distribution agent), so the RBAC
 *       permission check (dispatcher step 3, which runs BEFORE the OTP gate)
 *       intercepts → `permission_denied`.
 *
 * Both are denials; in both the handler must never run and no gated personal
 * data may be returned.
 *
 * ── Harness ──────────────────────────────────────────────────────────────────
 *
 * Mirrors `lead-capabilities.property.test.ts`: `pg-mem` (node-postgres
 * adapter) with migrations `0029` (parties / party_identities / leads_mirror /
 * reps / events …) and `0036` (inbound_leads), plus the `audit_log` and the
 * four RBAC tables created inline. `getTool` is widened to resolve the REAL
 * lead-engine `CatalogEntry` objects so the real dispatcher pipeline (Zod →
 * RBAC → OTP → audit → execute) runs against the real handler. The handler is
 * spied (never stubbed) on the same entry object the dispatcher resolves, so
 * "the handler never ran" is asserted against the exact function the dispatcher
 * would have called. The LLM gateway and Salesforce adapter are mocked so no
 * network is hit; the dispatcher and the audited services are never mocked.
 */

process.env.PHONE_HASH_SALT ??= "lead-otp-gate-test-salt";

// ── Module mocks — no network, no model, no CRM. Services are NEVER mocked. ────

vi.mock("../gateway", () => ({
  generateCompletion: vi.fn(async () => "Mocked rationale."),
  generateEmbedding: vi.fn(async () => new Array(768).fill(0)),
}));

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

// Widen the dispatcher's tool resolution to the canonical lead-engine
// Tool_Catalog. `dispatch.ts` resolves tools via `getTool()` from the (voice)
// registry; we keep every real registry export (so lead-capabilities' refs to
// `toolRegistry`/`selectRep` resolve) and only widen `getTool` to resolve the
// REAL lead `CatalogEntry` objects so the real dispatcher pipeline + real
// handler run.
vi.mock("./registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./registry")>();
  const { loadLeadCapabilities } = await import("./lead-capabilities");
  const leadCatalog = loadLeadCapabilities().catalog;
  return {
    ...actual,
    getTool: (name: string) => leadCatalog.get(name) ?? actual.getTool(name),
  };
});

import * as schema from "../../schema";
import {
  auditLog,
  events,
  inboundLeads,
  leadsMirror,
  parties,
  partyIdentities,
} from "../../schema";
import type { Database } from "../../db";
import type { IdentityResult } from "../identity";
import { dispatchTool } from "./dispatch";
import type { ToolContext } from "./registry";
import { seedLeadAgentIdentities } from "../../rbac/seed";
import {
  loadLeadCapabilities,
  LEAD_DISTRIBUTION_AGENT_ACTOR,
  LEAD_ENRICHMENT_AGENT_ACTOR,
} from "./lead-capabilities";

// ── Seeded personal sentinels (the gated data that must NEVER leak) ────────────

const SECRET_NAME = "SECRET_NAME_d3adbeef";
const SECRET_BUDGET = "SECRET_BUDGET_2.5-3.0M";
const SECRET_PROJECT = "SECRET_PROJECT_Bayn";
const SECRET_UNIT = "SECRET_UNIT_2BR-villa";
const SECRET_SUMMARY = "SECRET_SUMMARY_discussed_handover";
const SECRET_PHONE_HASH = "SECRET_PHONE_HASH_f00dcafe";
const SECRETS = [
  SECRET_NAME,
  SECRET_BUDGET,
  SECRET_PROJECT,
  SECRET_UNIT,
  SECRET_SUMMARY,
  SECRET_PHONE_HASH,
];

const VISITOR: IdentityResult = { type: "visitor", units: [] };

// The single requiresOtp lead Catalog_Entry under test.
const ENRICH_TOOL = "enrich_lead_read" as const;

// ── pg-mem harness (mirrors lead-capabilities.property.test.ts) ────────────────

const MIGRATION_0029 = "0029_demonic_mandrill.sql";
const MIGRATION_0036 = "0036_inbound_leads.sql";

const PREREQUISITE_SQL = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_appointments" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_conversations" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
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
    "user_id" text NOT NULL,
    "role_id" uuid NOT NULL,
    "granted_by" uuid,
    "granted_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE UNIQUE INDEX "permissions_resource_action_idx" ON "permissions" ("resource","action");
  CREATE UNIQUE INDEX "role_permissions_unique_idx" ON "role_permissions" ("role_id","permission_id");
  CREATE UNIQUE INDEX "user_roles_unique_idx" ON "user_roles" ("user_id","role_id");
`;

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
  applyMigration(mem, MIGRATION_0029);
  applyMigration(mem, MIGRATION_0036);

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

/**
 * Seed the RBAC identities plus a resolved party whose mirror + phone identity
 * carry the personal sentinels `enrich_lead_read` would return if it ran.
 */
async function seed(db: Database): Promise<{ partyId: string }> {
  await seedLeadAgentIdentities(db);

  const partyId = randomUUID();
  await db
    .insert(parties)
    .values({ id: partyId, type: "person", name: SECRET_NAME, language: "en" });
  await db.insert(leadsMirror).values({
    partyId,
    tier: "HOT",
    budgetBand: SECRET_BUDGET,
    projectInterest: SECRET_PROJECT,
    unitInterest: SECRET_UNIT,
    lastInteractionSummary: SECRET_SUMMARY,
  });
  await db
    .insert(partyIdentities)
    .values({ partyId, kind: "phone_hash", value: SECRET_PHONE_HASH });
  await db.insert(inboundLeads).values({
    id: randomUUID(),
    source: "web_form",
    idempotencyKey: `seed-${randomUUID()}`,
    content: "",
  });

  return { partyId };
}

/** A byte-for-byte snapshot of the durable domain state (audit_log excluded). */
async function domainSnapshot(db: Database): Promise<string> {
  const sortRows = (rows: Record<string, unknown>[]) =>
    rows.map((r) => JSON.stringify(r)).sort();
  const [il, lm, pr, pi, ev] = await Promise.all([
    db.select().from(inboundLeads),
    db.select().from(leadsMirror),
    db.select().from(parties),
    db.select().from(partyIdentities),
    db.select().from(events),
  ]);
  return JSON.stringify({
    inboundLeads: sortRows(il as Record<string, unknown>[]),
    leadsMirror: sortRows(lm as Record<string, unknown>[]),
    parties: sortRows(pr as Record<string, unknown>[]),
    partyIdentities: sortRows(pi as Record<string, unknown>[]),
    events: sortRows(ev as Record<string, unknown>[]),
  });
}

/** Assert no seeded personal sentinel leaked into a (gated) dispatch result. */
function expectNoSecretLeak(result: unknown): void {
  const serialized = JSON.stringify(result) ?? "";
  for (const secret of SECRETS) {
    expect(serialized).not.toContain(secret);
  }
}

function ctxFor(
  actor: string,
  otpVerificationState: ToolContext["otpVerificationState"]
): ToolContext {
  return {
    actor,
    conversationId: randomUUID(),
    identity: VISITOR,
    language: "en",
    otpVerificationState,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("enrich_lead_read OTP/permission gate — Req 12.6", () => {
  // seedLeadAgentIdentities logs once per call; keep the test output clean.
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeAll(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterAll(() => {
    logSpy.mockRestore();
  });

  /**
   * Spy on the SAME handler function object the (widened) dispatcher resolves:
   * the lead catalog stores the module-level `enrichLeadReadEntry`, so spying on
   * the entry the test resolves mutates the exact function the dispatcher calls.
   */
  function spyEnrichHandler() {
    const entry = loadLeadCapabilities().catalog.get(ENRICH_TOOL);
    expect(entry).toBeDefined();
    return vi.spyOn(entry as { handler: ToolHandlerLike }, "handler");
  }

  it("(a) an UNVERIFIED caller (granted permission) is intercepted: otp_required, handler never runs, no gated data, no state change", async () => {
    const { db } = buildDb();
    const { partyId } = await seed(db);

    // The enrichment agent IS granted enrich_lead_read, so the RBAC check passes
    // and the OTP gate is the only thing left to intercept the unverified caller.
    const handlerSpy = spyEnrichHandler();
    try {
      const before = await domainSnapshot(db);
      const result = await dispatchTool(
        db,
        ENRICH_TOOL,
        { partyId },
        ctxFor(LEAD_ENRICHMENT_AGENT_ACTOR, "not_required")
      );
      const after = await domainSnapshot(db);

      // Denial indication returned (Req 12.6).
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("otp_required");

      // No handler ran, no gated personal data returned, no mutation (Req 12.6).
      expect(handlerSpy).not.toHaveBeenCalled();
      expectNoSecretLeak(result);
      expect(after).toBe(before);
    } finally {
      handlerSpy.mockRestore();
    }
  });

  it("(a') an UNVERIFIED caller in a 'pending' OTP state is likewise intercepted: otp_required, handler never runs, no gated data", async () => {
    const { db } = buildDb();
    const { partyId } = await seed(db);

    const handlerSpy = spyEnrichHandler();
    try {
      const result = await dispatchTool(
        db,
        ENRICH_TOOL,
        { partyId },
        ctxFor(LEAD_ENRICHMENT_AGENT_ACTOR, "pending")
      );

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("otp_required");
      expect(handlerSpy).not.toHaveBeenCalled();
      expectNoSecretLeak(result);
    } finally {
      handlerSpy.mockRestore();
    }
  });

  it("(b) an UNDER-PERMISSIONED caller is intercepted: permission_denied, handler never runs, no gated data, no state change", async () => {
    const { db } = buildDb();
    const { partyId } = await seed(db);

    // The distribution agent is a real lead agent but is NOT granted
    // lead:tool:enrich_lead_read. The permission check (dispatcher step 3) runs
    // BEFORE the OTP gate, so even a "verified" state cannot help it through.
    const handlerSpy = spyEnrichHandler();
    try {
      const before = await domainSnapshot(db);
      const result = await dispatchTool(
        db,
        ENRICH_TOOL,
        { partyId },
        ctxFor(LEAD_DISTRIBUTION_AGENT_ACTOR, "verified")
      );
      const after = await domainSnapshot(db);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("permission_denied");

      expect(handlerSpy).not.toHaveBeenCalled();
      expectNoSecretLeak(result);
      expect(after).toBe(before);
    } finally {
      handlerSpy.mockRestore();
    }
  });

  it("(b') an identity holding NO roles is intercepted: permission_denied, handler never runs, no gated data", async () => {
    const { db } = buildDb();
    const { partyId } = await seed(db);

    const handlerSpy = spyEnrichHandler();
    try {
      const result = await dispatchTool(
        db,
        ENRICH_TOOL,
        { partyId },
        ctxFor(randomUUID(), "verified") // uuid principal, never granted anything
      );

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("permission_denied");
      expect(handlerSpy).not.toHaveBeenCalled();
      expectNoSecretLeak(result);
    } finally {
      handlerSpy.mockRestore();
    }
  });
});

/** Minimal structural type for the spy target (avoids importing the entry type). */
type ToolHandlerLike = (...args: never[]) => unknown;
