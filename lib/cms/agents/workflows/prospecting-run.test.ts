// lib/cms/agents/workflows/prospecting-run.test.ts
//
// Unit tests for the `prospecting-run` workflow (S7 task 5.2).
//
// Drives the REAL `runProspectingRun(input, deps)` over INJECTED FAKES for all
// four collaborators — the audited dispatcher, the Prospecting_Agent turn, the
// Agent_Memory writer, and the SSE publisher — so no live model, dispatcher,
// database, or memory store is touched.
//
// Coverage (Design §Components #1, #3, #4; Requirements 2.1, 3.1, 3.4, 10.1,
// 10.2, 10.5, 10.6, 8.1, 9.2):
//   • brief-led phase 1 — publishes brief.received + comparables.found, runs the
//     agent (which proposes the editable hypothesis) and PAUSES awaiting rep
//     edit (Req 10.1, 10.2, 10.6);
//   • brief-led resume — a rep-edited hypothesis builds the search filter and
//     runs prospect_search → record_target → enrich_target, publishing the
//     search.completed / target.recorded / target.enriched lifecycle events and
//     storing each Target's research in Agent_Memory keyed `target:{id}`
//     (Req 2.1, 3.1, 3.4);
//   • ICP-led — skips the proposal and runs the search phase immediately (10.5);
//   • per-candidate failure isolation, search failure, budget halt, no entry;
//   • PRIVACY — no raw phone reaches any event payload or memory record (9.2);
//   • the hypothesis→filter pure helper and the container-tier guard.

import { describe, it, expect, vi } from "vitest";

import type { DispatchResult } from "../../ai/tools/dispatch";
import type { ProspectingBrief } from "../../prospecting/brief";
import type { BuyerHypothesis } from "../../prospecting/hypothesis";
import type { MemoryKey } from "../memory";
import type { ProspectingAgentTurnResult } from "../prospecting-agent";
import {
  ProspectingRunTierError,
  assertProspectingRunContainerTier,
  hypothesisToFilter,
  runProspectingRun,
  targetMemoryKey,
  type ProspectingDispatch,
  type ProspectingMemoryStore,
  type ProspectingRunDeps,
  type ProspectingRunEvent,
  type TargetResearchRecord,
} from "./prospecting-run";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RAW_PHONE = "+971500000123";

const BRIEF: ProspectingBrief = {
  spec: {
    area: "Palm Jumeirah",
    segment: "ultra_luxury",
    unitType: "villa",
    bedrooms: 4,
    priceMinAed: 30_000_000,
    priceMaxAed: 50_000_000,
    features: ["sea view", "branded"],
  },
};

const HYPOTHESIS: BuyerHypothesis = {
  segments: ["post-liquidity founders", "family offices"],
  feederMarkets: ["India", "UK"],
  titles: ["Founder", "Managing Partner"],
  wealthSignals: ["recent exit"],
  evidence: [
    {
      claim: "Comparable villas transacted around AED 42M in the last year",
      sourceTable: "market_transactions",
      asOf: "2026-01-15T00:00:00.000Z",
    },
  ],
  confidence: "medium",
};

/** A candidate as `prospect_search` returns it (raw phone held transiently). */
const CANDIDATE = {
  targetType: "person",
  displayName: "A. Founder",
  companyName: "Acme Capital",
  title: "Founder",
  email: "founder@example.com",
  phone: RAW_PHONE,
  country: "India",
  attributes: {
    title: {
      value: "Founder",
      source: "apollo",
      asOf: "2026-01-10T00:00:00.000Z",
    },
  },
  sourceProvider: "apollo",
  sourceRef: "apollo:123",
  lawfulBasis: "legitimate_interest",
};

// ── Fake collaborators ──────────────────────────────────────────────────────

/** An agent-turn fake returning a canned successful brief-led turn. */
function okAgentTurn(
  hypothesis: BuyerHypothesis | null,
  comparables: unknown[] = [],
  unconfigured = false,
): ProspectingAgentTurnResult {
  return {
    ok: true,
    mode: "brief",
    response: "Here are the comparables and who tends to buy them.",
    toolResults: [
      {
        toolName: "find_comparables",
        result: { comparables, unconfigured },
      },
    ],
    hypothesis,
    hypothesisProposed: hypothesis !== null,
    modelTier: "premium",
  };
}

/** A recording memory store fake. */
function fakeMemory(): ProspectingMemoryStore & {
  writes: Array<{ key: MemoryKey; record: TargetResearchRecord }>;
} {
  const writes: Array<{ key: MemoryKey; record: TargetResearchRecord }> = [];
  return {
    writes,
    async saveResearch(key, record) {
      writes.push({ key, record });
    },
  };
}

/** A recording publisher fake. */
function fakePublisher(): {
  publish: (event: ProspectingRunEvent) => Promise<void>;
  events: ProspectingRunEvent[];
} {
  const events: ProspectingRunEvent[] = [];
  return {
    events,
    publish: async (event) => {
      events.push(event);
    },
  };
}

/**
 * A dispatcher fake answering per tool name from a canned table. A missing
 * entry throws, surfacing an unexpected dispatch in a test.
 */
function fakeDispatch(
  table: Record<string, DispatchResult | (() => DispatchResult)>,
): ProspectingDispatch & { calls: Array<{ tool: string; input: unknown }> } {
  const calls: Array<{ tool: string; input: unknown }> = [];
  const fn = (async (tool: string, input: unknown) => {
    calls.push({ tool, input });
    const answer = table[tool];
    if (answer === undefined) {
      throw new Error(`prospecting-run.test: no dispatch canned for "${tool}"`);
    }
    return typeof answer === "function" ? answer() : answer;
  }) as ProspectingDispatch & { calls: Array<{ tool: string; input: unknown }> };
  fn.calls = calls;
  return fn;
}

/** Build a full deps bundle, overriding any seam. */
function makeDeps(overrides: Partial<ProspectingRunDeps> = {}): ProspectingRunDeps {
  return {
    dispatch: fakeDispatch({}),
    runAgentTurn: vi.fn().mockResolvedValue(okAgentTurn(HYPOTHESIS)),
    memory: fakeMemory(),
    publish: fakePublisher().publish,
    serverless: false,
    now: () => new Date("2026-02-01T00:00:00.000Z"),
    ...overrides,
  };
}

const eventTypes = (events: ProspectingRunEvent[]) => events.map((e) => e.type);

// ── hypothesisToFilter (pure) ─────────────────────────────────────────────────

describe("hypothesisToFilter", () => {
  it("maps feeder markets → geography, titles, wealth signals, segments → keywords", () => {
    const filter = hypothesisToFilter(HYPOTHESIS, "person", 10);
    expect(filter.targetType).toBe("person");
    expect(filter.geography).toEqual(["India", "UK"]);
    expect(filter.titles).toEqual(["Founder", "Managing Partner"]);
    expect(filter.wealthSignals).toEqual(["recent exit"]);
    expect(filter.keywords).toEqual([
      "post-liquidity founders",
      "family offices",
    ]);
    expect(filter.limit).toBe(10);
  });

  it("drops empty arrays so providers see only meaningful seeds", () => {
    const filter = hypothesisToFilter(
      { ...HYPOTHESIS, feederMarkets: [], titles: [], wealthSignals: [], segments: [] },
      "company",
    );
    expect(filter.targetType).toBe("company");
    expect(filter.geography).toBeUndefined();
    expect(filter.titles).toBeUndefined();
    expect(filter.wealthSignals).toBeUndefined();
    expect(filter.keywords).toBeUndefined();
  });
});

// ── targetMemoryKey ─────────────────────────────────────────────────────────

describe("targetMemoryKey", () => {
  it("builds a target:{id} resource key (scope:'resource')", () => {
    expect(targetMemoryKey("abc")).toEqual({ resourceId: "target:abc" });
  });

  it("rejects an empty id", () => {
    expect(() => targetMemoryKey("  ")).toThrow();
  });
});

// ── Container-tier guard ──────────────────────────────────────────────────────

describe("assertProspectingRunContainerTier", () => {
  it("refuses a serverless invocation", () => {
    expect(() => assertProspectingRunContainerTier(true)).toThrow(
      ProspectingRunTierError,
    );
  });
  it("permits a container/worker invocation", () => {
    expect(() => assertProspectingRunContainerTier(false)).not.toThrow();
  });
  it("refuses before any work when run serverless", async () => {
    const deps = makeDeps({ serverless: true });
    await expect(runProspectingRun({ brief: BRIEF }, deps)).rejects.toBeInstanceOf(
      ProspectingRunTierError,
    );
  });
});

// ── Brief-led phase 1: propose + pause (Req 10.1, 10.2, 10.6) ─────────────────

describe("runProspectingRun — brief-led proposal phase", () => {
  it("publishes brief.received + comparables.found and pauses awaiting the hypothesis", async () => {
    const publisher = fakePublisher();
    const comparables = [
      { marketProjectId: "mp1", name: "Comp One" },
      { marketProjectId: "mp2", name: "Comp Two" },
    ];
    const runAgentTurn = vi
      .fn()
      .mockResolvedValue(okAgentTurn(HYPOTHESIS, comparables));
    const deps = makeDeps({ publish: publisher.publish, runAgentTurn });

    const result = await runProspectingRun({ brief: BRIEF }, deps);

    expect(result).toEqual({
      status: "awaiting_hypothesis",
      hypothesis: HYPOTHESIS,
      comparablesFound: 2,
    });

    // The agent was asked for a brief-led turn.
    expect(runAgentTurn).toHaveBeenCalledTimes(1);
    expect(runAgentTurn.mock.calls[0][0]).toMatchObject({ brief: BRIEF });

    // The workflow owns brief.received + comparables.found (Req 10.1, 10.2).
    expect(eventTypes(publisher.events)).toEqual([
      "prospecting.brief.received",
      "prospecting.comparables.found",
    ]);
    const found = publisher.events[1].payload as {
      count: number;
      marketProjectIds: string[];
    };
    expect(found.count).toBe(2);
    expect(found.marketProjectIds).toEqual(["mp1", "mp2"]);
  });

  it("does NOT run prospect_search during the proposal phase (await rep edit)", async () => {
    const dispatch = fakeDispatch({}); // any dispatch would throw
    const deps = makeDeps({ dispatch });

    await runProspectingRun({ brief: BRIEF }, deps);

    expect(dispatch.calls).toEqual([]);
  });

  it("surfaces a budget halt as an error", async () => {
    const runAgentTurn = vi.fn().mockResolvedValue({
      ok: false,
      reason: "budget_exceeded",
      budgetExceeded: { reason: "steps", usedTokens: 0, usedSteps: 99 },
    } satisfies ProspectingAgentTurnResult);
    const deps = makeDeps({ runAgentTurn });

    const result = await runProspectingRun({ brief: BRIEF }, deps);

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.reason).toBe("agent_budget_exceeded");
    }
  });
});

// ── Brief-led resume: search → record → enrich (Req 2.1, 3.1, 3.4) ────────────

describe("runProspectingRun — brief-led search phase (resume with edited hypothesis)", () => {
  it("runs prospect_search → record_target → enrich_target, stores research keyed target:{id}", async () => {
    const publisher = fakePublisher();
    const memory = fakeMemory();
    const dispatch = fakeDispatch({
      prospect_search: {
        ok: true,
        result: {
          candidates: [CANDIDATE],
          unconfiguredProviders: ["pdl"],
          failedProviders: [],
        },
      },
      record_target: {
        ok: true,
        result: { targetId: "t-1", phoneHash: "hash-1" },
      },
      enrich_target: {
        ok: true,
        result: {
          targetId: "t-1",
          attributes: {
            netWorth: {
              value: "UHNWI",
              source: "crunchbase",
              asOf: "2026-01-12T00:00:00.000Z",
            },
          },
          unconfiguredProviders: [],
          failedProviders: ["cognism"],
        },
      },
    });
    const deps = makeDeps({ dispatch, publish: publisher.publish, memory });

    const result = await runProspectingRun(
      { brief: BRIEF, hypothesis: HYPOTHESIS },
      deps,
    );

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.mode).toBe("brief");
    expect(result.candidateCount).toBe(1);
    expect(result.unconfiguredProviders).toEqual(["pdl"]);
    expect(result.targets).toEqual([
      { targetId: "t-1", targetType: "person", phoneHash: "hash-1", enriched: true },
    ]);

    // The dispatch order is search → record → enrich, all through the seam.
    expect(dispatch.calls.map((c) => c.tool)).toEqual([
      "prospect_search",
      "record_target",
      "enrich_target",
    ]);

    // The search filter was derived from the (rep-edited) hypothesis.
    const searchInput = dispatch.calls[0].input as { filter: { geography?: string[] } };
    expect(searchInput.filter.geography).toEqual(["India", "UK"]);

    // Research stored in Agent_Memory keyed target:{id} (Req 3.4).
    expect(memory.writes).toHaveLength(1);
    expect(memory.writes[0].key).toEqual({ resourceId: "target:t-1" });
    expect(memory.writes[0].record.targetId).toBe("t-1");
    expect(Object.keys(memory.writes[0].record.attributes)).toEqual(["netWorth"]);
    expect(memory.writes[0].record.failedProviders).toEqual(["cognism"]);

    // Lifecycle events: search.completed → target.recorded → target.enriched.
    expect(eventTypes(publisher.events)).toEqual([
      "prospecting.search.completed",
      "prospecting.target.recorded",
      "prospecting.target.enriched",
    ]);
  });

  it("PRIVACY: no raw phone appears in any event payload or memory record (Req 9.2)", async () => {
    const publisher = fakePublisher();
    const memory = fakeMemory();
    const dispatch = fakeDispatch({
      prospect_search: {
        ok: true,
        result: { candidates: [CANDIDATE], unconfiguredProviders: [], failedProviders: [] },
      },
      record_target: { ok: true, result: { targetId: "t-1", phoneHash: "hash-1" } },
      enrich_target: {
        ok: true,
        result: { targetId: "t-1", attributes: {}, unconfiguredProviders: [], failedProviders: [] },
      },
    });
    const deps = makeDeps({ dispatch, publish: publisher.publish, memory });

    await runProspectingRun({ icp: hypothesisToFilter(HYPOTHESIS) }, deps);

    const serialized =
      JSON.stringify(publisher.events) + JSON.stringify(memory.writes);
    expect(serialized).not.toContain(RAW_PHONE);
    // The salted hash IS allowed to appear in the recorded event.
    expect(JSON.stringify(publisher.events)).toContain("hash-1");
  });

  it("isolates a record_target failure (the candidate is skipped, run still completes)", async () => {
    const publisher = fakePublisher();
    const memory = fakeMemory();
    const dispatch = fakeDispatch({
      prospect_search: {
        ok: true,
        result: {
          candidates: [CANDIDATE, { ...CANDIDATE, email: "second@example.com" }],
          unconfiguredProviders: [],
          failedProviders: [],
        },
      },
      // First record fails, second succeeds.
      record_target: (() => {
        let n = 0;
        return () =>
          n++ === 0
            ? { ok: false, error: { code: "handler_error", message: "boom" } }
            : { ok: true, result: { targetId: "t-2", phoneHash: null } };
      })(),
      enrich_target: {
        ok: true,
        result: { targetId: "t-2", attributes: {}, unconfiguredProviders: [], failedProviders: [] },
      },
    });
    const deps = makeDeps({ dispatch, publish: publisher.publish, memory });

    const result = await runProspectingRun(
      { brief: BRIEF, hypothesis: HYPOTHESIS },
      deps,
    );

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.candidateCount).toBe(2);
    // Only the second candidate was recorded.
    expect(result.targets).toEqual([
      { targetId: "t-2", targetType: "person", phoneHash: null, enriched: true },
    ]);
    expect(memory.writes.map((w) => w.record.targetId)).toEqual(["t-2"]);
  });

  it("records the Target but stores no research when enrichment fails", async () => {
    const memory = fakeMemory();
    const publisher = fakePublisher();
    const dispatch = fakeDispatch({
      prospect_search: {
        ok: true,
        result: { candidates: [CANDIDATE], unconfiguredProviders: [], failedProviders: [] },
      },
      record_target: { ok: true, result: { targetId: "t-1", phoneHash: "hash-1" } },
      enrich_target: { ok: false, error: { code: "handler_error", message: "no providers" } },
    });
    const deps = makeDeps({ dispatch, publish: publisher.publish, memory });

    const result = await runProspectingRun(
      { brief: BRIEF, hypothesis: HYPOTHESIS },
      deps,
    );

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.targets).toEqual([
      { targetId: "t-1", targetType: "person", phoneHash: "hash-1", enriched: false },
    ]);
    // No research stored, and no target.enriched event.
    expect(memory.writes).toEqual([]);
    expect(eventTypes(publisher.events)).toEqual([
      "prospecting.search.completed",
      "prospecting.target.recorded",
    ]);
  });

  it("returns search_failed when prospect_search dispatch fails", async () => {
    const dispatch = fakeDispatch({
      prospect_search: { ok: false, error: { code: "handler_error", message: "down" } },
    });
    const deps = makeDeps({ dispatch });

    const result = await runProspectingRun(
      { brief: BRIEF, hypothesis: HYPOTHESIS },
      deps,
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.reason).toBe("search_failed");
    }
  });
});

// ── ICP-led entry (Req 10.5) ───────────────────────────────────────────────────

describe("runProspectingRun — ICP-led entry", () => {
  it("skips the proposal and runs the search phase immediately", async () => {
    const publisher = fakePublisher();
    const runAgentTurn = vi.fn();
    const dispatch = fakeDispatch({
      prospect_search: {
        ok: true,
        result: { candidates: [], unconfiguredProviders: [], failedProviders: [] },
      },
    });
    const deps = makeDeps({ dispatch, publish: publisher.publish, runAgentTurn });

    const result = await runProspectingRun(
      { icp: { targetType: "intermediary", geography: ["DIFC"] } },
      deps,
    );

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.mode).toBe("icp");
    expect(result.candidateCount).toBe(0);

    // The agent (and hence the model) is never invoked on the ICP-led path.
    expect(runAgentTurn).not.toHaveBeenCalled();
    // No brief.received / comparables.found — only search.completed.
    expect(eventTypes(publisher.events)).toEqual(["prospecting.search.completed"]);
    // The ICP filter passed straight through to prospect_search.
    expect((dispatch.calls[0].input as { filter: unknown }).filter).toEqual({
      targetType: "intermediary",
      geography: ["DIFC"],
    });
  });
});

// ── No entry point ─────────────────────────────────────────────────────────────

describe("runProspectingRun — no entry point", () => {
  it("returns no_entry_point when neither a brief nor an ICP filter is given", async () => {
    const result = await runProspectingRun({}, makeDeps());
    expect(result).toEqual({ status: "error", reason: "no_entry_point" });
  });
});
