import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import fc from "fast-check";

/**
 * Property test for the prospecting dispatcher / audit boundary (task 3.4 — a
 * non-optional CC-Audit boundary test).
 *
 *   **Feature: prospecting-workspace, Property 7: Every prospecting mutation/personal-data read/provider call/send flows through dispatchTool into a CatalogEntry, producing exactly one audit row; a non-catalog tool is rejected.**
 *
 * **Validates: Requirements 8.1**
 *
 * Requirement 8 is "the one rule, preserved": every prospecting MUTATION
 * (`record_target`, `enrich_target`, `draft_outreach`, `promote_target_to_lead`),
 * every personal-data read / PROVIDER CALL (`prospect_search`, `enrich_target`),
 * every market SQL read (`find_comparables`, `market_comps`), and every SEND
 * (`send_outreach`) EXECUTES through `dispatchTool` (Zod → RBAC → OTP → audit →
 * execute) into a `CatalogEntry`; an agent never touches the database, a
 * provider API, or the send transport directly. The S7 capabilities inherit the
 * S1 dispatcher's enforcement with no new enforcement code:
 *
 *   • Req 8.1 (a) — a prospecting tool reaches the world ONLY by invoking its
 *     `CatalogEntry` through the dispatcher, and every such dispatch writes
 *     EXACTLY ONE `audit_log` row, recorded under the dispatching identity with
 *     the catalog tool name as the action.
 *   • Req 8.1 (b) — a tool name that is NOT a prospecting `CatalogEntry` is
 *     rejected with `unknown_tool`, runs NO handler, and changes NO persistent
 *     state.
 *
 * The property drives a random interleaving of:
 *   - market SQL reads             — `find_comparables`, `market_comps`;
 *   - prospecting mutations        — `record_target`, `enrich_target`,
 *     `draft_outreach`, `promote_target_to_lead`;
 *   - a provider-call search       — `prospect_search`;
 *   - the human-gated send         — `send_outreach` (a valid single-use,
 *     rep-and-draft-bound Approval_Flow token, dispatched under the approving
 *     rep's identity);
 *   - a non-catalog tool name      — rejected as `unknown_tool`.
 *
 * The agent reads/mutations dispatch under the `agent:prospecting` /
 * `agent:outreach` identities (resolved in-process by the dispatcher's static
 * grants, exactly the seeded role's tool set). The send dispatches under a rep
 * uuid seeded with `prospecting:tool:send_outreach` so the REAL RBAC check
 * inside `dispatchTool` admits it (a send is never agent-grantable). Across any
 * generated mix it asserts:
 *   1. the number of `audit_log` rows equals the number of dispatches — exactly
 *      one per dispatch (Req 8.1 a); and
 *   2. the recorded `(actor, action)` multiset equals the issued one — actor =
 *      the dispatching identity, action = the tool name (the rejected name for
 *      the non-catalog case); and
 *   3. for every non-catalog dispatch the durable prospecting/market/party
 *      domain state is byte-for-byte unchanged across the call — no handler ran
 *      (Req 8.1 b).
 *
 * ── Harness ──────────────────────────────────────────────────────────────────
 *
 * `pg-mem` (node-postgres adapter) with migration `0029` (parties /
 * party_identities / leads_mirror / reps / events / sf_outbox …), `0037`
 * (market_* catalog) and `0038` (prospecting domain) applied over minimal
 * id-only stubs for the pre-existing tables their FKs reference. `audit_log`
 * and the four RBAC tables are created inline (not in 0029) so the dispatcher's
 * audit insert and its real RBAC permission resolution run for real. The model
 * gateway and the Salesforce adapter are mocked so no network is hit; the
 * provider registry is empty (no transport configured) and the send channel is
 * a fake adapter — the audited services + the dispatcher are NEVER mocked, so
 * the real handlers run against pg-mem behind the real dispatch pipeline.
 */

// record_target / promote reach computePhoneHash only when a phone is present;
// set a stable salt regardless so nothing depends on ambient env.
process.env.PHONE_HASH_SALT ??= "prospecting-audit-boundary-test-salt";

// The spec mandates ≥100 iterations for this non-optional CC-Audit boundary
// property; default to 100 so a bare `vitest --run` honors the floor (env can
// raise it). Never below 100.
const NUM_RUNS = Math.max(100, Number(process.env.PBT_NUM_RUNS ?? 100));

// ── Module mocks — no network, no model, no CRM. Services are NEVER mocked. ────

// dispatch.ts → registry imports the LLM gateway at module load; never hit the
// network (no prospecting tool needs it, but the import must resolve offline).
vi.mock("../gateway", () => ({
  generateCompletion: vi.fn(async () => "Mocked rationale."),
  generateEmbedding: vi.fn(async () => new Array(768).fill(0)),
}));

// The registry + dedupe/outbox chain imports the Salesforce adapter; handlers
// (e.g. promote_target_to_lead) must never reach CRM.
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

import * as schema from "../../schema";
import {
  auditLog,
  events,
  leadsMirror,
  marketProjects,
  marketTransactions,
  marketPriceIndex,
  outreachDrafts,
  parties,
  partyIdentities,
  permissions,
  prospectOptouts,
  rolePermissions,
  roles,
  sfOutbox,
  targets,
  userRoles,
} from "../../schema";
import type { Database } from "../../db";
import type { IdentityResult } from "../identity";
import { dispatchTool, type DispatchErrorCode } from "./dispatch";
import type { ToolContext } from "./registry";
import {
  PROSPECTING_AGENT_ACTOR,
  PROSPECTING_OUTREACH_AGENT_ACTOR,
  OUTREACH_APPROVAL_TTL_MS,
  getOutreachApprovalStore,
  setOutreachChannelAdapter,
  _resetOutreachApprovalStoreForTests,
  _resetOutreachChannelAdapterForTests,
} from "./prospecting-capabilities";
import { prospectingToolPermission } from "../../rbac/seed";
import type { ChannelAdapter } from "../../jobs/channel-adapter";

// ── pg-mem harness ────────────────────────────────────────────────────────────

const VISITOR: IdentityResult = { type: "visitor", units: [] };

const MIGRATION_0029 = "0029_demonic_mandrill.sql";
const MIGRATION_0037 = "0037_market_catalog.sql";
const MIGRATION_0038 = "0038_prospecting.sql";
const MIGRATION_0039 = "0039_project_clusters.sql";

// 0029 ALTERs ai_appointments / ai_conversations / ai_messages and references
// ai_clients / ai_tenants via FK; 0037/0038 reference users / projects /
// ai_units / parties. Stub the pre-existing tables (id-only) so the real
// migrations apply verbatim and their FK references resolve. `audit_log` and
// the four RBAC tables are NOT created by 0029 — create them inline so the
// dispatcher's audit insert and its RBAC resolution run for real. `audit_log.
// user_id` is `text`: the dispatcher records the string actor (agent identity)
// or the rep uuid as the audited user, so a `text` column persists both.
const PREREQUISITE_SQL = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_appointments" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_conversations" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_messages" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "users"    ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "projects" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_units" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
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

/** Split the breakpoint-delimited 0029 migration into individual statements. */
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

function readMigration(file: string): string {
  return readFileSync(join(process.cwd(), "drizzle", file), "utf-8");
}

/** Apply 0029 statement-by-statement (its ai_* ALTERs must apply in order). */
function applySplitMigration(mem: IMemoryDb, file: string): void {
  for (const stmt of splitStatements(readMigration(file))) {
    mem.public.none(stmt);
  }
}

/** Stand up pg-mem with the prerequisite stubs + 0029 + 0037 + 0038. */
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
  applySplitMigration(mem, MIGRATION_0029);
  // 0037/0038 carry only `--> statement-breakpoint` comments between plain
  // statements; pg-mem runs the whole file (comments ignored), mirroring the
  // proven prospecting/market migration tests.
  mem.public.none(readMigration(MIGRATION_0037));
  mem.public.none(readMigration(MIGRATION_0038));
  // 0039 (increment) adds the additive market_price_index Area_Trend columns
  // (roi_pct/volume/trend) the read tools now surface, plus project_clusters /
  // location_resolutions. Applied whole-file like 0037/0038.
  mem.public.none(readMigration(MIGRATION_0039));

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
 * Seed a rep uuid granted EXACTLY `prospecting:tool:send_outreach` via the real
 * RBAC tables so the dispatcher's permission check (loadUserRoles →
 * resolvePermissions → hasPermission) admits the human-gated send. A send is
 * never agent-grantable — it is dispatched under the approving rep's uuid.
 */
async function seedSendingRep(db: Database): Promise<string> {
  const repId = randomUUID();
  // The rep is a real user row: `outreach_drafts.approved_by` FKs `users(id)`,
  // stamped when the send completes.
  await db.execute(sql`INSERT INTO users (id) VALUES (${repId})`);
  const [perm] = await db
    .insert(permissions)
    .values({
      resource: "prospecting:tool",
      action: "send_outreach",
      description: "Human-approved outreach send",
    })
    .returning({ id: permissions.id });
  const [role] = await db
    .insert(roles)
    .values({
      name: "rep_outreach_sender",
      displayName: "Outreach Sender",
      description: "Rep who may send approved outreach",
      userType: "employee",
      isSystem: true,
    })
    .returning({ id: roles.id });
  await db
    .insert(rolePermissions)
    .values({ roleId: role.id, permissionId: perm.id });
  await db.insert(userRoles).values({ userId: repId, roleId: role.id });
  return repId;
}

/** Insert a minimal Target and return its id. */
async function seedTarget(
  db: Database,
  opts: { email?: string } = {}
): Promise<string> {
  const [row] = await db
    .insert(targets)
    .values({
      targetType: "person",
      email: opts.email ?? null,
      sourceProvider: "apollo",
      lawfulBasis: "legitimate_interest",
    })
    .returning({ id: targets.id });
  return row.id;
}

/** Insert a minimal draft Target+draft pair, return both ids. */
async function seedDraft(
  db: Database
): Promise<{ targetId: string; draftId: string }> {
  const targetId = await seedTarget(db, {
    email: `send-${randomUUID()}@example.com`,
  });
  const [row] = await db
    .insert(outreachDrafts)
    .values({
      targetId,
      channel: "email",
      language: "en",
      body: "An understated, grounded note.",
      grounding: [],
      status: "draft",
    })
    .returning({ id: outreachDrafts.id });
  return { targetId, draftId: row.id };
}

/**
 * A byte-for-byte snapshot of the durable prospecting / market / party domain
 * state. Rows are stringified and sorted so the comparison is order-independent.
 * `audit_log` is deliberately EXCLUDED — a rejected non-catalog dispatch
 * legitimately writes its one audit (rejection) row while running NO handler and
 * changing NO domain state, which is exactly the Req 8.1(b) distinction this
 * snapshot verifies.
 */
async function domainSnapshot(db: Database): Promise<string> {
  const sortRows = (rows: Record<string, unknown>[]) =>
    rows.map((r) => JSON.stringify(r)).sort();
  const [tg, od, oo, mp, mt, mi, pr, pi, lm, ob, ev] = await Promise.all([
    db.select().from(targets),
    db.select().from(outreachDrafts),
    db.select().from(prospectOptouts),
    db.select().from(marketProjects),
    db.select().from(marketTransactions),
    db.select().from(marketPriceIndex),
    db.select().from(parties),
    db.select().from(partyIdentities),
    db.select().from(leadsMirror),
    db.select().from(sfOutbox),
    db.select().from(events),
  ]);
  return JSON.stringify({
    targets: sortRows(tg as Record<string, unknown>[]),
    outreachDrafts: sortRows(od as Record<string, unknown>[]),
    prospectOptouts: sortRows(oo as Record<string, unknown>[]),
    marketProjects: sortRows(mp as Record<string, unknown>[]),
    marketTransactions: sortRows(mt as Record<string, unknown>[]),
    marketPriceIndex: sortRows(mi as Record<string, unknown>[]),
    parties: sortRows(pr as Record<string, unknown>[]),
    partyIdentities: sortRows(pi as Record<string, unknown>[]),
    leadsMirror: sortRows(lm as Record<string, unknown>[]),
    sfOutbox: sortRows(ob as Record<string, unknown>[]),
    events: sortRows(ev as Record<string, unknown>[]),
  });
}

// ── A fake send channel — the external transport seam (never real network) ────

function fakeChannelAdapter(): ChannelAdapter {
  return {
    provider: "fake",
    send: async () => ({ messageId: `fake-${randomUUID()}`, provider: "fake" }),
  };
}

// ── Generated step model ──────────────────────────────────────────────────────

/**
 * One generated dispatch. `kind` selects the assertion + per-step setup shape:
 *   - "catalog"  → a prospecting CatalogEntry, expected to flow through and
 *     succeed (one audit row);
 *   - "send"     → the human-gated `send_outreach`, dispatched under a rep uuid
 *     with a valid Approval_Flow token (one audit row);
 *   - "nonCatalog"→ a non-catalog tool name, rejected unknown_tool (one audit
 *     row, no state change).
 */
type CatalogToolName =
  | "find_comparables"
  | "market_comps"
  | "record_target"
  | "prospect_search"
  | "enrich_target"
  | "draft_outreach"
  | "promote_target_to_lead";

interface CatalogStep {
  kind: "catalog";
  toolName: CatalogToolName;
}
interface SendStep {
  kind: "send";
}
interface NonCatalogStep {
  kind: "nonCatalog";
  toolName: string;
}
type Step = CatalogStep | SendStep | NonCatalogStep;

const catalogToolArb = fc.constantFrom<CatalogToolName>(
  "find_comparables",
  "market_comps",
  "record_target",
  "prospect_search",
  "enrich_target",
  "draft_outreach",
  "promote_target_to_lead"
);

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ kind: fc.constant("catalog" as const), toolName: catalogToolArb }),
  fc.record({ kind: fc.constant("send" as const) }),
  fc.record({
    kind: fc.constant("nonCatalog" as const),
    toolName: fc
      .uuid()
      .map((u) => `not_a_catalog_tool_${u.slice(0, 8)}`),
  })
);

/** The dispatching identity each catalog tool is granted to. */
function actorForCatalogTool(toolName: CatalogToolName): string {
  return toolName === "draft_outreach"
    ? PROSPECTING_OUTREACH_AGENT_ACTOR
    : PROSPECTING_AGENT_ACTOR;
}

function ctxFor(actor: string, extra: Partial<ToolContext> = {}): ToolContext {
  return {
    actor,
    conversationId: randomUUID(),
    identity: VISITOR,
    language: "en",
    otpVerificationState: "not_required",
    ...extra,
  };
}

const SAMPLE_BRIEF = {
  spec: {
    area: "Palm Jumeirah",
    segment: "ultra_luxury" as const,
    unitType: "villa" as const,
    bedrooms: 4,
    priceMinAed: 30_000_000,
    priceMaxAed: 50_000_000,
    features: ["sea view", "branded"],
  },
};

// ── Property 7 ──────────────────────────────────────────────────────────────

describe("prospecting-capabilities — Property 7: dispatcher / audit boundary (Req 8.1)", () => {
  beforeEach(() => {
    _resetOutreachApprovalStoreForTests();
    _resetOutreachChannelAdapterForTests();
    setOutreachChannelAdapter(fakeChannelAdapter());
  });

  it("every prospecting read/mutation/provider-call/send flows through dispatchTool into a CatalogEntry with exactly one audit row; a non-catalog tool is rejected and changes no state", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(stepArb, { minLength: 1, maxLength: 8 }),
        async (steps) => {
          const { db } = buildDb();
          const repId = await seedSendingRep(db);

          // The (actor, action) pair each dispatch SHOULD be audited under.
          const expected: Array<{ userId: string; action: string }> = [];

          for (const step of steps) {
            if (step.kind === "catalog") {
              const actor = actorForCatalogTool(step.toolName);
              const input = await buildCatalogInput(db, step.toolName);
              const result = await dispatchTool(db, step.toolName, input, ctxFor(actor));
              // It reached the CatalogEntry handler and executed (Req 8.1 a):
              // not unknown_tool / validation_error / permission_denied.
              expect(result.ok).toBe(true);
              expected.push({ userId: actor, action: step.toolName });
            } else if (step.kind === "send") {
              const { draftId } = await seedDraft(db);
              const approval = await getOutreachApprovalStore().issue(
                db,
                repId,
                draftId,
                OUTREACH_APPROVAL_TTL_MS
              );
              const result = await dispatchTool(
                db,
                "send_outreach",
                { draftId, token: approval.token },
                // The send is dispatched under the approving rep, never an agent.
                ctxFor(repId, { userId: repId })
              );
              expect(result.ok).toBe(true);
              expected.push({ userId: repId, action: "send_outreach" });
            } else {
              // Non-catalog: NO handler may run, so the durable domain state must
              // be byte-for-byte unchanged across the call (Req 8.1 b) — while
              // still producing exactly one audit (rejection) row.
              const before = await domainSnapshot(db);
              const result = await dispatchTool(
                db,
                step.toolName,
                {},
                ctxFor(PROSPECTING_AGENT_ACTOR)
              );
              const after = await domainSnapshot(db);

              expect(result.ok).toBe(false);
              if (!result.ok) {
                const code: DispatchErrorCode = "unknown_tool";
                expect(result.error.code).toBe(code);
              }
              expect(after).toBe(before);
              expected.push({
                userId: PROSPECTING_AGENT_ACTOR,
                action: step.toolName,
              });
            }
          }

          const rows = await db
            .select({ userId: auditLog.userId, action: auditLog.action })
            .from(auditLog);

          // 1. Exactly one audit row PER dispatch — no more, no fewer (Req 8.1 a).
          expect(rows.length).toBe(steps.length);

          // 2. The recorded (actor, action) multiset equals what was issued:
          //    actor = the dispatching identity, action = the tool name (the
          //    rejected name for the non-catalog case). Order-independent.
          const key = (r: { userId: string; action: string }) =>
            `${r.userId}\u0000${r.action}`;
          expect(rows.map(key).sort()).toEqual(expected.map(key).sort());
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

/** Resolve a catalog tool's valid input, seeding any per-step precondition. */
async function buildCatalogInput(
  db: Database,
  toolName: CatalogToolName
): Promise<unknown> {
  switch (toolName) {
    case "find_comparables":
      return { brief: SAMPLE_BRIEF };
    case "market_comps":
      return { area: "Palm Jumeirah", segment: "ultra_luxury" };
    case "record_target":
      return {
        targetType: "person",
        displayName: "A. Buyer",
        sourceProvider: "apollo",
        lawfulBasis: "legitimate_interest",
      };
    case "prospect_search":
      return { filter: { targetType: "person", geography: ["Dubai"] } };
    case "enrich_target": {
      const targetId = await seedTarget(db, {
        email: `enrich-${randomUUID()}@example.com`,
      });
      return { targetId };
    }
    case "draft_outreach": {
      const targetId = await seedTarget(db);
      return {
        targetId,
        channel: "email",
        language: "en",
        body: "A discreet, data-grounded note.",
        grounding: [],
      };
    }
    case "promote_target_to_lead": {
      const targetId = await seedTarget(db);
      // A fresh email → resolveLeadByMatchKeys returns "new" → upsertLead creates
      // the parties + leads_mirror pairing (Req 5.3) — one audited dispatch.
      return { targetId, email: `promote-${randomUUID()}@example.com` };
    }
  }
}

// ── Explicit examples — the boundary's non-negotiable halves ────────────────────

describe("prospecting-capabilities audit boundary — explicit examples (Req 8.1)", () => {
  beforeEach(() => {
    _resetOutreachApprovalStoreForTests();
    _resetOutreachChannelAdapterForTests();
    setOutreachChannelAdapter(fakeChannelAdapter());
  });

  async function auditRows(db: Database) {
    return db
      .select({ userId: auditLog.userId, action: auditLog.action })
      .from(auditLog);
  }

  it("a market read (find_comparables) flows through, one audit row under agent:prospecting", async () => {
    const { db } = buildDb();
    const result = await dispatchTool(
      db,
      "find_comparables",
      { brief: SAMPLE_BRIEF },
      ctxFor(PROSPECTING_AGENT_ACTOR)
    );
    expect(result.ok).toBe(true);

    const rows = await auditRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(PROSPECTING_AGENT_ACTOR);
    expect(rows[0].action).toBe("find_comparables");
  });

  it("a mutation (record_target) writes the row and exactly one audit entry", async () => {
    const { db } = buildDb();
    const result = await dispatchTool(
      db,
      "record_target",
      {
        targetType: "company",
        companyName: "Acme Family Office",
        sourceProvider: "cognism",
        lawfulBasis: "legitimate_interest",
      },
      ctxFor(PROSPECTING_AGENT_ACTOR)
    );
    expect(result.ok).toBe(true);

    const all = await db.select().from(targets);
    expect(all).toHaveLength(1);

    const rows = await auditRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(PROSPECTING_AGENT_ACTOR);
    expect(rows[0].action).toBe("record_target");
  });

  it("the human-gated send flows through under the approving rep, one audit row; the draft is marked sent", async () => {
    const { db } = buildDb();
    setOutreachChannelAdapter(fakeChannelAdapter());
    const repId = await seedSendingRep(db);
    const { draftId } = await seedDraft(db);
    const approval = await getOutreachApprovalStore().issue(
      db,
      repId,
      draftId,
      OUTREACH_APPROVAL_TTL_MS
    );

    const result = await dispatchTool(
      db,
      "send_outreach",
      { draftId, token: approval.token },
      ctxFor(repId, { userId: repId })
    );
    expect(result.ok).toBe(true);

    const [sent] = await db
      .select({ status: outreachDrafts.status })
      .from(outreachDrafts)
      .where(eq(outreachDrafts.id, draftId));
    expect(sent.status).toBe("sent");

    const rows = await auditRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(repId);
    expect(rows[0].action).toBe("send_outreach");
  });

  it("a non-catalog tool is rejected unknown_tool, runs no handler, and changes no state", async () => {
    const { db } = buildDb();

    const before = await domainSnapshot(db);
    const result = await dispatchTool(
      db,
      "definitely_not_a_prospecting_tool",
      { whatever: true },
      ctxFor(PROSPECTING_AGENT_ACTOR)
    );
    const after = await domainSnapshot(db);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unknown_tool");
    expect(after).toBe(before);

    // The dispatcher still records exactly one audit (rejection) row.
    const rows = await auditRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(PROSPECTING_AGENT_ACTOR);
    expect(rows[0].action).toBe("definitely_not_a_prospecting_tool");
  });
});
