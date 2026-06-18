import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, like } from "drizzle-orm";

/**
 * Unit sanity tests for the nudge sweep workflow (task 6.3).
 *
 * Drives the REAL `runNudgeSweep` against the REAL `leads_mirror` / `jobs` /
 * `events` tables under an in-memory Postgres (pg-mem), asserting the sweep's
 * contract from Design §Components #7 / Req 10.1–10.4:
 *   - a stale OWNED Lead → exactly one `lead_nudge` job enqueued (Req 10.2/10.3);
 *   - a fresh OWNED Lead → no job (the `isStale` guardrail, Req 11.5);
 *   - a stale UNOWNED Lead → no job, one `lead.nudge.suppressed` (`unowned_stale`)
 *     indication carrying no raw phone (Req 10.4 / 13);
 *   - re-running the sweep in the same window enqueues no second job for the
 *     same occasion (idempotent by `nudgeJobKey`, Req 11.1);
 *   - the sweep itself emits NO `lead.nudged` (that is the handler's, on
 *     delivery — see the design decision in the workflow module).
 *
 * pg-mem harness mirrors `lib/cms/jobs/lead-nudge.test.ts`: migration 0029 is
 * applied so the true `parties` / `reps` / `leads_mirror` / `jobs` / `events`
 * shapes (and the unique `job_key` constraint) exist.
 */

import * as schema from "../../schema";
import {
  parties,
  leadsMirror,
  reps,
  jobs as jobsTable,
  events as eventsTable,
} from "../../schema";
import type { Database } from "../../db";
import { runNudgeSweep } from "./lead-nudge";
import { DEFAULT_NUDGE_POLICY, nudgeJobKey } from "../../leads/nudge";

const MIGRATION_FILE = "0029_demonic_mandrill.sql";

const PREREQUISITE_SQL = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_appointments" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_conversations" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_messages" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
`;

function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

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

  const migrationSql = readFileSync(
    join(process.cwd(), "drizzle", MIGRATION_FILE),
    "utf-8"
  );
  for (const stmt of splitStatements(migrationSql)) {
    mem.public.none(stmt);
  }

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

const REP_PHONE = "+971500000009";

/** Seed one rep and return its id. */
async function seedRep(db: Database): Promise<string> {
  const [rep] = await db
    .insert(reps)
    .values({
      name: "Aisha",
      languages: ["en"],
      projects: ["Bayn"],
      capacity: 3,
      openHotCount: 0,
      phone: REP_PHONE,
    })
    .returning({ id: reps.id });
  return rep.id;
}

/** Seed a Lead with the given owner + last-interaction timing. */
async function seedLead(
  db: Database,
  opts: { repId: string | null; lastInteractionHoursAgo: number | null }
): Promise<string> {
  const [party] = await db
    .insert(parties)
    .values({ type: "person", name: "Lina", language: "en" })
    .returning({ id: parties.id });

  const lastInteractionAt =
    opts.lastInteractionHoursAgo === null
      ? null
      : new Date(Date.now() - opts.lastInteractionHoursAgo * 3600_000);

  await db.insert(leadsMirror).values({
    partyId: party.id,
    tier: "HOT",
    projectInterest: "Bayn",
    lastInteractionAt,
    assignedRepId: opts.repId,
  });

  return party.id;
}

async function jobsForLead(db: Database, partyId: string) {
  return db
    .select({ id: jobsTable.id, jobKey: jobsTable.jobKey })
    .from(jobsTable)
    .where(
      and(
        eq(jobsTable.kind, "lead_nudge"),
        like(jobsTable.jobKey, `nudge:stale:${partyId}:%`)
      )
    );
}

async function eventsOfType(db: Database, type: string) {
  return db
    .select({ payload: eventsTable.payload })
    .from(eventsTable)
    .where(eq(eventsTable.type, type));
}

describe("runNudgeSweep (task 6.3)", () => {
  let db: Database;
  beforeEach(() => {
    ({ db } = buildDb());
  });

  it("enqueues exactly one lead_nudge job for a stale OWNED lead (Req 10.2/10.3)", async () => {
    const repId = await seedRep(db);
    const partyId = await seedLead(db, { repId, lastInteractionHoursAgo: 48 });
    const now = new Date();

    const result = await runNudgeSweep(db, { now });

    expect(result.enqueued).toBe(1);
    expect(result.unowned).toBe(0);

    const queued = await jobsForLead(db, partyId);
    expect(queued).toHaveLength(1);
    expect(queued[0].jobKey).toBe(
      nudgeJobKey(partyId, "stale", now, DEFAULT_NUDGE_POLICY)
    );
  });

  it("does NOT enqueue for a FRESH owned lead (isStale guardrail, Req 11.5)", async () => {
    const repId = await seedRep(db);
    const partyId = await seedLead(db, { repId, lastInteractionHoursAgo: 1 });

    const result = await runNudgeSweep(db, { now: new Date() });

    expect(result.enqueued).toBe(0);
    expect(await jobsForLead(db, partyId)).toHaveLength(0);
  });

  it("records an unowned-stale indication (no phone, no job) for a stale UNOWNED lead (Req 10.4)", async () => {
    const partyId = await seedLead(db, {
      repId: null,
      lastInteractionHoursAgo: 48,
    });

    const result = await runNudgeSweep(db, { now: new Date() });

    expect(result.unowned).toBe(1);
    expect(result.enqueued).toBe(0);
    expect(await jobsForLead(db, partyId)).toHaveLength(0);

    const suppressed = await eventsOfType(db, "lead.nudge.suppressed");
    expect(suppressed).toHaveLength(1);
    expect((suppressed[0].payload as { reason: string }).reason).toBe(
      "unowned_stale"
    );

    // The sweep emits NO lead.nudged (that belongs to the handler on delivery).
    expect(await eventsOfType(db, "lead.nudged")).toHaveLength(0);

    // PRIVACY: no raw phone anywhere in any event payload (Req 13.2).
    const allEvents = await db
      .select({ payload: eventsTable.payload })
      .from(eventsTable);
    expect(JSON.stringify(allEvents)).not.toContain(REP_PHONE);
  });

  it("is idempotent within a window: a second sweep enqueues no duplicate job (Req 11.1)", async () => {
    const repId = await seedRep(db);
    const partyId = await seedLead(db, { repId, lastInteractionHoursAgo: 48 });
    const now = new Date();

    await runNudgeSweep(db, { now });
    // Same window (same `now`) → the occasion jobKey collapses on conflict.
    await runNudgeSweep(db, { now });

    expect(await jobsForLead(db, partyId)).toHaveLength(1);
  });
});
