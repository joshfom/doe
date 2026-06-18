// `record_target` (reached below) hashes any provided phone via
// `computePhoneHash`, which reads PHONE_HASH_SALT from the environment; set a
// stable test salt so hashing is deterministic across the suite.
process.env.PHONE_HASH_SALT ??= "prospecting-provenance-test-salt";

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzleProxy } from "drizzle-orm/pg-proxy";
import { eq } from "drizzle-orm";
import fc from "fast-check";

import * as schema from "../../schema";
import { targets, marketTransactions } from "../../schema";
import type { Database } from "../../db";
import type { ToolContext } from "./registry";
import type { CatalogEntry } from "./catalog";
import {
  prospectingCapabilityEntries,
  PROSPECTING_AGENT_ACTOR,
} from "./prospecting-capabilities";
import {
  provenancedFieldSchema,
  type ProvenancedField,
} from "../../prospecting/target";
import type {
  EnrichmentProvider,
  ProspectFilter,
  ProviderEnrichment,
  ProviderResult,
} from "../../prospecting/providers";
import type { Clock, HttpResponse } from "../../prospecting/providers/transport";
import { ApolloProvider } from "../../prospecting/providers/apollo";
import { PdlProvider } from "../../prospecting/providers/pdl";
import { CognismProvider } from "../../prospecting/providers/cognism";
import { CrunchbaseProvider } from "../../prospecting/providers/crunchbase";
import { comparableStats } from "../../market/stats";

/**
 * Property test for provenance completeness (task 4.4, NOT optional).
 *
 * **Feature: prospecting-workspace, Property 1: Every recorded Target field carries source + as-of (and lawful basis for PII), and every market figure carries source + as-of.**
 *
 * **Validates: Requirements 1.3, 9.1, 11.4**
 *
 * Provenance is the moat's integrity guarantee (CC-Provenance): purchased data
 * must never be indistinguishable from first-party data, and every market figure
 * the agent shows or embeds in outreach must trace to a sourced, as-of-stamped
 * SQL record. This single property exercises BOTH halves end-to-end per run:
 *
 *  1. TARGET provenance (Req 1.3, 9.1) — drive a randomly generated provider
 *     payload through the REAL provider adapter (`ApolloProvider` / `PdlProvider`
 *     / `CognismProvider` / `CrunchbaseProvider`, transport + clock injected so
 *     no network/credentials are touched), then persist the produced
 *     candidate/enrichment through the `record_target` catalog handler. Read the
 *     row back and assert EVERY persisted attribute carries a non-empty `source`
 *     and a valid `asOf`, and that any PII attribute (email / phone /
 *     linkedin url) ALSO carries a non-empty `lawfulBasis`. The record itself
 *     carries acquisition `sourceProvider` + record-level `lawfulBasis`.
 *
 *  2. MARKET-figure provenance (Req 11.4) — seed randomly generated
 *     `market_transactions` (each stamped with a real `source` + non-null
 *     `as_of`, mirroring ingestion under CC-Provenance) into an in-memory
 *     Postgres and read them back through the SQL stat reader
 *     `comparableStats`. Assert that EVERY returned figure that is backed by a
 *     market record (`source !== null`) carries a non-empty `source` AND a valid
 *     `asOf` — the model never surfaces an unsourced figure.
 *
 * The harnesses mirror the proven sibling tests: the target half uses the
 * node-postgres pg-mem adapter from prospecting-capabilities.write.test.ts (the
 * adapter `record_target` is already tested under), and the market half uses the
 * pg-proxy adapter from lib/cms/market/stats.test.ts.
 */

// The spec baseline for this non-optional property (Property 1) is >= 100
// iterations; overridable upward via FAST_CHECK_NUM_RUNS for CI.
const NUM_RUNS = Math.max(100, Number(process.env.FAST_CHECK_NUM_RUNS) || 0);

// ── Target-half harness (node-postgres pg-mem; record_target writes `targets`) ─

const TARGETS_DDL = `
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
`;

function buildTargetDb(): Database {
  const mem: IMemoryDb = newDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });
  mem.public.none(TARGETS_DDL);

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

  return drizzleNodePg(pool, { schema }) as unknown as Database;
}

// ── Market-half harness (pg-proxy pg-mem; comparableStats reads market_*) ──────

const MARKET_DDL = `
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
`;

function buildMarketDb(): Database {
  const mem = newDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });
  mem.public.none(MARKET_DDL);

  const { Client } = mem.adapters.createPg();
  const client = new Client();

  const executor = async (
    sql: string,
    params: unknown[],
    method: "all" | "execute"
  ): Promise<{ rows: unknown[] }> => {
    const res = await client.query({ text: sql, values: params });
    const objectRows = (res.rows ?? []) as Record<string, unknown>[];
    return {
      rows:
        method === "all"
          ? objectRows.map((row) => Object.values(row))
          : objectRows,
    };
  };

  return drizzleProxy(executor as never, { schema }) as unknown as Database;
}

// ── Catalog entry under test ──────────────────────────────────────────────────

const CTX: ToolContext = { actor: PROSPECTING_AGENT_ACTOR };

function capability(name: string): CatalogEntry {
  const e = prospectingCapabilityEntries.find((c) => c.name === name);
  if (!e) throw new Error(`capability "${name}" not found`);
  return e;
}

// A deterministic clock so the adapters stamp a stable, valid `asOf`.
const FIXED_NOW = new Date("2026-02-01T00:00:00.000Z");
const fixedClock: Clock = () => FIXED_NOW;

// The PII attribute keys the adapters mark as personal data (and so must carry a
// lawful basis, Req 9.1). Provider-agnostic: any attribute under one of these
// keys is treated as PII regardless of which adapter produced it.
const PII_KEYS = new Set(["email", "workEmail", "phone", "linkedinUrl"]);

/** A fake transport that always returns the given JSON payload (no network). */
function transportReturning(payload: unknown) {
  return async (): Promise<HttpResponse> => ({
    ok: true,
    status: 200,
    json: async () => payload,
  });
}

/**
 * Assert provenance completeness over a persisted attribute map (Req 1.3, 9.1):
 * every attribute is a well-formed ProvenancedField with a non-empty `source`
 * and a valid `asOf`; every PII attribute additionally carries a non-empty
 * `lawfulBasis`.
 */
function assertAttributeProvenance(
  attributes: Record<string, ProvenancedField>
): void {
  for (const [key, attr] of Object.entries(attributes)) {
    // Shape (value:string, source:string, asOf:datetime, lawfulBasis?:string).
    const parsed = provenancedFieldSchema.parse(attr);
    expect(parsed.source.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(parsed.asOf))).toBe(false);
    if (PII_KEYS.has(key)) {
      expect(typeof parsed.lawfulBasis).toBe("string");
      expect((parsed.lawfulBasis ?? "").length).toBeGreaterThan(0);
    }
  }
}

// ── Generators ──────────────────────────────────────────────────────────────

const PROVIDER_IDS = ["apollo", "pdl", "cognism", "crunchbase"] as const;
const COUNTRIES = ["AE", "IN", "GB", "US", "SA"];
const SEGMENTS = ["founder", "family_office", "uhnwi", "golden_visa"];
const SOURCES = ["dubai_pulse", "property_monitor"];

// Generated string values are constrained to a DB-safe alphabet (alphanumerics
// + space + a few separators). This is a harness accommodation, NOT a weakening
// of the property: the in-memory test DB (pg-mem) has a SQL-lexer limitation
// storing backslashes/quotes inside an inserted jsonb value, whereas real
// Postgres stores them fine. The provenance property under test concerns the
// PRESENCE of source / as-of / lawful-basis on every field — not arbitrary
// unicode round-tripping — so restricting the value alphabet leaves the
// provenance assertions fully intact while keeping the harness reliable.
const SAFE_CHARS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -._".split("");
const safeChar = fc.constantFrom(...SAFE_CHARS);
const word = (max = 24) =>
  fc.array(safeChar, { minLength: 1, maxLength: max }).map((a) => a.join(""));
const optWord = (max = 24) => fc.option(word(max), { nil: undefined });
const optEmail = fc.option(
  word(12).map((w) => `${w}@example.com`),
  { nil: undefined }
);
// A mix of E.164-shaped and junk phones so record_target's hashing path (and its
// graceful fallback on un-normalizable input) are both exercised.
const optPhone = fc.option(
  fc.oneof(
    fc
      .integer({ min: 500_000_00, max: 599_999_99 })
      .map((n) => `+9715${String(n).slice(0, 7)}`),
    word(10)
  ),
  { nil: undefined }
);
const optUrl = fc.option(
  word(12).map((w) => `https://linkedin.com/in/${w}`),
  { nil: undefined }
);

/** A generated "person" the person-mode adapters map from. */
const personArb = fc.record({
  id: optWord(16),
  name: optWord(32),
  title: optWord(32),
  email: optEmail,
  phone: optPhone,
  country: fc.option(fc.constantFrom(...COUNTRIES), { nil: undefined }),
  seniority: optWord(20),
  linkedin: optUrl,
  companyName: optWord(32),
  industry: optWord(24),
  employees: fc.option(fc.integer({ min: 1, max: 250_000 }), { nil: undefined }),
});
type GenPerson = typeof personArb extends fc.Arbitrary<infer T> ? T : never;

/** A generated "organization" the funding-mode adapter (Crunchbase) maps from. */
const orgArb = fc.record({
  uuid: optWord(16),
  name: optWord(32),
  fundingType: optWord(16),
  numRounds: fc.option(fc.integer({ min: 0, max: 20 }), { nil: undefined }),
  totalFunding: fc.option(fc.integer({ min: 0, max: 5_000_000_000 }), {
    nil: undefined,
  }),
  categories: fc.option(fc.array(word(16), { maxLength: 4 }), { nil: undefined }),
  employeesEnum: optWord(12),
  founded: fc.option(fc.constantFrom("2010-01-01", "2018-06-01", "2021-03-15"), {
    nil: undefined,
  }),
  website: fc.option(
    word(12).map((w) => `https://${w}.com`),
    { nil: undefined }
  ),
  country: fc.option(fc.constantFrom(...COUNTRIES), { nil: undefined }),
});
type GenOrg = typeof orgArb extends fc.Arbitrary<infer T> ? T : never;

/** Build the provider-specific SEARCH payload from a generated person/org. */
function searchPayload(
  providerId: (typeof PROVIDER_IDS)[number],
  person: GenPerson,
  org: GenOrg
): unknown {
  switch (providerId) {
    case "apollo":
      return {
        people: [
          {
            id: person.id,
            name: person.name,
            title: person.title,
            email: person.email,
            country: person.country,
            seniority: person.seniority,
            linkedin_url: person.linkedin,
            phone_numbers: person.phone
              ? [{ raw_number: person.phone }]
              : undefined,
            organization: {
              name: person.companyName,
              industry: person.industry,
              estimated_num_employees: person.employees,
            },
          },
        ],
      };
    case "pdl":
      return {
        data: [
          {
            id: person.id,
            full_name: person.name,
            job_title: person.title,
            job_title_levels: person.seniority ? [person.seniority] : undefined,
            work_email: person.email,
            mobile_phone: person.phone,
            job_company_name: person.companyName,
            job_company_industry: person.industry,
            job_company_size: person.employees?.toString(),
            location_country: person.country,
            linkedin_url: person.linkedin,
          },
        ],
      };
    case "cognism":
      return {
        contacts: [
          {
            id: person.id,
            firstName: person.name,
            lastName: undefined,
            jobTitle: person.title,
            seniority: person.seniority,
            email: person.email,
            phone: person.phone,
            companyName: person.companyName,
            industry: person.industry,
            employeeCount: person.employees,
            country: person.country,
            linkedinUrl: person.linkedin,
          },
        ],
      };
    case "crunchbase":
      return {
        entities: [
          {
            uuid: org.uuid,
            properties: {
              uuid: org.uuid,
              name: org.name,
              last_funding_type: org.fundingType,
              num_funding_rounds: org.numRounds,
              total_funding_usd: org.totalFunding,
              categories: org.categories,
              num_employees_enum: org.employeesEnum,
              founded_on: org.founded,
              website_url: org.website,
              location_identifiers: org.country ? [org.country] : undefined,
              country_code: org.country,
            },
          },
        ],
      };
  }
}

/** Build the provider-specific ENRICH payload from a generated person/org. */
function enrichPayload(
  providerId: (typeof PROVIDER_IDS)[number],
  person: GenPerson,
  org: GenOrg
): unknown {
  switch (providerId) {
    case "apollo":
      return {
        person: {
          id: person.id,
          name: person.name,
          title: person.title,
          email: person.email,
          country: person.country,
          seniority: person.seniority,
          linkedin_url: person.linkedin,
          phone_numbers: person.phone
            ? [{ raw_number: person.phone }]
            : undefined,
          organization: { name: person.companyName, industry: person.industry },
        },
      };
    case "pdl":
      return {
        data: {
          id: person.id,
          full_name: person.name,
          job_title: person.title,
          job_title_levels: person.seniority ? [person.seniority] : undefined,
          work_email: person.email,
          mobile_phone: person.phone,
          job_company_name: person.companyName,
          job_company_industry: person.industry,
          job_company_size: person.employees?.toString(),
          location_country: person.country,
          linkedin_url: person.linkedin,
        },
      };
    case "cognism":
      return {
        contact: {
          id: person.id,
          firstName: person.name,
          jobTitle: person.title,
          seniority: person.seniority,
          email: person.email,
          phone: person.phone,
          companyName: person.companyName,
          industry: person.industry,
          country: person.country,
          linkedinUrl: person.linkedin,
        },
      };
    case "crunchbase":
      return {
        properties: {
          uuid: org.uuid,
          name: org.name,
          last_funding_type: org.fundingType,
          num_funding_rounds: org.numRounds,
          total_funding_usd: org.totalFunding,
          categories: org.categories,
          num_employees_enum: org.employeesEnum,
          founded_on: org.founded,
          website_url: org.website,
          country_code: org.country,
        },
      };
  }
}

/** Construct the real adapter for a provider id, transport + clock injected. */
function buildProvider(
  providerId: (typeof PROVIDER_IDS)[number],
  payload: unknown
): EnrichmentProvider {
  const config = { apiKey: "test-key", baseUrl: "https://provider.test" };
  const deps = { transport: transportReturning(payload), clock: fixedClock };
  switch (providerId) {
    case "apollo":
      return new ApolloProvider(config, deps);
    case "pdl":
      return new PdlProvider(config, deps);
    case "cognism":
      return new CognismProvider(config, deps);
    case "crunchbase":
      return new CrunchbaseProvider(config, deps);
  }
}

// A generated market transaction. `asOf` is always non-null, mirroring CC-
// Provenance ingestion (every market_* row is stamped source + as_of), so any
// figure the reader backs with a record must surface a non-null `asOf`.
interface GenTxn {
  txnType: "sale" | "rent" | "off_plan";
  txnDate: string;
  priceAed: number | null;
  pricePerSqft: number | null;
  buyerSegment: string | null;
  source: string;
  asOf: Date;
}

const pad = (n: number) => String(n).padStart(2, "0");

const txnArb: fc.Arbitrary<GenTxn> = fc.record({
  // Bias to `sale` so the sale-based figures are actually exercised.
  txnType: fc.constantFrom<"sale" | "rent" | "off_plan">(
    "sale",
    "sale",
    "sale",
    "rent",
    "off_plan"
  ),
  txnDate: fc
    .record({
      y: fc.integer({ min: 2023, max: 2026 }),
      m: fc.integer({ min: 1, max: 12 }),
      d: fc.integer({ min: 1, max: 28 }),
    })
    .map(({ y, m, d }) => `${y}-${pad(m)}-${pad(d)}`),
  priceAed: fc.option(fc.integer({ min: 500_000, max: 100_000_000 }), {
    nil: null,
  }),
  pricePerSqft: fc.option(fc.integer({ min: 500, max: 8000 }), { nil: null }),
  buyerSegment: fc.option(fc.constantFrom(...SEGMENTS), { nil: null }),
  source: fc.constantFrom(...SOURCES),
  asOf: fc
    .integer({ min: Date.UTC(2023, 0, 1), max: Date.UTC(2026, 11, 31) })
    .map((ms) => new Date(ms)),
});

// ── The property ──────────────────────────────────────────────────────────────

describe("Property 1: provenance completeness (Target fields + market figures)", () => {
  it(
    "every recorded Target attribute carries source + as-of (+ lawful basis for PII), and every backed market figure carries source + as-of",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...PROVIDER_IDS),
          fc.constantFrom<"search" | "enrich">("search", "enrich"),
          personArb,
          orgArb,
          fc.array(txnArb, { maxLength: 10 }),
          async (providerId, mode, person, org, txns) => {
            // ── Half 1: Target provenance via adapter → record_target ─────────
            const isCompany = providerId === "crunchbase";
            const targetType = isCompany ? "company" : "person";
            const filter: ProspectFilter = { targetType };

            const provider = buildProvider(
              providerId,
              mode === "search"
                ? searchPayload(providerId, person, org)
                : enrichPayload(providerId, person, org)
            );

            // Build the record_target inputs the adapter produced.
            const recordInputs: Array<{
              targetType: "person" | "company" | "intermediary";
              displayName?: string;
              companyName?: string;
              title?: string;
              email?: string;
              phone?: string;
              country?: string;
              attributes: Record<string, ProvenancedField>;
              sourceProvider: string;
              sourceRef?: string;
              lawfulBasis: string;
            }> = [];

            if (mode === "search") {
              const results = (await provider.search(filter)) as ProviderResult[];
              for (const r of results) {
                recordInputs.push({
                  targetType: r.targetType,
                  displayName: r.displayName,
                  companyName: r.companyName,
                  title: r.title,
                  email: r.email,
                  phone: r.phone,
                  country: r.country,
                  attributes: r.attributes,
                  sourceProvider: r.sourceProvider,
                  sourceRef: r.sourceRef,
                  lawfulBasis: r.lawfulBasis,
                });
              }
            } else {
              const enrichment = (await provider.enrich({
                displayName: person.name,
                companyName: person.companyName ?? org.name,
                email: person.email,
                sourceRef: isCompany ? org.uuid : person.id,
              })) as ProviderEnrichment;
              recordInputs.push({
                targetType,
                attributes: enrichment.attributes,
                sourceProvider: enrichment.sourceProvider,
                sourceRef: enrichment.sourceRef,
                lawfulBasis: "legitimate_interest",
              });
            }

            const targetDb = buildTargetDb();
            const recordTarget = capability("record_target");
            for (const input of recordInputs) {
              const out = (await recordTarget.handler(targetDb, CTX, input)) as {
                targetId: string;
              };

              const [row] = await targetDb
                .select()
                .from(targets)
                .where(eq(targets.id, out.targetId));

              // Record-level acquisition provenance (Req 1.3): non-empty source
              // provider + a record-level lawful basis.
              expect(row.sourceProvider.length).toBeGreaterThan(0);
              expect((row.lawfulBasis ?? "").length).toBeGreaterThan(0);

              // Every persisted attribute carries source + as-of (+ lawful basis
              // for PII) — the heart of the Target half of Property 1.
              assertAttributeProvenance(
                (row.attributes ?? {}) as Record<string, ProvenancedField>
              );
            }

            // ── Half 2: every backed market figure carries source + as-of ─────
            const marketDb = buildMarketDb();
            const projectId = randomUUID();
            for (const t of txns) {
              await marketDb.insert(marketTransactions).values({
                marketProjectId: projectId,
                txnType: t.txnType,
                txnDate: t.txnDate,
                priceAed: t.priceAed,
                pricePerSqft: t.pricePerSqft,
                buyerSegment: t.buyerSegment,
                source: t.source,
                asOf: t.asOf,
              });
            }

            const [stats] = await comparableStats(marketDb, [projectId]);

            const figures = [
              stats.recentSalePriceAed,
              stats.avgPricePerSqft,
              stats.velocitySalesLast12m,
              stats.buyerSegmentMix,
            ];
            for (const fig of figures) {
              // A figure backed by a real market_* record MUST carry both a
              // non-empty source and a valid as-of (Req 11.4). An unbacked
              // figure (no contributing rows) is null/null and surfaces nothing.
              if (fig.source !== null) {
                expect(fig.source.length).toBeGreaterThan(0);
                expect(SOURCES).toContain(fig.source);
                expect(fig.asOf).not.toBeNull();
                expect(Number.isNaN(Date.parse(fig.asOf as string))).toBe(false);
              } else {
                // No backing data ⇒ no as-of either (never an invented stamp).
                expect(fig.asOf).toBeNull();
              }
            }
          }
        ),
        { numRuns: NUM_RUNS }
      );
    },
    120_000
  );
});
