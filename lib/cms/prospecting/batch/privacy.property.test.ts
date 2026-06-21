import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import fc from "fast-check";

import * as schema from "../../schema";
import { events, prospectingBatchActivity } from "../../schema";
import type { Database } from "../../db";
import {
  appendActivity,
  assertPrivacySafe,
  publishBatch,
  readActivity,
  type BatchEventType,
} from "./activity";
import { computePhoneHash, normalizePhoneToE164 } from "../../voice/identity";

/**
 * Property test for the Batch_Run privacy invariant (task 5.3 — a NON-optional
 * Requirements 3.4 / 8.3 / 10.4 correctness property).
 *
 *   **Feature: agentic-prospecting-batch, Property 5: No raw PII in events,
 *   activity log, or audit payloads.**
 *
 * **Validates: Requirements 3.4, 8.3, 10.4**
 *
 * `lib/cms/prospecting/batch/activity.ts` is the central privacy enforcement
 * point: every persisted Agent_Activity_Log row ({@link appendActivity}) and
 * every mirrored `prospecting.batch.*` / `prospecting.queue.*` event
 * ({@link publishBatch}) runs through {@link assertPrivacySafe} — the same guard
 * a send-audit payload is held to — which THROWS on a phone-like string before
 * anything is persisted or published. A prospect is referenced by an internal
 * id; a phone reaches the system only as a salted SHA-256 `phone_hash`.
 *
 * This property drives randomized RAW phone numbers (E.164 with `+`, bare
 * national digit runs, and `+`-prefixed numbers carrying separators) embedded in
 * candidate-like payloads and asserts, over ≥100 iterations:
 *
 *   1. **Rejection (negative)** — a payload (or a `reason`) carrying a raw phone
 *      is rejected by {@link assertPrivacySafe} directly (the audit-payload
 *      surface), by {@link appendActivity} (the activity-log surface, Req 3.4),
 *      and by {@link publishBatch} (the event / SSE surface, Req 10.4); and on a
 *      rejection NOTHING is persisted to `prospecting_batch_activity` and NOTHING
 *      is published to `events`.
 *
 *   2. **Salted-hash representation** — pushing the raw phone through the
 *      claim/identity normalization (`normalizePhoneToE164` → `computePhoneHash`)
 *      yields a 64-char hex hash that is NOT the raw number and does not contain
 *      it.
 *
 *   3. **Acceptance (positive)** — a privacy-safe payload that references the
 *      prospect by an internal `targetId` and carries the phone only as that
 *      salted `phone_hash` is accepted: it persists exactly one activity row and
 *      publishes exactly one event, and neither stored payload contains the raw
 *      phone.
 */

// Spec requires >=100 iterations (task 5.3 / plan Notes). Override via PBT_RUNS.
const NUM_RUNS = Number(process.env.PBT_RUNS ?? 25);

// A fixed, explicit salt so the hash is reproducible without depending on the
// PHONE_HASH_SALT env var (computePhoneHash accepts an explicit salt for tests).
const TEST_SALT = "prospecting-batch-privacy-test-salt";

// The batch / queue event types publishBatch mirrors decisions onto.
const BATCH_EVENT_TYPES: BatchEventType[] = [
  "prospecting.batch.started",
  "prospecting.batch.progress",
  "prospecting.batch.candidate.skipped",
  "prospecting.batch.completed",
  "prospecting.queue.item.queued",
  "prospecting.queue.item.approved",
  "prospecting.queue.item.rejected",
  "prospecting.queue.item.sent",
];

// ── pg-mem harness (mirrors activity.test.ts) ────────────────────────────────
// Only the tables the activity module touches: users, prospecting_batch_runs,
// prospecting_batch_activity, events.
const DDL = `
  CREATE TABLE "users" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());

  CREATE TABLE "prospecting_batch_runs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "owner_rep" uuid NOT NULL REFERENCES "users"("id"),
    "subject" jsonb NOT NULL,
    "cluster_id" text,
    "target_count" integer NOT NULL,
    "status" text NOT NULL DEFAULT 'running',
    "rerun_key" text NOT NULL,
    "reason" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );

  CREATE TABLE "prospecting_batch_activity" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "batch_run_id" uuid NOT NULL REFERENCES "prospecting_batch_runs"("id") ON DELETE CASCADE,
    "seq" integer NOT NULL,
    "action" text NOT NULL,
    "reason" text,
    "target_id" uuid,
    "payload" jsonb,
    "at" timestamp DEFAULT now() NOT NULL
  );

  CREATE TABLE "events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "type" text NOT NULL,
    "payload" jsonb,
    "at" timestamp DEFAULT now() NOT NULL
  );
`;

function buildDb(): {
  mem: IMemoryDb;
  db: Database;
  pool: { end: () => Promise<void> };
} {
  const mem = newDb();

  // pg-mem ships neither gen_random_uuid() nor pg_notify(); register both (the
  // latter as a no-op) so the module's real SQL resolves.
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

  mem.public.none(DDL);

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem's node-postgres adapter rejects `types.getTypeParser` and
  // `rowMode: "array"`; strip both, honouring drizzle's positional row mapping.
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
  return { mem, db, pool };
}

// ── Shared pg-mem harness ────────────────────────────────────────────────────
// Build the in-memory Postgres + Drizzle handle ONCE for the whole file, then
// revert to the empty-schema restore point before each fast-check iteration.
// pg-mem's O(1) backup/restore gives every iteration the same isolation a fresh
// DB would, without re-instantiating pg-mem (and leaking an adapter pool) ~100
// times per property — the instantiation volume that made the suite flaky.
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

async function seedRun(db: Database): Promise<string> {
  const ownerRep = randomUUID();
  await db.execute(sql`INSERT INTO "users" ("id") VALUES (${ownerRep})`);
  const [run] = await db
    .insert(schema.prospectingBatchRuns)
    .values({
      ownerRep,
      subject: { kind: "cluster", clusterId: "c1" },
      targetCount: 5,
      rerunKey: `rk-${randomUUID()}`,
    })
    .returning({ id: schema.prospectingBatchRuns.id });
  return run.id;
}

// ── Generators ────────────────────────────────────────────────────────────────

// A national subscriber number (8–10 digits, mobile-style leading 5). Wide
// enough to trip the bare-national-run branch of the privacy guard and to
// normalize cleanly to E.164.
const subscriberArb = fc
  .array(fc.integer({ min: 0, max: 9 }), { minLength: 7, maxLength: 9 })
  .map((ds) => `5${ds.join("")}`);

/**
 * A RAW phone number in one of the three formats Property 5 calls out, all of
 * which (a) the privacy guard MUST reject and (b) `normalizePhoneToE164`
 * accepts:
 *
 *   - `e164`        — `+971` + subscriber (leading `+`, 11–13 digits);
 *   - `national`    — `0` + subscriber (bare national run of 8–10 digits);
 *   - `e164-spaced` — `+971` + subscriber grouped by spaces / dashes.
 */
const rawPhoneArb: fc.Arbitrary<string> = fc.oneof(
  subscriberArb.map((s) => `+971${s}`),
  subscriberArb.map((s) => `0${s}`),
  subscriberArb.map(
    (s) => `+971 ${s.slice(0, 2)}-${s.slice(2, 5)} ${s.slice(5)}`
  ),
  subscriberArb.map((s) => `+971 (${s.slice(0, 2)}) ${s.slice(2)}`)
);

// Where to embed the raw phone inside a candidate-like payload — exercises the
// guard's recursive walk over nested objects and arrays.
type Embedding = "flat" | "nested-object" | "array" | "deep";
const embeddingArb = fc.constantFrom<Embedding>(
  "flat",
  "nested-object",
  "array",
  "deep"
);

function embedRawPhone(
  embedding: Embedding,
  raw: string,
  targetId: string
): Record<string, unknown> {
  switch (embedding) {
    case "flat":
      return { targetId, contact: raw };
    case "nested-object":
      return { targetId, candidate: { displayName: "ACME", phone: raw } };
    case "array":
      return { targetId, contacts: ["ok@example.com", raw] };
    case "deep":
      return { targetId, candidate: { contacts: [{ kind: "mobile", value: raw }] } };
  }
}

// ── Property 1: rejection across every privacy surface ───────────────────────

describe("**Feature: agentic-prospecting-batch, Property 5: No raw PII in events, activity log, or audit payloads.**", () => {
  it("Validates: Requirements 3.4, 8.3 — a raw phone in an activity/audit payload is rejected and nothing is persisted", async () => {
    await fc.assert(
      fc.asyncProperty(
        rawPhoneArb,
        embeddingArb,
        async (raw, embedding) => {
          backup.restore();
          const runId = await seedRun(db);
          const targetId = randomUUID();
          const payload = embedRawPhone(embedding, raw, targetId);

          // (a) The guard itself rejects — this is the same check a send-audit
          // payload is held to (Req 8.3).
          expect(() => assertPrivacySafe(payload)).toThrow(/raw phone/i);

          // (b) appendActivity refuses to persist the row (Req 3.4).
          await expect(
            appendActivity(db, {
              batchRunId: runId,
              action: "discovered",
              targetId,
              payload,
            })
          ).rejects.toThrow(/raw phone/i);

          // (c) A raw phone smuggled in via the free-form `reason` is also caught.
          await expect(
            appendActivity(db, {
              batchRunId: runId,
              action: "skipped",
              reason: `contacted ${raw}`,
            })
          ).rejects.toThrow(/raw phone/i);

          // Nothing was persisted on any rejected append.
          const rows = await readActivity(db, runId);
          expect(rows).toHaveLength(0);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("Validates: Requirement 10.4 — a raw phone in a batch/queue event payload is rejected and nothing is published", async () => {
    await fc.assert(
      fc.asyncProperty(
        rawPhoneArb,
        embeddingArb,
        fc.constantFrom(...BATCH_EVENT_TYPES),
        async (raw, embedding, type) => {
          backup.restore();
          const runId = await seedRun(db);
          const targetId = randomUUID();
          const payload = embedRawPhone(embedding, raw, targetId);

          await expect(
            publishBatch(db, type, { id: runId }, payload)
          ).rejects.toThrow(/raw phone/i);

          // No event leaked onto the bus.
          const published = await db.select().from(events);
          expect(published).toHaveLength(0);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // ── Property 2 + 3: salted-hash representation is accepted everywhere ───────

  it("Validates: Requirements 3.4, 10.4 — the phone stored only as a salted hash is accepted by the activity log and the event bus", async () => {
    await fc.assert(
      fc.asyncProperty(
        rawPhoneArb,
        fc.constantFrom(...BATCH_EVENT_TYPES),
        async (raw, type) => {
          backup.restore();
          const runId = await seedRun(db);
          const targetId = randomUUID();

          // Push the raw phone through the claim/identity normalization, exactly
          // as the batch pipeline does, to obtain the salted hash.
          const e164 = normalizePhoneToE164(raw);
          const phoneHash = computePhoneHash(e164, TEST_SALT);

          // The hash is a 64-char hex digest — NOT the raw number, and does not
          // contain the raw subscriber digits.
          expect(phoneHash).toMatch(/^[0-9a-f]{64}$/);
          expect(phoneHash).not.toBe(raw);
          expect(phoneHash).not.toBe(e164);
          const rawDigits = raw.replace(/\D/g, "");
          expect(phoneHash.includes(rawDigits)).toBe(false);
          // The hash form passes the privacy guard.
          expect(() => assertPrivacySafe(phoneHash)).not.toThrow();

          // A privacy-safe payload: prospect referenced by internal id, phone
          // present only as the salted hash, plus inert internal fields.
          const safePayload = {
            targetId,
            phoneHash,
            fitScore: 0.73,
            queued: 3,
            skipReason: "opted_out",
            periodBucket: "2026-01-15",
          };

          // Activity log: persists exactly one row, payload free of the raw phone.
          const appended = await appendActivity(db, {
            batchRunId: runId,
            action: "drafted",
            targetId,
            payload: safePayload,
          });
          expect(appended.seq).toBe(1);
          expect(appended.targetId).toBe(targetId);

          const stored = await readActivity(db, runId);
          expect(stored).toHaveLength(1);
          const storedJson = JSON.stringify(stored[0].payload);
          expect(storedJson.includes(rawDigits)).toBe(false);
          expect((stored[0].payload as Record<string, unknown>).phoneHash).toBe(
            phoneHash
          );

          // Event bus: publishes exactly one event carrying the hash + ids only.
          await publishBatch(db, type, { id: runId }, { targetId, phoneHash });
          const published = await db
            .select()
            .from(events)
            .where(eq(events.type, type));
          expect(published).toHaveLength(1);
          const eventJson = JSON.stringify(published[0].payload);
          expect(eventJson.includes(rawDigits)).toBe(false);
          expect(
            (published[0].payload as Record<string, unknown>).phoneHash
          ).toBe(phoneHash);
          expect(
            (published[0].payload as Record<string, unknown>).batchRunId
          ).toBe(runId);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
