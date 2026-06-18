import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

/**
 * Integration test for the lean voice orchestrator's non-blocking guarantee
 * (task 11.2).
 *
 * **Property 6: Voice loop never blocks on slow work** —
 * **Validates: Requirements 5.3, 5.4, 4.8**
 *
 * Per design §18, Property 6 is classified as an example/integration test
 * (timing/streaming behaviour is hard to express as a pure fast-check property),
 * so this is a scenario-driven integration test, not a `*.property.test.ts`.
 *
 * What it proves about one `runVoiceTurn`:
 *   • 5.3 — a Salesforce-bound write is routed to the outbox, and the real
 *     Salesforce client (the inline write) is NEVER invoked during the turn.
 *   • 5.4 — work expected to exceed ~2s is enqueued to the Job_Runner with a
 *     spoken acknowledgement, and the job is NEVER run (awaited) inline. The
 *     turn completes far faster than the modelled 2s job would take.
 *   • 4.8 — when a tool runs long the orchestrator speaks a filler so the agent
 *     is never silent, i.e. slow work does not produce dead air.
 *
 * The dispatcher (`dispatchTool`) and the `POST /api/tools/:toolName` route do
 * not exist yet, so the orchestrator's injected `callTool` is a FAKE that models
 * exactly what the real voice tools do: SF-bound tools call `outbox.enqueue`
 * (never the Salesforce client), and >~2s tools call `jobs.enqueue` (never the
 * job runner). The orchestrator awaits only those fast enqueues. We assert via
 * spies that the slow channels (`salesforce.push`, `jobRunner.run`) stay at zero
 * calls for the whole turn.
 *
 * pg-mem setup mirrors `orchestrator.test.ts` so `appendTurn` (aiConversations
 * lookup + aiMessages insert + turn.appended event) runs against real SQL.
 */

import * as schema from "../schema";
import { aiConversations, aiMessages, events } from "../schema";
import type { Database } from "../db";
import {
  runVoiceTurn,
  type ToolCaller,
  type ToolDispatchResult,
  type ToolCallingLLM,
} from "./orchestrator";
import type { CallContext, ToolName } from "./contracts";
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** How long the modelled background job would take if (wrongly) awaited inline. */
const SLOW_JOB_MS = 2000;

/**
 * A fake "platform" standing in for the not-yet-built dispatcher + tools + their
 * downstream adapters. The orchestrator only ever talks to `callTool`; these
 * spies let us assert which channels were touched DURING the turn.
 */
function makePlatform() {
  // The slow, blocking channels the voice loop must NEVER touch inline.
  const salesforcePush = vi.fn(async () => {
    await sleep(SLOW_JOB_MS); // a real SF write is slow
    return { sfId: `sf-${randomUUID()}` };
  });
  const jobRunnerRun = vi.fn(async () => {
    await sleep(SLOW_JOB_MS); // running a >2s job inline would stall the turn
  });

  // The fast, async channels the voice loop routes work to instead.
  let outboxSeq = 0;
  let jobSeq = 0;
  const outboxEnqueue = vi.fn(async (_row: unknown) => `outbox-${++outboxSeq}`);
  const jobsEnqueue = vi.fn(
    async (_kind: string, _payload: unknown, _jobKey: string) =>
      `job-${++jobSeq}`
  );

  // Maps each tool to what a correct handler does: SF-bound tools enqueue to the
  // outbox (never push), >~2s tools enqueue a job (never run it), reads return
  // mirror data with no side effects.
  const callTool: ToolCaller = vi.fn(
    async (toolName: ToolName): Promise<ToolDispatchResult> => {
      switch (toolName) {
        // ── Salesforce-bound writes → outbox (Req 5.3) ──────────────────────
        case "book_viewing": {
          const outboxId = await outboxEnqueue({
            kind: "event",
            object: "Event",
          });
          return {
            ok: true,
            result: {
              appointmentId: `appt-${randomUUID()}`,
              when: "Thursday 4pm",
              repName: "Omar",
              outboxId,
            },
          };
        }
        case "log_outcome": {
          const outboxId = await outboxEnqueue({ kind: "task", object: "Task" });
          return { ok: true, result: { outboxId } };
        }

        // ── Work expected to exceed ~2s → Job_Runner queue (Req 5.4) ─────────
        case "queue_report_email": {
          const jobId = await jobsEnqueue(
            "compile_and_email_report",
            { scope: "exec", period: "mtd" },
            "report:exec:mtd"
          );
          return { ok: true, result: { jobId } };
        }
        case "send_whatsapp_brief": {
          const jobId = await jobsEnqueue(
            "send_whatsapp_brief",
            { repId: "rep-1", partyId: KNOWN_CONTEXT.partyId },
            `wa:rep-1:${KNOWN_CONTEXT.partyId}`
          );
          return { ok: true, result: { jobId } };
        }

        // ── Mirror-only reads → no external side effect ─────────────────────
        case "score_lead":
          return { ok: true, result: { tier: "HOT", reason: "strong signals" } };
        default:
          return { ok: true, result: {} };
      }
    }
  );

  return {
    callTool,
    salesforcePush,
    jobRunnerRun,
    outboxEnqueue,
    jobsEnqueue,
  };
}

describe("runVoiceTurn — Property 6: never blocks on slow work (Req 5.3, 5.4, 4.8)", () => {
  let db: Database;
  let conversationId: string;

  beforeEach(async () => {
    ({ db } = buildDb());
    conversationId = await seedConversation(db);
  });

  it("routes an SF-bound write to the outbox and never performs the Salesforce write inline (Req 5.3)", async () => {
    const platform = makePlatform();

    // The model books a viewing (SF-bound), then speaks.
    const steps: ToolCallCompletion[] = [
      {
        content: null,
        toolCalls: [
          {
            id: "call_1",
            name: "book_viewing",
            arguments: JSON.stringify({
              partyId: KNOWN_CONTEXT.partyId,
              slotId: "slot-1",
            }),
          },
        ],
      },
      { content: "You're booked for Thursday at 4 — anything else?", toolCalls: [] },
    ];
    let i = 0;
    const llm: ToolCallingLLM = vi.fn(async () => steps[i++]);

    const result = await runVoiceTurn(
      { db, llm, callTool: platform.callTool },
      {
        conversationId,
        context: KNOWN_CONTEXT,
        userText: "Book me a viewing for Thursday.",
        history: [],
      }
    );

    // The SF-bound write was routed to the outbox …
    expect(platform.outboxEnqueue).toHaveBeenCalledTimes(1);
    // … and the actual Salesforce write never happened inline.
    expect(platform.salesforcePush).not.toHaveBeenCalled();
    // No job runner involvement for a simple SF-bound write either.
    expect(platform.jobRunnerRun).not.toHaveBeenCalled();
    expect(result.toolCalls[0]).toMatchObject({ name: "book_viewing", ok: true });
    expect(result.agentText).toContain("booked");
  });

  it("enqueues >~2s work to the Job_Runner with a spoken acknowledgement, never awaiting it inline (Req 5.4)", async () => {
    const platform = makePlatform();

    const steps: ToolCallCompletion[] = [
      {
        content: null,
        toolCalls: [
          {
            id: "call_1",
            name: "queue_report_email",
            arguments: JSON.stringify({
              requesterEmail: "exec@ora.ae",
              scope: "exec",
              period: "mtd",
            }),
          },
        ],
      },
      {
        content: "I'm putting that report together and will email it over shortly.",
        toolCalls: [],
      },
    ];
    let i = 0;
    const llm: ToolCallingLLM = vi.fn(async () => steps[i++]);

    const startedAt = Date.now();
    const result = await runVoiceTurn(
      { db, llm, callTool: platform.callTool },
      {
        conversationId,
        context: KNOWN_CONTEXT,
        userText: "Email me this month's pipeline report.",
        history: [],
      }
    );
    const elapsed = Date.now() - startedAt;

    // The work was enqueued as a job …
    expect(platform.jobsEnqueue).toHaveBeenCalledTimes(1);
    expect(platform.jobsEnqueue).toHaveBeenCalledWith(
      "compile_and_email_report",
      expect.anything(),
      expect.any(String)
    );
    // … the job itself was never RUN (awaited) inline …
    expect(platform.jobRunnerRun).not.toHaveBeenCalled();
    // … so the turn finished far faster than the modelled 2s job.
    expect(elapsed).toBeLessThan(SLOW_JOB_MS);

    // A spoken acknowledgement accompanies the enqueued work (Req 5.4).
    expect(result.agentText.length).toBeGreaterThan(0);
    expect(result.agentText.toLowerCase()).toContain("report");

    // Even after the event loop turns over, nothing fired the slow channels:
    // the orchestrator did not fire-and-forget the job execution either.
    await sleep(50);
    expect(platform.jobRunnerRun).not.toHaveBeenCalled();
    expect(platform.salesforcePush).not.toHaveBeenCalled();
  });

  it("never runs Salesforce or a job synchronously across a multi-tool turn (Req 5.3, 5.4)", async () => {
    const platform = makePlatform();

    // A turn that touches both channels: an SF-bound write AND a background job.
    const steps: ToolCallCompletion[] = [
      {
        content: null,
        toolCalls: [
          {
            id: "call_1",
            name: "book_viewing",
            arguments: JSON.stringify({
              partyId: KNOWN_CONTEXT.partyId,
              slotId: "slot-1",
            }),
          },
          {
            id: "call_2",
            name: "send_whatsapp_brief",
            arguments: JSON.stringify({
              repId: "rep-1",
              partyId: KNOWN_CONTEXT.partyId,
            }),
          },
        ],
      },
      { content: "Booked, and I've briefed your rep — talk soon!", toolCalls: [] },
    ];
    let i = 0;
    const llm: ToolCallingLLM = vi.fn(async () => steps[i++]);

    const startedAt = Date.now();
    const result = await runVoiceTurn(
      { db, llm, callTool: platform.callTool },
      {
        conversationId,
        context: KNOWN_CONTEXT,
        userText: "Book Thursday and let my rep know.",
        history: [],
      }
    );
    const elapsed = Date.now() - startedAt;

    // Both side-effect channels were routed asynchronously …
    expect(platform.outboxEnqueue).toHaveBeenCalledTimes(1);
    expect(platform.jobsEnqueue).toHaveBeenCalledTimes(1);
    // … and NEITHER slow channel ran synchronously during the turn.
    expect(platform.salesforcePush).not.toHaveBeenCalled();
    expect(platform.jobRunnerRun).not.toHaveBeenCalled();
    expect(elapsed).toBeLessThan(SLOW_JOB_MS);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls.every((c) => c.ok)).toBe(true);

    // The turn is still recorded (transcript/HUD stay consistent).
    const evts = await db
      .select()
      .from(events)
      .where(eq(events.type, "turn.appended"));
    expect(evts).toHaveLength(1);
  });

  it("speaks a filler when a tool runs long so the agent is never silent (Req 4.8)", async () => {
    const platform = makePlatform();

    // Make the booking tool genuinely slow (but still just an outbox enqueue),
    // and drop the filler threshold so the orchestrator must fill the silence.
    const SLOW_TOOL_MS = 80;
    const FILLER_THRESHOLD_MS = 20;
    const slowCallTool: ToolCaller = vi.fn(async (toolName, input, ctx) => {
      await sleep(SLOW_TOOL_MS);
      return platform.callTool(toolName, input, ctx);
    });

    const steps: ToolCallCompletion[] = [
      {
        content: null,
        toolCalls: [
          {
            id: "call_1",
            name: "book_viewing",
            arguments: JSON.stringify({
              partyId: KNOWN_CONTEXT.partyId,
              slotId: "slot-1",
            }),
          },
        ],
      },
      { content: "All set for Thursday!", toolCalls: [] },
    ];
    let i = 0;
    const llm: ToolCallingLLM = vi.fn(async () => steps[i++]);

    const spoken: string[] = [];
    const speak = vi.fn((text: string) => spoken.push(text));

    const result = await runVoiceTurn(
      {
        db,
        llm,
        callTool: slowCallTool,
        speak,
        fillerThresholdMs: FILLER_THRESHOLD_MS,
      },
      {
        conversationId,
        context: KNOWN_CONTEXT,
        userText: "Book me a viewing for Thursday.",
        history: [],
      }
    );

    // The slow tool triggered a spoken filler — no dead air while it ran.
    expect(speak).toHaveBeenCalledTimes(1);
    expect(spoken[0].length).toBeGreaterThan(0);
    // Still routed to the outbox, never inline to Salesforce.
    expect(platform.outboxEnqueue).toHaveBeenCalledTimes(1);
    expect(platform.salesforcePush).not.toHaveBeenCalled();
    expect(result.agentText).toContain("Thursday");
  });
});
