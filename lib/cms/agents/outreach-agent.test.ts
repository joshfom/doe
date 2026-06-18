// lib/cms/agents/outreach-agent.test.ts
//
// Unit tests for the Outreach_Agent (S7 task 6.1).
//
// Validates: Requirements 6.1, 6.2, 6.3, 6.4, 8.1.
//  - the agent is granted EXACTLY `draft_outreach` and is NOT granted the
//    human-gated `send_outreach` nor any navigator tool (8.1);
//  - it declares the `premium` tier routed through the `doe` CF gateway;
//  - a turn composes a draft for the requested channel + language and returns it
//    editable and UNSENT (6.1, 6.3);
//  - every claim with no SQL source is OMITTED from the persisted manifest and
//    flagged back to the rep (6.2);
//  - the container-tier guard refuses a serverless invocation.
//
// The model gateway is never hit: the turn runner is exercised through its
// `agent` test seam. No database is required.

import { describe, it, expect, vi } from "vitest";

import {
  PROSPECTING_OUTREACH_AGENT_ACTOR,
  PROSPECTING_CAPABILITY_NAMES,
  loadProspectingCapabilities,
} from "@/lib/cms/ai/tools/prospecting-capabilities";
import { bindCatalog } from "@/lib/cms/agents/binding";
import {
  OUTREACH_AGENT_MODEL,
  OUTREACH_AGENT_MODEL_TIER,
  OUTREACH_AGENT_NAME,
  OUTREACH_AGENT_TOOL_NAMES,
  OutreachAgentTierError,
  assertOutreachContainerTier,
  extractDraft,
  filterGroundedClaims,
  outreachAgent,
  runOutreachAgentTurn,
  type OutreachAgentLike,
} from "@/lib/cms/agents/outreach-agent";
import { MODEL_TIERS } from "@/lib/cms/agents/gateway";
import type { OutreachDraft } from "@/lib/cms/prospecting/outreach";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TARGET_ID = "11111111-1111-4111-8111-111111111111";
const RECORD_ID = "22222222-2222-4222-8222-222222222222";

/** A draft whose every grounding claim resolves to a real SQL record. */
const GROUNDED_DRAFT: OutreachDraft = {
  targetId: TARGET_ID,
  channel: "email",
  language: "en",
  subject: "A quiet note on Palm Jumeirah",
  body: "Comparable branded villas have transacted around AED 42M recently.",
  grounding: [
    {
      claim: "Comparable branded villas transacted around AED 42M",
      sourceTable: "market_transactions",
      recordId: RECORD_ID,
      asOf: "2026-01-15T00:00:00.000Z",
    },
  ],
};

/** A mock agent whose `generate` returns a controlled Mastra-shaped result. */
function mockAgent(
  result: unknown,
): OutreachAgentLike & { generate: ReturnType<typeof vi.fn> } {
  return { generate: vi.fn().mockResolvedValue(result) };
}

// ── Construction & RBAC grant (Requirement 8.1) ──────────────────────────────

describe("Outreach_Agent construction (Requirement 8.1)", () => {
  it("is granted exactly draft_outreach and never the send/navigator tools", () => {
    expect([...OUTREACH_AGENT_TOOL_NAMES]).toEqual(["draft_outreach"]);
    expect(OUTREACH_AGENT_TOOL_NAMES).not.toContain("send_outreach");
    expect(OUTREACH_AGENT_TOOL_NAMES).not.toContain("find_comparables");
    expect(OUTREACH_AGENT_TOOL_NAMES).not.toContain("prospect_search");
    expect(OUTREACH_AGENT_TOOL_NAMES).not.toContain("promote_target_to_lead");
  });

  it("only grants names that exist in the prospecting catalog", () => {
    for (const name of OUTREACH_AGENT_TOOL_NAMES) {
      expect(PROSPECTING_CAPABILITY_NAMES).toContain(name);
    }
  });

  it("dispatches under the agent:outreach identity on the premium tier", () => {
    expect(PROSPECTING_OUTREACH_AGENT_ACTOR).toBe("agent:outreach");
    expect(OUTREACH_AGENT_MODEL_TIER).toBe("premium");
    expect(OUTREACH_AGENT_MODEL).toBe(`doe/cf/${MODEL_TIERS.premium}`);
  });

  it("binds exactly one tool per granted name (1:1) under the outreach identity", () => {
    const load = loadProspectingCapabilities();
    expect(load.ok).toBe(true);
    if (!load.ok) return;

    const bound = bindCatalog(load.catalog, [...OUTREACH_AGENT_TOOL_NAMES], {
      agentActor: PROSPECTING_OUTREACH_AGENT_ACTOR,
    });
    expect(Object.keys(bound).sort()).toEqual([...OUTREACH_AGENT_TOOL_NAMES].sort());
    expect(outreachAgent.name).toBe(OUTREACH_AGENT_NAME);
  });
});

// ── Grounding manifest filtering (Requirement 6.2) ────────────────────────────

describe("filterGroundedClaims", () => {
  it("keeps claims pinned to a real SQL record", () => {
    const { grounding, flaggedClaims } = filterGroundedClaims(GROUNDED_DRAFT.grounding);
    expect(grounding).toEqual(GROUNDED_DRAFT.grounding);
    expect(flaggedClaims).toEqual([]);
  });

  it("omits and flags claims with no SQL source (blank recordId)", () => {
    const { grounding, flaggedClaims } = filterGroundedClaims([
      ...GROUNDED_DRAFT.grounding,
      {
        claim: "Prices will rise 20% next quarter",
        sourceTable: "market_price_index",
        recordId: "   ",
        asOf: "2026-01-15T00:00:00.000Z",
      },
    ]);
    expect(grounding).toEqual(GROUNDED_DRAFT.grounding);
    expect(flaggedClaims).toEqual(["Prices will rise 20% next quarter"]);
  });
});

// ── Draft extraction ──────────────────────────────────────────────────────────

describe("extractDraft", () => {
  it("returns a validated draft from structured output", () => {
    expect(extractDraft({ object: GROUNDED_DRAFT })).toEqual(GROUNDED_DRAFT);
  });

  it("returns null when there is no structured output", () => {
    expect(extractDraft({ text: "no object" })).toBeNull();
    expect(extractDraft(null)).toBeNull();
    expect(extractDraft(undefined)).toBeNull();
  });

  it("returns null when the structured output fails schema validation", () => {
    expect(extractDraft({ object: { ...GROUNDED_DRAFT, channel: "carrier-pigeon" } })).toBeNull();
    expect(extractDraft({ object: { ...GROUNDED_DRAFT, language: "fr" } })).toBeNull();
  });
});

// ── Container-tier guard ([container-only]) ───────────────────────────────────

describe("assertOutreachContainerTier", () => {
  it("refuses a serverless invocation", () => {
    expect(() => assertOutreachContainerTier(true)).toThrow(OutreachAgentTierError);
  });

  it("permits a container/worker invocation", () => {
    expect(() => assertOutreachContainerTier(false)).not.toThrow();
  });
});

// ── runOutreachAgentTurn (Requirements 6.1, 6.2, 6.3) ─────────────────────────

describe("runOutreachAgentTurn", () => {
  it("composes an editable, grounded draft and surfaces the persisted draft id", async () => {
    const draftId = "33333333-3333-4333-8333-333333333333";
    const agent = mockAgent({
      text: "Drafted a discreet intro.",
      object: GROUNDED_DRAFT,
      toolResults: [
        {
          payload: {
            toolName: "draft_outreach",
            result: { draftId, status: "draft", draft: GROUNDED_DRAFT },
          },
        },
      ],
    });

    const out = await runOutreachAgentTurn(
      {
        message: "Draft an intro for this villa",
        targetId: TARGET_ID,
        channel: "email",
        language: "en",
      },
      { agent, serverless: false },
    );

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.draft).toEqual(GROUNDED_DRAFT);
    expect(out.flaggedClaims).toEqual([]);
    expect(out.draftId).toBe(draftId);
    expect(out.modelTier).toBe("premium");

    // The draft was requested as structured output so it can be ground-filtered.
    const [, genOptions] = agent.generate.mock.calls[0];
    expect(genOptions).toHaveProperty("output");
  });

  it("omits and flags an ungrounded claim from the returned draft (Requirement 6.2)", async () => {
    const ungrounded: OutreachDraft = {
      ...GROUNDED_DRAFT,
      grounding: [
        ...GROUNDED_DRAFT.grounding,
        {
          claim: "Inventory is almost gone",
          sourceTable: "market_transactions",
          recordId: "",
          asOf: "2026-01-15T00:00:00.000Z",
        },
      ],
    };
    const agent = mockAgent({ text: "", object: ungrounded, toolResults: [] });

    const out = await runOutreachAgentTurn(
      { message: "Draft it", targetId: TARGET_ID, channel: "whatsapp", language: "ar" },
      { agent, serverless: false },
    );

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.draft?.grounding).toEqual(GROUNDED_DRAFT.grounding);
    expect(out.flaggedClaims).toEqual(["Inventory is almost gone"]);
    expect(out.draftId).toBeNull();
  });

  it("returns a null draft when the agent produced no valid structured draft", async () => {
    const agent = mockAgent({ text: "I have nothing grounded to write.", toolResults: [] });

    const out = await runOutreachAgentTurn(
      { message: "Draft it", targetId: TARGET_ID, channel: "message", language: "en" },
      { agent, serverless: false },
    );

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.draft).toBeNull();
    expect(out.flaggedClaims).toEqual([]);
  });

  it("refuses to run on the serverless tier before invoking the model", async () => {
    const agent = mockAgent({ text: "", toolResults: [] });
    await expect(
      runOutreachAgentTurn(
        { message: "hi", targetId: TARGET_ID, channel: "email", language: "en" },
        { agent, serverless: true },
      ),
    ).rejects.toBeInstanceOf(OutreachAgentTierError);
    expect(agent.generate).not.toHaveBeenCalled();
  });
});
