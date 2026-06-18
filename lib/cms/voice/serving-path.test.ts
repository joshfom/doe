import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

import * as schema from "@/lib/cms/schema";
import { agentMigrationFlags } from "@/lib/cms/schema";
import type { Database } from "@/lib/cms/db";

/**
 * Tests for the voice serving-path router (S6 task 3.3).
 *
 *  - **Property 7 — serving-path default safety**: no/disabled flag ⇒ "lean";
 *    only `mode === "agent" && enabled === true` ⇒ "agent" (R4.1).
 *  - **Fallback**: an agent-path throw falls back to the lean path, records a
 *    divergence, and the fallback still dispatches through the injected
 *    (audited) `callTool` (R4.2, R4.3).
 *
 * The lean `runVoiceTurn` and the Mastra `runVoiceAgentTurn` are mocked so the
 * router's routing/fallback logic is tested in isolation (no live model / no
 * aiMessages persistence), against a real `agent_migration_flags` table under
 * pg-mem (so routeCapability / recordDivergence run genuine SQL).
 */

// Mock the agent path: importing it lazily inside the router returns this stub.
const runVoiceAgentTurn = vi.fn();
vi.mock("@/lib/cms/agents/voice-agent", () => ({
  runVoiceAgentTurn: (...args: unknown[]) => runVoiceAgentTurn(...args),
}));

// Mock the lean orchestrator so the router's fallback target is observable.
const runVoiceTurn = vi.fn();
vi.mock("@/lib/cms/voice/orchestrator", () => ({
  runVoiceTurn: (...args: unknown[]) => runVoiceTurn(...args),
}));

import {
  selectVoiceServingPath,
  runVoiceTurnRouted,
} from "@/lib/cms/voice/serving-path";

const MIGRATION_FILE = "0032_concerned_typhoid_mary.sql";
const PREREQUISITE_SQL = `
  CREATE TABLE "users" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
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
  mem.public.none(PREREQUISITE_SQL);
  const migrationSql = readFileSync(
    join(process.cwd(), "drizzle", MIGRATION_FILE),
    "utf-8",
  );
  for (const stmt of splitStatements(migrationSql)) mem.public.none(stmt);

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

async function setFlag(
  db: Database,
  mode: "agent" | "deterministic",
  enabled: boolean,
): Promise<void> {
  await db
    .insert(agentMigrationFlags)
    .values({ capability: "voice_lead", mode, enabled })
    .onConflictDoUpdate({
      target: agentMigrationFlags.capability,
      set: { mode, enabled, updatedAt: new Date() },
    });
}

describe("voice serving-path router", () => {
  let db: Database;

  beforeAll(() => {
    ({ db } = buildDb());
  });

  it('defaults to "lean" with no flag row (Property 7, R4.1)', async () => {
    expect(await selectVoiceServingPath(db)).toBe("lean");
  });

  it('returns "agent" only when mode === "agent" && enabled (Property 7)', async () => {
    await setFlag(db, "deterministic", true);
    expect(await selectVoiceServingPath(db)).toBe("lean");

    await setFlag(db, "agent", false);
    expect(await selectVoiceServingPath(db)).toBe("lean");

    await setFlag(db, "agent", true);
    expect(await selectVoiceServingPath(db)).toBe("agent");
  });

  it("falls back to lean on an agent throw, records a divergence, and still dispatches through callTool (R4.2, R4.3)", async () => {
    runVoiceAgentTurn.mockReset();
    runVoiceTurn.mockReset();

    // Route to the agent path...
    await setFlag(db, "agent", true);
    // ...but make it throw (e.g. budget breach).
    runVoiceAgentTurn.mockRejectedValueOnce(new Error("budget exceeded"));

    // The lean fallback dispatches a tool through the injected audited caller.
    const callTool = vi.fn().mockResolvedValue({ ok: true, result: {} });
    runVoiceTurn.mockImplementationOnce(async (deps: { callTool: typeof callTool }) => {
      await deps.callTool("score_lead", { partyId: "p1" }, {
        conversationId: "c1",
        context: { language: "en" },
      });
      return { agentText: "ok", toolCalls: [], latency: {} };
    });

    const turn = {
      conversationId: "c1",
      context: { partyId: "p1", known: false, language: "en" as const },
      userText: "hi",
      history: [],
    };
    const result = await runVoiceTurnRouted(
      { db, callTool } as never,
      turn as never,
    );

    expect(runVoiceAgentTurn).toHaveBeenCalledTimes(1);
    expect(runVoiceTurn).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(result.agentText).toBe("ok");

    // A divergence was recorded so the capability is re-validated before re-enable.
    const [flag] = await db
      .select()
      .from(agentMigrationFlags)
      .where(eq(agentMigrationFlags.capability, "voice_lead"))
      .limit(1);
    expect(flag?.lastDivergenceAt).not.toBeNull();
  });

  it("runs lean directly (no agent call) when routed to lean", async () => {
    runVoiceAgentTurn.mockReset();
    runVoiceTurn.mockReset();
    runVoiceTurn.mockResolvedValueOnce({
      agentText: "lean",
      toolCalls: [],
      latency: {},
    });

    await setFlag(db, "deterministic", true);
    const turn = {
      conversationId: "c2",
      context: { partyId: "p2", known: false, language: "en" as const },
      userText: "hi",
      history: [],
    };
    await runVoiceTurnRouted({ db, callTool: vi.fn() } as never, turn as never);

    expect(runVoiceAgentTurn).not.toHaveBeenCalled();
    expect(runVoiceTurn).toHaveBeenCalledTimes(1);
  });
});
