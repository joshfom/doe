import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Example / integration tests for the agentic Batch_Run bridge routes
 * (task 8.11, OPTIONAL, example-based — NOT property tests). These drive the
 * EXISTING Elysia app in-process via `app.handle(new Request(...))`, mirroring
 * the sibling `prospecting.queue.test.ts` / `prospecting.own-catalog.test.ts`
 * harness: a configurable `db` holder serves the rows each route selects /
 * captures the values each route writes, RBAC is mocked to an authenticated
 * `leads:read` rep (with a per-test deny toggle), and `dispatchTool` is a spy so
 * we can assert the audited boundary, actor identity, and call order.
 *
 * Covered (reliably testable in-process):
 *   - POST /batches initiation: a valid CLUSTER subject and a valid ICP subject
 *     each persist a `prospecting_batch_runs` row (status `running`) and enqueue
 *     the `prospecting_batch` job keyed by the deterministic `rerun_key`
 *     (Req 1.1, 1.3, 9.1, 9.2); a subject-less request is rejected `400` and a
 *     cap-exhausted rep is rejected `409` — neither persisting a row nor
 *     enqueuing a job (Req 1.4, 1.5).
 *   - RBAC boundary (Req 1.2, 12.1): a rep lacking `leads:read` is blocked by the
 *     server gate BEFORE any batch row is created — no insert, no enqueue.
 *   - GET /batches/:id/activity (Req 3.5, 3.6): the persisted Agent_Activity_Log
 *     is returned in `seq` order; a forced read failure surfaces an explicit
 *     `500` with an error code, never an empty/silent success.
 *   - POST /queue/:id/approve (Req 4.3, 8.2, 8.4, 12.2): on a clear gate it
 *     dispatches `approve_outreach` THEN `send_outreach`, both under the
 *     approving REP's identity (`{ actor: userId, userId }`), records the send
 *     exactly-once, flips the item to `sent`, and publishes the
 *     `prospecting.queue.item.sent` bus event; an opted-out or cap-reached item
 *     returns a structured skip with NO send; an OTP-gated dispatch is honoured
 *     (the dispatcher's OTP requirement maps to `401`).
 *   - POST /targets/:id/promote (Req 8.4, 12.1): promotion to a Lead reaches
 *     Salesforce ONLY through `dispatchTool` (`promote_target_to_lead`), never a
 *     direct provider/DB write.
 *
 * Documented as NOT re-asserted here (owned/verified elsewhere — no fabricated
 * assertions, per task guidance):
 *   - SSE smoke (a live `prospecting.batch.*` stream): the durable SSE stream
 *     only holds open on the standalone Bun mount (`server.ts`), not under the
 *     serverless / in-process harness (documented "Bun-mount caveat"). The
 *     `prospecting.batch.*` events themselves are published by the CONTAINER-tier
 *     job handler (`lib/cms/prospecting/batch/run.ts`), not by these
 *     request/response routes; we instead assert the route-layer
 *     `prospecting.queue.item.sent` publish as the in-process bus proxy.
 *   - Outbox idempotency (unconfigured-SF send enqueues rather than fails,
 *     Req 9.3/11.6): the SF side effect is enqueued to `sf_outbox` under the
 *     draft `job_key` INSIDE the dispatched `send_outreach` tool (reused
 *     verbatim, never reinvented at the route layer); its at-most-once /
 *     enqueue-when-unconfigured behaviour is covered by
 *     `eligibility.sf-degrade.property.test.ts`. We assert here only that the
 *     route treats a confirmed `send_outreach` result as success.
 *   - Grounding manifest pins every claim to a real source (Req 2.6): the cold
 *     draft is composed by the run handler with an EMPTY grounding manifest
 *     (the deterministic prose states no figures), enforced in `run.ts` and
 *     exercised by the run-handler tests; these routes do not compose drafts.
 */

// ── Configurable db holder (declared before importing the route) ─────────────

const h = vi.hoisted(() => {
  const fn = vi.fn;
  return {
    // Rows every `select()` chain resolves to (set per test).
    selectRows: [] as unknown[],
    // Captured `insert(...).values(...)` payloads (asserted for the run row).
    insertValues: [] as Record<string, unknown>[],
    // The row(s) `insert(...).returning()` resolves to (set per test).
    insertReturning: [] as unknown[],
    // Captured `update(...).set(...)` payloads.
    updateSet: [] as Record<string, unknown>[],
    // The row(s) `update(...).returning()` resolves to (set per test).
    updateReturning: [] as unknown[],
    // When true, the RBAC `requirePermission` gate denies (no leads:read).
    denyPermission: false,
    // Spies referenced by the mock factories below (hoisted alongside them so
    // they are initialized before the hoisted `vi.mock` factories run).
    dispatchTool: fn(),
    deriveRerunKey: fn(() => "rerun-key-fixed"),
    capExhausted: fn(async () => false),
    recordSend: fn(async () => ({})),
    incrementScope: fn(async () => ({})),
    isOptedOut: fn(async () => false),
    releaseClaim: fn(async () => undefined),
    readActivity: fn(async () => [] as unknown[]),
    enqueueJob: fn(async () => undefined),
    publishEvent: fn(async () => undefined),
  };
});

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
        insert() {
          const builder: Record<string, unknown> = {
            values(payload: Record<string, unknown>) {
              h.insertValues.push(payload);
              return builder;
            },
            onConflictDoNothing: () => builder,
            onConflictDoUpdate: () => builder,
            returning: () => Promise.resolve(h.insertReturning),
          };
          return builder;
        },
        update() {
          const builder: Record<string, unknown> = {
            set(payload: Record<string, unknown>) {
              h.updateSet.push(payload);
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

// RBAC: authenticated employee rep with leads:read, with a per-test deny toggle
// that mirrors the real `requirePermission` 403 onBeforeHandle path so we can
// exercise the unauthorized boundary WITHOUT a real session.
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
            return {
              error: "Access denied: insufficient permissions",
              required: "leads:read",
            };
          }
        }),
  };
});

// The audited boundary — a spy so we can assert the dispatched tool, actor
// identity, and call order. Default: ok with an empty result.
const dispatchTool = h.dispatchTool;
vi.mock("../../ai/tools/dispatch", () => ({ dispatchTool: h.dispatchTool }));
vi.mock("../../ai/tools/prospecting-capabilities", () => ({
  PROSPECTING_AGENT_ACTOR: "agent:prospecting",
  PROSPECTING_OUTREACH_AGENT_ACTOR: "agent:outreach",
}));

// Deterministic rerun key so we can assert the job is enqueued under it.
vi.mock("../../prospecting/batch/rerun-key", () => ({
  deriveRerunKey: h.deriveRerunKey,
}));

// Guardrail collaborators (configurable per test).
const capExhausted = h.capExhausted;
const recordSend = h.recordSend;
const incrementScope = h.incrementScope;
vi.mock("../../prospecting/batch/send-cap", () => ({
  capExhausted: h.capExhausted,
  recordSend: h.recordSend,
  incrementScope: h.incrementScope,
}));
const isOptedOut = h.isOptedOut;
vi.mock("../../prospecting/optout", () => ({ isOptedOut: h.isOptedOut }));
const releaseClaim = h.releaseClaim;
vi.mock("../../prospecting/batch/claim", () => ({ releaseClaim: h.releaseClaim }));
const readActivity = h.readActivity;
vi.mock("../../prospecting/batch/activity", () => ({ readActivity: h.readActivity }));
const enqueueJob = h.enqueueJob;
vi.mock("../../jobs", () => ({ enqueueJob: h.enqueueJob }));
const publishEvent = h.publishEvent;
vi.mock("../../realtime/events", () => ({ publishEvent: h.publishEvent }));

// Collaborators the batch/queue routes do NOT touch — mocked so imports stay lean.
vi.mock("../../prospecting/own-subject", () => ({ resolveComparisonSpec: vi.fn() }));
vi.mock("../../prospecting/crm-check", () => ({ checkCrmForContact: vi.fn() }));
vi.mock("../../ai/gateway", () => ({ generateCompletion: vi.fn() }));
vi.mock("../../realtime/subscribe", () => ({ streamEvents: vi.fn() }));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { Elysia } from "elysia";
import { prospectingRoutes } from "./prospecting";

function createApp() {
  return new Elysia().use(prospectingRoutes);
}

async function call(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: any }> {
  const res = await createApp().handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        Cookie: "ora_session=valid",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  );
  return { status: res.status, body: await res.json() };
}

function resetHolder() {
  vi.clearAllMocks();
  h.selectRows = [];
  h.insertValues = [];
  h.insertReturning = [];
  h.updateSet = [];
  h.updateReturning = [];
  h.denyPermission = false;
  capExhausted.mockResolvedValue(false);
  isOptedOut.mockResolvedValue(false);
  readActivity.mockResolvedValue([]);
}

// ── POST /batches — initiation (Req 1.1, 1.3, 1.4, 1.5, 9.1, 9.2) ─────────────

describe("POST /api/prospecting/batches (initiation)", () => {
  beforeEach(resetHolder);

  it("a valid CLUSTER subject persists a running run row and enqueues the job keyed by rerun_key", async () => {
    h.insertReturning = [{ id: "run-cluster", status: "running" }];
    const { status, body } = await call("POST", "/prospecting/batches", {
      subject: { kind: "cluster", clusterId: "cluster-1" },
      targetCount: 10,
    });

    expect(status).toBe(201);
    expect(body).toEqual({ batchRunId: "run-cluster", status: "running" });

    // Persisted run row: owner = authenticated rep, status running, the cluster
    // denormalized for cap scoping, the deterministic rerun_key (Req 1.3, 9.1).
    expect(h.insertValues).toHaveLength(1);
    const row = h.insertValues[0];
    expect(row.ownerRep).toBe("rep-user-id");
    expect(row.status).toBe("running");
    expect(row.clusterId).toBe("cluster-1");
    expect(row.targetCount).toBe(10);
    expect(row.rerunKey).toBe("rerun-key-fixed");
    expect((row.subject as any).clusterId).toBe("cluster-1");

    // Durable job enqueued under the rerun_key as its job_key (Req 9.2).
    expect(enqueueJob).toHaveBeenCalledTimes(1);
    expect(enqueueJob).toHaveBeenCalledWith(
      expect.anything(),
      "prospecting_batch",
      { batchRunId: "run-cluster" },
      "rerun-key-fixed"
    );
  });

  it("a valid ICP subject persists a running run row (no cluster) and enqueues the job", async () => {
    h.insertReturning = [{ id: "run-icp", status: "running" }];
    const { status, body } = await call("POST", "/prospecting/batches", {
      subject: { kind: "icp", icpFilter: { titles: ["Founder"], limit: 50 } },
      targetCount: 5,
    });

    expect(status).toBe(201);
    expect(body.batchRunId).toBe("run-icp");
    const row = h.insertValues[0];
    expect(row.clusterId).toBeNull();
    expect((row.subject as any).icpFilter.titles).toContain("Founder");
    expect(enqueueJob).toHaveBeenCalledTimes(1);
  });

  it("rejects a subject-less request with 400 and starts nothing (Req 1.4)", async () => {
    const { status, body } = await call("POST", "/prospecting/batches", {
      subject: {},
      targetCount: 10,
    });
    expect(status).toBe(400);
    expect(body.code).toBe("invalid_subject");
    // SHALL NOT start: no run row, no job.
    expect(h.insertValues).toHaveLength(0);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it("rejects with 409 cap_exhausted when the rep's send-cap budget is zero (Req 1.5)", async () => {
    capExhausted.mockResolvedValue(true);
    const { status, body } = await call("POST", "/prospecting/batches", {
      subject: { kind: "cluster", clusterId: "cluster-1" },
      targetCount: 10,
    });
    expect(status).toBe(409);
    expect(body.code).toBe("cap_exhausted");
    // SHALL NOT start: no run row, no job.
    expect(h.insertValues).toHaveLength(0);
    expect(enqueueJob).not.toHaveBeenCalled();
  });
});

// ── RBAC boundary (Req 1.2, 12.1) ─────────────────────────────────────────────

describe("RBAC boundary — unauthorized rep blocked before any batch row is created", () => {
  beforeEach(resetHolder);

  it("a rep lacking leads:read is blocked (403) before any insert/enqueue", async () => {
    h.denyPermission = true;
    h.insertReturning = [{ id: "should-not-happen", status: "running" }];

    const { status } = await call("POST", "/prospecting/batches", {
      subject: { kind: "cluster", clusterId: "cluster-1" },
      targetCount: 10,
    });

    expect(status).toBe(403);
    // The server gate ran BEFORE the handler — no run row, no job, no dispatch.
    expect(h.insertValues).toHaveLength(0);
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(dispatchTool).not.toHaveBeenCalled();
  });
});

// ── GET /batches/:id/activity (Req 3.5, 3.6) ──────────────────────────────────

describe("GET /api/prospecting/batches/:id/activity", () => {
  beforeEach(resetHolder);

  it("returns the persisted Agent_Activity_Log ordered by seq (Req 3.5)", async () => {
    h.selectRows = [{ id: "run-1" }]; // owner-scoped run lookup succeeds
    readActivity.mockResolvedValue([
      { seq: 1, action: "discovered", reason: null },
      { seq: 2, action: "crm_checked", reason: null },
      { seq: 3, action: "skipped", reason: "opted_out" },
    ]);

    const { status, body } = await call(
      "GET",
      "/prospecting/batches/run-1/activity"
    );
    expect(status).toBe(200);
    expect(body.count).toBe(3);
    const seqs = body.activity.map((a: any) => a.seq);
    expect(seqs).toEqual([1, 2, 3]); // monotonic, ordered
  });

  it("surfaces an explicit 500 (never an empty success) when the log read fails (Req 3.6)", async () => {
    h.selectRows = [{ id: "run-1" }];
    readActivity.mockRejectedValue(new Error("activity store unavailable"));

    const { status, body } = await call(
      "GET",
      "/prospecting/batches/run-1/activity"
    );
    expect(status).toBe(500);
    expect(body.code).toBe("activity_read_failed");
    expect(body.error).toBeTruthy();
    // It must NOT masquerade as an empty-but-successful log.
    expect(body.activity).toBeUndefined();
    expect(body.count).toBeUndefined();
  });

  it("404s a run not owned by the requesting rep (no cross-rep disclosure)", async () => {
    h.selectRows = []; // owner-scoped lookup returns nothing
    const { status } = await call(
      "GET",
      "/prospecting/batches/not-mine/activity"
    );
    expect(status).toBe(404);
    expect(readActivity).not.toHaveBeenCalled();
  });
});

// ── POST /queue/:id/approve — approve + send under rep identity (Req 4.3, 8, 12.2)

describe("POST /api/prospecting/queue/:id/approve", () => {
  beforeEach(resetHolder);

  function seedClearItem() {
    h.selectRows = [
      {
        id: "qi-1",
        draftId: "draft-1",
        clusterId: "cluster-1",
        targetEmail: "jane@example.com",
        targetPhoneHash: "hash-abc",
      },
    ];
  }

  it("dispatches approve_outreach THEN send_outreach under the rep identity, records the send, and marks the item sent", async () => {
    seedClearItem();
    dispatchTool
      .mockResolvedValueOnce({ ok: true, result: { token: "tok-1", status: "approved" } })
      .mockResolvedValueOnce({
        ok: true,
        result: { sent: true, status: "sent", messageId: "msg-1" },
      });

    const { status, body } = await call(
      "POST",
      "/prospecting/queue/qi-1/approve"
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({ queueItemId: "qi-1", sent: true, status: "sent" });

    // Two dispatches, in order, BOTH under the approving rep's identity (Req 8.2).
    expect(dispatchTool).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = dispatchTool.mock.calls;
    expect(firstCall[1]).toBe("approve_outreach");
    expect(firstCall[2]).toEqual({ draftId: "draft-1" });
    expect(firstCall[3]).toEqual({ actor: "rep-user-id", userId: "rep-user-id" });
    expect(secondCall[1]).toBe("send_outreach");
    expect(secondCall[2]).toEqual({ draftId: "draft-1", token: "tok-1" });
    expect(secondCall[3]).toEqual({ actor: "rep-user-id", userId: "rep-user-id" });

    // Exactly-once counter advance on a CONFIRMED send (Req 7.5, 7.6).
    expect(recordSend).toHaveBeenCalledTimes(1);
    expect(recordSend).toHaveBeenCalledWith(expect.anything(), {
      draftId: "draft-1",
      repId: "rep-user-id",
      clusterId: "cluster-1",
      periodBucket: expect.any(String),
    });

    // Single status field flipped to `sent` (Req 4.5).
    expect(h.updateSet.some((s) => s.status === "sent")).toBe(true);

    // Bus event published (in-process proxy for the live stream; Req 3.1).
    expect(publishEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "prospecting.queue.item.sent" })
    );
  });

  it("skips an opted-out prospect at send time with a structured reason and NO send (Req 6.4)", async () => {
    seedClearItem();
    isOptedOut.mockResolvedValue(true);

    const { status, body } = await call(
      "POST",
      "/prospecting/queue/qi-1/approve"
    );
    expect(status).toBe(200);
    expect(body).toEqual({ skipped: true, reason: "opted_out" });
    expect(dispatchTool).not.toHaveBeenCalled();
    expect(recordSend).not.toHaveBeenCalled();
  });

  it("skips a cap-reached item at send time with a structured reason and NO send (Req 7.2)", async () => {
    seedClearItem();
    capExhausted.mockResolvedValue(true);

    const { status, body } = await call(
      "POST",
      "/prospecting/queue/qi-1/approve"
    );
    expect(status).toBe(200);
    expect(body).toEqual({ skipped: true, reason: "cap_reached" });
    expect(dispatchTool).not.toHaveBeenCalled();
    expect(recordSend).not.toHaveBeenCalled();
  });

  it("honours the dispatcher's OTP gate — an otp_required approve maps to 401 (Req 12.2)", async () => {
    seedClearItem();
    dispatchTool.mockResolvedValueOnce({
      ok: false,
      error: { code: "otp_required", message: "OTP required" },
    });

    const { status, body } = await call(
      "POST",
      "/prospecting/queue/qi-1/approve"
    );
    expect(status).toBe(401);
    expect(body.code).toBe("otp_required");
    // The send was never reached and nothing was counted.
    expect(dispatchTool).toHaveBeenCalledTimes(1);
    expect(recordSend).not.toHaveBeenCalled();
  });
});

// ── POST /targets/:id/promote — dispatcher boundary (Req 8.4, 12.1) ───────────

describe("POST /api/prospecting/targets/:id/promote", () => {
  beforeEach(resetHolder);

  it("promotes to a Lead ONLY through dispatchTool (promote_target_to_lead), never a direct write", async () => {
    // Target email lookup (the route reads it to dedupe/link). A supplied
    // sfLeadId short-circuits the CRM check so the focus stays on the dispatch.
    h.selectRows = [{ email: "jane@example.com" }];
    dispatchTool.mockResolvedValue({ ok: true, result: { leadId: "lead-1" } });

    const { status, body } = await call(
      "POST",
      "/prospecting/targets/tgt-1/promote",
      { sfLeadId: "sf-lead-9" }
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({ leadId: "lead-1", sfLeadId: "sf-lead-9" });
    expect(dispatchTool).toHaveBeenCalledTimes(1);
    const [call0] = dispatchTool.mock.calls;
    expect(call0[1]).toBe("promote_target_to_lead");
    expect(call0[2]).toMatchObject({ targetId: "tgt-1", sfLeadId: "sf-lead-9" });
  });
});
