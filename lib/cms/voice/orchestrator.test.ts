import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

/**
 * Unit tests for the lean voice orchestrator `runVoiceTurn` (task 11.1).
 *
 * Focus (complements the task 11.2 non-blocking property test):
 *   • native tool-calling loop drives a tool then produces an utterance;
 *   • identity is taken from the prefetched CallContext on the turn and never
 *     re-resolved per turn (Req 5.1) — the injected caller sees the partyId;
 *   • a structured tool error is fed back and the turn still produces a
 *     graceful utterance (Req 5.5);
 *   • an LLM transport failure falls back gracefully rather than throwing;
 *   • both caller + agent turns are appended to aiMessages with tMs/latencyMs
 *     and a `turn.appended` event is emitted (Req 4.10).
 *
 * The LLM and the tool caller are injected fakes, so no network or registry
 * handler runs here. pg-mem setup mirrors `ai/tools/registry.test.ts`.
 */

import * as schema from "../schema";
import { aiConversations, aiMessages, events } from "../schema";
import type { Database } from "../db";
import {
  runVoiceTurn,
  buildSystemPrompt,
  buildToolSpecs,
  type ToolCaller,
  type ToolCallingLLM,
} from "./orchestrator";
import type { CallContext } from "./contracts";
import type { ToolCallCompletion } from "../ai/gateway";

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

async function seedConversation(db: Database): Promise<string> {
  const [row] = await db
    .insert(aiConversations)
    .values({ channel: "web_call", status: "connecting", language: "en" })
    .returning({ id: aiConversations.id });
  return row.id;
}

const KNOWN_CONTEXT: CallContext = {
  partyId: "party-123",
  known: true,
  name: "Lina",
  language: "en",
  tier: "WARM",
  projectInterest: "Bayn",
};

describe("buildSystemPrompt", () => {
  it("bakes in the resolved identity and the FR-V5 conversation constraints", () => {
    const prompt = buildSystemPrompt(KNOWN_CONTEXT);
    expect(prompt).toContain("ONE question per turn");
    expect(prompt).toContain("Never ask for the caller's phone number");
    expect(prompt).toContain("Lina");
    expect(prompt).toContain("party-123");
  });
});

describe("buildToolSpecs", () => {
  it("produces a JSON-schema spec per registry tool", () => {
    const specs = buildToolSpecs();
    expect(specs.length).toBeGreaterThan(0);
    const byName = new Map(specs.map((s) => [s.name, s]));
    expect(byName.has("get_lead_context")).toBe(true);
    const spec = byName.get("get_lead_context")!;
    expect(spec.parameters).toMatchObject({ type: "object" });
  });
});

describe("runVoiceTurn", () => {
  let db: Database;
  let conversationId: string;

  beforeEach(async () => {
    ({ db } = buildDb());
    conversationId = await seedConversation(db);
  });

  it("runs a tool then speaks, passing the prefetched partyId (no per-turn identity)", async () => {
    // First LLM step asks for a tool; second step (after the tool result) speaks.
    const steps: ToolCallCompletion[] = [
      {
        content: null,
        toolCalls: [
          {
            id: "call_1",
            name: "score_lead",
            arguments: JSON.stringify({ partyId: KNOWN_CONTEXT.partyId }),
          },
        ],
      },
      { content: "You're looking like a strong match — shall we book a viewing?", toolCalls: [] },
    ];
    let i = 0;
    const llm: ToolCallingLLM = vi.fn(async () => steps[i++]);

    const seenPartyIds: unknown[] = [];
    const callTool: ToolCaller = vi.fn(async (_name, input) => {
      seenPartyIds.push((input as { partyId?: string }).partyId);
      return { ok: true as const, result: { tier: "HOT", reason: "strong signals" } };
    });

    const result = await runVoiceTurn(
      { db, llm, callTool },
      {
        conversationId,
        context: KNOWN_CONTEXT,
        userText: "I'm interested in a 2-bed at Bayn.",
        history: [],
      }
    );

    expect(result.agentText).toContain("book a viewing");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({ name: "score_lead", ok: true });
    // Identity came from the prefetched context, not a per-turn lookup.
    expect(seenPartyIds).toEqual([KNOWN_CONTEXT.partyId]);
    expect(callTool).toHaveBeenCalledTimes(1);

    // Both turns appended with timing; latency stored on the agent turn.
    const msgs = await db
      .select()
      .from(aiMessages)
      .where(eq(aiMessages.conversationId, conversationId));
    const caller = msgs.find((m) => m.role === "caller");
    const agent = msgs.find((m) => m.role === "agent");
    expect(caller?.content).toContain("2-bed at Bayn");
    expect(agent?.content).toContain("book a viewing");
    expect(typeof agent?.latencyMs).toBe("number");

    // turn.appended emitted to the SSE bus (Req 4.10).
    const evts = await db
      .select()
      .from(events)
      .where(eq(events.type, "turn.appended"));
    expect(evts).toHaveLength(1);
  });

  it("speaks around a structured tool error and still completes the turn (Req 5.5)", async () => {
    const steps: ToolCallCompletion[] = [
      {
        content: null,
        toolCalls: [
          {
            id: "call_1",
            name: "book_viewing",
            arguments: JSON.stringify({ partyId: "party-123", slotId: "slot-x" }),
          },
        ],
      },
      { content: "That slot just filled up — want me to find another time?", toolCalls: [] },
    ];
    let i = 0;
    const llm: ToolCallingLLM = vi.fn(async () => steps[i++]);
    const callTool: ToolCaller = vi.fn(async () => ({
      ok: false as const,
      error: { code: "slot_taken", message: "Slot is no longer available" },
    }));

    const result = await runVoiceTurn(
      { db, llm, callTool },
      {
        conversationId,
        context: KNOWN_CONTEXT,
        userText: "Book me for Thursday.",
        history: [],
      }
    );

    expect(result.agentText).toContain("another time");
    expect(result.toolCalls[0]).toMatchObject({ ok: false });
    expect(result.toolCalls[0].error?.code).toBe("slot_taken");
  });

  it("falls back gracefully when the model throws (never dead air)", async () => {
    const llm: ToolCallingLLM = vi.fn(async () => {
      throw new Error("gateway unreachable");
    });
    const callTool: ToolCaller = vi.fn(async () => ({ ok: true as const, result: {} }));

    const result = await runVoiceTurn(
      { db, llm, callTool },
      {
        conversationId,
        context: KNOWN_CONTEXT,
        userText: "Hello?",
        history: [],
      }
    );

    expect(result.agentText.length).toBeGreaterThan(0);
    expect(callTool).not.toHaveBeenCalled();
    // The turn is still recorded so the transcript/HUD stay consistent.
    const msgs = await db
      .select()
      .from(aiMessages)
      .where(eq(aiMessages.conversationId, conversationId));
    expect(msgs).toHaveLength(2);
  });

  it("does not call Salesforce or a job runner inline — only the injected tool caller (Req 5.3/5.4)", async () => {
    // The orchestrator has no Salesforce adapter or job runner in its deps; the
    // only side-effect channel is callTool. A no-tool turn touches nothing else.
    const llm: ToolCallingLLM = vi.fn(async () => ({
      content: "Happy to help — what's your budget range?",
      toolCalls: [],
    }));
    const callTool: ToolCaller = vi.fn(async () => ({ ok: true as const, result: {} }));

    const result = await runVoiceTurn(
      { db, llm, callTool },
      {
        conversationId,
        context: KNOWN_CONTEXT,
        userText: "I want to buy a home.",
        history: [],
      }
    );

    expect(result.agentText).toContain("budget");
    expect(callTool).not.toHaveBeenCalled();
  });
});
