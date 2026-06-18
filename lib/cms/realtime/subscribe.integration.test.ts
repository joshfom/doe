import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/pg-proxy";
import { asc } from "drizzle-orm";

import * as schema from "../schema";
import { events } from "../schema";
import { publishEvent, type DoeEvent, type DoeEventType } from "./events";
import { createEventStream, handleNotification } from "./subscribe";
import type { Database } from "../db";

/**
 * Integration test for the SSE event bus liveness + catch-up (task 2.5).
 *
 *   Property 12 — SSE liveness & catch-up: publish N events; a subscriber that
 *     connects mid-stream (recent backlog replay, then live) receives all N
 *     exactly once, in order, with NO gap or duplicate across the replay→live
 *     boundary (Requirements 7.3, 7.4).
 *
 * **Validates: Requirements 7.3, 7.4**
 *
 * Per design §18 this is an example/integration test (streaming, not a heavy
 * property test): a few focused, deterministic scenarios kept fast.
 *
 * The harness mirrors events.property.test.ts: a Drizzle pg-proxy driver over
 * an in-memory Postgres (pg-mem) with a thin BEGIN/COMMIT transaction, migration
 * 0029 applied statement-by-statement, and `gen_random_uuid`/`pg_notify`
 * registered (the latter as a no-op). Postgres LISTEN/NOTIFY is unavailable in
 * pg-mem, so the stream is opened with `{ listen: false }` and live fan-out is
 * driven directly via the exported `handleNotification(eventId, db)`.
 */

const MIGRATION_FILE = "0029_demonic_mandrill.sql";

// Pre-existing tables migration 0029 ALTERs / references (see migration test).
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

/**
 * Stand up a fresh in-memory Postgres with migration 0029 applied and return a
 * Drizzle handle (shaped like the production `Database`) bound to it. Identical
 * approach to events.property.test.ts.
 */
function buildEventsDb(): { db: Database; mem: IMemoryDb } {
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

/** Small spacing so each publish gets a distinct `at` (deterministic replay order). */
const tick = () => new Promise((r) => setTimeout(r, 2));

/**
 * Publish an event carrying a tracking `seq`, then return the persisted row id
 * so the caller can drive live fan-out via {@link handleNotification}.
 */
async function publishSeq(
  db: Database,
  type: DoeEventType,
  seq: number
): Promise<string> {
  await publishEvent(db, { type, payload: { seq } });
  await tick();
  const rows = await db
    .select({ id: events.id, payload: events.payload })
    .from(events)
    .orderBy(asc(events.at), asc(events.id));
  const match = rows.find(
    (r) => (r.payload as { seq?: number } | null)?.seq === seq
  );
  if (!match) throw new Error(`could not locate published event seq=${seq}`);
  return match.id;
}

/** Resolve `reader.read()` but reject if no chunk arrives within `ms`. */
function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ms: number
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("SSE read timed out")), ms);
  });
  return Promise.race([
    reader.read().then((r) => {
      clearTimeout(timer);
      return r;
    }),
    timeout,
  ]);
}

/**
 * Read exactly `count` SSE `data:` frames from the stream, decoding bytes and
 * splitting on the `\n\n` frame delimiter. Heartbeat / comment frames (lines
 * starting with `:`) are ignored. Throws rather than hanging if frames stall.
 */
async function readDataFrames(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  count: number,
  timeoutMs = 3000
): Promise<DoeEvent[]> {
  const decoder = new TextDecoder();
  const out: DoeEvent[] = [];
  let buf = "";

  while (out.length < count) {
    const { value, done } = await readWithTimeout(reader, timeoutMs);
    if (done) break;
    if (value) buf += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of frame.split("\n")) {
        if (line.startsWith("data: ")) {
          out.push(JSON.parse(line.slice(6)) as DoeEvent);
        }
        // Lines starting with ":" are SSE comments / heartbeats — ignored.
      }
    }
  }

  return out;
}

const seqOf = (e: DoeEvent) => (e.payload as { seq: number }).seq;

describe("createEventStream — Property 12: SSE liveness & catch-up (Req 7.3, 7.4)", () => {
  it("replays the backlog in order, then delivers live events with no gap or duplicate across the boundary", async () => {
    const { db } = buildEventsDb();

    // 1. Seed a backlog BEFORE any subscriber connects (seqs 0..4).
    const BACKLOG = 5;
    for (let i = 0; i < BACKLOG; i++) {
      await publishSeq(db, "turn.appended", i);
    }

    // 2. Connect a subscriber mid-stream (no Postgres LISTEN; test-driven live).
    const stream = createEventStream(undefined, {
      db,
      listen: false,
      replayLimit: 100,
    });
    const reader = stream.getReader();

    // 3. Exercise the boundary: an event published the instant the subscriber
    //    has registered its live listener but (conceptually) before replay has
    //    drained. The stream must surface it exactly once, after the backlog,
    //    with no loss or duplication across the replay→live boundary.
    const BOUNDARY_SEQ = BACKLOG; // 5
    const boundaryId = await publishSeq(db, "turn.appended", BOUNDARY_SEQ);
    await handleNotification(boundaryId, db);

    // 4. Replayed backlog arrives oldest→newest.
    const replayed = await readDataFrames(reader, BACKLOG);
    expect(replayed.map(seqOf)).toEqual([0, 1, 2, 3, 4]);

    // 5. Publish MORE events live (seqs 6..9) and simulate NOTIFY for each.
    const liveSeqs = [BOUNDARY_SEQ + 1, BOUNDARY_SEQ + 2, BOUNDARY_SEQ + 3, BOUNDARY_SEQ + 4];
    for (const seq of liveSeqs) {
      const id = await publishSeq(db, "turn.appended", seq);
      await handleNotification(id, db);
    }

    // 6. The boundary event plus the live events arrive in order, once each.
    const live = await readDataFrames(reader, 1 + liveSeqs.length);
    expect(live.map(seqOf)).toEqual([BOUNDARY_SEQ, ...liveSeqs]);

    await reader.cancel();

    // 7. Across the whole session the subscriber saw all N = backlog+boundary+
    //    live events exactly once, in strict order — no gap, no duplicate.
    const all = [...replayed, ...live].map(seqOf);
    const N = BACKLOG + 1 + liveSeqs.length; // 5 + 1 + 4 = 10
    expect(all).toHaveLength(N);
    expect(all).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(new Set(all).size).toBe(N); // no duplicates
  });

  it("delivers events published entirely after connect to a subscriber that started with an empty backlog", async () => {
    const { db } = buildEventsDb();

    // No backlog: subscriber connects to an empty event log.
    const stream = createEventStream(undefined, {
      db,
      listen: false,
      replayLimit: 100,
    });
    const reader = stream.getReader();

    // Publish N purely-live events after connect.
    const N = 6;
    for (let i = 0; i < N; i++) {
      const id = await publishSeq(db, "decision.made", i);
      await handleNotification(id, db);
    }

    const received = await readDataFrames(reader, N);
    await reader.cancel();

    expect(received.map(seqOf)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(new Set(received.map(seqOf)).size).toBe(N);
  });
});
