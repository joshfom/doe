import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Example tests for the Review-Inbox routes (task 8.3, Req 4.1, 4.2, 4.5).
 *
 *   - `GET /api/prospecting/queue` — present the rep's PENDING, cold-eligible
 *     Queued_Items WITH draft content (subject/body/channel/language), Fit_Score
 *     + rationale, and lawful-basis provenance; privacy-safe (phoneHash only).
 *   - `PUT /api/prospecting/queue/:id` — persist an edited subject/body onto
 *     `outreach_drafts`, copying the FIRST edit's prior content into
 *     `ai_original_subject` / `ai_original_body` and NEVER overwriting it on a
 *     later edit.
 *
 * The route is driven in-process via Elysia's `app.handle(new Request(...))`
 * (mirroring the sibling own-catalog test). The db is mocked with a configurable
 * holder so each test serves the rows the route selects and captures the
 * `update().set(...)` payload to assert the AI-original preservation logic. The
 * heavy collaborators the queue routes never touch are mocked away.
 */

// ── Configurable db holder (before importing the route) ──────────────────────

const h = vi.hoisted(() => ({
  // Rows the `select()` chain resolves to (set per test).
  selectRows: [] as unknown[],
  // The most recent `update().set(...)` payload (captured for assertions).
  lastUpdateSet: null as Record<string, unknown> | null,
  // The row `update().returning()` resolves to (set per test).
  updateReturning: [] as unknown[],
}));

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
            set(payload: Record<string, unknown>) {
              h.lastUpdateSet = payload;
              return builder;
            },
            where: () => builder,
            returning: () => Promise.resolve(h.updateReturning),
          };
          return builder;
        },
      };
    },
  };
});

// RBAC: pass through with an authenticated employee identity (leads:read).
vi.mock("../../rbac/middleware", () => {
  const { Elysia } = require("elysia");
  return {
    identityGuard: new Elysia({ name: "identityGuard" }).derive(
      { as: "scoped" },
      () => ({ userId: "rep-user-id", userType: "employee", isActive: true })
    ),
    requirePermission: () =>
      new Elysia({ name: "requirePermission:leads:read" }).derive(
        { as: "scoped" },
        () => ({ resolvedPermissions: ["leads:read"] })
      ),
  };
});

// Collaborators the queue routes do NOT touch — mocked so the import stays lean.
vi.mock("../../ai/tools/dispatch", () => ({ dispatchTool: vi.fn() }));
vi.mock("../../ai/tools/prospecting-capabilities", () => ({
  PROSPECTING_AGENT_ACTOR: "agent:prospecting",
  PROSPECTING_OUTREACH_AGENT_ACTOR: "agent:outreach",
}));
vi.mock("../../prospecting/own-subject", () => ({ resolveComparisonSpec: vi.fn() }));
vi.mock("../../prospecting/crm-check", () => ({ checkCrmForContact: vi.fn() }));
vi.mock("../../prospecting/batch/send-cap", () => ({ capExhausted: vi.fn() }));
vi.mock("../../prospecting/batch/activity", () => ({ readActivity: vi.fn() }));
vi.mock("../../jobs", () => ({ enqueueJob: vi.fn() }));
vi.mock("../../ai/gateway", () => ({ generateCompletion: vi.fn() }));
vi.mock("../../realtime/subscribe", () => ({ streamEvents: vi.fn() }));
vi.mock("../../realtime/events", () => ({ publishEvent: vi.fn() }));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { Elysia } from "elysia";
import { prospectingRoutes } from "./prospecting";

function createApp() {
  return new Elysia().use(prospectingRoutes);
}

async function getQueue(): Promise<{ status: number; body: any }> {
  const res = await createApp().handle(
    new Request("http://localhost/prospecting/queue", {
      method: "GET",
      headers: { Cookie: "ora_session=valid" },
    })
  );
  return { status: res.status, body: await res.json() };
}

async function putQueue(
  id: string,
  payload: unknown
): Promise<{ status: number; body: any }> {
  const res = await createApp().handle(
    new Request(`http://localhost/prospecting/queue/${id}`, {
      method: "PUT",
      headers: { Cookie: "ora_session=valid", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  );
  return { status: res.status, body: await res.json() };
}

// ── GET /queue ────────────────────────────────────────────────────────────────

describe("GET /api/prospecting/queue (Req 4.1, 4.5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.selectRows = [];
    h.lastUpdateSet = null;
    h.updateReturning = [];
  });

  it("presents draft content, fit score + rationale, and lawful-basis provenance", async () => {
    h.selectRows = [
      {
        id: "qi-1",
        batchRunId: "run-1",
        targetId: "tgt-1",
        draftId: "draft-1",
        eligibility: "cold_eligible",
        status: "pending",
        fitScore: "0.82",
        fitRationale: { matched: ["segment", "wealthSignal"] },
        lawfulBasis: "gdpr_legitimate_interest",
        dataSource: "provider:apollo",
        acquiredAt: "2026-01-10T00:00:00.000Z",
        createdAt: "2026-01-10T00:00:00.000Z",
        updatedAt: "2026-01-10T00:00:00.000Z",
        draftSubject: "An opportunity at Palm Tower",
        draftBody: "Hello...",
        draftChannel: "email",
        draftLanguage: "en",
        draftStatus: "draft",
        targetType: "person",
        targetDisplayName: "Jane Doe",
        targetCompanyName: null,
        targetTitle: "Investor",
        targetEmail: "jane@example.com",
        targetPhoneHash: "hash-abc",
        targetCountry: "AE",
        targetStatus: "active",
      },
    ];
    const { status, body } = await getQueue();
    expect(status).toBe(200);
    expect(body.count).toBe(1);
    const item = body.queueItems[0];
    // Draft content (Req 4.1)
    expect(item.draftSubject).toBe("An opportunity at Palm Tower");
    expect(item.draftChannel).toBe("email");
    expect(item.draftLanguage).toBe("en");
    // Fit score + rationale (Req 2.4 / 4.1)
    expect(item.fitScore).toBe("0.82");
    expect(item.fitRationale.matched).toContain("segment");
    // Lawful-basis provenance (Req 4.1 / 10.1)
    expect(item.lawfulBasis).toBe("gdpr_legitimate_interest");
    expect(item.dataSource).toBe("provider:apollo");
    expect(item.acquiredAt).toBe("2026-01-10T00:00:00.000Z");
  });

  it("is privacy-safe — phoneHash only, never a raw phone (CC-Privacy)", async () => {
    h.selectRows = [
      {
        id: "qi-1",
        draftId: "draft-1",
        targetPhoneHash: "hash-abc",
        targetDisplayName: "Jane Doe",
      },
    ];
    const { body } = await getQueue();
    const item = body.queueItems[0];
    expect(item.targetPhoneHash).toBe("hash-abc");
    expect(item).not.toHaveProperty("targetPhone");
    expect(JSON.stringify(item)).not.toMatch(/"phone"\s*:/);
  });

  it("returns an empty inbox cleanly when no items are pending", async () => {
    h.selectRows = [];
    const { status, body } = await getQueue();
    expect(status).toBe(200);
    expect(body.count).toBe(0);
    expect(body.queueItems).toEqual([]);
  });
});

// ── PUT /queue/:id ─────────────────────────────────────────────────────────────

describe("PUT /api/prospecting/queue/:id (Req 4.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.selectRows = [];
    h.lastUpdateSet = null;
    h.updateReturning = [];
  });

  it("on the FIRST edit copies the AI subject/body into ai_original_* before overwriting", async () => {
    // The select chain is used twice (queue item, then draft); both resolve to
    // the same `selectRows`, so include both shapes' fields on one row.
    h.selectRows = [
      {
        // queue-item lookup fields
        id: "qi-1",
        draftId: "draft-1",
        // draft lookup fields (no edit recorded yet → ai_original_* null)
        status: "draft",
        subject: "AI original subject",
        body: "AI original body",
        aiOriginalSubject: null,
        aiOriginalBody: null,
      },
    ];
    h.updateReturning = [{ id: "draft-1", subject: "Edited subject", body: "Edited body" }];

    const { status, body } = await putQueue("qi-1", {
      subject: "Edited subject",
      body: "Edited body",
    });
    expect(status).toBe(200);
    expect(body.queueItemId).toBe("qi-1");
    // First edit: the prior AI content is preserved verbatim.
    expect(h.lastUpdateSet?.aiOriginalSubject).toBe("AI original subject");
    expect(h.lastUpdateSet?.aiOriginalBody).toBe("AI original body");
    // ...and the new content overwrites the live draft.
    expect(h.lastUpdateSet?.subject).toBe("Edited subject");
    expect(h.lastUpdateSet?.body).toBe("Edited body");
    // An edit re-opens the draft for approval.
    expect(h.lastUpdateSet?.status).toBe("draft");
  });

  it("on a SUBSEQUENT edit does NOT overwrite the retained AI original", async () => {
    h.selectRows = [
      {
        id: "qi-1",
        draftId: "draft-1",
        status: "draft",
        // a prior edit already ran → ai_original_* already populated
        subject: "Rep's first edit",
        body: "Rep's first edit body",
        aiOriginalSubject: "AI original subject",
        aiOriginalBody: "AI original body",
      },
    ];
    h.updateReturning = [{ id: "draft-1" }];

    await putQueue("qi-1", { subject: "Second edit", body: "Second edit body" });
    // The very first AI original is preserved — the set payload must NOT touch
    // the ai_original_* columns on a subsequent edit.
    expect(h.lastUpdateSet).not.toHaveProperty("aiOriginalSubject");
    expect(h.lastUpdateSet).not.toHaveProperty("aiOriginalBody");
    expect(h.lastUpdateSet?.subject).toBe("Second edit");
  });

  it("404s when the queue item is not owned by the rep / does not exist", async () => {
    h.selectRows = []; // scoped lookup returns nothing
    const { status, body } = await putQueue("missing", { body: "x" });
    expect(status).toBe(404);
    expect(body.error).toMatch(/not found/i);
  });

  it("409s when the resolved draft is already sent (terminal)", async () => {
    h.selectRows = [
      {
        id: "qi-1",
        draftId: "draft-1",
        status: "sent",
        subject: "s",
        body: "b",
        aiOriginalSubject: null,
        aiOriginalBody: null,
      },
    ];
    const { status, body } = await putQueue("qi-1", { body: "x" });
    expect(status).toBe(409);
    expect(body.error).toMatch(/sent/i);
  });
});
