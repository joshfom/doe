import { describe, it, expect, beforeEach, vi } from "vitest";
import fc from "fast-check";

/**
 * Property 10 — Bulk approval accounting (Requirements 5.2, 5.3, 5.4).
 *
 * `POST /api/prospecting/queue/bulk-approve` loops a selected set of Queued_Items
 * and applies the SAME per-item send-time gate the single-item approve route
 * uses (via the shared `approveAndSendQueueItem` helper): opt-out re-check → cap
 * re-check (rep + cluster) → approve_outreach → send_outreach → recordSend. The
 * loop NEVER aborts on a blocked item — an item targeting an opted-out prospect
 * is skipped `opted_out` (Req 5.3) and an item that would exceed a Send_Cap is
 * skipped `cap_reached` (Req 5.2); processing continues. It returns
 * `{ approved, sent, skipped: [{ id, reason }] }` (Req 5.4).
 *
 * This property pins down the ACCOUNTING the route must always satisfy across
 * an arbitrary selection of items in mixed states (opted-out, over-cap,
 * sendable):
 *
 *   (a) Every selected id is accounted for exactly once:
 *       `approved + skipped.length === selected.length`.
 *   (b) `sent <= approved` — an item can be approved without being sent, but a
 *       send never happens without an approval.
 *   (c) Every skipped entry carries a NON-EMPTY reason.
 *   (d) Opted-out items and cap-exceeded items appear in `skipped` (never sent),
 *       with the `opted_out` / `cap_reached` reason respectively.
 *
 * The route is driven in-process via Elysia's `app.handle(new Request(...))`
 * (mirroring the sibling `lib/cms/api/routes/prospecting.queue.test.ts`
 * harness). The db is mocked with a configurable holder serving the selected
 * rows; the per-item gate collaborators (`isOptedOut`, `capExhausted`,
 * `dispatchTool`) are mocked so each generated item's state can be driven
 * deterministically. The heavy collaborators the bulk route never touches are
 * mocked away.
 *
 * Tag: Feature: agentic-prospecting-batch, Property 10: Bulk approval accounting
 */

const NUM_RUNS = Number(process.env.PBT_RUNS ?? 25);
const REP_USER_ID = "rep-user-id";

// ── Configurable holder (set per fast-check sample, read by the mocks) ────────

const h = vi.hoisted(() => ({
  // Rows the bulk select() chain resolves to (the rep's selected queue items).
  selectRows: [] as Array<{
    id: string;
    draftId: string | null;
    clusterId: string | null;
    targetEmail: string | null;
    targetPhoneHash: string | null;
  }>,
  // Item emails (used as the opt-out identity key) that are opted out.
  optedOutEmails: new Set<string>(),
  // Cluster ids whose cluster-scope cap is exhausted (per-item over-cap state).
  overCapClusters: new Set<string>(),
}));

// db: select chain resolves to h.selectRows; update is a no-op thenable-free
// builder (the route awaits it but never reads its result).
vi.mock("../../db", () => {
  function makeSelectBuilder() {
    const builder: Record<string, unknown> = {
      from: () => builder,
      innerJoin: () => builder,
      leftJoin: () => builder,
      where: () => builder,
      orderBy: () => builder,
      limit: () => builder,
      then(onF: (v: unknown[]) => unknown, onR?: (e: unknown) => unknown) {
        return Promise.resolve(h.selectRows).then(onF, onR);
      },
    };
    return builder;
  }
  return {
    get db() {
      return {
        select: () => makeSelectBuilder(),
        update() {
          const builder: Record<string, unknown> = {
            set: () => builder,
            where: () => builder,
            returning: () => Promise.resolve([]),
          };
          return builder;
        },
      };
    },
  };
});

// RBAC: pass through as an authenticated employee rep with leads:read.
vi.mock("../../rbac/middleware", () => {
  const { Elysia } = require("elysia");
  return {
    identityGuard: new Elysia({ name: "identityGuard" }).derive(
      { as: "scoped" },
      () => ({ userId: REP_USER_ID, userType: "employee", isActive: true })
    ),
    requirePermission: () =>
      new Elysia({ name: "requirePermission:leads:read" }).derive(
        { as: "scoped" },
        () => ({ resolvedPermissions: ["leads:read"] })
      ),
  };
});

// Per-item gate collaborators — driven by the holder.
vi.mock("../optout", () => ({
  isOptedOut: vi.fn(async (_db: unknown, { emailHash }: { emailHash?: string }) =>
    emailHash != null && h.optedOutEmails.has(emailHash)
  ),
}));

vi.mock("./send-cap", () => ({
  // A cluster-scope read is exhausted when its scopeId is in the over-cap set;
  // the rep scope is never exhausted (rep budget always available) so a
  // sendable item clears the gate.
  capExhausted: vi.fn(
    async (_db: unknown, { scopeKind, scopeId }: { scopeKind: string; scopeId: string }) =>
      scopeKind === "cluster" && h.overCapClusters.has(scopeId)
  ),
  recordSend: vi.fn(async () => {}),
  incrementScope: vi.fn(async () => {}),
  remainingBudget: vi.fn(async () => 1),
}));

// dispatchTool: approve_outreach issues a token; send_outreach confirms sent.
vi.mock("../../ai/tools/dispatch", () => ({
  dispatchTool: vi.fn(async (_db: unknown, tool: string) => {
    if (tool === "approve_outreach") {
      return { ok: true, result: { token: "tok-1", status: "approved" } };
    }
    if (tool === "send_outreach") {
      return { ok: true, result: { sent: true, status: "sent", messageId: "msg-1" } };
    }
    return { ok: true, result: {} };
  }),
}));

// Collaborators the bulk route does NOT touch — mocked so the import stays lean.
vi.mock("../../ai/tools/prospecting-capabilities", () => ({
  PROSPECTING_AGENT_ACTOR: "agent:prospecting",
  PROSPECTING_OUTREACH_AGENT_ACTOR: "agent:outreach",
}));
vi.mock("../crm-check", () => ({ checkCrmForContact: vi.fn() }));
vi.mock("./claim", () => ({ releaseClaim: vi.fn(async () => {}) }));
vi.mock("./activity", () => ({ readActivity: vi.fn() }));
vi.mock("./rerun-key", () => ({ deriveRerunKey: vi.fn() }));
vi.mock("../own-subject", () => ({ resolveComparisonSpec: vi.fn() }));
vi.mock("../../jobs", () => ({ enqueueJob: vi.fn() }));
vi.mock("../../ai/gateway", () => ({ generateCompletion: vi.fn() }));
vi.mock("../../realtime/subscribe", () => ({ streamEvents: vi.fn() }));
vi.mock("../../realtime/events", () => ({ publishEvent: vi.fn(async () => {}) }));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { Elysia } from "elysia";
import { prospectingRoutes } from "../../api/routes/prospecting";

function createApp() {
  return new Elysia().use(prospectingRoutes);
}

async function bulkApprove(
  ids: string[]
): Promise<{ status: number; body: any }> {
  const res = await createApp().handle(
    new Request("http://localhost/prospecting/queue/bulk-approve", {
      method: "POST",
      headers: { Cookie: "ora_session=valid", "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    })
  );
  return { status: res.status, body: await res.json() };
}

// ── Generator: a selected set of queue items in mixed states ──────────────────

type ItemState = "sendable" | "opted_out" | "over_cap";

const itemStateArb: fc.Arbitrary<ItemState> = fc.constantFrom(
  "sendable",
  "opted_out",
  "over_cap"
);

// Each item gets a unique id / draft / email / cluster derived from its index so
// the per-item state can be keyed off identity in the mocks without collisions.
const selectionArb = fc
  .array(itemStateArb, { minLength: 1, maxLength: 12 })
  .map((states) =>
    states.map((state, i) => ({
      state,
      id: `qi-${i}`,
      draftId: `draft-${i}`,
      clusterId: `cluster-${i}`,
      targetEmail: `email-${i}@example.com`,
      targetPhoneHash: `hash-${i}`,
    }))
  );

describe("POST /api/prospecting/queue/bulk-approve — Property 10: Bulk approval accounting (Req 5.2, 5.3, 5.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.selectRows = [];
    h.optedOutEmails = new Set();
    h.overCapClusters = new Set();
  });

  it("accounts for every selected id, sent <= approved, every skip has a reason, opted-out + over-cap items are skipped not sent", async () => {
    await fc.assert(
      fc.asyncProperty(selectionArb, async (items) => {
        // Wire the holder for this sample.
        h.selectRows = items.map((it) => ({
          id: it.id,
          draftId: it.draftId,
          clusterId: it.clusterId,
          targetEmail: it.targetEmail,
          targetPhoneHash: it.targetPhoneHash,
        }));
        h.optedOutEmails = new Set(
          items.filter((it) => it.state === "opted_out").map((it) => it.targetEmail)
        );
        h.overCapClusters = new Set(
          items.filter((it) => it.state === "over_cap").map((it) => it.clusterId)
        );

        const ids = items.map((it) => it.id);
        const { status, body } = await bulkApprove(ids);

        expect(status).toBe(200);

        const approved: number = body.approved;
        const sent: number = body.sent;
        const skipped: Array<{ id: string; reason: string }> = body.skipped;

        // (a) Every selected id is accounted for exactly once (Req 5.4).
        expect(approved + skipped.length).toBe(ids.length);

        // (b) A send never happens without an approval (Req 5.1).
        expect(sent).toBeLessThanOrEqual(approved);

        // (c) Every skipped entry carries a non-empty reason (Req 5.4).
        for (const s of skipped) {
          expect(typeof s.reason).toBe("string");
          expect(s.reason.length).toBeGreaterThan(0);
          expect(ids).toContain(s.id);
        }

        const skipById = new Map(skipped.map((s) => [s.id, s.reason]));

        // (d) Opted-out items are skipped `opted_out`, never sent (Req 5.3);
        //     over-cap items are skipped `cap_reached`, never sent (Req 5.2);
        //     sendable items are approved + sent.
        const expectedSendable = items.filter((it) => it.state === "sendable").length;
        for (const it of items) {
          if (it.state === "opted_out") {
            expect(skipById.get(it.id)).toBe("opted_out");
          } else if (it.state === "over_cap") {
            expect(skipById.get(it.id)).toBe("cap_reached");
          } else {
            // sendable → cleared the gate, approved + sent (not in skipped).
            expect(skipById.has(it.id)).toBe(false);
          }
        }

        // The sendable items are exactly the sent count, and every non-sendable
        // item landed in skipped.
        expect(sent).toBe(expectedSendable);
        expect(approved).toBe(expectedSendable);
        expect(skipped.length).toBe(ids.length - expectedSendable);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
