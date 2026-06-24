import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Example / integration tests for the shared pre-run preview route
 * `POST /api/prospecting/preview` (task 12.5, example-based — NOT property
 * tests; Property 20 in `prospecting.preview.property.test.ts` owns the
 * side-effect-free invariant across random inputs). These pin two concrete,
 * human-checkable behaviours of the preview surface:
 *
 *   - CAPPED sample (Req 14.2): given a provider that returns MORE candidates
 *     than the configured sample size, the preview returns AT MOST
 *     `PREVIEW_SAMPLE_SIZE` (6) read-only, `phoneHash`-only sample prospects and
 *     AT MOST `PREVIEW_MESSAGE_COUNT` (3) illustrative Sample_Messages — never
 *     the full provider result, never a raw phone.
 *   - Representative fallback on trial limit (Req 14.8): when the trial-tier
 *     market source taps out (`find_comparables` fails) AND the live provider
 *     search yields nothing, the preview does NOT dead-end — it substitutes
 *     deterministic representative comparables (`marketDataNote: "trial_limit"`,
 *     `marketDataSource: "demo"`) and a representative, clearly-flagged
 *     (`representative: true`) sample drawn from the offline DemoProvider.
 *
 * The harness mirrors the sibling `prospecting.batches.test.ts` /
 * `prospecting.queue.test.ts` example suites: the EXISTING Elysia app is driven
 * in-process via `app.handle(new Request(...))`, RBAC is mocked to an
 * authenticated `leads:read` rep, and the audited boundary (`dispatchTool`) is a
 * spy whose `find_comparables` / `prospect_search` results are configured per
 * test. `generateCompletion` is stubbed offline so message composition never
 * touches the network. The DemoProvider and `buildDemoComparables` are the REAL
 * offline/synthetic modules (the preview's actual fallback), not mocked.
 */

// A deterministic salt so `candidateToSampleProspect`'s phone hashing is stable.
process.env.PHONE_HASH_SALT =
  process.env.PHONE_HASH_SALT ?? "preview-example-test-salt";

// The preview surface caps (kept in sync with `prospecting.ts`).
const PREVIEW_SAMPLE_SIZE = 6;
const PREVIEW_MESSAGE_COUNT = 3;

// ── Hoisted holder: configurable dispatch results + RBAC toggle ──────────────

const h = vi.hoisted(() => {
  const fn = vi.fn;
  return {
    // When `find_comparables` should fail (trial-limit), set ok:false.
    comparablesOk: true,
    comparables: [] as unknown[],
    // The candidates `prospect_search` resolves to (set per test).
    candidates: [] as unknown[],
    // Tool names dispatched, in order — asserted to be read-only.
    dispatched: [] as string[],
    denyPermission: false,
    generateCompletion: fn(async () =>
      JSON.stringify({
        subject: "An opportunity in the Bayn community",
        body: "Dear investor,\n\nA short, grounded note.\n\nWarm regards,",
      })
    ),
  };
});

// The preview route reads `db` only on the briefId branch; these tests use ICP
// subjects, so a minimal stub suffices.
vi.mock("../../db", () => ({
  get db() {
    return {} as unknown;
  },
}));

vi.mock("../../rbac/middleware", () => {
  const { Elysia } = require("elysia");
  return {
    identityGuard: new Elysia({ name: "identityGuard" }).derive(
      { as: "scoped" },
      () => ({ userId: "rep-user-id", userType: "employee", isActive: true })
    ),
    requirePermission: () =>
      new Elysia({ name: "requirePermission:leads:read" })
        .derive({ as: "scoped" }, () => ({
          resolvedPermissions: h.denyPermission ? [] : ["leads:read"],
        }))
        .onBeforeHandle({ as: "scoped" }, (ctx: any) => {
          if (h.denyPermission) {
            ctx.set.status = 403;
            return { error: "Access denied", required: "leads:read" };
          }
        }),
  };
});

// The audited boundary: `find_comparables` / `prospect_search` are the only
// reads a preview performs; their results are configured per test.
vi.mock("../../ai/tools/dispatch", () => ({
  dispatchTool: vi.fn(async (_db: unknown, toolName: string) => {
    h.dispatched.push(toolName);
    if (toolName === "find_comparables") {
      return h.comparablesOk
        ? { ok: true, result: { comparables: h.comparables, unconfigured: false } }
        : { ok: false, error: { code: "rate_limited", message: "trial limit" } };
    }
    if (toolName === "prospect_search") {
      return {
        ok: true,
        result: {
          candidates: h.candidates,
          unconfiguredProviders: [],
          failedProviders: [],
          rateLimitedProviders: [],
        },
      };
    }
    return { ok: true, result: {} };
  }),
}));
vi.mock("../../ai/tools/prospecting-capabilities", () => ({
  PROSPECTING_AGENT_ACTOR: "agent:prospecting",
  PROSPECTING_OUTREACH_AGENT_ACTOR: "agent:outreach",
}));

vi.mock("../../ai/gateway", () => ({ generateCompletion: h.generateCompletion }));

// Collaborators the preview route does NOT exercise on the ICP path — mocked so
// imports stay lean (mirrors the sibling batches/queue example suites).
vi.mock("../../prospecting/batch/send-cap", () => ({
  capExhausted: vi.fn(async () => false),
  recordSend: vi.fn(async () => ({})),
  incrementScope: vi.fn(async () => ({})),
}));
vi.mock("../../prospecting/batch/rerun-key", () => ({
  deriveRerunKey: vi.fn(() => "rerun-key-fixed"),
}));
vi.mock("../../prospecting/optout", () => ({ isOptedOut: vi.fn(async () => false) }));
vi.mock("../../prospecting/batch/claim", () => ({ releaseClaim: vi.fn() }));
vi.mock("../../prospecting/batch/activity", () => ({ readActivity: vi.fn(async () => []) }));
vi.mock("../../prospecting/own-subject", () => ({ resolveComparisonSpec: vi.fn() }));
vi.mock("../../prospecting/crm-check", () => ({ checkCrmForContact: vi.fn() }));
vi.mock("../../jobs", () => ({ enqueueJob: vi.fn() }));
vi.mock("../../realtime/events", () => ({ publishEvent: vi.fn() }));
vi.mock("../../realtime/subscribe", () => ({ streamEvents: vi.fn() }));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { Elysia } from "elysia";
import { prospectingRoutes } from "./prospecting";

async function preview(body: unknown): Promise<{ status: number; body: any }> {
  const res = await new Elysia().use(prospectingRoutes).handle(
    new Request("http://localhost/prospecting/preview", {
      method: "POST",
      headers: { Cookie: "ora_session=valid", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  return { status: res.status, body: await res.json() };
}

/** A SQL-grounded comparable row shaped as `deriveHypothesis` reads it. */
function comparable(name: string): unknown {
  return {
    marketProjectId: `mp-${name}`,
    name,
    communityName: "Bayn",
    segment: "branded_residence",
    score: 0.9,
    stats: {
      buyerSegmentMix: {
        value: [{ segment: "investor", count: 12, pct: 60 }],
        source: "market_transactions",
        asOf: "2026-01-15T00:00:00.000Z",
      },
    },
  };
}

/** A raw provider candidate carrying a raw phone (must surface as hash only). */
function candidate(i: number): unknown {
  return {
    targetType: "person",
    displayName: `Candidate ${i}`,
    companyName: `Acme ${i}`,
    title: "Founder",
    email: `c${i}@example.com`,
    phone: `+97150000${String(1000 + i).slice(-4)}`,
    country: "AE",
    sourceProvider: "apollo",
    lawfulBasis: "legitimate_interest",
  };
}

const ICP_SUBJECT = {
  kind: "icp" as const,
  icpFilter: { targetType: "person", titles: ["Founder"], geography: ["India"] },
};

describe("POST /api/prospecting/preview — capped sample (Req 14.2)", () => {
  beforeEach(() => {
    h.comparablesOk = true;
    h.comparables = [comparable("Bayn Tower"), comparable("Marina Vista")];
    h.candidates = [];
    h.dispatched = [];
    h.denyPermission = false;
  });

  it("caps the read-only sample at PREVIEW_SAMPLE_SIZE and the messages at PREVIEW_MESSAGE_COUNT even when the provider returns more", async () => {
    // The provider returns DOUBLE the sample size of candidates.
    h.candidates = Array.from({ length: PREVIEW_SAMPLE_SIZE * 2 }, (_, i) =>
      candidate(i)
    );

    const { status, body } = await preview({ subject: ICP_SUBJECT });

    expect(status).toBe(200);

    // Capped to the configured sample size (Req 14.2) — never the full result.
    expect(body.sampleProspects).toHaveLength(PREVIEW_SAMPLE_SIZE);
    // At most a few illustrative messages, drawn from the sampled prospects.
    expect(body.sampleMessages.length).toBeLessThanOrEqual(PREVIEW_MESSAGE_COUNT);
    expect(body.sampleMessages).toHaveLength(PREVIEW_MESSAGE_COUNT);

    // Live market source (find_comparables returned rows), not a fallback.
    expect(body.marketDataSource).toBe("live");
    expect(body.marketDataNote).toBeNull();
    expect(body.representative).toBe(false);

    // Read-only, phoneHash-only sample — no raw phone leaks (CC-Privacy).
    for (const sp of body.sampleProspects) {
      expect(sp).not.toHaveProperty("phone");
      expect(Object.prototype.hasOwnProperty.call(sp, "phoneHash")).toBe(true);
    }

    // The only audited dispatches a preview performs are the two reads.
    expect(h.dispatched).toContain("find_comparables");
    expect(h.dispatched).toContain("prospect_search");
    for (const tool of h.dispatched) {
      expect(["find_comparables", "prospect_search"]).toContain(tool);
    }
  });

  it("returns a sample no larger than the provider result when the provider returns fewer than the cap", async () => {
    h.candidates = [candidate(1), candidate(2)]; // fewer than the cap
    const { status, body } = await preview({ subject: ICP_SUBJECT });
    expect(status).toBe(200);
    expect(body.sampleProspects).toHaveLength(2);
    expect(body.representative).toBe(false);
  });
});

describe("POST /api/prospecting/preview — representative fallback on trial limit (Req 14.8)", () => {
  beforeEach(() => {
    h.comparablesOk = true;
    h.comparables = [];
    h.candidates = [];
    h.dispatched = [];
    h.denyPermission = false;
  });

  it("substitutes representative comparables and a representative sample (not a failure) when the trial market source taps out and the live search is empty", async () => {
    // Trial-tier market read fails AND the live provider search yields nothing.
    h.comparablesOk = false;
    h.candidates = [];

    const { status, body } = await preview({ subject: ICP_SUBJECT });

    // Never a dead-end — a successful, clearly-flagged representative preview.
    expect(status).toBe(200);

    // Representative comparables substituted with an honest provenance note.
    expect(body.marketDataNote).toBe("trial_limit");
    expect(body.marketDataSource).toBe("demo");
    expect(Array.isArray(body.comparables)).toBe(true);
    expect(body.comparables.length).toBeGreaterThan(0);

    // Representative sample prospects drawn from the offline DemoProvider, with
    // a clear representative indication (Req 14.8) — capped and phoneHash-only.
    expect(body.representative).toBe(true);
    expect(body.sampleProspects.length).toBeGreaterThan(0);
    expect(body.sampleProspects.length).toBeLessThanOrEqual(PREVIEW_SAMPLE_SIZE);
    expect(body.rateLimitedProviders).toContain("apollo");
    for (const sp of body.sampleProspects) {
      expect(sp).not.toHaveProperty("phone");
      expect(Object.prototype.hasOwnProperty.call(sp, "phoneHash")).toBe(true);
    }
  });

  it("falls back to a representative sample when the live search is empty even if comparables are live", async () => {
    h.comparablesOk = true;
    h.comparables = [comparable("Bayn Tower")];
    h.candidates = []; // provider returned nothing → representative prospects

    const { status, body } = await preview({ subject: ICP_SUBJECT });
    expect(status).toBe(200);
    expect(body.representative).toBe(true);
    expect(body.sampleProspects.length).toBeGreaterThan(0);
  });
});
