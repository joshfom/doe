import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import fc from "fast-check";

/**
 * Property test for the lead-engine dispatcher / audit boundary (task 3.3 — a
 * non-optional CC-Audit boundary test).
 *
 *   **Feature: lead-engine, Property 10: Every lead-engine mutation/personal-data
 *   read flows through dispatchTool into a CatalogEntry, producing exactly one
 *   audit row; a non-catalog tool is rejected.**
 *
 * **Validates: Requirements 12.1, 12.3, 12.4**
 *
 * Requirement 12 is "the one rule, preserved": every Lead_Engine mutation and
 * every personal-data read EXECUTES through `dispatchTool` (Zod → RBAC → OTP →
 * audit → execute) into a `CatalogEntry`; an agent never touches the database
 * directly. This guards three consequences the design (§Components #8) inherits
 * from the S1 dispatcher with no new enforcement code:
 *
 *   • Req 12.4 — every mutating dispatch writes EXACTLY ONE `audit_log` row,
 *     recording its success-or-failure outcome (here: under the dispatching
 *     agent's identity, with the catalog tool name as the action).
 *   • Req 12.1 — a mutation / personal-data read only ever happens by invoking
 *     a `CatalogEntry` through the dispatcher; the OTP-gated personal-data read
 *     (`enrich_lead_read`) is intercepted for an unverified caller, still under
 *     exactly one audit row and with no state change.
 *   • Req 12.3 — a tool name that is NOT a `CatalogEntry` is rejected with
 *     `unknown_tool`, runs NO handler, and changes NO persistent state.
 *
 * The property drives a random interleaving of:
 *   - distribution-agent mutations  — `record_inbound_lead`, `attach_inbound_lead`,
 *     `assign_lead_owner`, `flag_lead_conflict`;
 *   - parse-agent mutations         — `update_qualification`, `score_lead`;
 *   - an enrichment-agent gated read — `enrich_lead_read` (OTP-gated);
 *   - a non-catalog tool name        — rejected as `unknown_tool`.
 * Each dispatch is issued under the lead-agent identity that the S3 RBAC seed
 * (`seedLeadAgentIdentities`, task 3.1) grants the tool to, so the real RBAC
 * check inside `dispatchTool` admits the granted tools (Req 12.1, 12.2). Across
 * any generated mix it asserts:
 *   1. the number of `audit_log` rows equals the number of dispatches — exactly
 *      one per dispatch (Req 12.4); and
 *   2. the recorded `(actor, action)` multiset equals the issued one — userId =
 *      the dispatching agent's identity, action = the tool name (the rejected
 *      name for the non-catalog case); and
 *   3. for every non-catalog dispatch and every gated personal-data read, the
 *      durable domain state (inbound_leads / leads_mirror / parties /
 *      party_identities / events) is byte-for-byte unchanged across the call —
 *      no handler ran (Req 12.1, 12.3).
 *
 * ── Harness ──────────────────────────────────────────────────────────────────
 *
 * `pg-mem` (node-postgres adapter) with migrations `0029` (parties /
 * party_identities / leads_mirror / reps / events …) and `0036`
 * (inbound_leads) applied statement-by-statement over stub FK tables, plus the
 * `audit_log` and the four RBAC tables created inline (those are not in 0029).
 * `getTool` is widened to resolve the REAL lead-engine `CatalogEntry` objects
 * (the canonical Tool_Catalog also contains them) so the real dispatcher
 * pipeline + real handlers + the real audited services run against `pg-mem` —
 * only the registry *lookup* is widened, mirroring the sibling behavioural-parity
 * harness. The LLM gateway and Salesforce adapter are mocked so no network is
 * hit; the audited services and the dispatcher are never mocked.
 */

// `computePhoneHash` (reached by record_inbound_lead when a phone is present)
// reads PHONE_HASH_SALT; set a stable test salt.
process.env.PHONE_HASH_SALT ??= "lead-audit-boundary-test-salt";

// Iteration count is env-configurable for fast local runs (low default keeps the
// boundary sweep quick); the spec mandates ≥100 for this non-optional CC-Audit
// boundary property, so CI overrides with PBT_NUM_RUNS=100 to honor that floor.
const NUM_RUNS = Number(process.env.PBT_NUM_RUNS ?? 10);

// ── Module mocks — no network, no model, no CRM. Services are NEVER mocked. ────

// The voice registry imports the LLM gateway at module load (score_lead's
// rationale reaches it); never hit the network.
vi.mock("../gateway", () => ({
  generateCompletion: vi.fn(async () => "Mocked rationale."),
  generateEmbedding: vi.fn(async () => new Array(768).fill(0)),
}));

// The voice registry imports the Salesforce adapter; handlers must never reach CRM.
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
// registry; the merged catalog the design assembles also contains the
// lead-engine capabilities. We keep every real registry export (so
// lead-capabilities' references to `toolRegistry`/`selectRep` resolve) and only
// widen `getTool` to resolve the REAL lead `CatalogEntry` objects so the real
// dispatcher pipeline + real handlers run.
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
import { dispatchTool, type DispatchErrorCode } from "./dispatch";
import type { ToolContext } from "./registry";
import { seedLeadAgentIdentities } from "../../rbac/seed";
import {
  LEAD_DISTRIBUTION_AGENT_ACTOR,
  LEAD_ENRICHMENT_AGENT_ACTOR,
  LEAD_PARSE_AGENT_ACTOR,
} from "./lead-capabilities";

// ── pg-mem harness ────────────────────────────────────────────────────────────

const VISITOR: IdentityResult = { type: "visitor", units: [] };

const MIGRATION_0029 = "0029_demonic_mandrill.sql";
const MIGRATION_0036 = "0036_inbound_leads.sql";

// 0029 ALTERs ai_appointments / ai_conversations / ai_messages and references
// ai_clients / ai_tenants via FK, so stub those before applying it. `audit_log`
// and the four RBAC tables (`roles`, `permissions`, `role_permissions`,
// `user_roles`) are NOT created by 0029 — create them inline so the dispatcher's
// audit insert and its RBAC permission resolution run for real. The RBAC unique
// indexes let `seedLeadAgentIdentities`' `onConflictDoNothing` links resolve.
// `audit_log.user_id` is `text`: the dispatcher records the string actor (the
// dispatching agent identity) as the audited user, so a `text` column lets every
// dispatch's audit insert persist and lets the property assert the actor.
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

/**
 * Split a Drizzle migration into individual statements. Handles both the
 * breakpoint-delimited 0029 and the comment + semicolon-delimited 0036.
 */
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

/** Stand up pg-mem with 0029 + 0036 + the audit/RBAC tables and a drizzle handle. */
function buildDb(): { mem: IMemoryDb; db: Database } {
  const mem = newDb();

  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });
  // publishEvent issues `SELECT pg_notify(channel, id)`; pg-mem lacks it.
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

/**
 * A byte-for-byte snapshot of the durable lead-engine domain state. Rows are
 * stringified and sorted so the comparison is order-independent. `audit_log` is
 * deliberately EXCLUDED — a rejected non-catalog dispatch legitimately writes
 * its one audit (rejection) row while running NO handler and changing NO domain
 * state, which is exactly the Req 12.3 distinction this snapshot verifies.
 */
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

// ── Generated step model ────────────────────────────────────────────────────

/**
 * One generated dispatch. `kind` selects the assertion shape:
 *   - "mutation"  → a catalog mutating tool, expected to succeed (one audit row);
 *   - "gatedRead" → the OTP-gated personal read, intercepted (one audit row, no
 *     state change);
 *   - "nonCatalog"→ a non-catalog tool name, rejected unknown_tool (one audit
 *     row, no state change).
 * `actor` is the lead-agent identity the S3 seed grants the tool to. `salt`
 * keeps generated inputs (record emails, non-catalog names) distinct per step.
 */
interface Step {
  kind: "mutation" | "gatedRead" | "nonCatalog";
  actor: string;
  toolName: string;
  salt: string;
}

const distributionToolArb = fc.constantFrom(
  "record_inbound_lead",
  "attach_inbound_lead",
  "assign_lead_owner",
  "flag_lead_conflict"
);
const parseToolArb = fc.constantFrom("update_qualification", "score_lead");

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  // distribution-agent mutation
  fc.record({
    kind: fc.constant("mutation" as const),
    actor: fc.constant(LEAD_DISTRIBUTION_AGENT_ACTOR),
    toolName: distributionToolArb,
    salt: fc.uuid(),
  }),
  // parse-agent mutation
  fc.record({
    kind: fc.constant("mutation" as const),
    actor: fc.constant(LEAD_PARSE_AGENT_ACTOR),
    toolName: parseToolArb,
    salt: fc.uuid(),
  }),
  // enrichment-agent gated personal-data read
  fc.record({
    kind: fc.constant("gatedRead" as const),
    actor: fc.constant(LEAD_ENRICHMENT_AGENT_ACTOR),
    toolName: fc.constant("enrich_lead_read"),
    salt: fc.uuid(),
  }),
  // a non-catalog tool name (never a real CatalogEntry)
  fc.record({
    kind: fc.constant("nonCatalog" as const),
    actor: fc.constant(LEAD_DISTRIBUTION_AGENT_ACTOR),
    toolName: fc.uuid().map((u) => `not_a_catalog_tool_${u.slice(0, 8)}`),
    salt: fc.uuid(),
  })
);

/** Resolve a step's raw tool input against the per-run seeded party / inbound ids. */
function resolveInput(step: Step, partyId: string, inboundId: string): unknown {
  switch (step.toolName) {
    case "record_inbound_lead":
      // A fresh email per step → resolves "new" (no prior match), one audit row.
      return { inboundId, email: `lead-${step.salt}@example.com` };
    case "attach_inbound_lead":
      return { inboundId, partyId };
    case "assign_lead_owner":
      return { partyId };
    case "flag_lead_conflict":
      return { inboundId, reason: "synthetic conflict" };
    case "update_qualification":
      return { partyId, budgetBand: "2.5-3.0M" };
    case "score_lead":
      return { partyId };
    case "enrich_lead_read":
      return { partyId };
    default:
      return {}; // nonCatalog
  }
}

function ctxFor(actor: string): ToolContext {
  return {
    actor,
    conversationId: randomUUID(),
    identity: VISITOR,
    language: "en",
    otpVerificationState: "not_required",
  };
}

// ── Property 10 ───────────────────────────────────────────────────────────────

describe("lead-capabilities — Property 10: dispatcher / audit boundary (Req 12.1, 12.3, 12.4)", () => {
  // seedLeadAgentIdentities logs once per run; keep the property output clean.
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeAll(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterAll(() => {
    logSpy.mockRestore();
  });

  it("writes exactly one audit row per dispatch (userId = agent, action = tool); a non-catalog tool is rejected and changes no state", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(stepArb, { minLength: 1, maxLength: 8 }),
        async (steps) => {
          const { db } = buildDb();

          // Seed the RBAC tables (task 3.1) so the dispatcher's per-agent
          // permission check admits each granted lead tool (Req 12.1, 12.2).
          await seedLeadAgentIdentities(db);

          // Seed a resolved party + its mirror, a party_identity, and an inbound
          // ledger row so the granted mutations / gated read have data to act on.
          const partyId = randomUUID();
          const inboundId = randomUUID();
          await db
            .insert(parties)
            .values({ id: partyId, type: "person", language: "en" });
          await db
            .insert(leadsMirror)
            .values({ partyId, projectInterest: "Bayn" });
          await db
            .insert(partyIdentities)
            .values({ partyId, kind: "phone_hash", value: "seeded-phone-hash" });
          await db.insert(inboundLeads).values({
            id: inboundId,
            source: "web_form",
            idempotencyKey: `seed-${randomUUID()}`,
            content: "",
          });

          // The (actor, action) pair each dispatch SHOULD be audited under.
          const expected: Array<{ userId: string; action: string }> = [];

          for (const step of steps) {
            const input = resolveInput(step, partyId, inboundId);
            const ctx = ctxFor(step.actor);

            if (step.kind === "mutation") {
              // A granted catalog mutation flows through the dispatcher and runs
              // (Req 12.1) — exactly one audit row recorded by the dispatcher.
              const result = await dispatchTool(db, step.toolName, input, ctx);
              expect(result.ok).toBe(true);
            } else {
              // Gated read + non-catalog: NO handler may run, so the durable
              // domain state must be byte-for-byte unchanged across the call
              // (Req 12.1, 12.3) — while still producing exactly one audit row.
              const before = await domainSnapshot(db);
              const result = await dispatchTool(db, step.toolName, input, ctx);
              const after = await domainSnapshot(db);

              expect(result.ok).toBe(false);
              if (!result.ok) {
                const code: DispatchErrorCode =
                  step.kind === "nonCatalog" ? "unknown_tool" : "otp_required";
                expect(result.error.code).toBe(code);
              }
              expect(after).toBe(before);
            }

            expected.push({ userId: step.actor, action: step.toolName });
          }

          const rows = await db
            .select({ userId: auditLog.userId, action: auditLog.action })
            .from(auditLog);

          // 1. Exactly one audit row PER dispatch — no more, no fewer (Req 12.4).
          expect(rows.length).toBe(steps.length);

          // 2. The recorded (actor, action) multiset equals what was issued:
          //    userId = the dispatching agent identity, action = the tool name
          //    (the rejected name for the non-catalog case). Order-independent.
          const key = (r: { userId: string; action: string }) =>
            `${r.userId}\u0000${r.action}`;
          expect(rows.map(key).sort()).toEqual(expected.map(key).sort());
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

// ── Explicit examples — the boundary's two non-negotiable halves ────────────────

describe("lead-capabilities audit boundary — explicit examples (Req 12.1, 12.3, 12.4)", () => {
  async function auditRows(db: Database) {
    return db
      .select({ userId: auditLog.userId, action: auditLog.action })
      .from(auditLog);
  }

  async function seed(db: Database): Promise<{ partyId: string; inboundId: string }> {
    await seedLeadAgentIdentities(db);
    const partyId = randomUUID();
    const inboundId = randomUUID();
    await db.insert(parties).values({ id: partyId, type: "person", language: "en" });
    await db.insert(leadsMirror).values({ partyId, projectInterest: "Bayn" });
    await db
      .insert(partyIdentities)
      .values({ partyId, kind: "phone_hash", value: "seeded-phone-hash" });
    await db.insert(inboundLeads).values({
      id: inboundId,
      source: "web_form",
      idempotencyKey: `seed-${randomUUID()}`,
      content: "",
    });
    return { partyId, inboundId };
  }

  it("a granted mutation writes exactly one audit row, action = tool name, actor = the agent", async () => {
    const { db } = buildDb();
    const { partyId } = await seed(db);

    const result = await dispatchTool(
      db,
      "update_qualification",
      { partyId, budgetBand: "2.5-3.0M" },
      ctxFor(LEAD_PARSE_AGENT_ACTOR)
    );
    expect(result.ok).toBe(true);

    const rows = await auditRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(LEAD_PARSE_AGENT_ACTOR);
    expect(rows[0].action).toBe("update_qualification");
  });

  it("a non-catalog tool is rejected unknown_tool, runs no handler, and changes no state", async () => {
    const { db } = buildDb();
    await seed(db);

    const before = await domainSnapshot(db);
    const result = await dispatchTool(
      db,
      "definitely_not_a_catalog_tool",
      { partyId: randomUUID() },
      ctxFor(LEAD_DISTRIBUTION_AGENT_ACTOR)
    );
    const after = await domainSnapshot(db);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unknown_tool");
    expect(after).toBe(before);

    // The dispatcher still records exactly one audit (rejection) row.
    const rows = await auditRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(LEAD_DISTRIBUTION_AGENT_ACTOR);
    expect(rows[0].action).toBe("definitely_not_a_catalog_tool");
  });

  it("the OTP-gated personal read is intercepted for an unverified caller, one audit row, no state change", async () => {
    const { db } = buildDb();
    const { partyId } = await seed(db);

    const before = await domainSnapshot(db);
    const result = await dispatchTool(
      db,
      "enrich_lead_read",
      { partyId },
      ctxFor(LEAD_ENRICHMENT_AGENT_ACTOR) // visitor, not verified → gate intercepts
    );
    const after = await domainSnapshot(db);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("otp_required");
    expect(after).toBe(before);

    const rows = await auditRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(LEAD_ENRICHMENT_AGENT_ACTOR);
    expect(rows[0].action).toBe("enrich_lead_read");
  });
});
