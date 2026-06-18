import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the demo-admin route's admin gating and reset delegation
 * (task 18.2).
 *
 * **Validates: Requirements 14.7, 11.6, 11.7**
 *
 * `POST /api/demo/reset` is destructive, so it must require admin auth
 * (Req 14.7): `identityGuard` establishes a session (401 otherwise) and
 * `requireAdmin` demands the `*:*` super_admin wildcard (403 otherwise). When
 * authorised it delegates to `resetVoiceDemo` and returns 202 with the removal
 * summary.
 *
 * These are UNIT tests: the database and `resetVoiceDemo` are mocked so no real
 * connection opens, and the RBAC middleware is replaced with controllable
 * stand-ins (mirroring the pattern in `validation.property.test.ts`) so each
 * gating branch — unauthenticated, authenticated-non-admin, admin — can be
 * exercised in-process via Elysia's `app.handle(new Request(...))`.
 */

// ── Mocks (declared before importing the route module) ───────────────────────

vi.mock("../../db", () => ({ db: {} }));

// `resetVoiceDemo` returns a canned summary; we assert on its call count to
// prove the route gates BEFORE running any destructive work.
const resetVoiceDemoMock = vi.fn(async () => ({
  reps: 2,
  parties: 117,
  identities: 234,
  leads: 117,
  viewingSlots: 9,
  marketingSpend: 65,
  total: 544,
  durationMs: 12,
}));

vi.mock("../../seed/voice-demo", () => ({
  resetVoiceDemo: () => resetVoiceDemoMock(),
}));

// Controllable RBAC stand-ins. `authState` decides whether `identityGuard`
// admits the request; `adminState` decides whether `requireAdmin` admits it.
// Both mirror the real guards' contract: short-circuit with a status + body
// from `onBeforeHandle` when access is denied.
const guardState = { authenticated: true, admin: true };

vi.mock("../../rbac/middleware", async () => {
  const { Elysia } = await import("elysia");

  const identityGuard = new Elysia({ name: "identityGuard" }).onBeforeHandle(
    { as: "scoped" },
    ({ set }: any) => {
      if (!guardState.authenticated) {
        set.status = 401;
        return { error: "Not authenticated" };
      }
    }
  );

  const requireAdmin = new Elysia({ name: "requireAdmin" }).onBeforeHandle(
    { as: "scoped" },
    ({ set }: any) => {
      if (!guardState.admin) {
        set.status = 403;
        return { error: "Access denied: admin privileges required" };
      }
    }
  );

  return { identityGuard, requireAdmin };
});

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { Elysia } from "elysia";
import { demoAdminRoutes } from "./demo-admin";

// ── Helpers ──────────────────────────────────────────────────────────────────

function createApp() {
  return new Elysia().use(demoAdminRoutes);
}

async function postReset(
  app: ReturnType<typeof createApp>
): Promise<{ status: number; body: any }> {
  const res = await app.handle(
    new Request("http://localhost/demo/reset", { method: "POST" })
  );
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

beforeEach(() => {
  resetVoiceDemoMock.mockClear();
  guardState.authenticated = true;
  guardState.admin = true;
});

// ── Admin gating (Req 14.7) ──────────────────────────────────────────────────

describe("POST /demo/reset admin gating", () => {
  it("rejects an unauthenticated request (401) without resetting", async () => {
    guardState.authenticated = false;
    const app = createApp();
    const { status } = await postReset(app);

    expect(status).toBe(401);
    expect(resetVoiceDemoMock).not.toHaveBeenCalled();
  });

  it("rejects an authenticated non-admin request (403) without resetting", async () => {
    guardState.authenticated = true;
    guardState.admin = false;
    const app = createApp();
    const { status } = await postReset(app);

    expect(status).toBe(403);
    expect(resetVoiceDemoMock).not.toHaveBeenCalled();
  });

  it("allows an admin request (202) and returns the removal summary", async () => {
    const app = createApp();
    const { status, body } = await postReset(app);

    expect(status).toBe(202);
    expect(resetVoiceDemoMock).toHaveBeenCalledTimes(1);
    expect(body.data).toMatchObject({
      reps: 2,
      parties: 117,
      total: 544,
    });
  });
});
