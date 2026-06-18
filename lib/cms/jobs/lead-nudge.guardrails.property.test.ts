import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

/**
 * Property test for the nudge guardrails (task 6.5).
 *
 * **Feature: lead-engine, Property 9: No more than the configured maximum
 * nudges per lead per window, and no stale-lead nudge while an interaction
 * newer than the threshold exists.**
 *
 * **Validates: Requirements 11.3, 11.5**
 *
 * Drives the REAL `lead_nudge` handler THROUGH THE JOB SPINE (`enqueueJob` +
 * `runJob`) over an in-memory Postgres (pg-mem + migration 0029), with a
 * counting `ChannelAdapter`, exactly as the sibling sanity test
 * (`lib/cms/jobs/lead-nudge.test.ts`) does. Two parts:
 *
 *  1. RATE CAP (Req 11.3) — for an arbitrary sequence of nudge occasions for one
 *     stale lead inside a single rolling window, the number of DELIVERED nudges
 *     never exceeds `policy.maxPerWindow`. Checked under `DEFAULT_NUDGE_POLICY`
 *     (maxPerWindow = 1) and under a generated policy (maxPerWindow ∈ 1..3).
 *
 *  2. FRESHNESS (Req 11.5) — a lead whose `lastInteractionAt` is newer than
 *     `policy.stalenessMs` gets NO stale-lead nudge (send count 0) and a
 *     `lead.nudge.suppressed` (reason `fresh_interaction`) is recorded; a
 *     genuinely stale lead within cap delivers exactly one.
 *
 * Per an explicit user instruction this test must run FAST: a single
 * `NUM_RUNS` constant caps every `fc.assert`. Property 9 is NOT in the spec's
 * non-optional ≥100 set, so a reduced count is acceptable here — raise NUM_RUNS
 * for fuller coverage.
 */

import * as schema from "../schema";
import {
  parties,
  leadsMirror,
  reps,
  jobs as jobsTable,
  events as eventsTable,
} from "../schema";
import type { Database } from "../db";
import {
  enqueueJob,
  runJob,
  type JobHandlerRegistry,
  type JobHandler,
} from "./index";
import { createLeadNudgeHandler } from "./lead-nudge";
import {
  isStale,
  nudgeJobKey,
  DEFAULT_NUDGE_POLICY,
  type NudgePolicy,
} from "../leads/nudge";
import type { ChannelAdapter, ChannelMessage } from "./channel-adapter";

// Reduced iteration count to keep this suite fast (per explicit user
// instruction). Property 9 is not in the non-optional ≥100 set; raise this for
// fuller coverage.
const NUM_RUNS = 25;

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

/** A fake channel that counts and records every send. */
class CountingChannelAdapter implements ChannelAdapter {
  readonly provider = "fake";
  readonly sent: ChannelMessage[] = [];
  async send(message: ChannelMessage) {
    this.sent.push(message);
    return { messageId: `fake-${this.sent.length}`, provider: this.provider };
  }
}

const REP_PHONE = "+971500000009";

/** Seed a rep and an owned lead. `lastInteractionHoursAgo` shapes the timing. */
async function seedOwnedLead(
  db: Database,
  opts: { lastInteractionHoursAgo: number | null }
): Promise<{ repId: string; partyId: string }> {
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
    budgetBand: "2M-3M",
    lastInteractionSummary: "Keen on a 2-bed.",
    lastInteractionAt,
    assignedRepId: rep.id,
  });

  return { repId: rep.id, partyId: party.id };
}

function registryWith(adapter: ChannelAdapter, policy: NudgePolicy): JobHandlerRegistry {
  const noop: JobHandler = async () => {};
  return {
    post_call_processing: noop,
    compile_and_email_report: noop,
    morning_briefing: noop,
    send_whatsapp_brief: noop,
    lead_nudge: createLeadNudgeHandler(adapter, policy),
    briefing_assembly: noop,
  };
}

async function eventsOfType(db: Database, type: string) {
  return db
    .select({ payload: eventsTable.payload })
    .from(eventsTable)
    .where(eq(eventsTable.type, type));
}

describe("Feature: lead-engine, Property 9: No more than the configured maximum nudges per lead per window, and no stale-lead nudge while an interaction newer than the threshold exists.", () => {
  // ── Part 1: RATE CAP (Req 11.3) ───────────────────────────────────────────
  // For an arbitrary sequence of nudge occasions for one stale lead inside one
  // rolling window, delivered nudges never exceed `policy.maxPerWindow`. Each
  // occasion is a distinct job sharing the `nudge:{type}:{partyId}:` prefix the
  // handler counts; with `maxPerWindow = 1` (default) at most one is delivered.
  it("delivers no more than maxPerWindow nudges per lead in a single window (Req 11.3)", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Number of nudge occasions (runs) attempted for the same lead.
        fc.integer({ min: 1, max: 6 }),
        // The configured per-window cap (default policy uses 1; we also vary it).
        fc.integer({ min: 1, max: 3 }),
        async (occasions, maxPerWindow) => {
          const { db } = buildDb();
          const policy: NudgePolicy = { ...DEFAULT_NUDGE_POLICY, maxPerWindow };
          const adapter = new CountingChannelAdapter();
          const registry = registryWith(adapter, policy);

          // A genuinely stale lead (last interaction 48h ago > 24h threshold).
          const { partyId } = await seedOwnedLead(db, {
            lastInteractionHoursAgo: 48,
          });

          // Run `occasions` distinct nudge jobs, all sharing the lead+type
          // prefix the cap counts, all inside the one rolling window.
          for (let i = 0; i < occasions; i++) {
            const jobKey = `nudge:stale:${partyId}:occ-${i}`;
            const jobId = await enqueueJob(
              db,
              "lead_nudge",
              { partyId, type: "stale" },
              jobKey
            );
            await runJob(db, jobId, registry);
          }

          // The cap is never exceeded, and delivery saturates at min(N, cap).
          const delivered = adapter.sent.length;
          expect(delivered).toBeLessThanOrEqual(policy.maxPerWindow);
          expect(delivered).toBe(Math.min(occasions, policy.maxPerWindow));

          // Every delivered nudge produced exactly one `lead.nudged` event.
          const nudged = await eventsOfType(db, "lead.nudged");
          expect(nudged).toHaveLength(delivered);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // ── Part 2: FRESHNESS (Req 11.5) ──────────────────────────────────────────
  // A lead with an interaction newer than the staleness threshold is never
  // nudged; a genuinely stale lead within cap is nudged exactly once. The pure
  // `isStale` classifier agrees with the handler's observable behaviour.
  it("suppresses the nudge on a fresh interaction and nudges a stale lead exactly once (Req 11.5)", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Fresh: strictly newer than the 24h threshold (0..23h ago).
        fc.integer({ min: 0, max: 23 }),
        // Stale: strictly older than the 24h threshold (25..200h ago).
        fc.integer({ min: 25, max: 200 }),
        async (freshHoursAgo, staleHoursAgo) => {
          const policy = DEFAULT_NUDGE_POLICY;

          // FRESH lead → no nudge, one `fresh_interaction` suppression.
          {
            const { db } = buildDb();
            const adapter = new CountingChannelAdapter();
            const { partyId } = await seedOwnedLead(db, {
              lastInteractionHoursAgo: freshHoursAgo,
            });

            // The pure classifier marks this lead NOT stale.
            const now = new Date();
            expect(
              isStale(
                now,
                {
                  lastInteractionAt: new Date(
                    Date.now() - freshHoursAgo * 3600_000
                  ),
                  slaDueAt: null,
                },
                policy
              )
            ).toBe(false);

            const jobKey = nudgeJobKey(partyId, "stale", now, policy);
            const jobId = await enqueueJob(
              db,
              "lead_nudge",
              { partyId, type: "stale" },
              jobKey
            );
            await runJob(db, jobId, registryWith(adapter, policy));

            expect(adapter.sent).toHaveLength(0);
            const suppressed = await eventsOfType(db, "lead.nudge.suppressed");
            expect(suppressed).toHaveLength(1);
            expect((suppressed[0].payload as { reason: string }).reason).toBe(
              "fresh_interaction"
            );
            expect(await eventsOfType(db, "lead.nudged")).toHaveLength(0);
          }

          // STALE lead within cap → nudged exactly once.
          {
            const { db } = buildDb();
            const adapter = new CountingChannelAdapter();
            const { partyId } = await seedOwnedLead(db, {
              lastInteractionHoursAgo: staleHoursAgo,
            });

            const now = new Date();
            expect(
              isStale(
                now,
                {
                  lastInteractionAt: new Date(
                    Date.now() - staleHoursAgo * 3600_000
                  ),
                  slaDueAt: null,
                },
                policy
              )
            ).toBe(true);

            const jobKey = nudgeJobKey(partyId, "stale", now, policy);
            const jobId = await enqueueJob(
              db,
              "lead_nudge",
              { partyId, type: "stale" },
              jobKey
            );
            await runJob(db, jobId, registryWith(adapter, policy));

            expect(adapter.sent).toHaveLength(1);
            expect(await eventsOfType(db, "lead.nudged")).toHaveLength(1);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
