import { Elysia } from "elysia";
import { identityGuard, requirePermission } from "../../rbac/middleware";
import { streamEvents } from "../../realtime/subscribe";

// ── Realtime SSE route (Design §10, §22; Requirements 7.1, 14.6) ──────────────
//
// `GET /api/realtime/events` is the Server-Sent Events stream that backs the
// Demo Console. It exposes transcripts and decisions, so it is a protected,
// network-exposed surface: it requires a Better Auth session (via `identityGuard`)
// AND the `voice:console` RBAC permission (via `requirePermission`). See Req 14.6.
//
// IMPORTANT — Bun-mount only (Req 12.2, 12.3): this is a durable, long-lived
// connection. It is effective ONLY when served by the standalone Bun process
// (`lib/cms/api/server.ts`, `api.listen`). The Next bridge
// (`app/api/[...slugs]/route.ts`, `api.handle`) is request/response only and
// cannot hold the stream open, so Caddy routes `/api/realtime/*` to the Bun
// mount. This module only EXPORTS `realtimeRoutes`; wiring it into the Elysia
// core and ensuring the Bun mount serves it is task 19.1.
//
// `streamEvents` (task 2.3, `lib/cms/realtime/subscribe.ts`) already returns a
// `Response` with the correct SSE headers (Content-Type text/event-stream,
// Cache-Control no-cache, heartbeat, etc.), so the handler simply returns it.

export const realtimeRoutes = new Elysia({ name: "realtime", prefix: "/realtime" })
  .use(identityGuard)
  .use(requirePermission("voice:console"))

  // GET /api/realtime/events — SSE stream consumed by the Demo Console.
  .get("/events", ({ request }) => streamEvents(request));

// ── Leads realtime stream (lead-engine dashboard) ────────────────────────────
//
// `GET /api/realtime/leads` is a SECOND, independently-gated SSE stream serving
// ONLY the lead-lifecycle events (`lead.*`). It is a separate Elysia instance so
// it carries its OWN guard — `leads:read` — rather than the Console's
// `voice:console`: a rep who can see leads must NOT need Console access, and a
// leads-only subscriber must NOT receive voice transcripts. The server-side
// `filter` enforces that scoping so unrelated events never leave the process on
// this stream.
//
// Same Bun-mount caveat as `/events`: it is a durable connection, effective only
// on the standalone Bun mount (`server.ts`); Caddy already routes
// `/api/realtime/*` there.
export const realtimeLeadsRoutes = new Elysia({ name: "realtime-leads", prefix: "/realtime" })
  .use(identityGuard)
  .use(requirePermission("leads:read"))

  // GET /api/realtime/leads — SSE stream of lead-lifecycle events only.
  .get("/leads", ({ request }) =>
    streamEvents(request, undefined, {
      filter: (event) => event.type.startsWith("lead."),
    })
  );
