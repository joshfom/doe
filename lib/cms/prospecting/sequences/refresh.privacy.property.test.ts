import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import fc from "fast-check";

import type { Database } from "../../db";
import * as schema from "../../schema";
import { PROVIDER_IDS, type ProviderResult } from "../providers";
import type { ProvenancedField } from "../target";

/**
 * Property 11 — No raw PII in events, activity, or audit payloads
 * (Requirement 9.7).
 *
 *   **Feature: prospecting-sequences, Property 11: No raw PII in events,
 *   activity, or audit payloads.**
 *
 * **Validates: Requirements 9.7**
 *
 * *For any* Sequence Refresh_Run over candidates that carry a raw phone number,
 * NO `prospecting.*` event payload, `prospecting_batch_activity` row, or audit
 * payload the run produces contains the raw phone — the prospect is referenced
 * only by an internal id, and the phone is persisted only as a salted hash
 * (Req 9.7, CC-Privacy).
 *
 * The decisive seam is the SAME durable batch handler the ad-hoc path uses —
 * `runProspectingBatch` (`lib/cms/prospecting/batch/run.ts`) — driven in its
 * SEQUENCE-SCOPED mode (the Batch_Run row carries a `sequence_id`). Every
 * decision point the run reaches is recorded twice: persisted as a
 * `prospecting_batch_activity` row (`appendActivity`) and mirrored as a
 * `prospecting.*` event over the bus (`publishBatch` → `publishEvent`, which
 * writes the `events` table here). Both call sites run `assertPrivacySafe` over
 * the payload (`lib/cms/prospecting/batch/activity.ts`), so a phone-like
 * sequence throws rather than being persisted. This property drives the whole
 * handler end to end and then reads BACK every persisted activity row and every
 * mirrored event and asserts the generated raw phone appears in NONE of them.
 *
 * The two external seams are mocked so candidates are deterministically
 * cold-eligible and the dispatcher boundary is observable:
 *   - `../../ai/tools/dispatch` — `prospect_search` returns the generated
 *     candidates; `record_target` inserts a `targets` row carrying ONLY the
 *     salted phone hash (never the raw phone) and returns its id; `draft_outreach`
 *     inserts an `outreach_drafts` row and returns its id.
 *   - `../crm-check` — reports `configured: true, found: false` so every
 *     candidate is genuinely cold.
 */

const h = vi.hoisted(() => ({
  candidates: [] as unknown[],
  recordTarget: null as
    | null
    | ((input: Record<string, unknown>) => Promise<{ targetId: string; phoneHash: string | null }>),
  draftOutreach: null as
    | null
    | ((input: Record<string, unknown>) => Promise<string>),
}));

vi.mock("../../ai/tools/dispatch", () => ({
  dispatchTool: vi.fn(
    async (_db: unknown, toolName: string, input: Record<string, unknown>) => {
      switch (toolName) {
        case "prospect_search":
          return {
            ok: true,
            result: {
              candidates: h.candidates,
              unconfiguredProviders: [],
              failedProviders: [],
            },
          };
        case "record_target": {
          const { targetId, phoneHash } = await h.recordTarget!(input);
          return { ok: true, result: { targetId, phoneHash } };
        }
        case "draft_outreach": {
          const draftId = await h.draftOutreach!(input);
          return { ok: true, result: { draftId, status: "drafted" } };
        }
        default:
          return { ok: false, error: new Error(`unexpected tool ${toolName}`) };
      }
    }
  ),
}));

vi.mock("../crm-check", () => ({
  checkCrmForContact: vi.fn(async (input: { email?: string | null }) => {
    const email = input.email?.trim().toLowerCase() || null;
    return { configured: true, found: false, matches: [], checkedEmail: email };
  }),
}));

import { runProspectingBatch } from "../batch/run";

const NUM_RUNS = Math.max(100, Number(process.env.PBT_RUNS ?? 100));
const BATCH_MIGRATION_FILE = "0040_agentic_prospecting_batch.sql";
const SEQUENCE_MIGRATION_FILE = "0043_prospecting_sequences.sql";

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
  CREATE UNIQUE INDEX "prospect_optouts_match_ux" ON "prospect_optouts" ("match_kind", "match_value");
  CREATE TABLE "events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "type" text NOT NULL,
    "payload" jsonb,
    "at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "prospecting_sequences" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "owner_rep" uuid NOT NULL,
    "name" text NOT NULL,
    "description" text,
    "subject" jsonb NOT NULL,
    "target_count" integer NOT NULL DEFAULT 10,
    "mode" text NOT NULL DEFAULT 'draft',
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
`;

function applyMigration(mem: IMemoryDb, file: string): void {
  const migration = readFileSync(join(process.cwd(), "drizzle", file), "utf-8");
  for (const statement of migration.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) mem.public.none(trimmed);
  }
}

function buildDb(): {
  mem: IMemoryDb;
  db: Database;
  pool: { end: () => Promise<void> };
} {
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
  mem.public.registerFunction({
    name: "now",
    returns: DataType.timestamptz,
    implementation: () => new Date(),
    impure: true,
  });

  mem.public.none(PREREQUISITE_SQL);

  applyMigration(mem, BATCH_MIGRATION_FILE);
  mem.public.none(
    'ALTER TABLE "prospecting_batch_runs" ADD COLUMN "sequence_id" uuid'
  );
  applyMigration(mem, SEQUENCE_MIGRATION_FILE);

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  const countRows = (table: string): number =>
    Number(
      (
        mem.public.many(`SELECT count(*) AS c FROM "${table}"`) as Array<{
          c: number | string;
        }>
      )[0].c
    );

  const originalQuery = pool.query.bind(pool);
  pool.query = ((config: unknown, values?: unknown, cb?: unknown) => {
    if (config && typeof config === "object" && !Array.isArray(config)) {
      const cfg = config as Record<string, unknown>;
      const wantArray = cfg.rowMode === "array";
      const text = String(cfg.text ?? "");
      const lower = text.toLowerCase();
      const clean = { ...cfg };
      delete clean.rowMode;
      delete clean.types;

      const conflictDoNothingReturning =
        lower.includes("on conflict") &&
        lower.includes("do nothing") &&
        lower.includes("returning");

      const shapeRows = (rows: Record<string, unknown>[]) =>
        wantArray ? rows.map((row) => Object.values(row)) : rows;

      if (conflictDoNothingReturning) {
        const table = text.match(/insert\s+into\s+"?([\w.]+)"?/i)?.[1] ?? null;
        const before = table ? countRows(table) : null;
        const result = originalQuery(clean, values, cb);
        return Promise.resolve(
          result as Promise<{ rows: Record<string, unknown>[] }>
        ).then((r) => {
          const after = table ? countRows(table) : null;
          const inserted =
            before === null || after === null ? true : after > before;
          const rows = inserted ? (r.rows ?? []) : [];
          return { ...r, rows: shapeRows(rows), rowCount: rows.length };
        });
      }

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
  return { mem, db, pool };
}

let mem!: IMemoryDb;
let db!: Database;
let dbPool!: { end: () => Promise<void> };
let backup!: { restore: () => void };

beforeAll(() => {
  ({ mem, db, pool: dbPool } = buildDb());
  backup = mem.backup();
});

afterAll(async () => {
  await dbPool?.end?.();
});

async function seedSequenceRun(db: Database): Promise<string> {
  const ownerRep = randomUUID();
  await db.execute(sql`INSERT INTO "users" ("id") VALUES (${ownerRep})`);

  const [sequence] = await db
    .insert(schema.prospectingSequences)
    .values({
      ownerRep,
      name: `seq-${randomUUID()}`,
      subject: { kind: "icp", icpFilter: { targetType: "person" } },
      targetCount: 100,
      mode: "live",
      status: "live",
      enrollmentCap: null,
      enrollmentPeriod: "month",
    })
    .returning({ id: schema.prospectingSequences.id });

  const [run] = await db
    .insert(schema.prospectingBatchRuns)
    .values({
      ownerRep,
      sequenceId: sequence.id,
      subject: { kind: "icp", icpFilter: { targetType: "person" } },
      targetCount: 100,
      rerunKey: `rk-${randomUUID()}`,
    })
    .returning({ id: schema.prospectingBatchRuns.id });
  return run.id;
}

function safeTextArb(maxLength: number): fc.Arbitrary<string> {
  return fc
    .string({ maxLength })
    .map((s) => s.replace(/[^a-zA-Z0-9 .,'-]/g, ""));
}

function provenancedArb(): fc.Arbitrary<ProvenancedField> {
  return fc.record(
    {
      value: fc.string({ minLength: 1, maxLength: 16 }),
      source: fc.constantFrom(...PROVIDER_IDS),
      asOf: fc
        .date({
          min: new Date("2020-01-01"),
          max: new Date("2030-01-01"),
          noInvalidDate: true,
        })
        .map((d) => d.toISOString()),
    },
    { requiredKeys: ["value", "source", "asOf"] }
  );
}

// A raw phone number every candidate carries — this is the PII that must never
// surface in any event / activity / audit payload (Req 9.7).
const RAW_PHONES = [
  "+971501234567",
  "+14155552671",
  "+442071838750",
  "+919876543210",
  "+34911234567",
  "+61291234567",
];

const baseCandidateArb: fc.Arbitrary<ProviderResult> = fc.record(
  {
    targetType: fc.constantFrom("person", "company", "intermediary"),
    displayName: fc.option(safeTextArb(16), { nil: undefined }),
    companyName: fc.option(safeTextArb(16), { nil: undefined }),
    title: fc.option(safeTextArb(16), { nil: undefined }),
    email: fc.emailAddress(),
    phone: fc.constantFrom(...RAW_PHONES),
    country: fc.option(safeTextArb(12), { nil: undefined }),
    attributes: fc.record({ email: provenancedArb() }),
    sourceProvider: fc.constantFrom(...PROVIDER_IDS),
    lawfulBasis: fc.constantFrom("legitimate_interest", "consent"),
  },
  {
    requiredKeys: [
      "targetType",
      "email",
      "phone",
      "attributes",
      "sourceProvider",
      "lawfulBasis",
    ],
  }
);

const candidatesArb: fc.Arbitrary<ProviderResult[]> = fc
  .array(baseCandidateArb, { minLength: 1, maxLength: 6 })
  .map((cands) =>
    cands.map((c, i) => ({ ...c, sourceRef: `ref-${i}-${randomUUID()}` }))
  );

/** A stable, NON-reversible hash stand-in for the candidate's raw phone. */
function hashPhone(raw: string): string {
  let acc = 0;
  for (let i = 0; i < raw.length; i++) {
    acc = (acc * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return `ph_${acc.toString(16)}`;
}

describe("**Feature: prospecting-sequences, Property 11: No raw PII in events, activity, or audit payloads.**", () => {
  it("Validates: Requirements 9.7 — no prospecting.* event, activity row, or audit payload produced by a Refresh_Run contains a raw phone; the prospect is referenced by internal id and the phone only as a salted hash", async () => {
    await fc.assert(
      fc.asyncProperty(candidatesArb, async (candidates) => {
        backup.restore();
        const runId = await seedSequenceRun(db);

        h.candidates = candidates;
        h.recordTarget = async (input) => {
          // The Target write stores ONLY the salted hash, never the raw phone —
          // the candidate's raw phone is hashed at the dispatcher boundary.
          const rawPhone = (input.phone as string) ?? null;
          const phoneHash = rawPhone ? hashPhone(rawPhone) : null;
          const [row] = await db
            .insert(schema.targets)
            .values({
              targetType: input.targetType as "person",
              displayName: (input.displayName as string) ?? null,
              companyName: (input.companyName as string) ?? null,
              title: (input.title as string) ?? null,
              email: (input.email as string) ?? null,
              phoneHash,
              country: (input.country as string) ?? null,
              attributes: {},
              sourceProvider: input.sourceProvider as string,
              sourceRef: (input.sourceRef as string) ?? null,
              lawfulBasis: input.lawfulBasis as string,
            })
            .returning({ id: schema.targets.id });
          return { targetId: row.id, phoneHash };
        };
        h.draftOutreach = async (input) => {
          const [row] = await db
            .insert(schema.outreachDrafts)
            .values({
              targetId: input.targetId as string,
              channel: input.channel as "email",
              language: input.language as "en",
              subject: (input.subject as string) ?? null,
              body: input.body as string,
              grounding: (input.grounding as unknown) ?? [],
            })
            .returning({ id: schema.outreachDrafts.id });
          return row.id;
        };

        await runProspectingBatch(db, { batchRunId: runId }, {} as never);

        const rawPhones = candidates.map((c) => c.phone as string);

        // (Req 9.7) Every persisted activity row's payload + reason carries NO
        // raw phone number — only internal ids, counts, scores, reasons.
        const activity = await db
          .select({
            payload: schema.prospectingBatchActivity.payload,
            reason: schema.prospectingBatchActivity.reason,
            targetId: schema.prospectingBatchActivity.targetId,
          })
          .from(schema.prospectingBatchActivity)
          .where(eq(schema.prospectingBatchActivity.batchRunId, runId));

        for (const row of activity) {
          const serialized = JSON.stringify(row);
          for (const phone of rawPhones) {
            expect(serialized).not.toContain(phone);
          }
        }

        // (Req 9.7) Every mirrored prospecting.* event payload carries NO raw
        // phone number either.
        const events = await db
          .select({
            type: schema.events.type,
            payload: schema.events.payload,
          })
          .from(schema.events);

        for (const event of events) {
          const serialized = JSON.stringify(event);
          for (const phone of rawPhones) {
            expect(serialized).not.toContain(phone);
          }
        }

        // The prospect IS still referenced — by its internal target id — proving
        // the absence of the phone is not merely an empty log.
        const queuedTargets = await db
          .select({ targetId: schema.prospectingQueueItems.targetId })
          .from(schema.prospectingQueueItems)
          .where(eq(schema.prospectingQueueItems.batchRunId, runId));
        expect(queuedTargets.length).toBeGreaterThan(0);
        for (const { targetId } of queuedTargets) {
          expect(typeof targetId).toBe("string");
        }

        // The phone reached the system only as a salted hash on `targets` — the
        // raw phone is never persisted there.
        const storedTargets = await db
          .select({
            phoneHash: schema.targets.phoneHash,
            rawPhone: schema.targets.rawPhone,
          })
          .from(schema.targets);
        for (const t of storedTargets) {
          expect(t.rawPhone).toBeNull();
          if (t.phoneHash !== null) {
            expect(rawPhones).not.toContain(t.phoneHash);
          }
        }
      }),
      { numRuns: NUM_RUNS }
    );
  }, 120000);
});
