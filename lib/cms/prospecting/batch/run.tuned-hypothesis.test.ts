import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

import type { Database } from "../../db";
import * as schema from "../../schema";
import { PROVIDER_IDS, type ProviderResult } from "../providers";
import type { DispatchResult } from "../../ai/tools/dispatch";
import type { BuyerHypothesis } from "../hypothesis";

/**
 * Example / integration tests — Batch_Run started with a rep-tuned
 * Buyer_Hypothesis grounds discovery + drafts in the previewed profile
 * (task 12.5, example-based — NOT a property test).
 *
 * **Validates: Requirements 14.6** — "WHEN a rep starts a Batch_Run after
 * previewing, THE Batch_Run SHALL discover and score using the rep-confirmed
 * Buyer_Hypothesis and SHALL ground its Outreach_Drafts in the previewed
 * Market_Comparables."
 *
 * Task 12.3 threaded an optional `buyerHypothesis` onto the persisted
 * Batch_Run subject. The handler (`run.ts`) projects it onto the discovery /
 * scoring ICP filter via `applyTunedHypothesis` (feeder markets → geography,
 * titles → titles, segments → keywords, wealth signals pass through) when no
 * explicit `icpFilter` is present, then composes the cold draft from that same
 * resolved filter (`toDraft` reads `filter.geography[0]` as the area and
 * `filter.keywords[0]` as the segment). So a tuned run both SEARCHES the tuned
 * profile and GROUNDS its draft copy in it.
 *
 * These tests seed a real `prospecting_batch_runs` row whose subject carries a
 * Buyer_Hypothesis, run the handler against the migrated
 * `drizzle/0040_agentic_prospecting_batch.sql` schema in pg-mem, and assert:
 *   1. `prospect_search` is dispatched with the hypothesis-derived ICP filter
 *      (uses the tuned profile for discovery);
 *   2. the cold `draft_outreach` body/subject is grounded in that tuned profile
 *      (names the feeder market + segment);
 *   3. an explicit `icpFilter` on the subject still wins over the hypothesis
 *      (backward compatible — the run derives nothing when given an ICP filter).
 *
 * Harness mirrors the sibling `run.ordering.test.ts`: the dispatcher + CRM check
 * are mocked so the candidate is deterministically cold-eligible, while every
 * other gate runs for real against pg-mem.
 */

const h = vi.hoisted(() => ({
  // Captured tool inputs by tool name (last call wins per name).
  inputs: {} as Record<string, unknown>,
}));

vi.mock("../../ai/tools/dispatch", () => ({ dispatchTool: vi.fn() }));
import { dispatchTool } from "../../ai/tools/dispatch";
const mockedDispatch = vi.mocked(dispatchTool);

vi.mock("../crm-check", () => ({ checkCrmForContact: vi.fn() }));
import { checkCrmForContact, type CrmCheckResult } from "../crm-check";
const mockedCrm = vi.mocked(checkCrmForContact);

import { runProspectingBatch } from "./run";

const MIGRATION_FILE = "0040_agentic_prospecting_batch.sql";
const ASOF = "2026-01-15T00:00:00.000Z";

process.env.PHONE_HASH_SALT =
  process.env.PHONE_HASH_SALT ?? "run-tuned-hypothesis-test-salt";

const PREREQUISITE_SQL = `
  CREATE TABLE "users" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
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
    "target_id" uuid NOT NULL REFERENCES "targets"("id") ON DELETE CASCADE,
    "brief_id" uuid,
    "channel" text NOT NULL,
    "language" text NOT NULL,
    "subject" text,
    "body" text NOT NULL,
    "grounding" jsonb NOT NULL,
    "status" text NOT NULL DEFAULT 'draft',
    "approved_by" uuid,
    "job_key" text,
    "ai_original_subject" text,
    "ai_original_body" text,
    "sent_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "prospect_optouts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "match_kind" text NOT NULL,
    "match_value" text NOT NULL,
    "reason" text,
    "created_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE UNIQUE INDEX "prospect_optouts_match_ux"
    ON "prospect_optouts" ("match_kind", "match_value");
  CREATE TABLE "events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "type" text NOT NULL,
    "payload" jsonb,
    "at" timestamp DEFAULT now() NOT NULL
  );
`;

function buildDb(): { mem: IMemoryDb; db: Database } {
  const mem = newDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });
  mem.public.registerFunction({
    name: "pg_notify",
    args: [DataType.text, DataType.text],
    returns: DataType.text,
    implementation: () => null,
    impure: true,
  });

  mem.public.none(PREREQUISITE_SQL);

  const sqlText = readFileSync(
    join(process.cwd(), "drizzle", MIGRATION_FILE),
    "utf-8"
  );
  for (const statement of sqlText.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) mem.public.none(trimmed);
  }
  mem.public.none(
    'ALTER TABLE "prospecting_batch_runs" ADD COLUMN "sequence_id" uuid'
  );

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  const originalQuery = pool.query.bind(pool);
  pool.query = ((config: unknown, values?: unknown, cb?: unknown) => {
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
  }) as typeof pool.query;

  const db = drizzle(pool, { schema }) as unknown as Database;
  return { mem, db };
}

/** Seed a run row whose ICP subject carries a rep-tuned Buyer_Hypothesis. */
function seedRun(
  mem: IMemoryDb,
  subject: Record<string, unknown>,
  targetCount = 10
): string {
  const ownerRep = randomUUID();
  const id = randomUUID();
  mem.public.none(`INSERT INTO "users" ("id") VALUES ('${ownerRep}')`);
  mem.public.none(
    `INSERT INTO "prospecting_batch_runs" ` +
      `("id", "owner_rep", "subject", "target_count", "rerun_key") ` +
      `VALUES ('${id}', '${ownerRep}', '${JSON.stringify(subject)}'::jsonb, ${targetCount}, '${id}')`
  );
  return id;
}

/** A single cold-eligible candidate from India (so geography/profile is observable). */
function makeColdCandidate(): ProviderResult {
  const u = randomUUID();
  const email = `${u}@example.com`;
  return {
    targetType: "person",
    displayName: `Candidate ${u.slice(0, 8)}`,
    companyName: `Acme ${u.slice(0, 4)}`,
    title: "Founder",
    email,
    country: "India",
    attributes: {
      email: {
        value: email,
        source: PROVIDER_IDS[0],
        asOf: ASOF,
        lawfulBasis: "legitimate_interest",
      },
    },
    sourceProvider: PROVIDER_IDS[0],
    sourceRef: `${PROVIDER_IDS[0]}-${u}`,
    lawfulBasis: "legitimate_interest",
  };
}

function notFoundCrm(email: string | null): CrmCheckResult {
  return { configured: true, found: false, matches: [], checkedEmail: email };
}

/** Install the dispatcher: capture each tool input, fulfil Target / draft writes. */
function installDispatch(db: Database, candidates: ProviderResult[]): void {
  mockedDispatch.mockImplementation(
    async (
      _db: Database,
      toolName: string,
      input: unknown
    ): Promise<DispatchResult> => {
      h.inputs[toolName] = input;
      if (toolName === "prospect_search") {
        return {
          ok: true,
          result: { candidates, unconfiguredProviders: [], failedProviders: [] },
        };
      }
      if (toolName === "record_target") {
        const rec = input as Record<string, unknown>;
        const [row] = await db
          .insert(schema.targets)
          .values({
            targetType: rec.targetType as "person",
            displayName: (rec.displayName as string) ?? null,
            companyName: (rec.companyName as string) ?? null,
            email: (rec.email as string) ?? null,
            country: (rec.country as string) ?? null,
            attributes: (rec.attributes as object) ?? {},
            sourceProvider: rec.sourceProvider as string,
            sourceRef: (rec.sourceRef as string) ?? null,
            lawfulBasis: rec.lawfulBasis as string,
          })
          .returning({ id: schema.targets.id });
        return { ok: true, result: { targetId: row.id, phoneHash: null } };
      }
      if (toolName === "draft_outreach") {
        const d = input as Record<string, unknown>;
        const [row] = await db
          .insert(schema.outreachDrafts)
          .values({
            targetId: d.targetId as string,
            channel: d.channel as "email",
            language: d.language as "en",
            subject: (d.subject as string) ?? null,
            body: d.body as string,
            grounding: (d.grounding as unknown) ?? [],
          })
          .returning({ id: schema.outreachDrafts.id });
        return { ok: true, result: { draftId: row.id, status: "draft" } };
      }
      throw new Error(`unexpected tool dispatched: ${toolName}`);
    }
  );
}

const TUNED_HYPOTHESIS: BuyerHypothesis = {
  segments: ["branded_residence"],
  feederMarkets: ["India"],
  titles: ["Founder"],
  wealthSignals: ["liquidity event"],
  evidence: [],
  confidence: "high",
};

describe("Feature: agentic-prospecting-batch — Batch_Run grounds in the rep-tuned Buyer_Hypothesis (Req 14.6)", () => {
  beforeEach(() => {
    h.inputs = {};
    mockedDispatch.mockReset();
    mockedCrm.mockReset();
    mockedCrm.mockImplementation(async (input: { email?: string | null }) =>
      notFoundCrm(input.email ?? null)
    );
  });

  it("discovers using the hypothesis-derived ICP filter and grounds the draft in the tuned profile (no explicit icpFilter)", async () => {
    const { mem, db } = buildDb();
    // Subject carries the tuned hypothesis and NO explicit icpFilter.
    const runId = seedRun(mem, {
      kind: "icp",
      buyerHypothesis: TUNED_HYPOTHESIS,
    });
    installDispatch(db, [makeColdCandidate()]);

    await runProspectingBatch(db, { batchRunId: runId }, {} as never);

    // (1) Discovery used the hypothesis-derived filter (Req 14.6) — feeder
    //     markets → geography, titles → titles, segments → keywords, wealth
    //     signals pass through.
    const searchInput = h.inputs["prospect_search"] as {
      filter: Record<string, unknown>;
    };
    expect(searchInput.filter).toMatchObject({
      targetType: "person",
      geography: ["India"],
      titles: ["Founder"],
      keywords: ["branded_residence"],
      wealthSignals: ["liquidity event"],
    });

    // (2) The cold draft is grounded in that same tuned profile — `toDraft`
    //     names the feeder market (area) and segment derived from the filter.
    const draftInput = h.inputs["draft_outreach"] as {
      subject?: string;
      body: string;
      grounding: unknown;
    };
    expect(draftInput).toBeTruthy();
    const draftText = `${draftInput.subject ?? ""}\n${draftInput.body}`;
    expect(draftText).toContain("India");
    expect(draftText.toLowerCase()).toContain("branded residence");
    // The deterministic prose states no figures, so the grounding manifest is
    // empty (the no-invented-figures invariant; Req 2.6) — the tuned profile is
    // provenance for discovery, not a quoted market figure.
    expect(draftInput.grounding).toEqual([]);

    // One cold-eligible queue item was produced.
    const items = await db
      .select()
      .from(schema.prospectingQueueItems)
      .where(eq(schema.prospectingQueueItems.batchRunId, runId));
    expect(items.filter((q) => q.eligibility === "cold_eligible")).toHaveLength(
      1
    );
  }, 60000);

  it("honours an explicit icpFilter over the hypothesis (backward compatible)", async () => {
    const { mem, db } = buildDb();
    // Both an explicit icpFilter AND a (conflicting) hypothesis are present;
    // the explicit filter must win for discovery (the tuning is only applied
    // when no explicit ICP filter is supplied).
    const runId = seedRun(mem, {
      kind: "icp",
      icpFilter: { targetType: "person", geography: ["United Kingdom"] },
      buyerHypothesis: TUNED_HYPOTHESIS,
    });
    installDispatch(db, [makeColdCandidate()]);

    await runProspectingBatch(db, { batchRunId: runId }, {} as never);

    const searchInput = h.inputs["prospect_search"] as {
      filter: Record<string, unknown>;
    };
    // The explicit ICP filter is authoritative — the hypothesis-derived
    // geography (India) is NOT projected on top of it.
    expect(searchInput.filter).toMatchObject({
      targetType: "person",
      geography: ["United Kingdom"],
    });
    expect(searchInput.filter.keywords).toBeUndefined();
  }, 60000);
});
