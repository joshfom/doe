import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  vi,
} from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import fc from "fast-check";

/**
 * Tests for the DOE voice tool handlers `get_lead_context`, `assign_rep`, and
 * `score_lead` (task 9.5).
 *
 *   Property 4 — get_lead_context reads mirror only (Req 6.5): across an
 *     arbitrary mix of known callers (seeded `parties` + `leads_mirror` +
 *     optional `reps`) and unknown callers (non-existent partyIds), the
 *     `get_lead_context` handler issues ZERO Salesforce calls. The whole
 *     `SalesforceAdapter` module is mocked so every method is a spy; after
 *     running the handler for every generated party the combined spy call
 *     count is 0.
 *
 *   Unit — assign_rep selection (Req 6.8): project × language × capacity
 *     rules pick the right rep, prefer reps with spare capacity, and fall back
 *     to the least-loaded matching rep; no candidate → handler throws.
 *
 *   Unit — score_lead tier thresholds (Req 6.6): deterministic thresholds map
 *     qualification signals to HOT / WARM / NURTURE; the LLM rationale is mocked
 *     and stored on `leads_mirror.score_reason` (Console-only), never affecting
 *     the tier.
 *
 * **Validates: Requirements 6.5, 6.8, 6.6**
 *
 * Setup mirrors `jobs/idempotency.property.test.ts` (node-postgres adapter over
 * pg-mem so `publishEvent`'s transaction + `pg_notify` work) combined with the
 * richer prerequisite tables `prefetch.property.test.ts` uses (the prefetch
 * join reads base columns on `ai_conversations` / `ai_appointments` that
 * migration 0029 only ALTERs).
 */

// ── Salesforce adapter mock — every method is a spy (proves isolation). ───────
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

// ── LLM gateway mock — score_lead's rationale is deterministic in tests. ──────
const MOCK_RATIONALE = "Mocked rationale: strong qualification signals.";
const generateCompletionMock = vi.fn(async () => MOCK_RATIONALE);

vi.mock("../gateway", () => ({
  generateCompletion: (...args: unknown[]) =>
    generateCompletionMock(...(args as [])),
}));

import * as schema from "../../schema";
import { parties, leadsMirror, reps, events } from "../../schema";
import type { Database } from "../../db";
import { SalesforceAdapter } from "../../tickets/crm/salesforce";
import {
  toolRegistry,
  scoreTier,
  selectRep,
  type RepRoutingRow,
} from "./registry";

// Reduced fast-check budget — each generated case stands up a fresh in-memory
// DB / runs real SQL, so keep run counts small for speed.
const NUM_RUNS = 20;
const MAX_KNOWN = 4;
const MAX_UNKNOWN = 3;

const MIGRATION_FILE = "0029_demonic_mandrill.sql";

// Base tables migration 0029 ALTERs / references. `ai_conversations` and
// `ai_appointments` carry their full BASE columns (migration 0029 only ADDs the
// voice-surface columns), matching `prefetch.property.test.ts`.
const PREREQUISITE_SQL = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
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

  // DEFAULTs reference gen_random_uuid(); pg-mem does not ship it. `impure`
  // forces per-row evaluation (otherwise every row gets the same uuid).
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
  // `rowMode: "array"` that this drizzle version sends; strip both and convert
  // object rows back to positional arrays when array-mode was requested.
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

// ── Seed helpers ──────────────────────────────────────────────────────────────

interface KnownPartySpec {
  language: "en" | "ar";
  name?: string;
  tier?: "HOT" | "WARM" | "NURTURE";
  projectInterest?: string;
  withRep: boolean;
}

async function seedKnownParty(
  db: Database,
  spec: KnownPartySpec
): Promise<string> {
  const partyId = randomUUID();
  await db.insert(parties).values({
    id: partyId,
    type: "person",
    name: spec.name,
    language: spec.language,
  });

  let assignedRepId: string | undefined;
  if (spec.withRep) {
    assignedRepId = randomUUID();
    await db.insert(reps).values({
      id: assignedRepId,
      name: `Rep ${assignedRepId.slice(0, 4)}`,
      capacity: 3,
      openHotCount: 1,
    });
  }

  await db.insert(leadsMirror).values({
    partyId,
    tier: spec.tier,
    projectInterest: spec.projectInterest,
    assignedRepId,
    lastInteractionSummary: "Discussed budget and timeline.",
  });

  return partyId;
}

// ── Property 4: get_lead_context reads mirror only (Req 6.5) ──────────────────

const knownPartyArb: fc.Arbitrary<KnownPartySpec> = fc.record({
  language: fc.constantFrom("en", "ar"),
  name: fc.option(fc.string({ minLength: 1, maxLength: 12 }), { nil: undefined }),
  tier: fc.option(fc.constantFrom("HOT", "WARM", "NURTURE"), { nil: undefined }),
  projectInterest: fc.option(fc.string({ minLength: 1, maxLength: 12 }), {
    nil: undefined,
  }),
  withRep: fc.boolean(),
});

describe("get_lead_context — Property 4: reads mirror only, no Salesforce (Req 6.5)", () => {
  it("issues zero Salesforce calls across known + unknown callers and returns a valid CallContext", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(knownPartyArb, { minLength: 0, maxLength: MAX_KNOWN }),
        fc.array(fc.uuid(), { minLength: 0, maxLength: MAX_UNKNOWN }),
        async (knownSpecs, unknownIds) => {
          if (knownSpecs.length === 0 && unknownIds.length === 0) {
            knownSpecs = [{ language: "en", withRep: false }];
          }

          for (const spy of Object.values(sfSpies)) spy.mockClear();

          const { db } = buildDb();

          // A fully-instrumented (mocked) adapter exists in the graph — the
          // handler must still never reach it.
          new SalesforceAdapter();

          const handler = toolRegistry.get_lead_context.handler;

          const knownIds: string[] = [];
          for (const spec of knownSpecs) {
            knownIds.push(await seedKnownParty(db, spec));
          }

          for (const partyId of knownIds) {
            const ctx = await handler(db, { actor: "agent:voice-lead" }, {
              partyId,
            });
            expect(ctx.known).toBe(true);
            expect(ctx.partyId).toBe(partyId);
          }

          for (const partyId of unknownIds) {
            if (knownIds.includes(partyId)) continue;
            const ctx = await handler(db, { actor: "agent:voice-lead" }, {
              partyId,
            });
            expect(ctx.known).toBe(false);
          }

          const totalSfCalls = Object.values(sfSpies).reduce(
            (sum, spy) => sum + spy.mock.calls.length,
            0
          );
          expect(totalSfCalls).toBe(0);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

// ── Unit: score_lead tier thresholds (Req 6.6) ────────────────────────────────

describe("scoreTier — deterministic tier thresholds (Req 6.6)", () => {
  it("HOT when all three qualification signals are present", () => {
    expect(
      scoreTier({
        budgetBand: "2.5-3.0M",
        projectInterest: "Bayn",
        unitInterest: "2BR",
      })
    ).toBe("HOT");
  });

  it("WARM when one or two signals are present", () => {
    expect(scoreTier({ budgetBand: "2.5-3.0M" })).toBe("WARM");
    expect(scoreTier({ projectInterest: "Bayn", unitInterest: "2BR" })).toBe(
      "WARM"
    );
  });

  it("NURTURE when no signals are present", () => {
    expect(scoreTier({})).toBe("NURTURE");
    expect(scoreTier(undefined)).toBe("NURTURE");
    expect(
      scoreTier({ budgetBand: null, projectInterest: null, unitInterest: null })
    ).toBe("NURTURE");
  });
});

describe("score_lead handler — tier from rules, rationale from LLM (Req 6.6)", () => {
  let db: Database;

  beforeEach(() => {
    ({ db } = buildDb());
    generateCompletionMock.mockClear();
  });

  async function seedParty(
    signals: {
      budgetBand?: string;
      projectInterest?: string;
      unitInterest?: string;
    }
  ): Promise<string> {
    const partyId = randomUUID();
    await db.insert(parties).values({ id: partyId, type: "person", language: "en" });
    await db.insert(leadsMirror).values({ partyId, ...signals });
    return partyId;
  }

  it("scores a fully-qualified lead HOT and stores the mocked rationale on the mirror (Console-only)", async () => {
    const partyId = await seedParty({
      budgetBand: "2.5-3.0M",
      projectInterest: "Bayn",
      unitInterest: "2BR",
    });

    const result = await toolRegistry.score_lead.handler(
      db,
      { actor: "agent:voice-lead" },
      { partyId }
    );

    expect(result.tier).toBe("HOT");
    expect(result.reason).toBe(MOCK_RATIONALE);
    expect(generateCompletionMock).toHaveBeenCalledTimes(1);

    const [row] = await db
      .select({ tier: leadsMirror.tier, scoreReason: leadsMirror.scoreReason })
      .from(leadsMirror)
      .where(eq(leadsMirror.partyId, partyId));
    expect(row.tier).toBe("HOT");
    expect(row.scoreReason).toBe(MOCK_RATIONALE);
  });

  it("scores a partially-qualified lead WARM", async () => {
    const partyId = await seedParty({ budgetBand: "1.0-1.5M" });
    const result = await toolRegistry.score_lead.handler(
      db,
      { actor: "agent:voice-lead" },
      { partyId }
    );
    expect(result.tier).toBe("WARM");
  });

  it("scores an unqualified lead NURTURE", async () => {
    const partyId = await seedParty({});
    const result = await toolRegistry.score_lead.handler(
      db,
      { actor: "agent:voice-lead" },
      { partyId }
    );
    expect(result.tier).toBe("NURTURE");
  });
});

// ── Unit: assign_rep selection (Req 6.8) ──────────────────────────────────────

describe("selectRep — project × language × capacity rules (Req 6.8)", () => {
  const rep = (over: Partial<RepRoutingRow>): RepRoutingRow => ({
    id: randomUUID(),
    name: "Rep",
    languages: ["en"],
    projects: ["Bayn"],
    capacity: 3,
    openHotCount: 0,
    ...over,
  });

  it("selects the rep matching project AND language AND with capacity", () => {
    const match = rep({ id: "match", name: "Aisha", languages: ["en", "ar"], projects: ["Bayn"] });
    const wrongLang = rep({ id: "wl", name: "Bob", languages: ["fr"], projects: ["Bayn"] });
    const wrongProject = rep({ id: "wp", name: "Carl", languages: ["en"], projects: ["Marina"] });

    const sel = selectRep([wrongLang, wrongProject, match], {
      language: "en",
      projectInterest: "Bayn",
    });
    expect(sel?.rep.id).toBe("match");
    expect(sel?.routing).toContain("Aisha");
    expect(sel?.routing).toContain("Bayn");
  });

  it("prefers a rep with spare capacity over one at capacity", () => {
    const full = rep({ id: "full", name: "Aaa", capacity: 3, openHotCount: 3 });
    const spare = rep({ id: "spare", name: "Zzz", capacity: 3, openHotCount: 1 });
    const sel = selectRep([full, spare], { language: "en", projectInterest: "Bayn" });
    expect(sel?.rep.id).toBe("spare");
  });

  it("prefers the rep with the most spare capacity", () => {
    const some = rep({ id: "some", name: "Aaa", capacity: 5, openHotCount: 3 });
    const most = rep({ id: "most", name: "Bbb", capacity: 5, openHotCount: 0 });
    const sel = selectRep([some, most], { language: "en", projectInterest: "Bayn" });
    expect(sel?.rep.id).toBe("most");
  });

  it("falls back to the least-loaded matching rep when all are at capacity", () => {
    const overA = rep({ id: "a", name: "Aaa", capacity: 3, openHotCount: 5 });
    const overB = rep({ id: "b", name: "Bbb", capacity: 3, openHotCount: 4 });
    const sel = selectRep([overA, overB], { language: "en", projectInterest: "Bayn" });
    expect(sel?.rep.id).toBe("b");
    expect(sel?.routing).toContain("at capacity");
  });

  it("returns null when no rep serves the project in the caller's language", () => {
    const r = rep({ languages: ["en"], projects: ["Bayn"] });
    expect(selectRep([r], { language: "ar", projectInterest: "Bayn" })).toBeNull();
    expect(selectRep([r], { language: "en", projectInterest: "Marina" })).toBeNull();
  });
});

describe("assign_rep handler — persists assignment + records routing line (Req 6.8)", () => {
  let db: Database;

  beforeEach(() => {
    ({ db } = buildDb());
  });

  async function seedPartyWithProject(
    language: "en" | "ar",
    projectInterest: string
  ): Promise<string> {
    const partyId = randomUUID();
    await db.insert(parties).values({ id: partyId, type: "person", language });
    await db.insert(leadsMirror).values({ partyId, projectInterest });
    return partyId;
  }

  it("assigns the matching rep, persists it on the mirror, and publishes a decision event", async () => {
    const partyId = await seedPartyWithProject("en", "Bayn");

    const goodRepId = randomUUID();
    await db.insert(reps).values({
      id: goodRepId,
      name: "Aisha",
      languages: ["en", "ar"],
      projects: ["Bayn"],
      capacity: 3,
      openHotCount: 0,
    });
    // A non-matching rep (wrong project) must be ignored.
    await db.insert(reps).values({
      id: randomUUID(),
      name: "Other",
      languages: ["en"],
      projects: ["Marina"],
      capacity: 3,
      openHotCount: 0,
    });

    const result = await toolRegistry.assign_rep.handler(
      db,
      { actor: "agent:voice-lead" },
      { partyId }
    );

    expect(result.repId).toBe(goodRepId);
    expect(result.repName).toBe("Aisha");

    // Assignment persisted on the mirror.
    const [mirror] = await db
      .select({ assignedRepId: leadsMirror.assignedRepId })
      .from(leadsMirror)
      .where(eq(leadsMirror.partyId, partyId));
    expect(mirror.assignedRepId).toBe(goodRepId);

    // Routing logic line recorded for the Console as a decision event.
    const decisionRows = await db
      .select({ type: events.type, payload: events.payload })
      .from(events)
      .where(eq(events.type, "decision.made"));
    expect(decisionRows).toHaveLength(1);
    const payload = decisionRows[0].payload as Record<string, unknown>;
    expect(payload.decision).toBe("assign_rep");
    expect(payload.repId).toBe(goodRepId);
    expect(String(payload.routing)).toContain("Aisha");
  });

  it("throws when no rep can serve the caller's project in their language", async () => {
    const partyId = await seedPartyWithProject("ar", "Bayn");
    await db.insert(reps).values({
      id: randomUUID(),
      name: "EnglishOnly",
      languages: ["en"],
      projects: ["Bayn"],
      capacity: 3,
      openHotCount: 0,
    });

    await expect(
      toolRegistry.assign_rep.handler(
        db,
        { actor: "agent:voice-lead" },
        { partyId }
      )
    ).rejects.toThrow(/no rep serves/);
  });
});
