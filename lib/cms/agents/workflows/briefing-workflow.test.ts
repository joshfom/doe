// lib/cms/agents/workflows/briefing-workflow.test.ts
//
// Focused UNIT test (NO fast-check) for the Briefing_Workflow's per-window
// element assembly and its failure/empty paths (task 7.2). The unit under test
// is the real `assembleBriefing(input, deps)` from `briefing-workflow.ts`,
// driven entirely over an INJECTED FAKE dispatcher — a function returning a
// canned `DispatchResult` per `toolName` (and, for morning, per period day) —
// so no real database, Mastra runtime, or network is involved.
//
// Coverage (Design §Components #3 per-window element table, §Error Handling;
// Requirements 2.1, 2.6, 3.1, 3.2, 3.6, 3.7):
//   • morning  — greeting + recap {completed, outstanding} from the prior-day
//                Stack + today's Stack present + invitesAdd === true.
//   • midday   — greeting + today's Stack present + recap === null +
//                invitesAdd === false (progress/remaining derivable from status).
//   • evening  — greeting + today's Stack present (completed/remaining derivable)
//                + recap === null + invitesAdd === false.
//   • empty sets → the "none remain"/"none completed" condition is represented
//                by empty Stack arrays / empty recap arrays (the §Data Models
//                Briefing shape has no separate marker field).
//   • window_unresolved — an invalid window value → { ok:false }.
//   • assembly_failed — get_pipeline_summary {ok:false} / malformed (no metrics)
//                / throws → { ok:false } with NO partial briefing; plus a
//                malformed periodDate and a missing userId.
//   • Stack-unavailable marker — list_stack {ok:false}/timeout while
//                get_pipeline_summary succeeds → ok:true with
//                briefing.stack === { unavailable: true } and greeting+recap intact.
//
// (Figure sourcing is covered by Property 7; RBAC scoping by Property 1.)

import { describe, it, expect } from "vitest";
import type { DispatchResult } from "../../ai/tools/dispatch";
import type { StackItem } from "../home/types";
import {
  assembleBriefing,
  type BriefingInput,
  type BriefingResult,
} from "./briefing-workflow";

// ── Fixtures ────────────────────────────────────────────────────────────────

const PERIOD_DATE = "2024-06-15";
const PRIOR_DATE = "2024-06-14";
const USER = "user_42";
const ROLES = ["rep"];

const mkItem = (
  id: string,
  status: "open" | "done",
  kind: StackItem["kind"] = "task",
): StackItem => ({
  id,
  kind,
  title: `stack item ${id}`,
  status,
  dueAt: null,
  leadPhoneHash: null,
});

const okStack = (items: StackItem[]): DispatchResult => ({
  ok: true,
  result: { items, truncatedAt: items.length },
});

const okPipeline = (
  metrics: Record<string, number | string> = { leadsToday: 3 },
): DispatchResult => ({
  ok: true,
  result: { scope: "rep", period: PERIOD_DATE, metrics },
});

const errResult = (code = "handler_error"): DispatchResult => ({
  ok: false,
  error: { code: code as never, message: "boom" },
});

/**
 * Build a fake injected dispatcher. `pipeline` answers `get_pipeline_summary`;
 * `stackByDay` answers `list_stack`, keyed by the `YYYY-MM-DD` prefix of the
 * dispatched `periodStart` (so morning's today/prior reads are distinguished).
 * A value may be a thunk to model a throw or a never-settling (timeout) promise.
 */
type Answer = DispatchResult | (() => DispatchResult | Promise<DispatchResult>);

function makeDispatch(config: {
  pipeline: Answer;
  stackByDay: Record<string, Answer>;
}) {
  const resolve = (a: Answer) => (typeof a === "function" ? a() : a);
  return async (toolName: string, input: unknown): Promise<DispatchResult> => {
    if (toolName === "get_pipeline_summary") {
      return resolve(config.pipeline);
    }
    if (toolName === "list_stack") {
      const start = (input as { periodStart?: string }).periodStart ?? "";
      const day = start.slice(0, 10);
      const answer = config.stackByDay[day];
      if (answer === undefined) {
        throw new Error(`briefing-workflow.test: no stack canned for day "${day}"`);
      }
      return resolve(answer);
    }
    throw new Error(`briefing-workflow.test: unexpected tool "${toolName}"`);
  };
}

const baseInput = (
  window: BriefingInput["window"],
  overrides: Partial<BriefingInput> = {},
): BriefingInput => ({
  userId: USER,
  window,
  periodDate: PERIOD_DATE,
  roles: ROLES,
  ...overrides,
});

/** Narrow a result to its success branch with a clear failure message. */
function expectOk(result: BriefingResult) {
  if (!result.ok) {
    throw new Error(`expected ok briefing, got failure: ${result.reason}`);
  }
  return result.briefing;
}

// ── Morning ───────────────────────────────────────────────────────────────────

describe("assembleBriefing — morning window (Req 2.1, 3.1)", () => {
  it("assembles greeting + recap (prior-day completed/outstanding) + today's stack + invitation to add", async () => {
    const today = [mkItem("t1", "open"), mkItem("t2", "open")];
    const prior = [
      mkItem("p_done1", "done"),
      mkItem("p_done2", "done"),
      mkItem("p_open1", "open"),
    ];
    const dispatch = makeDispatch({
      pipeline: okPipeline(),
      stackByDay: { [PERIOD_DATE]: okStack(today), [PRIOR_DATE]: okStack(prior) },
    });

    const briefing = expectOk(
      await assembleBriefing(baseInput("morning"), { dispatch, serverless: false }),
    );

    expect(briefing.window).toBe("morning");
    expect(briefing.greeting).toBe("Good morning");
    // Recap splits the prior day's Stack into completed + outstanding.
    expect(briefing.recap).not.toBeNull();
    expect(new Set(briefing.recap!.completed.map((i) => i.id))).toEqual(
      new Set(["p_done1", "p_done2"]),
    );
    expect(new Set(briefing.recap!.outstanding.map((i) => i.id))).toEqual(
      new Set(["p_open1"]),
    );
    // Today's Stack is present (an array, not the unavailable marker).
    expect(Array.isArray(briefing.stack)).toBe(true);
    expect(new Set((briefing.stack as StackItem[]).map((i) => i.id))).toEqual(
      new Set(["t1", "t2"]),
    );
    // Morning invites the user to add Stack_Items.
    expect(briefing.invitesAdd).toBe(true);
    expect(typeof briefing.assembledAt).toBe("string");
  });

  it("empty prior day → recap arrays empty ('none completed'/'none remain' derivable)", async () => {
    const dispatch = makeDispatch({
      pipeline: okPipeline(),
      stackByDay: {
        [PERIOD_DATE]: okStack([mkItem("t1", "open")]),
        [PRIOR_DATE]: okStack([]),
      },
    });

    const briefing = expectOk(
      await assembleBriefing(baseInput("morning"), { dispatch, serverless: false }),
    );

    expect(briefing.recap).toEqual({ completed: [], outstanding: [] });
  });
});

// ── Midday ──────────────────────────────────────────────────────────────────

describe("assembleBriefing — midday window (Req 3.1)", () => {
  it("greeting + today's stack present, recap null, invitesAdd false", async () => {
    const today = [mkItem("t1", "done"), mkItem("t2", "open"), mkItem("t3", "open")];
    const dispatch = makeDispatch({
      pipeline: okPipeline(),
      stackByDay: { [PERIOD_DATE]: okStack(today) },
    });

    const briefing = expectOk(
      await assembleBriefing(baseInput("midday"), { dispatch, serverless: false }),
    );

    expect(briefing.window).toBe("midday");
    expect(briefing.greeting).toBe("Good afternoon");
    expect(briefing.recap).toBeNull();
    expect(briefing.invitesAdd).toBe(false);
    // Progress + remaining outstanding are derivable from the present Stack's statuses.
    const stack = briefing.stack as StackItem[];
    expect(stack.filter((i) => i.status === "open").map((i) => i.id)).toEqual([
      "t2",
      "t3",
    ]);
  });

  it("empty today's stack → 'none remain' represented by an empty Stack array", async () => {
    const dispatch = makeDispatch({
      pipeline: okPipeline(),
      stackByDay: { [PERIOD_DATE]: okStack([]) },
    });

    const briefing = expectOk(
      await assembleBriefing(baseInput("midday"), { dispatch, serverless: false }),
    );

    expect(briefing.stack).toEqual([]);
  });
});

// ── Evening ─────────────────────────────────────────────────────────────────

describe("assembleBriefing — evening window (Req 3.2)", () => {
  it("greeting + today's stack present (completed/remaining derivable), recap null, invitesAdd false", async () => {
    const today = [mkItem("t1", "done"), mkItem("t2", "done"), mkItem("t3", "open")];
    const dispatch = makeDispatch({
      pipeline: okPipeline(),
      stackByDay: { [PERIOD_DATE]: okStack(today) },
    });

    const briefing = expectOk(
      await assembleBriefing(baseInput("evening"), { dispatch, serverless: false }),
    );

    expect(briefing.window).toBe("evening");
    expect(briefing.greeting).toBe("Good evening");
    expect(briefing.recap).toBeNull();
    expect(briefing.invitesAdd).toBe(false);
    const stack = briefing.stack as StackItem[];
    expect(stack.filter((i) => i.status === "done").map((i) => i.id)).toEqual([
      "t1",
      "t2",
    ]);
    expect(stack.filter((i) => i.status === "open").map((i) => i.id)).toEqual(["t3"]);
  });

  it("all-done today's stack → no outstanding remain (empty 'open' set)", async () => {
    const today = [mkItem("t1", "done"), mkItem("t2", "done")];
    const dispatch = makeDispatch({
      pipeline: okPipeline(),
      stackByDay: { [PERIOD_DATE]: okStack(today) },
    });

    const briefing = expectOk(
      await assembleBriefing(baseInput("evening"), { dispatch, serverless: false }),
    );

    const stack = briefing.stack as StackItem[];
    expect(stack.filter((i) => i.status === "open")).toEqual([]);
    expect(stack.filter((i) => i.status === "done").length).toBe(2);
  });

  it("all-open today's stack → none completed (empty 'done' set)", async () => {
    const today = [mkItem("t1", "open"), mkItem("t2", "open")];
    const dispatch = makeDispatch({
      pipeline: okPipeline(),
      stackByDay: { [PERIOD_DATE]: okStack(today) },
    });

    const briefing = expectOk(
      await assembleBriefing(baseInput("evening"), { dispatch, serverless: false }),
    );

    const stack = briefing.stack as StackItem[];
    expect(stack.filter((i) => i.status === "done")).toEqual([]);
  });
});

// ── window_unresolved (Req 3.6) ────────────────────────────────────────────────

describe("assembleBriefing — window_unresolved (Req 3.6)", () => {
  it("an invalid window value → { ok:false, reason:'window_unresolved' } and no briefing", async () => {
    const dispatch = makeDispatch({
      pipeline: okPipeline(),
      stackByDay: { [PERIOD_DATE]: okStack([mkItem("t1", "open")]) },
    });

    const result = await assembleBriefing(
      baseInput("nonsense" as never),
      { dispatch, serverless: false },
    );

    expect(result.ok).toBe(false);
    expect(result).toEqual({ ok: false, reason: "window_unresolved" });
  });
});

// ── assembly_failed (Req 3.7) ──────────────────────────────────────────────────

describe("assembleBriefing — assembly_failed (Req 3.7), no partial briefing", () => {
  it("get_pipeline_summary returns { ok:false } → assembly_failed", async () => {
    const dispatch = makeDispatch({
      pipeline: errResult(),
      stackByDay: { [PERIOD_DATE]: okStack([mkItem("t1", "open")]) },
    });

    const result = await assembleBriefing(baseInput("midday"), {
      dispatch,
      serverless: false,
    });

    expect(result).toEqual({ ok: false, reason: "assembly_failed" });
  });

  it("get_pipeline_summary returns malformed result (no metrics map) → assembly_failed", async () => {
    const dispatch = makeDispatch({
      pipeline: { ok: true, result: { scope: "rep", period: PERIOD_DATE } },
      stackByDay: { [PERIOD_DATE]: okStack([mkItem("t1", "open")]) },
    });

    const result = await assembleBriefing(baseInput("midday"), {
      dispatch,
      serverless: false,
    });

    expect(result).toEqual({ ok: false, reason: "assembly_failed" });
  });

  it("get_pipeline_summary dispatch throws → assembly_failed", async () => {
    const dispatch = makeDispatch({
      pipeline: () => {
        throw new Error("metrics view down");
      },
      stackByDay: { [PERIOD_DATE]: okStack([mkItem("t1", "open")]) },
    });

    const result = await assembleBriefing(baseInput("morning"), {
      dispatch,
      serverless: false,
    });

    expect(result).toEqual({ ok: false, reason: "assembly_failed" });
  });

  it("malformed periodDate → assembly_failed", async () => {
    const dispatch = makeDispatch({
      pipeline: okPipeline(),
      stackByDay: {},
    });

    const result = await assembleBriefing(
      baseInput("midday", { periodDate: "15-06-2024" }),
      { dispatch, serverless: false },
    );

    expect(result).toEqual({ ok: false, reason: "assembly_failed" });
  });

  it("missing userId → assembly_failed", async () => {
    const dispatch = makeDispatch({
      pipeline: okPipeline(),
      stackByDay: {},
    });

    const result = await assembleBriefing(
      baseInput("midday", { userId: "" }),
      { dispatch, serverless: false },
    );

    expect(result).toEqual({ ok: false, reason: "assembly_failed" });
  });
});

// ── Stack-unavailable marker (Req 2.6) ─────────────────────────────────────────

describe("assembleBriefing — Stack-unavailable marker (Req 2.6)", () => {
  it("list_stack { ok:false } while get_pipeline_summary succeeds → ok briefing with stack { unavailable:true } and no fabricated items", async () => {
    const dispatch = makeDispatch({
      pipeline: okPipeline(),
      stackByDay: { [PERIOD_DATE]: errResult("handler_error") },
    });

    const briefing = expectOk(
      await assembleBriefing(baseInput("midday"), { dispatch, serverless: false }),
    );

    expect(briefing.stack).toEqual({ unavailable: true });
    // Greeting still present; the figure path succeeded so assembly did not fail.
    expect(briefing.greeting).toBe("Good afternoon");
    expect(Array.isArray(briefing.figures)).toBe(true);
  });

  it("list_stack timeout while get_pipeline_summary succeeds → stack { unavailable:true }", async () => {
    const dispatch = makeDispatch({
      pipeline: okPipeline(),
      stackByDay: {
        [PERIOD_DATE]: () => new Promise<DispatchResult>(() => {}),
      },
    });

    const briefing = expectOk(
      await assembleBriefing(baseInput("midday"), {
        dispatch,
        serverless: false,
        timeoutMs: 5,
      }),
    );

    expect(briefing.stack).toEqual({ unavailable: true });
  });

  it("morning: today's stack unavailable but prior-day recap still assembled (greeting+recap intact)", async () => {
    const prior = [mkItem("p1", "done"), mkItem("p2", "open")];
    const dispatch = makeDispatch({
      pipeline: okPipeline(),
      stackByDay: {
        [PERIOD_DATE]: errResult("handler_error"),
        [PRIOR_DATE]: okStack(prior),
      },
    });

    const briefing = expectOk(
      await assembleBriefing(baseInput("morning"), { dispatch, serverless: false }),
    );

    expect(briefing.stack).toEqual({ unavailable: true });
    expect(briefing.greeting).toBe("Good morning");
    expect(briefing.recap).not.toBeNull();
    expect(briefing.recap!.completed.map((i) => i.id)).toEqual(["p1"]);
    expect(briefing.recap!.outstanding.map((i) => i.id)).toEqual(["p2"]);
    expect(briefing.invitesAdd).toBe(true);
  });
});
