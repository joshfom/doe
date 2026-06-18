import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Integration test for the DOE Voice Surface transport routing (task 19.4).
 *
 * **Validates: Requirements 12.2, 12.3, 14.2**
 *
 * The design (§3, §4) keeps ONE Elysia `api` instance behind TWO mounts:
 *   • the Next mount (`app/api/[...slugs]/route.ts`, `api.handle`) — request/
 *     response only, no durable connection (Req 12.2); and
 *   • the standalone Bun mount (`lib/cms/api/server.ts`, `api.listen`) — the
 *     only place a long-lived SSE stream can stay open (Req 12.3).
 *
 * This test drives the route modules through `app.handle(new Request(...))` —
 * the SAME mechanism the Next mount uses, and the pattern the sibling
 * `demo-admin.test.ts` uses. Rather than importing the full `lib/cms/api/index.ts`
 * (which boots every CMS route, the auth plugin, and the RBAC seeders at module
 * load), we compose a minimal Elysia app with the SAME `/api` prefix and the
 * SAME voice-surface route modules registered in `index.ts`
 * (`toolsRoutes`, `realtimeRoutes`). This exercises the real route modules and
 * their guards through the real handle path while keeping the test hermetic.
 *
 * What each assertion proves:
 *   1. Request/response routes resolve through `handle` (Next mount, Req 12.2):
 *      `POST /api/tools/:toolName` returns a normal `Response` and runs its
 *      handler — i.e. it resolves on the request/response mount.
 *   2. The `/api/tools/*` service-token guard (SEC-2 / Req 14.2): a request
 *      WITHOUT a valid `Authorization: Bearer <AGENT_SERVICE_TOKEN>` returns 401
 *      and the dispatcher NEVER runs; WITH the correct token the guard passes
 *      and the dispatcher runs exactly once.
 *   3. SSE is the durable Bun-mount transport (Req 12.3): `GET /api/realtime/events`
 *      is registered on the shared `api` and its handler returns a streaming
 *      `text/event-stream` `Response` (a durable transport). We assert
 *      registration + the stream response shape; we deliberately do NOT try to
 *      consume the stream through `handle`, because durable streams belong on
 *      the Bun mount (`api.listen`) — the Next bridge (`api.handle`) is request/
 *      response only and cannot hold the connection open (design §3, §4).
 *
 * These are integration-level UNIT tests: `../../db` is mocked so no connection
 * opens, the tool dispatcher is mocked so we can assert call counts at the guard
 * boundary, the RBAC middleware is replaced with pass-through stand-ins, and the
 * SSE machinery is mocked so no real pg LISTEN connection is ever opened.
 */

// ── Mocks (declared before importing the route modules) ──────────────────────

vi.mock("../../db", () => ({ db: {} }));

// Tool dispatcher mock. `tools.ts` calls `dispatchTool(db, toolName, body, ctx)`
// only AFTER the service-token guard passes, so its call count is the probe for
// whether the guard admitted the request (SEC-2 / Req 14.2).
const dispatchToolMock = vi.fn(async () => ({
  ok: true as const,
  result: { appointmentId: "appt_1", when: "2025-01-01T10:00:00.000Z" },
}));

vi.mock("../../ai/tools/dispatch", () => ({
  dispatchTool: (...args: unknown[]) => dispatchToolMock(...args),
}));

// `tools.ts` also imports the agent actor constant from the (heavy) registry
// module; stub it so the registry's transitive deps are not loaded in the test.
vi.mock("../../ai/tools/registry", () => ({
  VOICE_AGENT_ACTOR: "agent:voice-lead",
}));

// Pass-through RBAC stand-ins so `realtimeRoutes` mounts without touching the
// DB. The realtime route composes `identityGuard` then `requirePermission(...)`.
vi.mock("../../rbac/middleware", async () => {
  const { Elysia } = await import("elysia");
  const identityGuard = new Elysia({ name: "identityGuard" });
  const requirePermission = (permission?: string) =>
    new Elysia({ name: `requirePermission:${permission ?? "auth-only"}` });
  return { identityGuard, requirePermission };
});

// SSE machinery mock: return a real streaming `text/event-stream` Response but
// open NO pg LISTEN connection. Lets us assert the durable-stream response shape
// without the real subscribe/LISTEN path.
const streamEventsMock = vi.fn(
  () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(": connected\n\n"));
        },
      }),
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      }
    )
);

vi.mock("../../realtime/subscribe", () => ({
  streamEvents: (...args: unknown[]) => streamEventsMock(...args),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { Elysia } from "elysia";
import { toolsRoutes } from "./tools";
import { realtimeRoutes } from "./realtime";

// ── Helpers ──────────────────────────────────────────────────────────────────

const SERVICE_TOKEN = "test-agent-service-token";

/**
 * Compose the same single `api` shape the Next/Bun mounts share: one Elysia
 * instance with the `/api` prefix and the voice-surface route modules from
 * `index.ts`. Driving this with `.handle` mirrors `api.handle` (the Next mount).
 */
function createApi() {
  return new Elysia({ prefix: "/api" }).use(toolsRoutes).use(realtimeRoutes);
}

function postTool(
  app: ReturnType<typeof createApi>,
  toolName: string,
  authHeader?: string
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  return app.handle(
    new Request(`http://localhost/api/tools/${toolName}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ partyId: "party_1", slotId: "slot_1" }),
    })
  );
}

beforeEach(() => {
  dispatchToolMock.mockClear();
  streamEventsMock.mockClear();
  process.env.AGENT_SERVICE_TOKEN = SERVICE_TOKEN;
});

// ── 1. Request/response routes resolve through the handle path (Req 12.2) ─────

describe("request/response routes resolve on the handle path (Next mount)", () => {
  it("resolves POST /api/tools/:toolName to a normal Response via handle", async () => {
    const app = createApi();
    const res = await postTool(app, "book_viewing", `Bearer ${SERVICE_TOKEN}`);

    // A request/response route returns a normal, fully-resolved Response (not a
    // 404 from an unregistered path), proving it resolves on the handle mount.
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toMatchObject({ appointmentId: "appt_1" });
  });
});

// ── 2. /api/tools/* service-token guard (SEC-2 / Req 14.2) ────────────────────

describe("/api/tools/* service-token guard", () => {
  it("rejects a request with NO Authorization header (401) without dispatching", async () => {
    const app = createApi();
    const res = await postTool(app, "book_viewing");

    expect(res.status).toBe(401);
    expect(dispatchToolMock).not.toHaveBeenCalled();

    const body = await res.json();
    expect(body.error.code).toBe("unauthorized");
  });

  it("rejects a request with an INCORRECT bearer token (401) without dispatching", async () => {
    const app = createApi();
    const res = await postTool(app, "book_viewing", "Bearer wrong-token");

    expect(res.status).toBe(401);
    expect(dispatchToolMock).not.toHaveBeenCalled();
  });

  it("passes the guard with the CORRECT bearer token and dispatches once", async () => {
    const app = createApi();
    const res = await postTool(app, "book_viewing", `Bearer ${SERVICE_TOKEN}`);

    expect(res.status).toBe(200);
    expect(dispatchToolMock).toHaveBeenCalledTimes(1);
    // The dispatcher receives the requested tool name (resolved from the path).
    expect(dispatchToolMock.mock.calls[0]?.[1]).toBe("book_viewing");
  });

  it("fails closed when AGENT_SERVICE_TOKEN is unset (401), even with a bearer header", async () => {
    delete process.env.AGENT_SERVICE_TOKEN;
    const app = createApi();
    const res = await postTool(app, "book_viewing", "Bearer anything");

    expect(res.status).toBe(401);
    expect(dispatchToolMock).not.toHaveBeenCalled();
  });
});

// ── 3. SSE is the durable Bun-mount transport (Req 12.3) ──────────────────────

describe("realtime SSE is the durable transport (Bun mount)", () => {
  it("registers GET /api/realtime/events on the shared api", () => {
    const app = createApi();
    const routes = app.routes as Array<{ method: string; path: string }>;

    const sseRoute = routes.find(
      (r) => r.path === "/api/realtime/events" && r.method === "GET"
    );
    expect(sseRoute).toBeDefined();
  });

  it("serves a durable text/event-stream Response (belongs on the Bun mount, not the Next bridge)", async () => {
    // We can confirm the handler produces a streaming SSE Response. We do NOT
    // consume the stream through `handle`: durable streams belong on the Bun
    // mount (`api.listen`); the Next bridge (`api.handle`) is request/response
    // only and cannot hold the connection open (design §3, §4 / Req 12.3).
    const app = createApi();
    const res = await app.handle(
      new Request("http://localhost/api/realtime/events", { method: "GET" })
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    // The body is a stream — the long-lived transport that only the Bun mount
    // can keep open.
    expect(res.body).toBeInstanceOf(ReadableStream);

    // No real pg LISTEN connection was opened; the SSE machinery was mocked.
    expect(streamEventsMock).toHaveBeenCalledTimes(1);

    // Cancel the stream so the test does not leave it dangling.
    await res.body?.cancel();
  });
});
