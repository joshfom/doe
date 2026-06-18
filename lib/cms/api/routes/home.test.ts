import { describe, it, expect, vi } from "vitest";

/**
 * Focused unit tests for the Agent-First Home routes (task 11).
 *
 * **Validates: Requirements 1.6, 1.7, 5.2, 5.3, 5.5, 11.1**
 *
 * These exercise the route's extracted, dependency-injected service functions
 * directly over fakes (no real DB, no agent runtime, no `@mastra` import), the
 * same DI style the sibling `briefing-assembly.ts`/`createBriefingAssemblyHandler`
 * uses. They cover:
 *   - cache-first HIT (the workflow is NOT run) vs MISS (the workflow runs and
 *     the result is stored) — Req 5.2, 5.3;
 *   - the assembly-failure path returns a structured unavailable reason and
 *     stores nothing (so the surface shows "briefing unavailable") — Req 1.6;
 *   - `GET /home/health` returns the `AvailabilityProbe { available, latencyMs }`
 *     shape — Req 11.1;
 *   - the SSE-bus invalidation listener maps a Tool_Dispatcher mutation event
 *     onto `invalidateBriefingCache` and ignores non-mutation events — Req 5.5;
 *   - window/period resolution from the request's local-time hints.
 */

import {
  serveBriefing,
  probeAgentHealth,
  createBriefingInvalidationListener,
  resolveWindowAndPeriod,
  runHomeChatTurn,
  affectedUserId,
  type BriefingServiceDeps,
} from "./home";
import type { Database } from "../../db";
import type { Briefing } from "../../agents/home/types";
import type { DoeEvent } from "../../realtime/events";

// A stub DB handle — every accessor that would touch it is injected as a fake.
const fakeDb = {} as Database;

function makeBriefing(overrides: Partial<Briefing> = {}): Briefing {
  return {
    userId: "user-1",
    window: "morning",
    periodDate: "2024-03-10",
    greeting: "Good morning",
    recap: null,
    stack: [],
    figures: [],
    invitesAdd: true,
    assembledAt: "2024-03-10T06:30:00.000Z",
    ...overrides,
  };
}

// ── GET /home/briefing — cache-first vs miss (Req 5.2, 5.3) ───────────────────

describe("serveBriefing — cache-first vs miss", () => {
  it("serves a non-expired cache HIT without running the workflow (Req 5.2)", async () => {
    const cached = makeBriefing({ greeting: "cached" });
    const assemble = vi.fn(async () => {
      throw new Error("workflow must not run on a cache hit");
    });
    const writeCache = vi.fn(async () => {});
    const deps: BriefingServiceDeps = {
      readCache: vi.fn(async () => cached),
      writeCache,
      assemble,
    };

    const result = await serveBriefing(
      fakeDb,
      { userId: "user-1", roles: ["rep"], window: "morning", periodDate: "2024-03-10" },
      deps
    );

    expect(result).toEqual({ ok: true, briefing: cached, cached: true });
    expect(assemble).not.toHaveBeenCalled();
    expect(writeCache).not.toHaveBeenCalled();
  });

  it("runs the workflow on a MISS and stores the assembled briefing (Req 5.3)", async () => {
    const assembled = makeBriefing({ greeting: "assembled" });
    const assemble = vi.fn(async () => ({ ok: true as const, briefing: assembled }));
    const writeCache = vi.fn(async () => {});
    const deps: BriefingServiceDeps = {
      readCache: vi.fn(async () => null),
      writeCache,
      assemble,
    };

    const result = await serveBriefing(
      fakeDb,
      { userId: "user-1", roles: ["rep"], window: "midday", periodDate: "2024-03-10" },
      deps
    );

    expect(result).toEqual({ ok: true, briefing: assembled, cached: false });
    expect(assemble).toHaveBeenCalledTimes(1);
    expect(assemble).toHaveBeenCalledWith({
      userId: "user-1",
      roles: ["rep"],
      window: "midday",
      periodDate: "2024-03-10",
    });
    expect(writeCache).toHaveBeenCalledTimes(1);
    expect(writeCache).toHaveBeenCalledWith(
      fakeDb,
      { userId: "user-1", window: "midday", periodDate: "2024-03-10" },
      assembled
    );
  });

  it("returns a structured unavailable reason and stores nothing on assembly failure (Req 1.6, 3.7)", async () => {
    const writeCache = vi.fn(async () => {});
    const deps: BriefingServiceDeps = {
      readCache: vi.fn(async () => null),
      writeCache,
      assemble: vi.fn(async () => ({ ok: false as const, reason: "assembly_failed" as const })),
    };

    const result = await serveBriefing(
      fakeDb,
      { userId: "user-1", roles: [], window: "evening", periodDate: "2024-03-10" },
      deps
    );

    expect(result).toEqual({ ok: false, reason: "assembly_failed" });
    expect(writeCache).not.toHaveBeenCalled();
  });
});

// ── GET /home/health — Agent_Availability_Check shape (Req 11.1) ──────────────

describe("probeAgentHealth — AvailabilityProbe shape", () => {
  it("reports available with a non-negative latency when the runtime loads", async () => {
    let t = 1000;
    const probe = await probeAgentHealth(
      async () => ({ name: "homeAgent" }),
      () => (t += 5) // 1005 at start, 1010 at end → 5ms
    );

    expect(probe).toEqual({ available: true, latencyMs: 5 });
    expect(typeof probe.available).toBe("boolean");
    expect(typeof probe.latencyMs).toBe("number");
  });

  it("reports unavailable when the runtime fails to load", async () => {
    const probe = await probeAgentHealth(
      async () => {
        throw new Error("runtime down");
      },
      () => Date.now()
    );

    expect(probe.available).toBe(false);
    expect(probe.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

// ── SSE invalidation listener (Req 5.5) ───────────────────────────────────────

describe("createBriefingInvalidationListener — invalidation on mutation", () => {
  const fixedNow = () => new Date("2024-03-10T09:00:00.000Z");

  it("invalidates the affected user's current-period cache on a Stack mutation event", () => {
    const invalidate = vi.fn(async () => {});
    const listener = createBriefingInvalidationListener(fakeDb, {
      invalidate,
      now: fixedNow,
    });

    const event: DoeEvent = {
      id: "evt-1",
      type: "lead.routed",
      payload: { repId: "user-7", leadId: "lead-9" },
      at: "2024-03-10T09:00:00.000Z",
    };
    listener(event);

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith(fakeDb, "user-7", "2024-03-10");
  });

  it("ignores events that are not Stack mutations", () => {
    const invalidate = vi.fn(async () => {});
    const listener = createBriefingInvalidationListener(fakeDb, {
      invalidate,
      now: fixedNow,
    });

    listener({
      id: "evt-2",
      type: "job.queued",
      payload: { userId: "user-7" },
      at: "2024-03-10T09:00:00.000Z",
    });

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("ignores a mutation event that carries no resolvable affected user", () => {
    const invalidate = vi.fn(async () => {});
    const listener = createBriefingInvalidationListener(fakeDb, {
      invalidate,
      now: fixedNow,
    });

    listener({
      id: "evt-3",
      type: "lead.enriched",
      payload: { leadId: "lead-9" },
      at: "2024-03-10T09:00:00.000Z",
    });

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("resolves the affected user from the priority-ordered payload keys", () => {
    expect(affectedUserId({ userId: "u1", repId: "u2" })).toBe("u1");
    expect(affectedUserId({ repId: "u2" })).toBe("u2");
    expect(affectedUserId({ assigneeId: "u3" })).toBe("u3");
    expect(affectedUserId({})).toBeNull();
    expect(affectedUserId(null)).toBeNull();
  });
});

// ── Window / period resolution from local-time hints (Req 1.2, 3.3, 3.6) ──────

describe("resolveWindowAndPeriod", () => {
  it("classifies the user's local time into the right window + period", () => {
    expect(
      resolveWindowAndPeriod({ now: "2024-03-10T06:30:00.000Z", tzOffset: 0 })
    ).toEqual({ ok: true, window: "morning", periodDate: "2024-03-10" });

    expect(
      resolveWindowAndPeriod({ now: "2024-03-10T13:00:00.000Z", tzOffset: 0 })
    ).toEqual({ ok: true, window: "midday", periodDate: "2024-03-10" });

    expect(
      resolveWindowAndPeriod({ now: "2024-03-10T19:00:00.000Z", tzOffset: 0 })
    ).toEqual({ ok: true, window: "evening", periodDate: "2024-03-10" });
  });

  it("applies the tz offset so the local calendar day can roll across UTC midnight", () => {
    // 22:00 UTC + 4h (Dubai) → 02:00 local the NEXT day → evening, next period.
    expect(
      resolveWindowAndPeriod({ now: "2024-03-10T22:00:00.000Z", tzOffset: 240 })
    ).toEqual({ ok: true, window: "evening", periodDate: "2024-03-11" });
  });

  it("returns window_unresolved for an unparseable now hint (Req 3.6)", () => {
    expect(resolveWindowAndPeriod({ now: "not-a-date" })).toEqual({
      ok: false,
      reason: "window_unresolved",
    });
  });
});

// ── POST /home/chat — retain-input-on-failure semantics (Req 1.7) ─────────────

describe("runHomeChatTurn — retain-input-on-failure", () => {
  it("returns the agent response on a successful turn", async () => {
    const response = await runHomeChatTurn(
      { userId: "user-1", roles: ["rep"], body: { message: "hi" } },
      async () => ({ ok: true, response: "hello", modelTier: "fast" })
    );

    expect(response).toEqual({ ok: true, response: "hello", modelTier: "fast" });
  });

  it("retains input when the turn is unreachable (agent throws)", async () => {
    const response = await runHomeChatTurn(
      { userId: "user-1", roles: ["rep"], body: { message: "hi" } },
      async () => {
        throw new Error("runtime unreachable");
      }
    );

    expect(response).toMatchObject({
      ok: false,
      retainInput: true,
      reason: "agent_unreachable",
    });
  });

  it("retains input on a budget-exceeded turn", async () => {
    const response = await runHomeChatTurn(
      { userId: "user-1", roles: ["rep"], body: { message: "hi" } },
      async () => ({ ok: false, reason: "budget_exceeded" })
    );

    expect(response).toMatchObject({
      ok: false,
      retainInput: true,
      reason: "budget_exceeded",
    });
  });

  it("rejects an empty message while retaining input", async () => {
    const runTurn = vi.fn();
    const response = await runHomeChatTurn(
      { userId: "user-1", roles: [], body: { message: "   " } },
      runTurn as never
    );

    expect(response).toMatchObject({
      ok: false,
      retainInput: true,
      reason: "invalid_input",
    });
    expect(runTurn).not.toHaveBeenCalled();
  });
});
