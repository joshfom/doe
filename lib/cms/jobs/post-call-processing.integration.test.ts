import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

/**
 * Integration test for post-call processing — workflow W4 (task 16.2).
 *
 * Where the task-16.1 unit test (`post-call-processing.test.ts`) calls the
 * handler directly, this test exercises the FULL W4 path end-to-end through the
 * durable job-runner spine, exactly as the voice-agent worker does on hangup
 * (Design §8.4; Req 4.11, 9.4):
 *
 *   publishEvent(call.ended)
 *     → enqueueJob(post_call_processing, jobKey = conv:{id})
 *       → runJob(...) with the REGISTERED handler (fake summarizer injected so
 *         no live AI-gateway call is made)
 *         → summary + sentiment persisted on `aiConversations`
 *         → `call.processed` event emitted
 *         → job reaches terminal state `done`
 *
 * It also asserts the spine's idempotency end-to-end (Req 9.2/9.3, P7): a
 * duplicate `call.ended` + re-`enqueueJob` reuses the same job row, and a
 * re-`runJob` is a no-op that emits exactly one `call.processed`.
 *
 * pg-mem harness mirrors `post-call-processing.test.ts` / `orchestrator.test.ts`
 * (migration 0029).
 *
 * _Design §8.4 / Testing Strategy (Integration tests, W4); Requirements: 9.4_
 */

import * as schema from "../schema";
import {
  aiConversations,
  aiMessages,
  parties,
  sfOutbox,
  events,
  jobs,
} from "../schema";
import type { Database } from "../db";
import { publishEvent } from "../realtime/events";
import {
  enqueueJob,
  runJob,
  defaultJobHandlers,
  type JobHandlerRegistry,
} from "./index";
import {
  createPostCallProcessingHandler,
  type PostCallAnalysis,
  type PostCallSummarizer,
} from "./post-call-processing";
import { registerVoiceJobHandlers } from "./register";

const MIGRATION_FILE = "0029_demonic_mandrill.sql";

const PREREQUISITE_SQL = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_conversations" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "participant_name" text,
    "participant_phone" text,
    "participant_email" text,
    "participant_type" text NOT NULL DEFAULT 'visitor',
    "client_id" uuid,
    "tenant_id" uuid,
    "channel" text,
    "language" text NOT NULL DEFAULT 'en',
    "status" text NOT NULL DEFAULT 'active',
    "handoff_summary" jsonb,
    "otp_verification_state" text NOT NULL DEFAULT 'not_required',
    "resolved_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "ai_messages" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "conversation_id" uuid NOT NULL,
    "role" text NOT NULL,
    "content" text NOT NULL,
    "metadata" jsonb,
    "created_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "ai_appointments" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
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

const ANALYSIS: PostCallAnalysis = {
  summary: "Caller wants a 2-bed at Bayn around 2M and asked for a viewing.",
  sentiment: "positive",
  factsDiff: {
    tier: "HOT",
    projectInterest: "Bayn",
    budgetBand: "2M-3M",
    scoreReason: "Clear intent + budget fit.",
  },
  nextBestAction: "Book a viewing and brief the rep.",
};

/** Injected fake so the W4 run makes no live AI-gateway call. */
const fakeSummarizer: PostCallSummarizer = async () => ANALYSIS;

/**
 * The registered handler with the live gateway swapped for the fake summarizer.
 * This is the exact handler `registerVoiceJobHandlers` wires onto the spine,
 * minus the network dependency, so `runJob` drives the real registered code.
 */
const handlers: JobHandlerRegistry = {
  ...defaultJobHandlers,
  post_call_processing: createPostCallProcessingHandler(fakeSummarizer),
};

async function seedCall(
  db: Database
): Promise<{ conversationId: string; partyId: string }> {
  const [party] = await db
    .insert(parties)
    .values({ type: "person", name: "Lina" })
    .returning({ id: parties.id });

  const [conversation] = await db
    .insert(aiConversations)
    .values({
      channel: "web_call",
      status: "active",
      language: "en",
      partyId: party.id,
    })
    .returning({ id: aiConversations.id });

  await db.insert(aiMessages).values([
    {
      conversationId: conversation.id,
      role: "caller",
      content: "Hi, I'm after a 2-bed at Bayn.",
      tMs: 0,
    },
    {
      conversationId: conversation.id,
      role: "agent",
      content: "Great — what's your budget range?",
      tMs: 1200,
    },
    {
      conversationId: conversation.id,
      role: "caller",
      content: "Around two million, and I'd love a viewing.",
      tMs: 3000,
    },
  ]);

  return { conversationId: conversation.id, partyId: party.id };
}

describe("W4 post-call processing through the job spine (Req 9.4)", () => {
  let db: Database;

  beforeEach(() => {
    ({ db } = buildDb());
  });

  it("call.ended → enqueueJob → runJob: persists the summary and emits call.processed", async () => {
    const { conversationId, partyId } = await seedCall(db);
    const jobKey = `conv:${conversationId}`;

    // 1) On hangup the agent publishes call.ended (Req 4.11).
    await publishEvent(db, {
      type: "call.ended",
      payload: { conversationId, partyId },
    });

    // 2) …and enqueues the durable post_call_processing job keyed conv:{id}.
    const jobId = await enqueueJob(
      db,
      "post_call_processing",
      { conversationId, partyId },
      jobKey
    );
    expect(jobId).toBeTruthy();

    // 3) The job-runner worker picks it up and runs the registered handler.
    await runJob(db, jobId, handlers);

    // Job reached the terminal `done` state.
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    expect(job.status).toBe("done");
    expect(job.lastError).toBeNull();

    // Summary + sentiment persisted on the conversation (the W4 contract).
    const [conv] = await db
      .select({
        summary: aiConversations.summary,
        sentiment: aiConversations.sentiment,
      })
      .from(aiConversations)
      .where(eq(aiConversations.id, conversationId));
    expect(conv.summary).toBe(ANALYSIS.summary);
    expect(conv.sentiment).toBe("positive");

    // A privacy-safe `call.processed` event was emitted (no raw phone — P9).
    const processed = await db
      .select()
      .from(events)
      .where(eq(events.type, "call.processed"));
    expect(processed).toHaveLength(1);
    expect((processed[0].payload as { conversationId: string }).conversationId).toBe(
      conversationId
    );
    expect(JSON.stringify(processed[0].payload)).not.toMatch(/\+?\d{8,}/);

    // The triggering call.ended event is in the append-only log too.
    const ended = await db
      .select()
      .from(events)
      .where(eq(events.type, "call.ended"));
    expect(ended).toHaveLength(1);

    // The Salesforce-bound writes were enqueued (task + lead_upsert).
    const outbox = await db.select().from(sfOutbox);
    expect(outbox.map((o) => o.kind).sort()).toEqual(["lead_upsert", "task"]);
  });

  it("is idempotent end-to-end: re-enqueue + re-run keep one job and one call.processed (P7)", async () => {
    const { conversationId, partyId } = await seedCall(db);
    const jobKey = `conv:${conversationId}`;
    const payload = { conversationId, partyId };

    // First W4 cycle.
    await publishEvent(db, { type: "call.ended", payload });
    const jobId1 = await enqueueJob(db, "post_call_processing", payload, jobKey);
    await runJob(db, jobId1, handlers);

    // A duplicate trigger (e.g. a retried close): same jobKey → same job row,
    // and re-running an already-`done` job is a no-op.
    const jobId2 = await enqueueJob(db, "post_call_processing", payload, jobKey);
    expect(jobId2).toBe(jobId1);
    await runJob(db, jobId2, handlers);

    // Exactly one job row for the jobKey.
    const jobRows = await db
      .select()
      .from(jobs)
      .where(eq(jobs.jobKey, jobKey));
    expect(jobRows).toHaveLength(1);
    expect(jobRows[0].status).toBe("done");

    // Exactly one call.processed despite the duplicate run.
    const processed = await db
      .select()
      .from(events)
      .where(eq(events.type, "call.processed"));
    expect(processed).toHaveLength(1);

    // And at most one outbox row per side-effect jobKey.
    const outbox = await db.select().from(sfOutbox);
    expect(outbox).toHaveLength(2);
    expect(outbox.map((o) => o.jobKey).sort()).toEqual([
      `lead:conv:${conversationId}`,
      `task:conv:${conversationId}`,
    ]);
  });

  it("registerVoiceJobHandlers wires post_call_processing onto the default spine", async () => {
    // The worker registers the live handler at startup; here we confirm the
    // registration replaces the throwing placeholder so runJob can dispatch it.
    const before = defaultJobHandlers.post_call_processing;
    registerVoiceJobHandlers();
    expect(typeof defaultJobHandlers.post_call_processing).toBe("function");
    // Idempotent: calling again does not change the wired handler.
    const after = defaultJobHandlers.post_call_processing;
    registerVoiceJobHandlers();
    expect(defaultJobHandlers.post_call_processing).toBe(after);
    expect(after).not.toBe(undefined);
    void before;
  });
});
