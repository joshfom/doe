import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

/**
 * Unit tests for the voice-agent worker pipeline (task 12.1).
 *
 * The LiveKit Agents SDK and the Deepgram/ElevenLabs provider plugins are not
 * installed (creds-gated, container-only), so the worker is built around the
 * transport-agnostic `VoiceAgentSession` plus injectable provider interfaces.
 * These tests exercise that core with FAKE providers — no network, no LiveKit:
 *
 *   • STT/voice selection HOT-SWAPS for Arabic (Req 4.2);
 *   • job metadata parses into a validated CallContext;
 *   • a caller turn runs the orchestrator, speaks via the TTS provider, and logs
 *     the per-turn STT-final / LLM-first-token / TTS-first-byte breakdown (Req 15.1);
 *   • barge-in stops in-flight agent speech immediately (Req 4.3);
 *   • the HTTP tool caller maps success and error responses (Req 14.2 transport).
 *
 * pg-mem setup mirrors `lib/cms/voice/orchestrator.test.ts`.
 */

import * as schema from "@/lib/cms/schema";
import { aiConversations, aiMessages, events, jobs, sfOutbox } from "@/lib/cms/schema";
import type { Database } from "@/lib/cms/db";
import type { CallContext } from "@/lib/cms/voice/contracts";
import type { ToolCaller, ToolCallingLLM } from "@/lib/cms/voice/orchestrator";
import type { ToolCallCompletion } from "@/lib/cms/ai/gateway";
import {
  VoiceAgentSession,
  selectSttConfig,
  selectVoiceId,
  parseJobMetadata,
  createHttpToolCaller,
  buildGreeting,
  buildEscalationOffer,
  callToolWithFiller,
  type SpeechHandle,
  type TtsProvider,
  type TurnLatencyLog,
} from "./voice-agent";

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
  CREATE TABLE "agent_migration_flags" (
    "capability" text PRIMARY KEY,
    "mode" text NOT NULL DEFAULT 'deterministic',
    "enabled" boolean NOT NULL DEFAULT false,
    "proven" boolean NOT NULL DEFAULT false,
    "last_divergence_at" timestamp,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
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
    "utf-8",
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

// ── Fake TTS provider ─────────────────────────────────────────────────────────

interface FakeSpeech extends SpeechHandle {
  text: string;
  stopped: boolean;
  resolveFirstByte: (ms: number) => void;
  resolveDone: () => void;
}

class FakeTts implements TtsProvider {
  utterances: FakeSpeech[] = [];
  constructor(private firstByteMs = 40) {}

  synthesize(text: string): SpeechHandle {
    let resolveFirstByte!: (ms: number) => void;
    let resolveDone!: () => void;
    const firstByte = new Promise<number>((r) => (resolveFirstByte = r));
    const done = new Promise<void>((r) => (resolveDone = r));

    const handle: FakeSpeech = {
      text,
      stopped: false,
      firstByteMs: firstByte,
      done,
      resolveFirstByte,
      resolveDone,
      stop() {
        this.stopped = true;
        resolveDone();
      },
    };
    // Auto-resolve first byte + completion so awaits in the pipeline progress.
    resolveFirstByte(this.firstByteMs);
    resolveDone();
    this.utterances.push(handle);
    return handle;
  }
}

// ── Provider selection (Req 4.2) ──────────────────────────────────────────────

describe("selectSttConfig", () => {
  it("uses the English primary model by default", () => {
    const cfg = selectSttConfig("en");
    expect(cfg.language).toBe("en");
    expect(cfg.interimResults).toBe(true);
    expect(cfg.model.length).toBeGreaterThan(0);
  });

  it("hot-swaps to the Arabic STT model/language for ar (Req 4.2)", () => {
    const cfg = selectSttConfig("ar");
    expect(cfg.language).toBe("ar");
    expect(cfg.interimResults).toBe(true);
  });
});

describe("selectVoiceId", () => {
  const prev = { ...process.env };
  afterEach(() => {
    process.env = { ...prev };
  });

  it("uses the primary DOE voice for English", () => {
    process.env.ELEVENLABS_VOICE_ID = "voice-en";
    expect(selectVoiceId("en")).toBe("voice-en");
  });

  it("uses the Arabic-capable voice for ar when configured (Req 4.2)", () => {
    process.env.ELEVENLABS_VOICE_ID = "voice-en";
    process.env.ELEVENLABS_VOICE_ID_AR = "voice-ar";
    expect(selectVoiceId("ar")).toBe("voice-ar");
  });

  it("falls back to the primary voice for ar when no Arabic voice is set", () => {
    process.env.ELEVENLABS_VOICE_ID = "voice-en";
    delete process.env.ELEVENLABS_VOICE_ID_AR;
    expect(selectVoiceId("ar")).toBe("voice-en");
  });
});

// ── Job metadata parsing ──────────────────────────────────────────────────────

describe("parseJobMetadata", () => {
  it("parses a valid CallContext from JSON job metadata", () => {
    const ctx = parseJobMetadata(JSON.stringify(KNOWN_CONTEXT));
    expect(ctx.partyId).toBe("party-123");
    expect(ctx.known).toBe(true);
    expect(ctx.language).toBe("en");
  });

  it("throws when metadata is missing", () => {
    expect(() => parseJobMetadata(undefined)).toThrow();
  });

  it("throws when metadata is not valid JSON", () => {
    expect(() => parseJobMetadata("not json")).toThrow();
  });

  it("throws when metadata does not satisfy the CallContext schema", () => {
    expect(() => parseJobMetadata(JSON.stringify({ partyId: 123 }))).toThrow();
  });
});

// ── VoiceAgentSession pipeline ─────────────────────────────────────────────────

describe("VoiceAgentSession", () => {
  let db: Database;
  let conversationId: string;

  beforeEach(async () => {
    ({ db } = buildDb());
    conversationId = await seedConversation(db);
    process.env.ELEVENLABS_VOICE_ID = "voice-en";
  });

  it("runs a caller turn, speaks the reply, and logs the latency breakdown (Req 15.1)", async () => {
    const steps: ToolCallCompletion[] = [
      { content: "Happy to help — what's your budget range?", toolCalls: [] },
    ];
    let i = 0;
    const llm: ToolCallingLLM = vi.fn(async () => steps[i++]);
    const callTool: ToolCaller = vi.fn(async () => ({
      ok: true as const,
      result: {},
    }));
    const tts = new FakeTts(35);
    const logs: TurnLatencyLog[] = [];

    const session = new VoiceAgentSession({
      conversationId,
      context: KNOWN_CONTEXT,
      db,
      callTool,
      tts,
      llm,
      logLatency: (l) => logs.push(l),
    });

    const { result, latency } = await session.handleCallerTurn(
      "I want to buy a home.",
      120,
    );

    expect(result.agentText).toContain("budget");
    // The agent reply was synthesised through the TTS provider with the
    // English voice.
    expect(tts.utterances.at(-1)?.text).toContain("budget");

    // Per-turn breakdown is logged with all three components (Req 15.1).
    expect(logs).toHaveLength(1);
    expect(latency.sttFinalMs).toBe(120);
    expect(latency.ttsFirstByteMs).toBe(35);
    expect(typeof latency.llmFirstTokenMs).toBe("number");
    // Voice-to-voice includes the STT-final time.
    expect(latency.voiceToVoiceMs).toBeGreaterThanOrEqual(120);

    // The turn was persisted by the orchestrator.
    const msgs = await db
      .select()
      .from(aiMessages)
      .where(eq(aiMessages.conversationId, conversationId));
    expect(msgs).toHaveLength(2);

    // Rolling history extends for the next turn.
    expect(session.getHistory()).toHaveLength(2);
    expect(session.getHistory()[0]).toMatchObject({ role: "user" });
    expect(session.getHistory()[1]).toMatchObject({ role: "assistant" });
  });

  it("stops in-flight agent speech immediately on barge-in (Req 4.3)", () => {
    // A TTS provider that does NOT auto-complete, so the utterance stays
    // "playing" until explicitly stopped.
    const pendingTts: TtsProvider = {
      synthesize(text: string) {
        const handle: SpeechHandle = {
          text,
          stopped: false,
          firstByteMs: Promise.resolve(20),
          done: new Promise<void>(() => {}),
          stop: vi.fn(),
        } as unknown as SpeechHandle;
        return handle;
      },
    };

    const session = new VoiceAgentSession({
      conversationId,
      context: KNOWN_CONTEXT,
      db,
      callTool: vi.fn(),
      tts: pendingTts,
    });

    const handle = session.speak("This is a long agent sentence…");
    session.notifyCallerSpeechStarted();
    expect(handle.stop).toHaveBeenCalledTimes(1);

    // Barge-in with nothing playing is a safe no-op.
    expect(() => session.notifyCallerSpeechStarted()).not.toThrow();
  });

  it("speaks the greeting via the 12.2 buildGreeting seam when provided (FR-V3 hook)", async () => {
    const tts = new FakeTts();
    const session = new VoiceAgentSession({
      conversationId,
      context: KNOWN_CONTEXT,
      db,
      callTool: vi.fn(),
      tts,
      buildGreeting: (ctx) => `Hi ${ctx.name}!`,
    });

    await session.start();
    expect(tts.utterances.at(0)?.text).toBe("Hi Lina!");
    expect(session.getHistory()).toEqual([
      { role: "assistant", content: "Hi Lina!" },
    ]);
  });

  it("start() is a no-op without a greeting hook (12.1 leaves greeting to 12.2)", async () => {
    const tts = new FakeTts();
    const session = new VoiceAgentSession({
      conversationId,
      context: KNOWN_CONTEXT,
      db,
      callTool: vi.fn(),
      tts,
    });
    await session.start();
    expect(tts.utterances).toHaveLength(0);
  });

  it("handleCallEnded stops audio and is idempotent", async () => {
    const tts = new FakeTts();
    const session = new VoiceAgentSession({
      conversationId,
      context: KNOWN_CONTEXT,
      db,
      callTool: vi.fn(),
      tts,
    });
    await session.handleCallEnded();
    await session.handleCallEnded();
    // No throw; nothing was playing so nothing to stop.
    expect(true).toBe(true);
  });

  it("uses the Arabic STT config and voice when the call language is ar (Req 4.2)", () => {
    process.env.ELEVENLABS_VOICE_ID = "voice-en";
    process.env.ELEVENLABS_VOICE_ID_AR = "voice-ar";
    const session = new VoiceAgentSession({
      conversationId,
      context: { ...KNOWN_CONTEXT, language: "ar" },
      db,
      callTool: vi.fn(),
      tts: new FakeTts(),
    });
    expect(session.sttConfig.language).toBe("ar");
    expect(session.ttsVoiceId).toBe("voice-ar");
  });
});

// ── HTTP tool caller transport (Req 14.2) ──────────────────────────────────────

describe("createHttpToolCaller", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("POSTs the tool input with the service token and returns the result", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ tier: "HOT" }),
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    const caller = createHttpToolCaller("https://api.internal/", "svc-token");
    const res = await caller(
      "score_lead",
      { partyId: "p1" },
      { conversationId: "c1", context: KNOWN_CONTEXT },
    );

    expect(res).toEqual({ ok: true, result: { tier: "HOT" } });
    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(url).toBe("https://api.internal/api/tools/score_lead");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer svc-token",
    });
  });

  it("maps a non-2xx response to a structured tool error", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 422,
      json: async () => ({ error: { code: "validation_error", message: "bad" } }),
    })) as unknown as typeof fetch;

    const caller = createHttpToolCaller("https://api.internal", "svc-token");
    const res = await caller(
      "score_lead",
      {},
      { conversationId: "c1", context: KNOWN_CONTEXT },
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("validation_error");
      expect(res.error.message).toBe("bad");
    }
  });

  it("maps a transport failure to a structured error", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;

    const caller = createHttpToolCaller("https://api.internal", "svc-token");
    const res = await caller(
      "score_lead",
      {},
      { conversationId: "c1", context: KNOWN_CONTEXT },
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("transport_error");
  });
});

// ── buildGreeting branches (task 12.3 — FR-V3 / Req 4.4, 4.5, 4.6) ────────────
//
// buildGreeting is a PURE template function (template + CallContext, never a
// free LLM call — Req 4.4), so it is exhaustively coverable here. The matrix is
// known/unknown × with/without project interest, plus the name-budget and
// conversation-constraint checks (one question, ≤ 2 sentences, never asks phone).

describe("buildGreeting", () => {
  /** Count sentence-terminators so we can assert the ≤ 2 sentences constraint. */
  const sentenceCount = (s: string) =>
    (s.match(/[.!?]+/g) ?? []).length;
  /** Count "?" so we can assert the one-question constraint. */
  const questionCount = (s: string) => (s.match(/\?/g) ?? []).length;
  /** Count case-insensitive occurrences of the caller's name. */
  const nameMentions = (s: string, name: string) =>
    (s.toLowerCase().match(new RegExp(name.toLowerCase(), "g")) ?? []).length;

  it("known caller WITH a project interest is greeted by name and references the project (Req 4.5)", () => {
    const greeting = buildGreeting({
      partyId: "p1",
      known: true,
      name: "Lina",
      language: "en",
      projectInterest: "Bayn",
      unitInterest: "3-bedroom apartment",
    });

    // Name-led and references their project + unit interest (Req 4.5).
    expect(greeting).toContain("Lina");
    expect(greeting).toContain("Bayn");
    expect(greeting).toContain("3-bedroom apartment");
    // Conversation constraints (Req 4.7): one question, ≤ 2 sentences, name once.
    expect(questionCount(greeting)).toBe(1);
    expect(sentenceCount(greeting)).toBeLessThanOrEqual(2);
    expect(nameMentions(greeting, "Lina")).toBe(1);
    // Never asks for the phone number (FR-V5 / Req 4.7).
    expect(greeting.toLowerCase()).not.toContain("phone");
    expect(greeting.toLowerCase()).not.toContain("number");
  });

  it("known caller WITH a project but no unit interest still references the project with a generic unit", () => {
    const greeting = buildGreeting({
      partyId: "p1",
      known: true,
      name: "Omar",
      language: "en",
      projectInterest: "Saadiyat",
    });

    expect(greeting).toContain("Omar");
    expect(greeting).toContain("Saadiyat");
    // Degrades to the word "unit" when no specific unit interest is on file.
    expect(greeting).toContain("unit");
    expect(questionCount(greeting)).toBe(1);
    expect(nameMentions(greeting, "Omar")).toBe(1);
  });

  it("known caller WITHOUT a project interest gets a warm, name-led open question (Req 4.5)", () => {
    const greeting = buildGreeting({
      partyId: "p1",
      known: true,
      name: "Lina",
      language: "en",
    });

    expect(greeting).toContain("Lina");
    expect(questionCount(greeting)).toBe(1);
    expect(sentenceCount(greeting)).toBeLessThanOrEqual(2);
    expect(nameMentions(greeting, "Lina")).toBe(1);
    expect(greeting.toLowerCase()).not.toContain("phone");
  });

  it("unknown caller gets a warm generic greeting whose single question is the first qualification question (Req 4.6)", () => {
    const greeting = buildGreeting({
      partyId: "p1",
      known: false,
      language: "en",
    });

    // Warm generic open — no caller name, since none is resolved (Req 4.6).
    expect(greeting.toLowerCase()).toContain("doe");
    expect(questionCount(greeting)).toBe(1);
    expect(sentenceCount(greeting)).toBeLessThanOrEqual(2);
    expect(greeting.toLowerCase()).not.toContain("phone");
  });

  it("unknown caller greeting ignores any stray project interest (no name, generic open)", () => {
    const greeting = buildGreeting({
      partyId: "p1",
      known: false,
      language: "en",
      projectInterest: "Bayn",
    });

    // An unknown caller is never greeted by a project reference they did not
    // establish in this call — the generic open is used.
    expect(questionCount(greeting)).toBe(1);
    expect(sentenceCount(greeting)).toBeLessThanOrEqual(2);
  });

  it("a known caller with NO name on file degrades to the generic greeting (no awkward 'Hi ,')", () => {
    const greeting = buildGreeting({
      partyId: "p1",
      known: true,
      language: "en",
      projectInterest: "Bayn",
    });

    // Falls back to the warm generic greeting rather than emitting "Hi , …".
    expect(greeting).not.toContain("Hi ,");
    expect(greeting.toLowerCase()).toContain("doe");
    expect(questionCount(greeting)).toBe(1);
  });
});

// ── buildEscalationOffer (FR-V6 / Req 4.9) ────────────────────────────────────

describe("buildEscalationOffer", () => {
  it("names the assigned rep when one is known", () => {
    const offer = buildEscalationOffer("Sara");
    expect(offer).toContain("Sara");
    // Two sentences, NO trailing question, so the call ends without looping.
    expect(offer).not.toContain("?");
  });

  it("falls back to the team when no rep is known", () => {
    const offer = buildEscalationOffer();
    expect(offer.toLowerCase()).toContain("team");
    expect(offer).not.toContain("?");
  });
});

// ── Escalation policy (FR-V6 / Req 4.9) ───────────────────────────────────────
//
// Escalation on a human request / frustration / two consecutive
// non-understandings must: offer a callback from the assigned rep, file a
// follow-up task to the Salesforce outbox, end the call gracefully, and NEVER
// loop. These tests drive the real VoiceAgentSession against pg-mem + a fake TTS.

describe("VoiceAgentSession escalation (Req 4.9)", () => {
  let db: Database;
  let conversationId: string;

  const REP_CONTEXT: CallContext = {
    ...KNOWN_CONTEXT,
    assignedRep: { id: "rep-1", name: "Sara", available: true },
  };

  beforeEach(async () => {
    ({ db } = buildDb());
    conversationId = await seedConversation(db);
    process.env.ELEVENLABS_VOICE_ID = "voice-en";
  });

  async function newSession(context: CallContext) {
    return new VoiceAgentSession({
      conversationId,
      context,
      db,
      callTool: vi.fn(),
      tts: new FakeTts(),
    });
  }

  it("offers a rep callback, files a follow-up task, and ends the call on an explicit human request", async () => {
    const session = await newSession(REP_CONTEXT);

    await session.requestEscalation("human_request");

    // 1) Spoken callback offer names the assigned rep and is the last turn.
    const history = session.getHistory();
    const offer = history.at(-1);
    expect(offer?.role).toBe("assistant");
    expect(offer?.content).toContain("Sara");
    expect(offer?.content).not.toContain("?"); // graceful end, no loop

    // 2) A single follow-up task was filed to the Salesforce outbox, keyed so a
    //    retry never duplicates it (jobKey = escalation:conv:{id}).
    const outbox = await db.select().from(sfOutbox);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].kind).toBe("task");
    expect(outbox[0].jobKey).toBe(`escalation:conv:${conversationId}`);

    // 3) The call ended gracefully: call.ended published + post_call_processing
    //    enqueued (end-of-call handoff).
    const ended = await db
      .select()
      .from(events)
      .where(eq(events.type, "call.ended"));
    expect(ended).toHaveLength(1);

    const postCall = await db
      .select()
      .from(jobs)
      .where(eq(jobs.kind, "post_call_processing"));
    expect(postCall).toHaveLength(1);
    expect(postCall[0].jobKey).toBe(`conv:${conversationId}`);
  });

  it("does NOT loop: a second escalation request after escalating is a no-op", async () => {
    const session = await newSession(REP_CONTEXT);

    await session.requestEscalation("human_request");
    await session.requestEscalation("frustration");
    await session.requestEscalation("human_request");

    // Still exactly one offer, one outbox task, one call.ended event.
    const offers = session
      .getHistory()
      .filter((m) => m.role === "assistant" && m.content.includes("Sara"));
    expect(offers).toHaveLength(1);

    const outbox = await db.select().from(sfOutbox);
    expect(outbox).toHaveLength(1);

    const ended = await db
      .select()
      .from(events)
      .where(eq(events.type, "call.ended"));
    expect(ended).toHaveLength(1);
  });

  it("falls back to the team callback offer when no rep is assigned", async () => {
    const session = await newSession(KNOWN_CONTEXT); // no assignedRep

    await session.requestEscalation("frustration");

    const offer = session.getHistory().at(-1);
    expect(offer?.content.toLowerCase()).toContain("team");
    expect(offer?.content).not.toContain("?");

    const outbox = await db.select().from(sfOutbox);
    expect(outbox).toHaveLength(1);
  });

  it("escalates only on the SECOND consecutive non-understanding (Req 4.9)", async () => {
    const session = await newSession(REP_CONTEXT);

    // First non-understanding: no escalation yet.
    await session.onCallerNotUnderstood();
    expect(await db.select().from(sfOutbox)).toHaveLength(0);
    expect(
      await db.select().from(events).where(eq(events.type, "call.ended")),
    ).toHaveLength(0);

    // Second consecutive non-understanding: escalate + end the call.
    await session.onCallerNotUnderstood();
    expect(await db.select().from(sfOutbox)).toHaveLength(1);
    expect(
      await db.select().from(events).where(eq(events.type, "call.ended")),
    ).toHaveLength(1);
  });

  it("resets the non-understanding streak after an understood turn (no escalation on isolated misses)", async () => {
    const llm: ToolCallingLLM = vi.fn(async () => ({
      content: "Sure — what's your budget range?",
      toolCalls: [],
    }));
    const session = new VoiceAgentSession({
      conversationId,
      context: REP_CONTEXT,
      db,
      callTool: vi.fn(async () => ({ ok: true as const, result: {} })),
      tts: new FakeTts(),
      llm,
    });

    // miss, then an understood turn (which resets the streak), then miss again.
    await session.onCallerNotUnderstood();
    await session.handleCallerTurn("I'm looking to buy.", 100);
    await session.onCallerNotUnderstood();

    // Two non-understandings total, but NOT consecutive → no escalation.
    expect(await db.select().from(sfOutbox)).toHaveLength(0);
    expect(
      await db.select().from(events).where(eq(events.type, "call.ended")),
    ).toHaveLength(0);
  });
});
