import { Elysia } from "elysia";
import { db } from "../../db";
import { RateLimiter } from "../../tickets/rate-limit";
import { createVoiceSessionInputSchema } from "../../voice/contracts";
import { createVoiceSession, getVoiceSession, endVoiceSession } from "../../voice/session";

// ── Voice session routes (Design §10, §22; Requirements 3.1, 2.1, 14.1) ───────
//
// The request/response half of the DOE Voice Surface. Two endpoints, both
// served through the Next bridge (`app/api/[...slugs]/route.ts`, `api.handle`)
// — request/response only, NO durable connection (the WebRTC audio leg is owned
// by LiveKit, and the durable SSE stream lives on the Bun mount, see
// `realtime.ts`). Wiring `voiceRoutes` into the Elysia core is task 19.1; this
// module only EXPORTS it.
//
//   • POST /api/voice/sessions   — PUBLIC (unauthenticated), like the public AI
//     chat path and the public tickets form. Body is Zod-validated server-side
//     (`consent === true` is enforced by `createVoiceSessionInputSchema`'s
//     `z.literal(true)`); rejected bodies return 400 without provisioning a
//     call. Rate-limited to 5 sessions per IP per 10 minutes (Req 14.1),
//     reusing the tickets public-form `RateLimiter` pattern.
//
//   • GET /api/voice/sessions/:id — returns the conversation status, summary,
//     and any booked appointment for the widget thank-you card (Req 2.8).

// ── Module-level rate limiter (single instance, not per-request) ─────────────
//
// 5 sessions per IP per 10-minute window (Req 14.1 / SEC-1). Mirrors the
// tickets public-form limiter (`lib/cms/api/routes/tickets.ts`), differing only
// in the window length the requirement specifies.
const voiceSessionRateLimiter = new RateLimiter(5, 10 * 60 * 1000);

export const voiceRoutes = new Elysia({ name: "voice", prefix: "/voice" })

  // POST /api/voice/sessions — start a voice session from the pre-call form.
  .post("/sessions", async ({ body, set, request }) => {
    // Extract the client IP from the standard forwarded header (same approach
    // as the public tickets route).
    const forwarded = request.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";

    // Rate limit check — 5 per IP per 10 minutes (Req 14.1).
    if (!voiceSessionRateLimiter.isAllowed(ip)) {
      set.status = 429;
      return { error: "Too many requests. Please try again later." };
    }

    // Server-side Zod validation. `consent` must be exactly `true`
    // (`z.literal(true)`); anything else fails here and the handler never runs
    // (Req 3.1, 14.1).
    const parsed = createVoiceSessionInputSchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        fieldErrors[issue.path.join(".")] = issue.message;
      }
      return { error: "Validation failed", details: fieldErrors };
    }

    // Record the request for rate limiting only after it passes validation,
    // so malformed bodies don't consume a caller's quota.
    voiceSessionRateLimiter.record(ip);

    const result = await createVoiceSession(db, parsed.data);

    // Request/response only — return the join credentials. The widget opens the
    // durable WebRTC connection to LiveKit itself; Elysia never holds it open.
    // `conversationId` is forwarded so the widget can fetch the session summary
    // for its thank-you card on call end (Req 2.8); it matches the design's
    // `CreateVoiceSessionResult` shape (contracts.ts).
    return {
      roomName: result.roomName,
      token: result.token,
      livekitUrl: result.livekitUrl,
      conversationId: result.conversationId,
    };
  })

  // GET /api/voice/sessions/:id — thank-you card lookup (Req 2.8).
  .get("/sessions/:id", async ({ params, set }) => {
    try {
      return await getVoiceSession(db, params.id);
    } catch {
      set.status = 404;
      return { error: "Voice session not found" };
    }
  })

  // POST /api/voice/sessions/:id/end — caller hung up. Tear the call down
  // server-side: delete the LiveKit room (kills the agent at once) and finalize
  // a never-connected conversation. Best-effort and idempotent — it must never
  // block the widget's hang-up UX, so failures still return 200.
  .post("/sessions/:id/end", async ({ params, body }) => {
    const roomName =
      body && typeof body === "object"
        ? (body as { roomName?: unknown }).roomName
        : undefined;
    try {
      return await endVoiceSession(db, {
        conversationId: params.id,
        roomName: typeof roomName === "string" ? roomName : null,
      });
    } catch {
      return { ok: false };
    }
  });
