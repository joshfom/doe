import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/pg-proxy";
import { eq } from "drizzle-orm";

/**
 * Integration test for the DOE voice W1 happy path (task 8.3).
 *
 * Exercises {@link createVoiceSession} end-to-end against a REAL Drizzle
 * instance backed by an in-memory Postgres (pg-mem), with migration 0029
 * applied statement-by-statement exactly as the migration runner does (reusing
 * the harness from `realtime/events.property.test.ts` + the richer prerequisite
 * stubs from `prefetch.property.test.ts`). The full request/response path runs:
 * normalise phone → resolve party (salted-hash identity graph) → build
 * mirror-only CallContext → provision LiveKit → insert `ai_conversations` →
 * publish `session.created`.
 *
 *   Req 3.7 — a `web_call` `ai_conversations` row is inserted with status
 *     `connecting` and a non-null `partyId`.
 *   Req 3.8 — a `session.created` row exists in the append-only `events` table,
 *     and its payload contains NO raw phone number (privacy / Property 9).
 *   Req 3.9 — the returned result has `{ roomName (call_*), token, livekitUrl,
 *     conversationId }`.
 *
 * **Validates: Requirements 3.7, 3.8, 3.9**
 *
 * SCOPE CHOICE (documented per the task): the assertions are made at the
 * `createVoiceSession` SERVICE level rather than by booting the full Elysia HTTP
 * route. The `POST /api/voice/sessions` route (task 8.2) only Zod-validates the
 * body and delegates to this service, so testing the service directly is both
 * the faithful integration surface for the W1 happy path and the
 * pg-mem-friendly one (no HTTP/auth scaffolding required).
 *
 * LIVEKIT (creds-gated, design §7 / task 7.1): the entire `./livekit` module is
 * mocked so no real LiveKit calls happen — `mintParticipantToken` returns a
 * fixed fake token, `createRoom` / `dispatchAgent` are no-op spies, and
 * `generateRoomName` returns a deterministic `call_*` name.
 */

// ── LiveKit mock — no real LiveKit calls. ────────────────────────────────────
const FAKE_TOKEN = "fake.jwt.token";
const FAKE_ROOM = "call_TESTROOM0000000000000000";

const livekitSpies = {
  generateRoomName: vi.fn(() => FAKE_ROOM),
  createRoom: vi.fn(async () => {}),
  mintParticipantToken: vi.fn(async () => FAKE_TOKEN),
  dispatchAgent: vi.fn(async () => {}),
};

vi.mock("./livekit", () => ({
  generateRoomName: (...args: unknown[]) => livekitSpies.generateRoomName(...args),
  createRoom: (...args: unknown[]) => livekitSpies.createRoom(...args),
  mintParticipantToken: (...args: unknown[]) =>
    livekitSpies.mintParticipantToken(...args),
  dispatchAgent: (...args: unknown[]) => livekitSpies.dispatchAgent(...args),
}));

import * as schema from "../schema";
import { aiConversations, events } from "../schema";
import type { Database } from "../db";
import { createVoiceSession } from "./session";

const MIGRATION_FILE = "0029_demonic_mandrill.sql";

// Phone-hash salt + LiveKit URL the service reads from the environment. The
// salt makes `computePhoneHash` deterministic; the URL is echoed back into the
// session result (LiveKit itself is mocked, so no other env is required).
const TEST_PHONE_HASH_SALT = "doe-voice-test-salt";
const TEST_LIVEKIT_URL = "wss://example.livekit.cloud";

// Pre-existing tables migration 0029 ALTERs / references. `ai_clients` /
// `ai_tenants` carry `email` + `first_name` because `resolveIdentityByEmail`
// (reached by `resolveParty`) selects those columns. `ai_conversations` /
// `ai_appointments` carry their full BASE columns (migration 0029 only ADDs the
// voice-surface columns) so Drizzle's fully-named INSERT/SELECT resolves.
const PREREQUISITE_SQL = `
  CREATE TABLE "ai_clients"  (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "first_name" text,
    "email" text
  );
  CREATE TABLE "ai_tenants"  (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "first_name" text,
    "email" text
  );
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
  CREATE TABLE "ai_appointments" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "reference_number" text NOT NULL UNIQUE,
    "conversation_id" uuid,
    "client_id" uuid,
    "tenant_id" uuid,
    "contact_name" text NOT NULL,
    "contact_email" text,
    "contact_phone" text,
    "appointment_type" text NOT NULL,
    "scheduled_date" date NOT NULL,
    "scheduled_time" time NOT NULL,
    "status" text NOT NULL DEFAULT 'confirmed',
    "notes" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "ai_messages" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
`;

/** Split a Drizzle migration into individual statements. */
function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Stand up a fresh in-memory Postgres with migration 0029 applied and return a
 * Drizzle handle (shaped like the production `Database`) bound to it.
 *
 * Uses the pg-proxy driver over pg-mem (node-postgres' type parsing + array
 * row-mode are rejected by pg-mem). `gen_random_uuid` + a no-op `pg_notify` are
 * registered so the real SQL resolves, and a thin BEGIN/COMMIT transaction is
 * provided over the single connection because `publishEvent` wraps its insert +
 * NOTIFY in `db.transaction` (the proxy driver does not implement it).
 */
function buildSessionDb(): { db: Database; mem: IMemoryDb } {
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

  const migrationPath = join(process.cwd(), "drizzle", MIGRATION_FILE);
  const migrationSql = readFileSync(migrationPath, "utf-8");
  for (const stmt of splitStatements(migrationSql)) {
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

// The W1 happy-path input the task specifies.
const RAW_PHONE = "+971501234567";
const HAPPY_PATH_INPUT = {
  phone: RAW_PHONE,
  email: "a@b.com",
  name: "Ada",
  consent: true as const,
  page: "/home",
};

describe("createVoiceSession — W1 happy path (Req 3.7, 3.8, 3.9)", () => {
  beforeEach(() => {
    process.env.PHONE_HASH_SALT = TEST_PHONE_HASH_SALT;
    process.env.LIVEKIT_URL = TEST_LIVEKIT_URL;
    for (const spy of Object.values(livekitSpies)) spy.mockClear();
  });

  it("inserts a connecting web_call conversation with a resolved partyId (Req 3.7)", async () => {
    const { db } = buildSessionDb();

    const result = await createVoiceSession(db, HAPPY_PATH_INPUT);

    const [conversation] = await db
      .select({
        id: aiConversations.id,
        channel: aiConversations.channel,
        status: aiConversations.status,
        partyId: aiConversations.partyId,
      })
      .from(aiConversations)
      .where(eq(aiConversations.id, result.conversationId))
      .limit(1);

    expect(conversation).toBeDefined();
    expect(conversation.channel).toBe("web_call");
    expect(conversation.status).toBe("connecting");
    expect(conversation.partyId).toBeTruthy();
  });

  it("publishes a session.created event whose payload contains no raw phone (Req 3.8 / Property 9)", async () => {
    const { db } = buildSessionDb();

    await createVoiceSession(db, HAPPY_PATH_INPUT);

    const rows = await db
      .select({ type: events.type, payload: events.payload })
      .from(events);

    const sessionCreated = rows.filter((r) => r.type === "session.created");
    expect(sessionCreated).toHaveLength(1);

    // Privacy: the raw E.164 number must never leak into any event payload.
    for (const row of rows) {
      expect(JSON.stringify(row.payload)).not.toContain(RAW_PHONE);
      // Bare digits guard too (in case of any reformatting).
      expect(JSON.stringify(row.payload)).not.toContain("971501234567");
    }
  });

  it("returns { roomName (call_*), token, livekitUrl, conversationId } (Req 3.9)", async () => {
    const { db } = buildSessionDb();

    const result = await createVoiceSession(db, HAPPY_PATH_INPUT);

    expect(result.roomName).toMatch(/^call_/);
    expect(result.token).toBe(FAKE_TOKEN);
    expect(result.livekitUrl).toBe(TEST_LIVEKIT_URL);
    expect(result.conversationId).toBeTruthy();
  });

  it("provisions LiveKit via the mocked layer (room created + agent dispatched + token minted)", async () => {
    const { db } = buildSessionDb();

    const result = await createVoiceSession(db, HAPPY_PATH_INPUT);

    // Room created with the generated room name.
    expect(livekitSpies.createRoom).toHaveBeenCalledTimes(1);
    expect(livekitSpies.createRoom).toHaveBeenCalledWith(result.roomName);

    // Token minted for the room + resolved party id.
    const [conversation] = await db
      .select({ partyId: aiConversations.partyId })
      .from(aiConversations)
      .where(eq(aiConversations.id, result.conversationId))
      .limit(1);
    expect(livekitSpies.mintParticipantToken).toHaveBeenCalledTimes(1);
    expect(livekitSpies.mintParticipantToken).toHaveBeenCalledWith(
      result.roomName,
      conversation.partyId
    );

    // Agent dispatched into the room with a CallContext object.
    expect(livekitSpies.dispatchAgent).toHaveBeenCalledTimes(1);
    const [dispatchRoom, dispatchContext] =
      livekitSpies.dispatchAgent.mock.calls[0];
    expect(dispatchRoom).toBe(result.roomName);
    expect(dispatchContext).toMatchObject({ partyId: conversation.partyId });
  });
});
