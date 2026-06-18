import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/pg-proxy";
import { eq } from "drizzle-orm";
import fc from "fast-check";

import * as schema from "../schema";
import { sfOutbox, parties, leadsMirror, partyIdentities } from "../schema";
import { enqueueOutbox, drainOnce, type OutboxKind } from "./index";
import type { Database } from "../db";
import { SfHttpError, type SalesforceAdapter } from "../tickets/crm/salesforce";

/**
 * Property test for at-most-one-Salesforce-record-per-jobKey ACROSS transient
 * failures and retries (task 4.3). This is the non-optional CC-Idem boundary
 * test for the outbox spine after the Case shim was replaced by the
 * Object_Router (`object-router.ts`) driving a `SalesforceObjectClient`.
 *
 * **Feature: salesforce-lead-core, Property 1: For any sequence of enqueues and
 * drains of a given jobKey (including transient failures and retries), exactly
 * one Salesforce create occurs and all further deliveries reconcile and
 * update.**
 *
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
 *
 * Harness mirrors `lib/cms/outbox/drain.integration.test.ts` and
 * `lib/cms/outbox/jobkey-idempotency.property.test.ts`: migration 0029 is
 * applied statement-by-statement over an in-memory Postgres (pg-mem) so the
 * real `sf_outbox`, `parties`, `party_identities`, and `leads_mirror` tables
 * exist with their true column shapes, the unique `job_key` constraint, and the
 * `leads_mirror`/`party_identities` foreign keys to `parties`. A pg-proxy
 * Drizzle handle runs `enqueueOutbox` and `drainOnce` against genuine SQL
 * (`ON CONFLICT (job_key) DO NOTHING`, the `leads_mirror` upsert).
 *
 * pg-mem ships neither `gen_random_uuid()` (column DEFAULTs) nor `pg_notify`
 * (issued by `publishEvent` inside `drainOnce`), so both are registered as
 * uuid/no-op stubs. A BEGIN/COMMIT/ROLLBACK shim is layered over the single
 * connection because `publishEvent` wraps its insert + NOTIFY in
 * `db.transaction`, which the pg-proxy driver does not provide out of the box.
 *
 * TRANSIENT FAILURES + RETRIES. The fake `SalesforceAdapter` exposes only the
 * `requestJson` transport the `SalesforceObjectClient` actually calls and counts
 * every Salesforce CREATE (POST) and UPDATE (PATCH). It can be configured, per
 * jobKey, to fail transiently (an HTTP 503 `SfHttpError`, `transient = true`)
 * so the retry paths are exercised in two distinct ways:
 *
 *   - "leadTransient" — the Lead CREATE itself throws transiently the first few
 *     times, recovering WITHIN one `withRetry` group (Requirement 1.7). Exactly
 *     one Lead is ever created.
 *
 *   - "contactCrossDrain" — the Lead CREATE succeeds and its id is mirrored into
 *     `leads_mirror`, but the associated Contact CREATE then fails for a whole
 *     `withRetry` group, so the whole route throws and the outbox row stays
 *     `pending`. On the NEXT drain the Object_Router reconciles against the
 *     Party's mirrored `leads_mirror.sf_lead_id` and issues a Lead UPDATE
 *     (PATCH) rather than a second Lead CREATE — the core reconciliation
 *     guarantee (Requirement 5.4).
 *
 * NOTE on `withRetry` sleeps: a transient error is retried by `withRetry` with
 * exponential backoff (1s/2s/4s). We stub `setTimeout` to fire on the next tick
 * for the duration of this file so those retries do not incur real waits — a
 * test-only fast-forward of the retry clock.
 *
 * NOTE on backoff: a failed outbox row stays `pending` but is only re-attempted
 * once it has waited out `backoffMs(attempts)` since its `updatedAt`. To drive a
 * cross-drain reconciliation without real waits we backdate `updated_at` far
 * into the past between drains (as the sibling tests do).
 */

/** fast-check budget — the design mandates ≥100 iterations for each property. */
const NUM_RUNS = 100;
const MAX_SEQUENCE = 10;

/** Bound on the settle loop that drains everything pending to completion. */
const MAX_SETTLE_PASSES = 12;

const MIGRATION_FILE = "0029_demonic_mandrill.sql";

/** A small pool of jobKeys so duplicate enqueues (the idempotency case) recur. */
const JOB_KEY_POOL = ["jk-1", "jk-2", "jk-3"] as const;
type PoolJobKey = (typeof JOB_KEY_POOL)[number];

/** Per-jobKey transient-failure scenario assigned for a run. */
type Scenario = "clean" | "leadTransient" | "contactCrossDrain";

// Pre-existing tables migration 0029 ALTERs / references (FK targets).
const PREREQUISITE_SQL = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_appointments" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_conversations" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_messages" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
`;

/** Split a Drizzle migration into individual statements. */
function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Read + parse the migration once; applying it per-run is the per-iteration cost.
const MIGRATION_STATEMENTS = splitStatements(
  readFileSync(join(process.cwd(), "drizzle", MIGRATION_FILE), "utf-8")
);

// ── withRetry fast-forward ────────────────────────────────────────────────────
//
// `withRetry` sleeps with exponential backoff between transient retries. Stub
// `setTimeout` so the sleep fires on the next tick (delay ignored) — transient
// retries are exercised for real, just without wall-clock waits.
let realSetTimeout: typeof setTimeout;
beforeAll(() => {
  realSetTimeout = globalThis.setTimeout;
  vi.stubGlobal("setTimeout", ((fn: (...args: unknown[]) => void) =>
    realSetTimeout(fn, 0)) as unknown as typeof setTimeout);
});
afterAll(() => {
  vi.unstubAllGlobals();
});

/**
 * Stand up a fresh in-memory Postgres with migration 0029 applied and return a
 * Drizzle handle bound to it, with a real transaction over the single
 * connection so `publishEvent` (insert + NOTIFY) runs inside `drainOnce`.
 */
function buildDb(): { db: Database; mem: IMemoryDb } {
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
  for (const stmt of MIGRATION_STATEMENTS) {
    mem.public.none(stmt);
  }

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

  const db = drizzle(executor as never, { schema }) as unknown as Database;

  (db as unknown as { transaction: unknown }).transaction = async (
    fn: (tx: Database) => Promise<unknown>
  ) => {
    await executor("BEGIN", [], "execute");
    try {
      const result = await fn(db);
      await executor("COMMIT", [], "execute");
      return result;
    } catch (err) {
      await executor("ROLLBACK", [], "execute");
      throw err;
    }
  };

  return { db, mem };
}

// ── Counting + transient fake Salesforce adapter ──────────────────────────────

interface SfCall {
  method: string;
  path: string;
  email: string;
}

/**
 * A fake `SalesforceAdapter` exposing only the `requestJson` transport the
 * `SalesforceObjectClient` (driven by the Object_Router inside `drainOnce`)
 * calls. It records every call and supports a per-email transient-failure
 * schedule so the retry/reconcile paths can be exercised:
 *
 *   - `leadTransientFails[email]` — the number of times the Lead CREATE for that
 *     email should throw a transient 503 before succeeding. With a value < the
 *     `withRetry` attempt budget the create recovers within one drain pass
 *     (Req 1.7) and still creates exactly one Lead.
 *
 *   - `contactFailFirstGroup` — emails whose Contact CREATE should fail for a
 *     whole `withRetry` group (so the route throws AFTER the Lead was created
 *     and mirrored), forcing a cross-drain Lead reconciliation (Req 5.4).
 *
 * A correlation `email` is read from the request body's mapped `Email` field
 * (every Lead/Contact write here carries one) so creates can be attributed back
 * to their originating jobKey.
 */
function makeTransientAdapter() {
  const calls: SfCall[] = [];
  /** Only SUCCESSFUL Lead creates (a failed transient POST creates nothing). */
  const leadCreateSuccesses: Array<{ email: string; id: string }> = [];
  let seq = 0;

  const leadTransientFails = new Map<string, number>();
  const contactFailFirstGroup = new Set<string>();
  const contactPostCount = new Map<string, number>();

  // The `withRetry` budget is MAX_RETRIES(3) + 1 = 4 attempts. Failing this many
  // contact POSTs exhausts one whole group so the route throws on that drain.
  const WITH_RETRY_ATTEMPTS = 4;

  const adapter = {
    name: "transient-fake-salesforce",
    async requestJson<T>(
      method: string,
      path: string,
      body?: Record<string, unknown>
    ): Promise<T> {
      const email = typeof body?.Email === "string" ? body.Email : "";
      calls.push({ method, path, email });

      const isLead = path.endsWith("/Lead");
      const isContact = path.endsWith("/Contact");

      if (method === "POST") {
        if (isLead) {
          const remaining = leadTransientFails.get(email) ?? 0;
          if (remaining > 0) {
            leadTransientFails.set(email, remaining - 1);
            throw new SfHttpError("transient 503 (lead create)", 503, true);
          }
          seq += 1;
          const id = `sf-lead-${seq}`;
          leadCreateSuccesses.push({ email, id });
          return { id, success: true, errors: [] } as T;
        }

        if (isContact) {
          const count = (contactPostCount.get(email) ?? 0) + 1;
          contactPostCount.set(email, count);
          if (contactFailFirstGroup.has(email) && count <= WITH_RETRY_ATTEMPTS) {
            throw new SfHttpError("transient 503 (contact create)", 503, true);
          }
          seq += 1;
          return { id: `sf-contact-${seq}`, success: true, errors: [] } as T;
        }

        // Any other object create (none generated here) — succeed generically.
        seq += 1;
        return { id: `sf-${seq}`, success: true, errors: [] } as T;
      }

      if (method === "PATCH") {
        // Update → 204 No Content. Always succeeds in this harness.
        return {} as T;
      }

      throw new Error(`unexpected Salesforce ${method} ${path}`);
    },
  };

  const leadEmail = (jobKey: string) => `${jobKey}@lead.test`;
  const contactEmail = (jobKey: string) => `${jobKey}@contact.test`;

  return {
    adapter: adapter as unknown as SalesforceAdapter,
    calls,
    /** The ids of every SUCCESSFUL Lead create. */
    get createdLeadIds(): string[] {
      return leadCreateSuccesses.map((c) => c.id);
    },
    leadEmail,
    contactEmail,
    /** Configure the failure schedule for a jobKey's chosen scenario. */
    configure(jobKey: string, scenario: Scenario) {
      if (scenario === "leadTransient") {
        // Fail twice then succeed — recovers within the first withRetry group.
        leadTransientFails.set(leadEmail(jobKey), 2);
      } else if (scenario === "contactCrossDrain") {
        // Lead create succeeds + mirrors; contact create fails a whole group.
        contactFailFirstGroup.add(contactEmail(jobKey));
      }
    },
    /** SUCCESSFUL Lead creates, optionally filtered to one correlation email. */
    leadCreates(email?: string): Array<{ email: string; id: string }> {
      return leadCreateSuccesses.filter(
        (c) => email === undefined || c.email === email
      );
    },
    /** Lead UPDATE (PATCH) calls, optionally filtered to a Lead id in the path. */
    leadUpdates(): SfCall[] {
      return calls.filter(
        (c) => c.method === "PATCH" && c.path.includes("/Lead/")
      );
    },
    /** Any call whose path targets a Salesforce Case (must never happen). */
    caseCalls(): SfCall[] {
      return calls.filter((c) => c.path.includes("/Case"));
    },
  };
}

// ── DB helpers ────────────────────────────────────────────────────────────────

/** Create a `parties` row and return its generated id. */
async function createParty(db: Database): Promise<string> {
  const [row] = await db
    .insert(parties)
    .values({ type: "person", language: "en" })
    .returning({ id: parties.id });
  return row.id;
}

/** Backdate every pending outbox row so the next drain skips its backoff window. */
async function backdatePending(db: Database): Promise<void> {
  await db
    .update(sfOutbox)
    .set({ updatedAt: new Date(0) })
    .where(eq(sfOutbox.status, "pending"));
}

/** Number of rows still pending delivery. */
async function pendingCount(db: Database): Promise<number> {
  const rows = await db
    .select({ id: sfOutbox.id })
    .from(sfOutbox)
    .where(eq(sfOutbox.status, "pending"));
  return rows.length;
}

// ── The property ──────────────────────────────────────────────────────────────

describe("Outbox + Object_Router — Property 1: at most one SF create per jobKey across transient failures and retries (Req 5.1–5.4)", () => {
  it("creates exactly one Salesforce Lead per jobKey and reconciles every later delivery to an update, regardless of duplicate enqueues, transient failures, and retries", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          // An interleaved sequence of (often duplicated) enqueues and drains
          // over a small jobKey pool — duplicate jobKeys and repeated drains are
          // exactly what could double-create if the spine weren't at-most-once.
          ops: fc.array(
            fc.oneof(
              fc.record({
                op: fc.constant("enqueue" as const),
                jobKey: fc.constantFrom(...JOB_KEY_POOL),
              }),
              fc.record({ op: fc.constant("drain" as const) })
            ),
            { minLength: 1, maxLength: MAX_SEQUENCE }
          ),
          // Each jobKey's transient-failure scenario for this run.
          scenarios: fc.record({
            "jk-1": fc.constantFrom<Scenario>(
              "clean",
              "leadTransient",
              "contactCrossDrain"
            ),
            "jk-2": fc.constantFrom<Scenario>(
              "clean",
              "leadTransient",
              "contactCrossDrain"
            ),
            "jk-3": fc.constantFrom<Scenario>(
              "clean",
              "leadTransient",
              "contactCrossDrain"
            ),
          }),
        }),
        async ({ ops, scenarios }) => {
          const { db } = buildDb();
          const fake = makeTransientAdapter();

          // A real Party per pool jobKey so the lead_upsert reconciliation path
          // (leads_mirror / party_identities FKs → parties) is satisfied.
          const partyIdByKey = new Map<PoolJobKey, string>();
          for (const jobKey of JOB_KEY_POOL) {
            partyIdByKey.set(jobKey, await createParty(db));
            fake.configure(jobKey, scenarios[jobKey]);
          }

          // The payload for a jobKey: a lead_upsert carrying its Party id (drives
          // reconciliation) plus a nested contact (drives the cross-drain path).
          const payloadFor = (jobKey: PoolJobKey) => ({
            partyId: partyIdByKey.get(jobKey),
            email: fake.leadEmail(jobKey),
            firstName: "Ada",
            lastName: jobKey,
            company: "DOE",
            contact: {
              email: fake.contactEmail(jobKey),
              firstName: "Ada",
              lastName: jobKey,
            },
          });

          // (a) Replay the random op sequence. Re-enqueuing a known jobKey MUST
          //     return the same row id (ON CONFLICT (job_key) DO NOTHING).
          const idByKey = new Map<PoolJobKey, string>();
          const enqueuedKeys = new Set<PoolJobKey>();

          for (const operation of ops) {
            if (operation.op === "enqueue") {
              const jobKey = operation.jobKey;
              const id = await enqueueOutbox(
                db,
                "lead_upsert" as OutboxKind,
                payloadFor(jobKey),
                jobKey
              );
              enqueuedKeys.add(jobKey);
              const seen = idByKey.get(jobKey);
              if (seen !== undefined) expect(id).toBe(seen);
              else idByKey.set(jobKey, id);
            } else {
              await drainOnce(db, fake.adapter);
            }
          }

          // (b) Settle: drain to completion, backdating between passes so any
          //     row inside its backoff window (e.g. a cross-drain retry) becomes
          //     eligible. Bounded so a stuck row fails the test rather than hangs.
          for (let pass = 0; pass < MAX_SETTLE_PASSES; pass++) {
            if ((await pendingCount(db)) === 0) break;
            await backdatePending(db);
            await drainOnce(db, fake.adapter);
          }

          // (c) At most one sf_outbox row per jobKey (idempotent enqueue —
          //     Req 5.1, 5.2), and every enqueued row is delivered (`sent`).
          for (const jobKey of enqueuedKeys) {
            const rows = await db
              .select({ id: sfOutbox.id, status: sfOutbox.status, sfId: sfOutbox.sfId })
              .from(sfOutbox)
              .where(eq(sfOutbox.jobKey, jobKey));
            expect(rows).toHaveLength(1);
            expect(rows[0].id).toBe(idByKey.get(jobKey));
            expect(rows[0].status).toBe("sent");
            expect(rows[0].sfId).not.toBeNull();
          }

          // (d) No path EVER routes to a Salesforce Case (the shim is gone).
          expect(fake.caseCalls()).toHaveLength(0);

          // (e) THE CORE PROPERTY (Req 5.3): exactly one Lead CREATE per jobKey,
          //     no matter how many enqueues / drains / transient retries
          //     occurred. Counting only successful creates — failed transient
          //     POSTs threw and created nothing.
          expect(fake.leadCreates()).toHaveLength(enqueuedKeys.size);
          expect(new Set(fake.createdLeadIds).size).toBe(
            fake.createdLeadIds.length
          );
          for (const jobKey of enqueuedKeys) {
            expect(fake.leadCreates(fake.leadEmail(jobKey))).toHaveLength(1);
          }

          // (f) RECONCILIATION (Req 5.4): every enqueued Party ends with exactly
          //     one leads_mirror row whose sf_lead_id is the one created Lead id.
          const mirrorRows = await db
            .select({ partyId: leadsMirror.partyId, sfLeadId: leadsMirror.sfLeadId })
            .from(leadsMirror);
          expect(mirrorRows).toHaveLength(enqueuedKeys.size);
          const mirroredIds = new Set<string>();
          for (const jobKey of enqueuedKeys) {
            const partyId = partyIdByKey.get(jobKey)!;
            const mirror = mirrorRows.find((m) => m.partyId === partyId);
            expect(mirror).toBeDefined();
            expect(mirror!.sfLeadId).not.toBeNull();
            mirroredIds.add(mirror!.sfLeadId as string);
          }
          // The mirrored ids are exactly the created Lead ids — one per jobKey.
          expect(mirroredIds).toEqual(new Set(fake.createdLeadIds));

          // (g) Exactly one sf_lead_id identity row per enqueued Party — the
          //     mirror linkage is laid down once, on the single create.
          for (const jobKey of enqueuedKeys) {
            const partyId = partyIdByKey.get(jobKey)!;
            const idRows = await db
              .select({ kind: partyIdentities.kind, value: partyIdentities.value })
              .from(partyIdentities)
              .where(eq(partyIdentities.partyId, partyId));
            expect(idRows).toHaveLength(1);
            expect(idRows[0].kind).toBe("sf_lead_id");
          }

          // (h) The "all further deliveries reconcile and UPDATE" half of the
          //     property (Req 5.4): any jobKey forced to retry AFTER its Lead was
          //     created + mirrored issued a Lead UPDATE (PATCH), never a second
          //     CREATE.
          const crossDrainKeys = [...enqueuedKeys].filter(
            (k) => scenarios[k] === "contactCrossDrain"
          );
          if (crossDrainKeys.length > 0) {
            expect(fake.leadUpdates().length).toBeGreaterThanOrEqual(
              crossDrainKeys.length
            );
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
