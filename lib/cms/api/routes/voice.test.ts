import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the voice session route's rate-limit and consent gating.
 *
 * **Validates: Requirements 14.1**
 *
 * Task 8.4 — two gating concerns on `POST /api/voice/sessions`
 * (Design §22; Requirement 14.1 / SEC-1):
 *
 *   • Consent gating — the body must carry `consent === true`
 *     (`createVoiceSessionInputSchema` uses `z.literal(true)`). A non-true /
 *     missing consent is rejected (400) and a call is NEVER provisioned.
 *
 *   • Rate limiting — 5 sessions per IP per 10-minute window; the 6th request
 *     from the same IP is rejected (429). A different IP is unaffected.
 *
 * These are UNIT tests: the database is mocked away and `createVoiceSession`
 * (which would hit LiveKit + DB) is mocked so the route's gating logic can be
 * exercised in-process via Elysia's `app.handle(new Request(...))`.
 *
 * NOTE ON SHARED STATE: the route module owns a single module-level
 * `RateLimiter` instance. Because the module is imported once, that limiter is
 * shared across every test in this file. Each test therefore uses a DISTINCT
 * `x-forwarded-for` IP so cases never bleed into one another.
 */

// ── Mocks (must be declared before importing the route module) ───────────────

// The route imports `db` at module load; stub it so no real connection opens.
vi.mock("../../db", () => ({ db: {} }));

// Mock the session service so the route never touches LiveKit or the database.
// `createVoiceSession` returns a canned join payload; we assert on call count
// to prove the route gates BEFORE provisioning.
const createVoiceSessionMock = vi.fn(async () => ({
  roomName: "call_test",
  token: "test-token",
  livekitUrl: "wss://livekit.test",
  conversationId: "conv_test",
}));
const getVoiceSessionMock = vi.fn(async () => ({ status: "connecting" }));

vi.mock("../../voice/session", () => ({
  createVoiceSession: (...args: unknown[]) => createVoiceSessionMock(...args),
  getVoiceSession: (...args: unknown[]) => getVoiceSessionMock(...args),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { Elysia } from "elysia";
import { voiceRoutes } from "./voice";
import { createVoiceSessionInputSchema } from "../../voice/contracts";
import { RateLimiter } from "../../tickets/rate-limit";

// ── Helpers ──────────────────────────────────────────────────────────────────

function createApp() {
  return new Elysia().use(voiceRoutes);
}

/** A valid pre-call form body (consent === true, valid phone + email). */
function validBody(overrides: Record<string, unknown> = {}) {
  return {
    phone: "+971501234567",
    email: "caller@example.com",
    name: "Test Caller",
    consent: true,
    ...overrides,
  };
}

async function postSession(
  app: ReturnType<typeof createApp>,
  body: unknown,
  ip: string
): Promise<{ status: number; body: any }> {
  const res = await app.handle(
    new Request("http://localhost/voice/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify(body),
    })
  );
  const json = await res.json();
  return { status: res.status, body: json };
}

beforeEach(() => {
  createVoiceSessionMock.mockClear();
  getVoiceSessionMock.mockClear();
});

// ── Consent gating — the schema directly (Req 14.1) ──────────────────────────

describe("createVoiceSessionInputSchema consent gating", () => {
  it("rejects a body with consent: false", () => {
    const result = createVoiceSessionInputSchema.safeParse(validBody({ consent: false }));
    expect(result.success).toBe(false);
  });

  it("rejects a body with consent missing", () => {
    const { consent, ...withoutConsent } = validBody();
    const result = createVoiceSessionInputSchema.safeParse(withoutConsent);
    expect(result.success).toBe(false);
  });

  it("rejects a non-boolean truthy consent value", () => {
    const result = createVoiceSessionInputSchema.safeParse(validBody({ consent: "true" }));
    expect(result.success).toBe(false);
  });

  it("accepts consent: true with a valid phone and email", () => {
    const result = createVoiceSessionInputSchema.safeParse(validBody());
    expect(result.success).toBe(true);
  });

  it("rejects an invalid email even when consent is true", () => {
    const result = createVoiceSessionInputSchema.safeParse(validBody({ email: "not-an-email" }));
    expect(result.success).toBe(false);
  });
});

// ── Consent gating — at the route level (Req 14.1) ───────────────────────────

describe("POST /voice/sessions consent gating", () => {
  it("returns 400 and never provisions a call when consent is false", async () => {
    const app = createApp();
    const { status, body } = await postSession(app, validBody({ consent: false }), "10.0.0.1");

    expect(status).toBe(400);
    expect(body.error).toBe("Validation failed");
    expect(createVoiceSessionMock).not.toHaveBeenCalled();
  });

  it("returns 400 and never provisions a call when consent is missing", async () => {
    const app = createApp();
    const { consent, ...withoutConsent } = validBody();
    const { status } = await postSession(app, withoutConsent, "10.0.0.2");

    expect(status).toBe(400);
    expect(createVoiceSessionMock).not.toHaveBeenCalled();
  });

  it("provisions a call (200) when consent is true and the body is valid", async () => {
    const app = createApp();
    const { status, body } = await postSession(app, validBody(), "10.0.0.3");

    expect(status).toBe(200);
    expect(body).toMatchObject({
      roomName: "call_test",
      token: "test-token",
      livekitUrl: "wss://livekit.test",
    });
    expect(createVoiceSessionMock).toHaveBeenCalledTimes(1);
  });
});

// ── Rate limiting — at the route level (Req 14.1) ────────────────────────────

describe("POST /voice/sessions rate limiting (5 / IP / 10 min)", () => {
  it("allows 5 requests from one IP then rejects the 6th with 429", async () => {
    const app = createApp();
    const ip = "203.0.113.10";

    for (let i = 0; i < 5; i++) {
      const { status } = await postSession(app, validBody(), ip);
      expect(status).toBe(200);
    }

    const sixth = await postSession(app, validBody(), ip);
    expect(sixth.status).toBe(429);
    expect(sixth.body.error).toMatch(/too many requests/i);

    // The 6th request was gated before provisioning.
    expect(createVoiceSessionMock).toHaveBeenCalledTimes(5);
  });

  it("does not affect a different IP", async () => {
    const app = createApp();
    const blockedIp = "203.0.113.20";
    const freshIp = "203.0.113.21";

    // Exhaust the window for the blocked IP.
    for (let i = 0; i < 5; i++) {
      await postSession(app, validBody(), blockedIp);
    }
    const blocked = await postSession(app, validBody(), blockedIp);
    expect(blocked.status).toBe(429);

    // A different IP starts with a full quota.
    const fresh = await postSession(app, validBody(), freshIp);
    expect(fresh.status).toBe(200);
  });

  it("does not consume quota for invalid (consent-failing) bodies", async () => {
    const app = createApp();
    const ip = "203.0.113.30";

    // 5 invalid requests should not count against the window.
    for (let i = 0; i < 5; i++) {
      const { status } = await postSession(app, validBody({ consent: false }), ip);
      expect(status).toBe(400);
    }

    // A valid request from the same IP is still allowed.
    const { status } = await postSession(app, validBody(), ip);
    expect(status).toBe(200);
  });
});

// ── Rate limiter window semantics (Req 14.1) ─────────────────────────────────

describe("RateLimiter(5, 10min) window semantics", () => {
  it("permits exactly 5 within the window and blocks the 6th", () => {
    const limiter = new RateLimiter(5, 10 * 60 * 1000);
    const ip = "198.51.100.1";

    for (let i = 0; i < 5; i++) {
      expect(limiter.isAllowed(ip)).toBe(true);
      limiter.record(ip);
    }
    expect(limiter.isAllowed(ip)).toBe(false);
  });

  it("expires entries once the window elapses", () => {
    const now = 1_000_000;
    const spy = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const limiter = new RateLimiter(5, 10 * 60 * 1000);
      const ip = "198.51.100.2";

      for (let i = 0; i < 5; i++) limiter.record(ip);
      expect(limiter.isAllowed(ip)).toBe(false);

      // Advance past the 10-minute window — old timestamps expire.
      spy.mockReturnValue(now + 10 * 60 * 1000 + 1);
      expect(limiter.isAllowed(ip)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
