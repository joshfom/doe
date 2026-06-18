import { Elysia } from "elysia";
import { timingSafeEqual } from "node:crypto";
import { db } from "../../db";
import { dispatchTool, type DispatchErrorCode } from "../../ai/tools/dispatch";
import { VOICE_AGENT_ACTOR } from "../../ai/tools/registry";

// ── Voice tool dispatch route (Design §10, §11, §13; Requirements 6.1, 6.2,
//    6.3, 6.10, 13.1, 13.2, 14.2) ───────────────────────────────────────────
//
// `POST /api/tools/:toolName` is the single, agent-authenticated choke point
// through which the voice-agent worker runs every tool. The route itself is
// intentionally THIN: all of the real work — registry resolution, Zod input
// validation, permission checks, OTP gating, auditing, and handler execution —
// lives in `dispatchTool` (`lib/cms/ai/tools/dispatch.ts`). The route's only
// jobs are (a) to enforce the service-token guard and (b) to translate the
// dispatcher's structured `DispatchResult` into an HTTP response shape the
// worker's `createHttpToolCaller` understands.
//
// SECURITY (SEC-2 / Req 14.2): the endpoint is authenticated ONLY with the
// agent service token (`AGENT_SERVICE_TOKEN`), scoped to the tool routes — never
// a user session, never an API key in a client bundle. The voice-agent worker
// sends `Authorization: Bearer <AGENT_SERVICE_TOKEN>` (see `createHttpToolCaller`
// in `workers/voice-agent.ts`). A missing/incorrect token returns 401 and the
// dispatcher never runs.
//
// TRANSPORT: request/response only (no durable connection), so it resolves on
// either mount; per design §10 the table lists it as "Next or Bun". Wiring this
// module into the Elysia core (`lib/cms/api/index.ts`) is task 19.1.

/**
 * Constant-time compare of the presented bearer token against the configured
 * `AGENT_SERVICE_TOKEN`. Returns false when the env var is unset (fail closed)
 * or when the lengths/contents differ.
 */
function isValidServiceToken(presented: string | null): boolean {
  const expected = process.env.AGENT_SERVICE_TOKEN;
  if (!expected || !presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch; guard first so a length
  // difference is still a constant-ish, non-throwing rejection.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Extract the bearer token from an `Authorization: Bearer <token>` header. */
function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/** Map a structured dispatch error code to the HTTP status the worker reads. */
function statusForError(code: DispatchErrorCode): number {
  switch (code) {
    case "unknown_tool":
      return 404;
    case "validation_error":
      return 422;
    case "permission_denied":
      return 403;
    case "otp_required":
      return 403;
    case "handler_error":
      return 500;
    default:
      return 500;
  }
}

export const toolsRoutes = new Elysia({ name: "tools", prefix: "/tools" })
  // Service-token guard scoped to every route in this module (SEC-2 / Req 14.2).
  .onBeforeHandle(({ request, set }) => {
    const token = bearerToken(request.headers.get("authorization"));
    if (!isValidServiceToken(token)) {
      set.status = 401;
      return { error: { code: "unauthorized", message: "Invalid service token" } };
    }
  })

  // POST /api/tools/:toolName — validate, permission-check, OTP-gate, audit, run.
  .post("/:toolName", async ({ params, body, set }) => {
    const result = await dispatchTool(db, params.toolName, body, {
      actor: VOICE_AGENT_ACTOR,
    });

    if (result.ok) {
      // The worker reads `res.json()` as the tool result directly on 2xx.
      return result.result;
    }

    set.status = statusForError(result.error.code);
    return { error: result.error };
  });
