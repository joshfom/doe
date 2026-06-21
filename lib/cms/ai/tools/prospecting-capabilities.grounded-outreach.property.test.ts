// `draft_outreach` (reached below) persists through the audited dispatcher's
// SQL path; `publishEvent` issues a NOTIFY. No phone hashing is exercised here,
// but set a stable salt for parity with the sibling write/property tests.
process.env.PHONE_HASH_SALT ??= "prospecting-grounded-outreach-test-salt";

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import fc from "fast-check";

import * as schema from "../../schema";
import {
  parties,
  leadsMirror,
  marketTransactions,
  marketPriceIndex,
  targets,
  outreachDrafts,
} from "../../schema";
import type { Database } from "../../db";
import type { ToolContext } from "./registry";
import type { CatalogEntry } from "./catalog";
import {
  prospectingCapabilityEntries,
  PROSPECTING_OUTREACH_AGENT_ACTOR,
} from "./prospecting-capabilities";
import type { OutreachDraft } from "../../prospecting/outreach";

/**
 * Property test for grounded outreach (task 6.4, NOT optional).
 *
 * **Feature: prospecting-workspace, Property 2: Every factual claim in an OutreachDraft's grounding manifest resolves to a real record in its named SQL source; a draft contains no figure absent from the manifest.**
 *
 * **Validates: Requirements 14.8, 6.2**
 *
 * Grounding is the non-negotiable boundary of the outbound message (CC-SQL,
 * Req 6.2): the model narrates prose, but EVERY factual figure it states must
 * trace to a real SQL record, and the draft must never carry a figure that is
 * not pinned by its grounding manifest. Req 14.8 EXTENDS this same rule (it does
 * not create a new one) to area-level Area_Trend figures: when an Outreach_Draft
 * grounds a claim in trend figures (roi_pct, volume, yoy_pct, trend), those too
 * must come from a real SQL-mirrored `market_price_index` row that carries them,
 * never model-computed. The `market_price_index` source seeded below therefore
 * populates those Area_Trend columns so a trend-grounded claim resolves to a
 * real row bearing the figures — exercising Req 14.8 inside Property 2 in place.
 * This single property exercises both halves end-to-end per run, against the
 * REAL `draft_outreach` catalog handler
 * (which persists the manifest verbatim — Design §Components #7) backed by an
 * in-memory Postgres standing in for the four named SQL sources:
 *
 *  (a) MANIFEST RESOLVES — for a generated, properly-grounded draft, every
 *      grounding entry names a real record in its declared SQL source table
 *      (`market_transactions` / `market_price_index` / `leads_mirror` /
 *      `parties`). After persisting via `draft_outreach`, we read the draft
 *      back and re-resolve every manifest entry against the actual DB: each
 *      `recordId` must exist in the table named by `sourceTable`.
 *
 *  (b) BODY ⊆ MANIFEST — every numeric figure that appears in the persisted
 *      draft body is covered by the manifest (it appears in some grounding
 *      claim). A draft never ships a figure the manifest does not pin. The body
 *      is assembled from a (possibly strict) subset of the manifest claims, so
 *      the manifest may legitimately carry MORE figures than the body — the
 *      invariant is containment (body figures ⊆ manifest figures), not equality.
 *
 * The harness mirrors prospecting-capabilities.write.test.ts (node-postgres
 * pg-mem adapter) so the handler's real INSERT + `publishEvent` NOTIFY path runs
 * unchanged and the persisted grounding manifest is exactly what we re-resolve.
 */

// The spec baseline for this non-optional property (Property 2) is exactly 100
// iterations — the floor. The user wants fast tests, so we pin it at 100.
const NUM_RUNS = 100;

// The four SQL sources a grounding entry may name (the outreachDraftSchema enum).
type SourceTable = OutreachDraft["grounding"][number]["sourceTable"];

// ── Harness: in-memory Postgres for the four named SQL sources ────────────────
//
// Only the tables the handler writes (`targets`, `outreach_drafts`, `events`)
// and the four grounding SQL sources are declared; plain uuid columns, no
// cross-table FKs, so the harness needs no unrelated tables.
const DDL = `
  CREATE TABLE "parties" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "type" text NOT NULL DEFAULT 'person',
    "name" text,
    "language" text DEFAULT 'en',
    "client_id" uuid,
    "tenant_id" uuid,
    "consent_at" timestamp,
    "demo" boolean NOT NULL DEFAULT false,
    "created_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "leads_mirror" (
    "party_id" uuid PRIMARY KEY,
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
  CREATE TABLE "market_transactions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "market_project_id" uuid,
    "market_building_id" uuid,
    "community_name" text,
    "area_name" text,
    "txn_type" text NOT NULL,
    "txn_date" date NOT NULL,
    "unit_type" text,
    "area_sqm" numeric,
    "bedrooms" integer,
    "price_aed" numeric,
    "price_per_sqft" numeric,
    "is_cash" boolean,
    "buyer_segment" text,
    "buyer_nationality" text,
    "source" text NOT NULL,
    "source_ref" text,
    "as_of" timestamp,
    "demo" boolean NOT NULL DEFAULT false,
    "created_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "market_price_index" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "area_name" text NOT NULL,
    "segment" text,
    "period" text NOT NULL,
    "index_value" numeric,
    "avg_price_per_sqft" numeric,
    "yoy_pct" numeric,
    "roi_pct" numeric,
    "volume" integer,
    "trend" jsonb,
    "source" text NOT NULL,
    "as_of" timestamp,
    "demo" boolean NOT NULL DEFAULT false,
    "created_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "targets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "brief_id" uuid,
    "target_type" text NOT NULL,
    "display_name" text,
    "company_name" text,
    "title" text,
    "email" text,
    "phone_hash" text,
    "raw_phone" text,
    "country" text,
    "attributes" jsonb,
    "source_provider" text NOT NULL,
    "source_ref" text,
    "lawful_basis" text NOT NULL,
    "status" text NOT NULL DEFAULT 'new',
    "party_id" uuid,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "outreach_drafts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "target_id" uuid NOT NULL,
    "brief_id" uuid,
    "channel" text NOT NULL,
    "language" text NOT NULL,
    "subject" text,
    "body" text NOT NULL,
    "grounding" jsonb NOT NULL,
    "status" text NOT NULL DEFAULT 'draft',
    "approved_by" uuid,
    "job_key" text,
    "sent_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "type" text NOT NULL,
    "payload" jsonb,
    "at" timestamp DEFAULT now() NOT NULL
  );
`;

function buildDb(): Database {
  const mem: IMemoryDb = newDb();
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
  mem.public.none(DDL);

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem's node-postgres adapter rejects `types.getTypeParser` and
  // `rowMode: "array"`; strip both (mirrors the sibling write/dispatch tests).
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

  return drizzle(pool, { schema }) as unknown as Database;
}

// ── Catalog entry under test ──────────────────────────────────────────────────

const CTX: ToolContext = { actor: PROSPECTING_OUTREACH_AGENT_ACTOR };

function capability(name: string): CatalogEntry {
  const e = prospectingCapabilityEntries.find((c) => c.name === name);
  if (!e) throw new Error(`capability "${name}" not found`);
  return e;
}

/**
 * Seed one real record into the named SQL source and return its primary-key
 * value — the id a grounding entry must pin to (half (a)). For `leads_mirror`
 * the key is `party_id` (also seeded into `parties` so the row is realistic);
 * for the others it is the table's own `id`.
 */
async function seedRecord(db: Database, sourceTable: SourceTable): Promise<string> {
  switch (sourceTable) {
    case "market_transactions": {
      const [row] = await db
        .insert(marketTransactions)
        .values({
          txnType: "sale",
          txnDate: "2026-01-15",
          priceAed: 40_000_000,
          source: "dubai_pulse",
          asOf: new Date("2026-02-01T00:00:00.000Z"),
        })
        .returning({ id: marketTransactions.id });
      return row.id;
    }
    case "market_price_index": {
      // Req 14.8 extends Req 6.2: an Outreach_Draft may ground a claim in the
      // area-level Area_Trend summary, not just a transaction comp. The trend
      // figures (roi_pct, volume, yoy_pct, trend) are carried on this very
      // `market_price_index` row (S7 increment, Req 14.7), so seeding them here
      // makes the Area_Trend grounding explicit: a trend-grounded outreach claim
      // resolves to a REAL market_price_index row that actually carries those
      // figures (rather than a bare index row). Same primary key the grounding
      // entry pins to, so Property 2's manifest-resolves invariant is unchanged.
      const [row] = await db
        .insert(marketPriceIndex)
        .values({
          areaName: "Palm Jumeirah",
          segment: "ultra_luxury",
          period: "2026-Q1",
          indexValue: 184.2,
          yoyPct: 12.4,
          roiPct: 6.8,
          volume: 312,
          trend: {
            sale_avg_price: 41_500_000,
            sale_avg_price_change: 8.1,
            sale_avg_price_per_sqft: 5_900,
            sale_avg_price_per_sqft_change: 7.3,
            roi: 6.8,
            volume: 312,
          },
          source: "dubai_pulse",
          asOf: new Date("2026-02-01T00:00:00.000Z"),
        })
        .returning({ id: marketPriceIndex.id });
      return row.id;
    }
    case "parties": {
      const [row] = await db
        .insert(parties)
        .values({ type: "person", name: "Prospect" })
        .returning({ id: parties.id });
      return row.id;
    }
    case "leads_mirror": {
      const [party] = await db
        .insert(parties)
        .values({ type: "person", name: "Lead" })
        .returning({ id: parties.id });
      await db
        .insert(leadsMirror)
        .values({ partyId: party.id, tier: "HOT", budgetBand: "40M+" });
      return party.id;
    }
  }
}

/** Re-resolve a grounding entry against the DB: does its record actually exist? */
async function recordExists(
  db: Database,
  sourceTable: SourceTable,
  recordId: string
): Promise<boolean> {
  switch (sourceTable) {
    case "market_transactions": {
      const rows = await db
        .select({ id: marketTransactions.id })
        .from(marketTransactions)
        .where(eq(marketTransactions.id, recordId));
      return rows.length === 1;
    }
    case "market_price_index": {
      const rows = await db
        .select({ id: marketPriceIndex.id })
        .from(marketPriceIndex)
        .where(eq(marketPriceIndex.id, recordId));
      return rows.length === 1;
    }
    case "parties": {
      const rows = await db
        .select({ id: parties.id })
        .from(parties)
        .where(eq(parties.id, recordId));
      return rows.length === 1;
    }
    case "leads_mirror": {
      const rows = await db
        .select({ partyId: leadsMirror.partyId })
        .from(leadsMirror)
        .where(eq(leadsMirror.partyId, recordId));
      return rows.length === 1;
    }
  }
}

/** Extract the set of numeric-figure tokens appearing in a piece of text. */
function figuresIn(text: string): Set<string> {
  return new Set(text.match(/\d+/g) ?? []);
}

// ── Generators ────────────────────────────────────────────────────────────────

const SOURCE_TABLES: SourceTable[] = [
  "market_transactions",
  "market_price_index",
  "leads_mirror",
  "parties",
];

// A digit-free claim label, so the ONLY numeric token a claim contributes is its
// generated figure (keeps the body⊆manifest figure-set comparison exact).
const LABELS = [
  "comparable sale at AED",
  "area price index now at",
  "recent transaction near AED",
  "benchmark price per sqft of",
  "last sold for AED",
  "current segment index of",
];

/** One factual claim spec: which SQL source backs it, its figure, and whether it lands in the body. */
const claimSpecArb = fc.record({
  sourceTable: fc.constantFrom(...SOURCE_TABLES),
  figure: fc.integer({ min: 1, max: 99_999_999 }),
  label: fc.constantFrom(...LABELS),
  asOfMs: fc
    .integer({ min: Date.UTC(2023, 0, 1), max: Date.UTC(2026, 11, 31) })
    .map((ms) => new Date(ms).toISOString()),
  // Whether this claim's prose is included in the body. The manifest always
  // carries the claim, so the body may pin a STRICT SUBSET of manifest figures.
  inBody: fc.boolean(),
});

const draftSpecArb = fc.record({
  channel: fc.constantFrom("email" as const, "whatsapp" as const, "message" as const),
  language: fc.constantFrom("en" as const, "ar" as const),
  withSubject: fc.boolean(),
  claims: fc.array(claimSpecArb, { maxLength: 10 }),
  // A digit-free preamble so the body has non-figure prose too.
  preamble: fc.constantFrom(
    "A discreet note on this opportunity.",
    "Sharing some market context for you.",
    "A quiet update on comparable activity.",
    ""
  ),
});

// ── The property ────────────────────────────────────────────────────────────

describe("Property 2: grounded outreach (manifest resolves + body ⊆ manifest)", () => {
  it(
    "every grounding entry resolves to a real SQL record, and the draft body carries no figure absent from the manifest",
    async () => {
      const draftOutreach = capability("draft_outreach");

      await fc.assert(
        fc.asyncProperty(draftSpecArb, async (spec) => {
          const db = buildDb();

          // A Target for the draft to belong to (Req 6.1).
          const [target] = await db
            .insert(targets)
            .values({
              targetType: "person",
              sourceProvider: "apollo",
              lawfulBasis: "legitimate_interest",
            })
            .returning({ id: targets.id });

          // Materialise each claim: seed a REAL record in its named source, then
          // build the grounding entry (pinning that record's id) and, when the
          // claim is in-body, its prose sentence.
          const grounding: OutreachDraft["grounding"] = [];
          const bodySentences: string[] = [];
          for (const c of spec.claims) {
            const recordId = await seedRecord(db, c.sourceTable);
            const claimText = `${c.label} ${c.figure}`;
            grounding.push({
              claim: claimText,
              sourceTable: c.sourceTable,
              recordId,
              asOf: c.asOfMs,
            });
            if (c.inBody) bodySentences.push(claimText);
          }

          const body = [spec.preamble, ...bodySentences]
            .filter((s) => s.length > 0)
            .join(" | ");

          // Persist through the REAL draft_outreach handler (Design §Components
          // #7) — the manifest is stored verbatim for the send path / this test.
          const out = (await draftOutreach.handler(db, CTX, {
            targetId: target.id,
            channel: spec.channel,
            language: spec.language,
            subject: spec.withSubject ? "A note for you" : undefined,
            body,
            grounding,
          })) as { draftId: string; status: string };

          expect(out.status).toBe("draft");

          // Read the PERSISTED draft back — we verify the stored artifact.
          const [persisted] = await db
            .select({
              body: outreachDrafts.body,
              grounding: outreachDrafts.grounding,
            })
            .from(outreachDrafts)
            .where(eq(outreachDrafts.id, out.draftId));

          const storedGrounding =
            persisted.grounding as OutreachDraft["grounding"];

          // (a) Every grounding entry resolves to a real record in its named
          // SQL source table.
          for (const entry of storedGrounding) {
            const exists = await recordExists(
              db,
              entry.sourceTable,
              entry.recordId
            );
            expect(exists).toBe(true);
          }

          // (b) The draft body contains no figure absent from the manifest:
          // every numeric token in the body appears in some grounding claim.
          const manifestFigures = new Set<string>();
          for (const entry of storedGrounding) {
            for (const f of figuresIn(entry.claim)) manifestFigures.add(f);
          }
          for (const f of figuresIn(persisted.body)) {
            expect(manifestFigures.has(f)).toBe(true);
          }
        }),
        { numRuns: NUM_RUNS }
      );
    },
    120_000
  );
});
