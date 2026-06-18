import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

/**
 * Unit tests for the `post_call_processing` job handler (task 16.1).
 *
 * Exercises the full offline flow against real SQL (pg-mem + migration 0029):
 *   • turns pulled from `aiMessages`, analysis produced by an injected fake
 *     summarizer (no gateway call);
 *   • summary + sentiment persisted on `aiConversations` (Req 9.4);
 *   • mirror fields updated on `leadsMirror` from the facts diff (Req 9.4);
 *   • a Salesforce `task` and `lead_upsert` enqueued to `sf_outbox` (Req 9.4);
 *   • a `call.processed` event published with NO raw phone (Req 9.4 / P9);
 *   • idempotent re-run keeps exactly one outbox row per jobKey (P1/P7).
 *
 * pg-mem harness mirrors `lib/cms/voice/orchestrator.test.ts`.
 */

import * as schema from "../schema";
import {
  aiConversations,
  aiMessages,
  leadsMirror,
  parties,
  sfOutbox,
  events,
} from "../schema";
import type { Database } from "../db";
import {
  createPostCallProcessingHandler,
  type PostCallAnalysis,
  type PostCallSummarizer,
} from "./post-call-processing";
import type { JobContext } from "./index";

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
  summary: "Caller is keen on a 2-bed at Bayn, budget ~2M, wants a viewing.",
  sentiment: "positive",
  factsDiff: {
    tier: "HOT",
    projectInterest: "Bayn",
    budgetBand: "2M-3M",
    scoreReason: "Clear intent + budget fit.",
  },
  nextBestAction: "Book a viewing and send the rep a brief.",
};

const fakeSummarizer: PostCallSummarizer = async () => ANALYSIS;

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
      content: "Around two million.",
      tMs: 3000,
    },
  ]);

  return { conversationId: conversation.id, partyId: party.id };
}

function ctx(jobKey: string, partyId: string | null): JobContext {
  return { jobId: randomUUID(), jobKey, kind: "post_call_processing", partyId };
}

describe("post_call_processing handler (Req 9.4)", () => {
  let db: Database;

  beforeEach(() => {
    ({ db } = buildDb());
  });

  it("persists summary + sentiment, updates the mirror, enqueues outbox, and publishes call.processed", async () => {
    const { conversationId, partyId } = await seedCall(db);
    const handler = createPostCallProcessingHandler(fakeSummarizer);

    await handler(
      db,
      { conversationId, partyId },
      ctx(`conv:${conversationId}`, partyId)
    );

    // Summary + sentiment persisted on the conversation.
    const [conv] = await db
      .select({
        summary: aiConversations.summary,
        sentiment: aiConversations.sentiment,
      })
      .from(aiConversations)
      .where(eq(aiConversations.id, conversationId));
    expect(conv.summary).toBe(ANALYSIS.summary);
    expect(conv.sentiment).toBe("positive");

    // Mirror fields updated from the facts diff.
    const [mirror] = await db
      .select()
      .from(leadsMirror)
      .where(eq(leadsMirror.partyId, partyId));
    expect(mirror.tier).toBe("HOT");
    expect(mirror.projectInterest).toBe("Bayn");
    expect(mirror.budgetBand).toBe("2M-3M");
    expect(mirror.scoreReason).toBe("Clear intent + budget fit.");
    expect(mirror.lastInteractionSummary).toBe(ANALYSIS.summary);
    expect(mirror.lastInteractionAt).toBeTruthy();

    // A Salesforce task + lead_upsert enqueued.
    const outbox = await db.select().from(sfOutbox);
    const kinds = outbox.map((o) => o.kind).sort();
    expect(kinds).toEqual(["lead_upsert", "task"]);
    expect(outbox.every((o) => o.status === "pending")).toBe(true);

    // call.processed event published, with no raw phone in the payload (P9).
    const evs = await db
      .select()
      .from(events)
      .where(eq(events.type, "call.processed"));
    expect(evs).toHaveLength(1);
    // P9: no raw phone in the payload. Scan the analysis-derived fields only —
    // the `conversationId`/`partyId` are system UUIDs whose hex can, by chance,
    // contain an 8+ digit run and falsely trip a phone-shaped regex. The privacy
    // invariant concerns transcript-derived content, not internal ids.
    const { conversationId: _cid, partyId: _pid, ...scanned } =
      evs[0].payload as Record<string, unknown>;
    const payloadStr = JSON.stringify(scanned);
    expect(payloadStr).not.toMatch(/\+?\d{8,}/); // no phone-like digit run
    expect((evs[0].payload as { sentiment: string }).sentiment).toBe(
      "positive"
    );
  });

  it("is idempotent: re-running keeps exactly one outbox row per jobKey (P1/P7)", async () => {
    const { conversationId, partyId } = await seedCall(db);
    const handler = createPostCallProcessingHandler(fakeSummarizer);
    const c = ctx(`conv:${conversationId}`, partyId);

    await handler(db, { conversationId, partyId }, c);
    await handler(db, { conversationId, partyId }, c);

    const outbox = await db.select().from(sfOutbox);
    expect(outbox).toHaveLength(2); // one task + one lead_upsert, not four
    const keys = outbox.map((o) => o.jobKey).sort();
    expect(keys).toEqual([
      `lead:conv:${conversationId}`,
      `task:conv:${conversationId}`,
    ]);
  });

  it("falls back to the conversation's stored party when ctx.partyId is null", async () => {
    const { conversationId, partyId } = await seedCall(db);
    const handler = createPostCallProcessingHandler(fakeSummarizer);

    await handler(
      db,
      { conversationId },
      ctx(`conv:${conversationId}`, null)
    );

    const [mirror] = await db
      .select()
      .from(leadsMirror)
      .where(eq(leadsMirror.partyId, partyId));
    expect(mirror?.tier).toBe("HOT");
  });

  it("throws when the conversation is missing (so the spine records failure)", async () => {
    const handler = createPostCallProcessingHandler(fakeSummarizer);
    const missing = randomUUID();
    await expect(
      handler(db, { conversationId: missing }, ctx(`conv:${missing}`, null))
    ).rejects.toThrow(/not found/);
  });

  it("throws when payload.conversationId is absent", async () => {
    const handler = createPostCallProcessingHandler(fakeSummarizer);
    await expect(
      handler(db, {}, ctx("conv:none", null))
    ).rejects.toThrow(/conversationId is required/);
  });
});
