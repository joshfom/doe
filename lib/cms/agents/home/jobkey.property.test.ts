import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  combinedReportJobKey,
  briefingJobKey,
  resolveReportPeriodDate,
  type ReportPeriodType,
  type BriefingWindow,
} from "./jobkey";

// ── Imports for the enqueue-half (task 8.2) — `enqueueJob` over `pg-mem` ───────
// Grouped with the existing top-level imports (ES modules require import
// declarations at module scope). The harness below mirrors the proven sibling
// job-spine pg-mem harness in `lib/cms/jobs/side-effect-idempotency.test.ts`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/cms/schema";
import { jobs as jobsTable } from "@/lib/cms/schema";
import type { Database } from "@/lib/cms/db";
import {
  enqueueJob,
  runJob,
  type JobHandler,
  type JobHandlerRegistry,
} from "@/lib/cms/jobs";

// Feature: agentic-home, Property 6: Enqueue by `jobKey` yields at most one job row and at most one external side effect across retries; a missing or empty `jobKey` is rejected.
//
// **Validates: Requirements 4.1, 4.2, 4.3, 10.2, 10.3, 10.5, 10.6**
//
// ─────────────────────────────────────────────────────────────────────────────
// SCOPE OF THIS FILE (task 2.4): the KEY-HALF of Property 6 — the pure `jobkey.ts`
// derivation. Two guarantees are exercised here over generated inputs:
//
//   1. Determinism: the SAME (userId, periodType/window, periodDate) inputs always
//      produce the SAME key, in the exact `report:`/`briefing:` shapes
//      (Requirement 4.2). This is what makes `enqueueJob`'s
//      `ON CONFLICT (job_key) DO NOTHING` collapse retries to one row.
//   2. Rejection: any empty/whitespace/missing component is rejected up front so a
//      malformed enqueue can never collapse into another logical job's key
//      (Requirement 10.6).
//
// The ENQUEUE-HALF of Property 6 — `enqueueJob` over `pg-mem` yielding at most one
// row + at most one side effect across retries, and duplicate enqueue returning
// the existing id as a success ack — is added by task 8.2, which EXTENDS this file
// with a `pg-mem` section appended below. Keep this file structured so that
// section can be appended without disturbing the key-half above.
// ─────────────────────────────────────────────────────────────────────────────

const NUM_RUNS = 100;

// ── Arbitraries ─────────────────────────────────────────────────────────────

/** A present, non-empty, non-whitespace component (a valid key part). */
const validComponentArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 24 })
  .filter((s) => s.trim().length > 0);

/** A non-empty user identifier. */
const userIdArb = validComponentArb;

const periodTypeArb: fc.Arbitrary<ReportPeriodType> = fc.constantFrom(
  "daily",
  "weekly",
);

const windowArb: fc.Arbitrary<BriefingWindow> = fc.constantFrom(
  "morning",
  "midday",
  "evening",
);

/** A `YYYY-MM-DD` calendar day component used directly as a key part. Built
 *  from a day offset so every generated value is a valid calendar day. */
const periodDateArb: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: 36_524 }) // days from 2000-01-01 through ~2099
  .map((offset) => {
    const d = new Date(Date.UTC(2000, 0, 1) + offset * 86_400_000);
    return d.toISOString().slice(0, 10);
  });

/** A component that must be REJECTED: empty or whitespace-only. */
const emptyComponentArb: fc.Arbitrary<string> = fc.constantFrom(
  "",
  " ",
  "   ",
  "\t",
  "\n",
  " \t \n ",
);

// ──────────────────────────────────────────────────────────────────────────────
// Property 6 — key-half: determinism (same inputs → same key)
// ──────────────────────────────────────────────────────────────────────────────

describe("Feature: agentic-home, Property 6: Idempotency by jobKey (key-half — determinism)", () => {
  it("combinedReportJobKey is deterministic and has the report:{userId}:{periodType}:{periodDate} shape", () => {
    fc.assert(
      fc.property(
        userIdArb,
        periodTypeArb,
        periodDateArb,
        (userId, periodType, periodDate) => {
          const a = combinedReportJobKey(userId, periodType, periodDate);
          const b = combinedReportJobKey(userId, periodType, periodDate);
          // Same inputs → same key (the basis of ON CONFLICT idempotency).
          expect(a).toBe(b);
          expect(a).toBe(`report:${userId}:${periodType}:${periodDate}`);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("briefingJobKey is deterministic and has the briefing:{userId}:{window}:{periodDate} shape", () => {
    fc.assert(
      fc.property(
        userIdArb,
        windowArb,
        periodDateArb,
        (userId, window, periodDate) => {
          const a = briefingJobKey(userId, window, periodDate);
          const b = briefingJobKey(userId, window, periodDate);
          expect(a).toBe(b);
          expect(a).toBe(`briefing:${userId}:${window}:${periodDate}`);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("distinct logical jobs never collapse to the same key", () => {
    fc.assert(
      fc.property(
        userIdArb,
        userIdArb,
        periodTypeArb,
        periodTypeArb,
        periodDateArb,
        periodDateArb,
        (userA, userB, typeA, typeB, dateA, dateB) => {
          const keyA = combinedReportJobKey(userA, typeA, dateA);
          const keyB = combinedReportJobKey(userB, typeB, dateB);
          const sameInputs = userA === userB && typeA === typeB && dateA === dateB;
          // Keys collide iff the logical (user, type, date) inputs are identical.
          expect(keyA === keyB).toBe(sameInputs);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("the report and briefing namespaces never collide", () => {
    fc.assert(
      fc.property(
        userIdArb,
        windowArb,
        periodDateArb,
        (userId, window, periodDate) => {
          const briefing = briefingJobKey(userId, window, periodDate);
          // No periodType produces a "briefing:"-prefixed report key.
          expect(briefing.startsWith("report:")).toBe(false);
          expect(briefing.startsWith("briefing:")).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Property 6 — key-half: empty/missing component rejection (Requirement 10.6)
// ──────────────────────────────────────────────────────────────────────────────

describe("Feature: agentic-home, Property 6: Idempotency by jobKey (key-half — rejection)", () => {
  it("combinedReportJobKey rejects an empty/whitespace userId", () => {
    fc.assert(
      fc.property(
        emptyComponentArb,
        periodTypeArb,
        periodDateArb,
        (userId, periodType, periodDate) => {
          expect(() =>
            combinedReportJobKey(userId, periodType, periodDate),
          ).toThrow();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("combinedReportJobKey rejects an empty/whitespace periodDate", () => {
    fc.assert(
      fc.property(
        userIdArb,
        periodTypeArb,
        emptyComponentArb,
        (userId, periodType, periodDate) => {
          expect(() =>
            combinedReportJobKey(userId, periodType, periodDate),
          ).toThrow();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("briefingJobKey rejects an empty/whitespace userId", () => {
    fc.assert(
      fc.property(
        emptyComponentArb,
        windowArb,
        periodDateArb,
        (userId, window, periodDate) => {
          expect(() => briefingJobKey(userId, window, periodDate)).toThrow();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("briefingJobKey rejects an empty/whitespace periodDate", () => {
    fc.assert(
      fc.property(
        userIdArb,
        windowArb,
        emptyComponentArb,
        (userId, window, periodDate) => {
          expect(() => briefingJobKey(userId, window, periodDate)).toThrow();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("a rejected enqueue produces no key (the function throws, never returns a degenerate key)", () => {
    fc.assert(
      fc.property(
        emptyComponentArb,
        periodTypeArb,
        emptyComponentArb,
        (emptyUser, periodType, emptyDate) => {
          // Throwing — not returning "report:::" — is what stops a malformed
          // enqueue from colliding with a real key (Requirement 10.6).
          let threw = false;
          try {
            combinedReportJobKey(emptyUser, periodType, emptyDate);
          } catch {
            threw = true;
          }
          expect(threw).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Period-date derivation feeding the key (Requirement 4.2)
// ──────────────────────────────────────────────────────────────────────────────

describe("Feature: agentic-home, Property 6: Idempotency by jobKey (period-date derivation)", () => {
  it("daily derivation returns the reference day unchanged and is deterministic", () => {
    fc.assert(
      fc.property(periodDateArb, (referenceDay) => {
        const a = resolveReportPeriodDate("daily", referenceDay);
        const b = resolveReportPeriodDate("daily", referenceDay);
        expect(a).toBe(referenceDay);
        expect(a).toBe(b);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("weekly derivation maps every day of a week to the same Monday-start key", () => {
    fc.assert(
      fc.property(periodDateArb, (referenceDay) => {
        const periodDate = resolveReportPeriodDate("weekly", referenceDay);
        // The derived period date is itself a YYYY-MM-DD and is a Monday.
        expect(periodDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        const [y, m, d] = periodDate.split("-").map(Number);
        const derived = new Date(Date.UTC(y, m - 1, d));
        expect(derived.getUTCDay()).toBe(1); // Monday

        // Determinism + idempotence: resolving the derived Monday again is stable.
        expect(resolveReportPeriodDate("weekly", periodDate)).toBe(periodDate);

        // The derived Monday is on-or-before the reference day, within 6 days.
        const [ry, rm, rd] = referenceDay.split("-").map(Number);
        const ref = new Date(Date.UTC(ry, rm - 1, rd));
        const diffDays = (ref.getTime() - derived.getTime()) / 86_400_000;
        expect(diffDays).toBeGreaterThanOrEqual(0);
        expect(diffDays).toBeLessThanOrEqual(6);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("a derived period date yields a stable combinedReportJobKey", () => {
    fc.assert(
      fc.property(userIdArb, periodTypeArb, periodDateArb, (userId, periodType, referenceDay) => {
        const periodDate = resolveReportPeriodDate(periodType, referenceDay);
        const key = combinedReportJobKey(userId, periodType, periodDate);
        expect(key).toBe(`report:${userId}:${periodType}:${periodDate}`);
        // Re-deriving from the same reference produces the identical key.
        const periodDate2 = resolveReportPeriodDate(periodType, referenceDay);
        expect(combinedReportJobKey(userId, periodType, periodDate2)).toBe(key);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects a malformed referenceDay", () => {
    fc.assert(
      fc.property(
        periodTypeArb,
        fc.constantFrom("", "  ", "2024-13-01", "2024-02-31", "not-a-date", "20240101"),
        (periodType, bad) => {
          expect(() => resolveReportPeriodDate(periodType, bad)).toThrow();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NOTE (task 8.2): append the enqueue-idempotency (pg-mem) half of Property 6
// below this line — `enqueueJob` over `pg-mem` yielding at most one row + one
// side effect across retries, duplicate enqueue returning the existing id as a
// success ack, and missing/empty `jobKey` rejected at the enqueue boundary.
// ─────────────────────────────────────────────────────────────────────────────

// Feature: agentic-home, Property 6: Enqueue by `jobKey` yields at most one job row and at most one external side effect across retries; a missing or empty `jobKey` is rejected.
//
// **Validates: Requirements 4.1, 4.3, 10.2, 10.3, 10.4, 10.5, 10.6**
//
// ─────────────────────────────────────────────────────────────────────────────
// SCOPE OF THIS SECTION (task 8.2): the ENQUEUE-HALF of Property 6 — the real
// `enqueueJob` spine driven over an in-memory Postgres (`pg-mem` + migration
// 0029, so the real `jobs`/`events` tables exist with their true shapes and the
// unique `job_key` constraint). It complements the key-half above (the pure
// `jobkey.ts` derivation) by exercising what the derivation MAKES POSSIBLE:
//
//   1. At most one row across retries (Req 4.3, 10.3): enqueuing the SAME
//      derived `jobKey` N times collapses — via `ON CONFLICT (job_key) DO
//      NOTHING` — to exactly ONE `jobs` row.
//   2. At most one external side effect across retries (Req 10.5): with the row
//      collapsed to one, driving `runJob` repeatedly (the retry path) fires the
//      job handler — the modelled external side effect — AT MOST ONCE, because
//      the spine's atomic claim + terminal-state no-op admit a single execution.
//   3. Duplicate enqueue is a success ack (Req 10.4): each repeat returns the
//      EXISTING job id, never an error.
//   4. Distinct logical jobs stay distinct (Req 10.3): different derived keys
//      yield different rows.
//   5. Missing/empty `jobKey` rejected (Req 10.6): the realistic enqueue
//      boundary derives the key first (`combinedReportJobKey`/`briefingJobKey`),
//      so an empty/whitespace component throws BEFORE `enqueueJob` runs — no row
//      is inserted and the caller sees an error.
//
// The external side effect is modelled exactly as the sibling job-spine tests
// model it: a counting job handler invoked through `runJob`. (We deliberately do
// NOT count `job.queued` events — pg-mem's `onConflictDoNothing().returning()`
// returns a row on conflict where real Postgres returns none, which would let a
// duplicate enqueue re-publish `job.queued`; the at-most-once guarantee that
// matters is over the actual handler side effect, which the atomic claim bounds
// regardless of that pg-mem infidelity.)
//
// Harness mirrors `lib/cms/jobs/side-effect-idempotency.test.ts`.
// ─────────────────────────────────────────────────────────────────────────────

// Migration 0029 ALTERs pre-existing ai_* tables; create minimal stubs first
// (mirrors the sibling job-spine pg-mem tests).
const PREREQUISITE_SQL = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_appointments" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_conversations" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_messages" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
`;

// Read + split the migration once at module load (parsed fresh per pg-mem db).
const MIGRATION_STATEMENTS = readFileSync(
  join(process.cwd(), "drizzle", "0029_demonic_mandrill.sql"),
  "utf-8",
)
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

/** Build a fresh in-memory Postgres with the real `jobs`/`events` tables. */
function buildDb(): { mem: IMemoryDb; db: Database } {
  const mem = newDb();

  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });
  mem.public.registerFunction({
    name: "pg_notify",
    args: [DataType.text, DataType.text],
    returns: DataType.text,
    implementation: () => "",
  });

  mem.public.none(PREREQUISITE_SQL);
  for (const stmt of MIGRATION_STATEMENTS) {
    mem.public.none(stmt);
  }

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem doesn't honour node-postgres `rowMode: "array"`; shim it (mirrors the
  // sibling harness) so drizzle's `.returning()` reads back correctly.
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

/**
 * The realistic Combined_Report enqueue boundary (Design §Components #5): derive
 * the `jobKey` from the pure `jobkey.ts` function, THEN enqueue exactly one job.
 * An empty/whitespace component throws at derivation, so `enqueueJob` is never
 * reached and no row is inserted (Requirement 10.6).
 */
async function enqueueCombinedReport(
  db: Database,
  userId: string,
  periodType: ReportPeriodType,
  periodDate: string,
): Promise<string> {
  const jobKey = combinedReportJobKey(userId, periodType, periodDate);
  return enqueueJob(
    db,
    "compile_and_email_report",
    { userId, periodType, periodDate },
    jobKey,
  );
}

/**
 * A job handler registry whose handlers COUNT every invocation — the modelled
 * external side effect. Every {@link JobHandler} increments the shared counter,
 * so "the side effect happened at most once" is exactly "the counter never
 * exceeds 1" across any number of `runJob` retries (Requirement 10.5).
 */
function makeCountingRegistry(): {
  registry: JobHandlerRegistry;
  sideEffects: () => number;
} {
  let count = 0;
  const counting: JobHandler = async () => {
    count += 1;
  };
  const registry: JobHandlerRegistry = {
    post_call_processing: counting,
    compile_and_email_report: counting,
    morning_briefing: counting,
    send_whatsapp_brief: counting,
    lead_nudge: counting,
    briefing_assembly: counting,
  };
  return { registry, sideEffects: () => count };
}

// ──────────────────────────────────────────────────────────────────────────────
// Property 6 — enqueue-half: at most one row + one side effect across retries
// ──────────────────────────────────────────────────────────────────────────────

describe("Feature: agentic-home, Property 6: Idempotency by jobKey (enqueue-half — pg-mem)", () => {
  it("enqueuing the same derived jobKey N times yields exactly one row, returns the existing id on every duplicate, and produces at most one side effect across runJob retries", async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        periodTypeArb,
        periodDateArb,
        fc.integer({ min: 1, max: 6 }), // number of (retried) enqueues
        fc.integer({ min: 1, max: 4 }), // number of (retried) runs
        async (userId, periodType, periodDate, enqueues, runs) => {
          const { db } = buildDb();
          const { registry, sideEffects } = makeCountingRegistry();
          const jobKey = combinedReportJobKey(userId, periodType, periodDate);

          const ids: string[] = [];
          for (let i = 0; i < enqueues; i++) {
            // A retried enqueue returns the existing id as a success ack — no throw.
            ids.push(await enqueueCombinedReport(db, userId, periodType, periodDate));
          }

          // Duplicate enqueue returns the EXISTING job id (Req 10.4).
          for (const id of ids) {
            expect(id).toBe(ids[0]);
          }

          // Exactly ONE job row for the key (Req 4.3, 10.3).
          const rows = await db
            .select({ id: jobsTable.id })
            .from(jobsTable)
            .where(eq(jobsTable.jobKey, jobKey));
          expect(rows).toHaveLength(1);
          expect(rows[0].id).toBe(ids[0]);

          // At most one external side effect across all retries (Req 10.5): the
          // spine's atomic claim admits a single execution however many times the
          // job is re-run.
          for (let i = 0; i < runs; i++) {
            await runJob(db, ids[0], registry);
          }
          expect(sideEffects()).toBe(1);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("distinct logical jobs never collapse into one row (different keys → different rows)", async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        userIdArb,
        periodTypeArb,
        periodTypeArb,
        periodDateArb,
        periodDateArb,
        async (userA, userB, typeA, typeB, dateA, dateB) => {
          const { db } = buildDb();

          const keyA = combinedReportJobKey(userA, typeA, dateA);
          const keyB = combinedReportJobKey(userB, typeB, dateB);
          const sameLogicalJob = keyA === keyB;

          const idA = await enqueueCombinedReport(db, userA, typeA, dateA);
          const idB = await enqueueCombinedReport(db, userB, typeB, dateB);

          const allRows = await db.select({ id: jobsTable.id }).from(jobsTable);
          if (sameLogicalJob) {
            // Same derived key → one row, same id (Req 10.3, 10.4).
            expect(idB).toBe(idA);
            expect(allRows).toHaveLength(1);
          } else {
            // Distinct keys → two distinct rows.
            expect(idB).not.toBe(idA);
            expect(allRows).toHaveLength(2);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("briefing-keyed enqueues are idempotent too (one row, at most one side effect per derived briefing key)", async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        windowArb,
        periodDateArb,
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 3 }),
        async (userId, window, periodDate, enqueues, runs) => {
          const { db } = buildDb();
          const { registry, sideEffects } = makeCountingRegistry();
          const jobKey = briefingJobKey(userId, window, periodDate);

          const ids: string[] = [];
          for (let i = 0; i < enqueues; i++) {
            ids.push(
              await enqueueJob(
                db,
                "morning_briefing",
                { userId, window, periodDate },
                jobKey,
              ),
            );
          }

          for (const id of ids) {
            expect(id).toBe(ids[0]);
          }

          const rows = await db
            .select({ id: jobsTable.id })
            .from(jobsTable)
            .where(eq(jobsTable.jobKey, jobKey));
          expect(rows).toHaveLength(1);

          for (let i = 0; i < runs; i++) {
            await runJob(db, ids[0], registry);
          }
          expect(sideEffects()).toBe(1);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Property 6 — enqueue-half: missing/empty jobKey rejected, no row inserted (Req 10.6)
// ──────────────────────────────────────────────────────────────────────────────

describe("Feature: agentic-home, Property 6: Idempotency by jobKey (enqueue-half — empty jobKey rejected)", () => {
  it("an enqueue whose userId component is empty/whitespace is rejected and inserts no row", async () => {
    await fc.assert(
      fc.asyncProperty(
        emptyComponentArb,
        periodTypeArb,
        periodDateArb,
        async (badUser, periodType, periodDate) => {
          const { db } = buildDb();
          // The enqueue boundary derives the key first; an empty component
          // throws before `enqueueJob` runs (Req 10.6).
          await expect(
            enqueueCombinedReport(db, badUser, periodType, periodDate),
          ).rejects.toThrow();
          const rows = await db.select({ id: jobsTable.id }).from(jobsTable);
          expect(rows).toHaveLength(0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("an enqueue whose periodDate component is empty/whitespace is rejected and inserts no row", async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        periodTypeArb,
        emptyComponentArb,
        async (userId, periodType, badDate) => {
          const { db } = buildDb();
          await expect(
            enqueueCombinedReport(db, userId, periodType, badDate),
          ).rejects.toThrow();
          const rows = await db.select({ id: jobsTable.id }).from(jobsTable);
          expect(rows).toHaveLength(0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
