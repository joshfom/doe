import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import fc from "fast-check";

import * as schema from "../schema";
import {
  leadsMirror,
  marketingSpend,
  parties,
  partyIdentities,
  reps,
  viewingSlots,
} from "../schema";
import type { Database } from "../db";
import { resetVoiceDemo } from "./voice-demo";

/**
 * Property test for voice demo reset (task 18.3).
 *
 * Property 10: Demo reset completeness & safety — for all demo-flagged rows,
 * `resetVoiceDemo` removes exactly the `demo:true` scope (and only that scope)
 * and is idempotent (running twice equals running once); non-demo data is
 * untouched.
 *
 * **Validates: Requirements 11.6, 11.7**
 *
 * The harness mirrors the sibling pg-mem property tests
 * (`lib/cms/jobs/idempotency.property.test.ts`,
 * `lib/cms/jobs/post-call-processing.test.ts`): an in-memory Postgres has
 * migration `0029_demonic_mandrill.sql` (the voice-surface tables) and
 * `0031_voice_demo_marketing_spend.sql` (the `marketing_spend.demo` flag)
 * applied so `resetVoiceDemo` runs against genuine SQL — real FK cascades from
 * `parties` to `party_identities` / `leads_mirror`, and the FK-safe delete
 * order over `reps` / `viewing_slots` / `marketing_spend`.
 *
 * Each generated scenario plants an arbitrary mix of demo (`demo = true`) and
 * non-demo (`demo = false`) rows across every voice-surface table — with
 * explicit timestamps so the test never depends on the wall clock. The
 * property then asserts:
 *   (a) completeness + safety (Req 11.6): after one reset, ALL demo-scoped rows
 *       are gone and EVERY non-demo row survives byte-for-byte; and
 *   (b) idempotency (Req 11.7): a second reset removes zero rows and leaves the
 *       end state identical to running it once.
 */

// Each generated case stands up a fresh in-memory DB and runs real SQL, so keep
// the run budget modest (per the performance directive).
const NUM_RUNS = 30;

// A fixed clock anchor for all planted rows — keeps the dataset fully
// deterministic and the timestamps unambiguously in the past.
const BASE_MS = Date.UTC(2024, 0, 1, 12, 0, 0);

// Pre-existing tables migration 0029 ALTERs / references, plus the
// `marketing_spend` table 0031 ALTERs (created here WITHOUT the `demo` column
// so 0031's ADD COLUMN succeeds).
const PREREQUISITE_SQL = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_appointments" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_conversations" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_messages" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "marketing_spend" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "date" date NOT NULL,
    "channel" text NOT NULL,
    "campaign_id" text NOT NULL,
    "ad_set_id" text,
    "ad_id" text,
    "spend" numeric(12,2) NOT NULL,
    "impressions" integer NOT NULL DEFAULT 0,
    "clicks" integer NOT NULL DEFAULT 0,
    "currency" text NOT NULL DEFAULT 'AED',
    "created_at" timestamp DEFAULT now() NOT NULL
  );
`;

const MIGRATIONS = [
  "0029_demonic_mandrill.sql",
  "0031_voice_demo_marketing_spend.sql",
];

function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Stand up pg-mem with migrations 0029 + 0031 applied; return a drizzle handle. */
function buildDb(): { mem: IMemoryDb; db: Database } {
  const mem = newDb();

  // DEFAULTs reference gen_random_uuid(); pg-mem does not ship it. Mark impure
  // so every row gets a distinct uuid (else inserts collide on the PK).
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });

  mem.public.none(PREREQUISITE_SQL);

  for (const file of MIGRATIONS) {
    const sql = readFileSync(join(process.cwd(), "drizzle", file), "utf-8");
    for (const stmt of splitStatements(sql)) {
      mem.public.none(stmt);
    }
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

// ── Scenario generators ────────────────────────────────────────────────────────

interface Scenario {
  reps: { demo: boolean }[];
  parties: {
    demo: boolean;
    identityCount: number;
    withLead: boolean;
    tier: string;
  }[];
  slots: { demo: boolean; attachRep: boolean }[];
  spend: { demo: boolean; amount: number }[];
}

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  reps: fc.array(fc.record({ demo: fc.boolean() }), { maxLength: 5 }),
  parties: fc.array(
    fc.record({
      demo: fc.boolean(),
      identityCount: fc.integer({ min: 0, max: 2 }),
      withLead: fc.boolean(),
      tier: fc.constantFrom("HOT", "WARM", "NURTURE"),
    }),
    { maxLength: 6 }
  ),
  slots: fc.array(
    fc.record({ demo: fc.boolean(), attachRep: fc.boolean() }),
    { maxLength: 5 }
  ),
  spend: fc.array(
    fc.record({ demo: fc.boolean(), amount: fc.integer({ min: 0, max: 9999 }) }),
    { maxLength: 5 }
  ),
});

// ── Snapshot helpers ────────────────────────────────────────────────────────────

interface DbDump {
  reps: Record<string, unknown>[];
  parties: Record<string, unknown>[];
  identities: Record<string, unknown>[];
  leads: Record<string, unknown>[];
  slots: Record<string, unknown>[];
  spend: Record<string, unknown>[];
}

async function dumpAll(db: Database): Promise<DbDump> {
  const [repRows, partyRows, identityRows, leadRows, slotRows, spendRows] =
    await Promise.all([
      db.select().from(reps),
      db.select().from(parties),
      db.select().from(partyIdentities),
      db.select().from(leadsMirror),
      db.select().from(viewingSlots),
      db.select().from(marketingSpend),
    ]);
  return {
    reps: repRows as Record<string, unknown>[],
    parties: partyRows as Record<string, unknown>[],
    identities: identityRows as Record<string, unknown>[],
    leads: leadRows as Record<string, unknown>[],
    slots: slotRows as Record<string, unknown>[],
    spend: spendRows as Record<string, unknown>[],
  };
}

function sortByKey<T extends Record<string, unknown>>(rows: T[], key: string): T[] {
  return [...rows].sort((a, b) => {
    const av = String(a[key]);
    const bv = String(b[key]);
    return av < bv ? -1 : av > bv ? 1 : 0;
  });
}

describe("resetVoiceDemo — Property 10: completeness, safety & idempotency (Req 11.6, 11.7)", () => {
  let db: Database;

  beforeEach(() => {
    ({ db } = buildDb());
  });

  it("removes exactly the demo scope, preserves non-demo data, and is idempotent", async () => {
    let iteration = 0;

    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        // Fresh DB per generated case so iterations never interfere.
        ({ db } = buildDb());
        let clock = BASE_MS;
        const nextTs = () => new Date((clock += 60_000));
        iteration++;

        // 1) Reps — record (id, demo) so dependents can reference a same-scope
        //    rep (a non-demo row may NEVER point at a demo rep, or the FK-safe
        //    delete order would be blocked — and that is exactly the real seed
        //    invariant: dependents share their owner's scope).
        const insertedReps: { id: string; demo: boolean }[] = [];
        for (let i = 0; i < scenario.reps.length; i++) {
          const r = scenario.reps[i];
          const [row] = await db
            .insert(reps)
            .values({
              name: `rep-${iteration}-${i}`,
              languages: ["en"],
              projects: ["Bayn"],
              capacity: 3,
              openHotCount: 0,
              phone: `+97150${String(1_000_000 + i)}`,
              demo: r.demo,
            })
            .returning({ id: reps.id });
          insertedReps.push({ id: row.id, demo: r.demo });
        }
        const pickRepId = (demo: boolean): string | null =>
          insertedReps.find((r) => r.demo === demo)?.id ?? null;

        // 2) Parties (+ their identities and at most one lead). Identities and
        //    the lead inherit the party's demo scope (identities via cascade,
        //    the lead via its own flag set equal to the party's).
        const insertedParties: { id: string; demo: boolean }[] = [];
        for (let i = 0; i < scenario.parties.length; i++) {
          const p = scenario.parties[i];
          const ts = nextTs();
          const [row] = await db
            .insert(parties)
            .values({
              type: "person",
              name: `party-${iteration}-${i}`,
              language: "en",
              consentAt: ts,
              createdAt: ts,
              demo: p.demo,
            })
            .returning({ id: parties.id });
          insertedParties.push({ id: row.id, demo: p.demo });

          for (let k = 0; k < p.identityCount; k++) {
            await db.insert(partyIdentities).values({
              partyId: row.id,
              kind: k === 0 ? "phone_hash" : "email",
              value: `val-${iteration}-${i}-${k}`,
              verifiedAt: ts,
            });
          }

          if (p.withLead) {
            await db.insert(leadsMirror).values({
              partyId: row.id,
              tier: p.tier,
              stage: "qualified",
              source: "Google",
              campaign: "demo-camp",
              projectInterest: "Bayn",
              budgetBand: "2M-3M",
              assignedRepId: pickRepId(p.demo),
              lastInteractionAt: ts,
              lastInteractionSummary: "planted",
              demo: p.demo,
            });
          }
        }

        // 3) Viewing slots — optionally attached to a same-scope rep.
        for (let i = 0; i < scenario.slots.length; i++) {
          const s = scenario.slots[i];
          await db.insert(viewingSlots).values({
            project: "Bayn",
            startsAt: nextTs(),
            repId: s.attachRep ? pickRepId(s.demo) : null,
            taken: false,
            demo: s.demo,
          });
        }

        // 4) Marketing spend — distinct campaign ids to respect the upsert
        //    unique index (date, channel, campaign_id, ad_set_id, ad_id).
        for (let i = 0; i < scenario.spend.length; i++) {
          const sp = scenario.spend[i];
          await db.insert(marketingSpend).values({
            date: "2024-01-01",
            channel: "Google",
            campaignId: `camp-${iteration}-${i}`,
            spend: sp.amount.toFixed(2),
            impressions: 100,
            clicks: 10,
            currency: "AED",
            demo: sp.demo,
          });
        }

        // ── Expected survivors: every non-demo row, captured before reset ──────
        const before = await dumpAll(db);
        const nonDemoPartyIds = new Set(
          before.parties.filter((p) => p.demo === false).map((p) => p.id)
        );
        const expected = {
          reps: before.reps.filter((r) => r.demo === false),
          parties: before.parties.filter((p) => p.demo === false),
          leads: before.leads.filter((l) => l.demo === false),
          slots: before.slots.filter((s) => s.demo === false),
          spend: before.spend.filter((s) => s.demo === false),
          identities: before.identities.filter((idn) =>
            nonDemoPartyIds.has(idn.partyId)
          ),
        };

        // ── (a) One reset: completeness + safety (Req 11.6) ───────────────────
        const summary1 = await resetVoiceDemo(db);
        const after1 = await dumpAll(db);

        // Every non-demo row survives byte-for-byte; every demo row is gone.
        // (`after1` holds ONLY survivors, so equality proves both at once.)
        expect(sortByKey(after1.reps, "id")).toEqual(
          sortByKey(expected.reps, "id")
        );
        expect(sortByKey(after1.parties, "id")).toEqual(
          sortByKey(expected.parties, "id")
        );
        expect(sortByKey(after1.identities, "id")).toEqual(
          sortByKey(expected.identities, "id")
        );
        expect(sortByKey(after1.leads, "partyId")).toEqual(
          sortByKey(expected.leads, "partyId")
        );
        expect(sortByKey(after1.slots, "id")).toEqual(
          sortByKey(expected.slots, "id")
        );
        expect(sortByKey(after1.spend, "id")).toEqual(
          sortByKey(expected.spend, "id")
        );

        // No demo-flagged rows remain anywhere.
        expect(after1.reps.every((r) => r.demo === false)).toBe(true);
        expect(after1.parties.every((p) => p.demo === false)).toBe(true);
        expect(after1.leads.every((l) => l.demo === false)).toBe(true);
        expect(after1.slots.every((s) => s.demo === false)).toBe(true);
        expect(after1.spend.every((s) => s.demo === false)).toBe(true);
        // Surviving identities all belong to surviving (non-demo) parties.
        expect(
          after1.identities.every((idn) => nonDemoPartyIds.has(idn.partyId))
        ).toBe(true);

        // The summary reports exactly the demo-scoped rows it removed.
        expect(summary1.reps).toBe(
          before.reps.length - expected.reps.length
        );
        expect(summary1.parties).toBe(
          before.parties.length - expected.parties.length
        );
        expect(summary1.identities).toBe(
          before.identities.length - expected.identities.length
        );
        expect(summary1.leads).toBe(
          before.leads.length - expected.leads.length
        );
        expect(summary1.viewingSlots).toBe(
          before.slots.length - expected.slots.length
        );
        expect(summary1.marketingSpend).toBe(
          before.spend.length - expected.spend.length
        );

        // ── (b) Second reset: idempotency (Req 11.7) ──────────────────────────
        const summary2 = await resetVoiceDemo(db);
        const after2 = await dumpAll(db);

        // The second run finds nothing flagged demo → removes zero rows.
        expect(summary2.total).toBe(0);
        expect(summary2.reps).toBe(0);
        expect(summary2.parties).toBe(0);
        expect(summary2.identities).toBe(0);
        expect(summary2.leads).toBe(0);
        expect(summary2.viewingSlots).toBe(0);
        expect(summary2.marketingSpend).toBe(0);

        // Running twice equals running once: end state is unchanged.
        expect(sortByKey(after2.reps, "id")).toEqual(
          sortByKey(after1.reps, "id")
        );
        expect(sortByKey(after2.parties, "id")).toEqual(
          sortByKey(after1.parties, "id")
        );
        expect(sortByKey(after2.identities, "id")).toEqual(
          sortByKey(after1.identities, "id")
        );
        expect(sortByKey(after2.leads, "partyId")).toEqual(
          sortByKey(after1.leads, "partyId")
        );
        expect(sortByKey(after2.slots, "id")).toEqual(
          sortByKey(after1.slots, "id")
        );
        expect(sortByKey(after2.spend, "id")).toEqual(
          sortByKey(after1.spend, "id")
        );
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
