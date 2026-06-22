import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import fc from "fast-check";

import * as schema from "../../schema";
import { leadsMirror, reps } from "../../schema";
import type { Database } from "../../db";
import type { ToolContext } from "./registry";
import {
  loadExecutiveCapabilities,
  resolveRepByName,
  getAllLeadsEntry,
  getLeadsByUserEntry,
  getUserCountEntry,
  getUserPipelineEntry,
  compareUserPipelinesEntry,
  EXECUTIVE_TOOL_NAMES,
} from "./executive-capabilities";

// ── Minimal self-contained pg-mem schema ──────────────────────────────────────
// The executive tools only read `reps`, `leads_mirror`, and `users`, so we
// stand up just those tables (no FKs, no migration) — keeping the figure-
// grounding harness fast and independent of unrelated migrations.

const SCHEMA_SQL = `
  CREATE TABLE "reps" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" text NOT NULL,
    "languages" text[],
    "projects" text[],
    "capacity" integer NOT NULL DEFAULT 3,
    "open_hot_count" integer NOT NULL DEFAULT 0,
    "phone" text,
    "teams_id" text,
    "demo" boolean NOT NULL DEFAULT false
  );
  CREATE TABLE "leads_mirror" (
    "party_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "sf_lead_id" text,
    "stage" text,
    "tier" text,
    "score_reason" text,
    "project_interest" text,
    "unit_interest" text,
    "budget_band" text,
    "source" text,
    "campaign" text,
    "assigned_rep_id" uuid,
    "last_interaction_at" timestamp,
    "last_interaction_summary" text,
    "sla_due_at" timestamp,
    "demo" boolean NOT NULL DEFAULT false,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "users" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
  );
`;

function buildDb(): { mem: IMemoryDb; db: Database } {
  const mem = newDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });
  mem.public.none(SCHEMA_SQL);

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
          (r) => ({ ...r, rows: r.rows.map((row) => Object.values(row)) }),
        );
      }
      return result;
    }
    return originalQuery(config, values, cb);
  };

  const db = drizzle(pool, { schema }) as unknown as Database;
  return { mem, db };
}

const ctx: ToolContext = { actor: "agent:home-twin" };

// Arbitraries for a seeded population.
const TIERS = [null, "HOT", "WARM", "NURTURE"] as const;
const STAGES = [null, "new", "qualified", "closed"] as const;
const SOURCES = [null, "web_form", "lead_engine", "meta_lead_ads"] as const;

interface SeedRep {
  id: string;
  name: string;
}
interface SeedLead {
  tier: string | null;
  stage: string | null;
  source: string | null;
  repId: string | null;
  demo: boolean;
}

async function seed(
  db: Database,
  repCount: number,
  leads: SeedLead[],
  userCount: number,
  mem: IMemoryDb,
): Promise<SeedRep[]> {
  const seedReps: SeedRep[] = [];
  for (let i = 0; i < repCount; i++) {
    const id = randomUUID();
    const name = `Rep ${i}`;
    await db.insert(reps).values({ id, name, demo: false });
    seedReps.push({ id, name });
  }
  for (const lead of leads) {
    await db.insert(leadsMirror).values({
      partyId: randomUUID(),
      tier: lead.tier as never,
      stage: lead.stage,
      source: lead.source,
      assignedRepId: lead.repId,
      demo: lead.demo,
    });
  }
  for (let i = 0; i < userCount; i++) {
    mem.public.none(`INSERT INTO users (id) VALUES ('${randomUUID()}')`);
  }
  return seedReps;
}

// ──────────────────────────────────────────────────────────────────────────────
// Feature: ai-prompt-helper-slash-commands, Property 18: The executive
// capability catalog assembles completely.
// ──────────────────────────────────────────────────────────────────────────────
describe("Property 18 — executive catalog assembles completely", () => {
  it("loads ok, names equal EXECUTIVE_TOOL_NAMES, names are unique", () => {
    const result = loadExecutiveCapabilities();
    expect(result.ok).toBe(true);
    const names = [...result.catalog.keys()].sort();
    expect(names).toEqual([...EXECUTIVE_TOOL_NAMES].sort());
    expect(new Set(names).size).toBe(names.length);
    for (const entry of result.catalog.values()) {
      expect(typeof entry.description).toBe("string");
      expect(entry.inputSchema).toBeDefined();
      expect(entry.outputSchema).toBeDefined();
      expect(entry.permission).toBe(`home:tool:${entry.name}`);
      expect(entry.auditActor).toBe("agent:home-twin");
      expect(typeof entry.handler).toBe("function");
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Feature: ai-prompt-helper-slash-commands, Property 12: Executive tool figures
// are grounded, never invented.
// ──────────────────────────────────────────────────────────────────────────────
describe("Property 12 — executive tool figures are grounded", () => {
  it("every figure equals an independent computation over the same seed", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 0, max: 6 }),
        fc.array(
          fc.record({
            tier: fc.constantFrom(...TIERS),
            stage: fc.constantFrom(...STAGES),
            source: fc.constantFrom(...SOURCES),
            repIdx: fc.integer({ min: -1, max: 3 }),
            demo: fc.boolean(),
          }),
          { maxLength: 25 },
        ),
        async (repCount, userCount, rawLeads) => {
          const { db, mem } = buildDb();
          const seedReps = await seed(db, repCount, [], userCount, mem);
          // Resolve repIdx to an actual rep id (or null for unassigned).
          const leads: SeedLead[] = rawLeads.map((l) => ({
            tier: l.tier,
            stage: l.stage,
            source: l.source,
            demo: l.demo,
            repId:
              l.repIdx >= 0 && l.repIdx < seedReps.length
                ? seedReps[l.repIdx].id
                : null,
          }));
          for (const lead of leads) {
            await db.insert(leadsMirror).values({
              partyId: randomUUID(),
              tier: lead.tier as never,
              stage: lead.stage,
              source: lead.source,
              assignedRepId: lead.repId,
              demo: lead.demo,
            });
          }

          const live = leads.filter((l) => !l.demo);

          // get_all_leads — total + byTier + bySource over non-demo rows.
          const allLeads = (await getAllLeadsEntry.handler(db, ctx, {})) as {
            totalLeads: number;
            byTier?: Array<{ tier: string; count: number }>;
            bySource?: Array<{ source: string; count: number }>;
          };
          expect(allLeads.totalLeads).toBe(live.length);
          const expectTier = tally(live.map((l) => l.tier ?? "unknown"));
          expect(toMap(allLeads.byTier ?? [], "tier")).toEqual(expectTier);
          const expectSource = tally(live.map((l) => l.source ?? "unknown"));
          expect(toMap(allLeads.bySource ?? [], "source")).toEqual(
            expectSource,
          );

          // get_user_count — count over users.
          const uc = (await getUserCountEntry.handler(db, ctx, {})) as {
            userCount: number;
          };
          expect(uc.userCount).toBe(userCount);

          // get_leads_by_user — per-rep counts incl. zero-count reps.
          const byUser = (await getLeadsByUserEntry.handler(db, ctx, {})) as {
            users: Array<{ repId: string; name: string; leadCount: number }>;
          };
          expect(byUser.users.length).toBe(seedReps.length);
          for (const rep of seedReps) {
            const row = byUser.users.find((u) => u.repId === rep.id);
            expect(row).toBeDefined();
            const expected = live.filter((l) => l.repId === rep.id).length;
            expect(row!.leadCount).toBe(expected);
          }

          // compare_user_pipelines diffs = a − b over fetched totals.
          if (seedReps.length >= 2) {
            const cmp = (await compareUserPipelinesEntry.handler(db, ctx, {
              userNameA: seedReps[0].name,
              userNameB: seedReps[1].name,
            })) as
              | { matched: true; a: { pipeline: { totalLeads: number } }; b: { pipeline: { totalLeads: number } }; diffs: { totalLeads: number } }
              | { matched: false };
            expect(cmp.matched).toBe(true);
            if (cmp.matched) {
              const a = live.filter((l) => l.repId === seedReps[0].id).length;
              const b = live.filter((l) => l.repId === seedReps[1].id).length;
              expect(cmp.a.pipeline.totalLeads).toBe(a);
              expect(cmp.b.pipeline.totalLeads).toBe(b);
              expect(cmp.diffs.totalLeads).toBe(a - b);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Feature: ai-prompt-helper-slash-commands, Property 15: Per-user tools require
// a unique match or return a no-match result.
// ──────────────────────────────────────────────────────────────────────────────
describe("Property 15 — per-user tools require a unique match", () => {
  it("matched=true iff the query resolves to exactly one rep", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom("Alice", "Bob", "Alicia", "Charlie"), {
          minLength: 0,
          maxLength: 5,
        }),
        fc.constantFrom("Alice", "Bob", "Zoe", "Ali"),
        async (names, query) => {
          const { db, mem } = buildDb();
          for (const name of names) {
            await db.insert(reps).values({ id: randomUUID(), name, demo: false });
          }
          // Independent expectation: case-insensitive exact, else contains.
          const lower = names.map((n) => n.toLowerCase());
          const q = query.toLowerCase();
          const exact = lower.filter((n) => n === q);
          const contains = lower.filter((n) => n.includes(q));
          const uniqueExpected =
            exact.length === 1 || (exact.length === 0 && contains.length === 1);

          const match = await resolveRepByName(db, query);
          const res = (await getUserPipelineEntry.handler(db, ctx, {
            userName: query,
          })) as { matched: boolean };

          if (uniqueExpected) {
            expect(match.kind).toBe("unique");
            expect(res.matched).toBe(true);
          } else {
            expect(match.kind === "none" || match.kind === "ambiguous").toBe(
              true,
            );
            expect(res.matched).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── helpers ───────────────────────────────────────────────────────────────────

function tally(xs: string[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const x of xs) m[x] = (m[x] ?? 0) + 1;
  return m;
}

function toMap<T extends Record<string, unknown>>(
  rows: T[],
  key: keyof T,
): Record<string, number> {
  const m: Record<string, number> = {};
  for (const r of rows) m[String(r[key])] = r.count as number;
  return m;
}
