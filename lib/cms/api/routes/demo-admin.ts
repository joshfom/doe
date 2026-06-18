import { Elysia } from "elysia";
import { db } from "../../db";
import { identityGuard, requireAdmin } from "../../rbac/middleware";
import { resetVoiceDemo } from "../../seed/voice-demo";

// ── Demo admin routes (Design §10, §22; Requirements 11.6, 11.7, 14.7) ────────
//
// `POST /api/demo/reset` returns the DOE Voice Surface to a clean, known
// synthetic state for the next rehearsal. It removes exactly the demo-scoped
// (`demo = true`) voice-surface rows and leaves all non-demo data untouched
// (Req 11.6), and is idempotent — running it twice equals running it once
// (Req 11.7). The work is delegated to `resetVoiceDemo` (`lib/cms/seed/
// voice-demo.ts`), which builds on the shared `clearVoiceDemo` scope clearer.
//
// SECURITY (Req 14.7 / design §22): the reset is destructive, so the endpoint
// requires ADMIN authentication. `identityGuard` establishes a valid Better
// Auth session (401 otherwise) and `requireAdmin` demands the global `*:*`
// permission held only by the `super_admin` role (403 otherwise). The Demo
// Console reset control (task 15.3, `DemoResetControl.tsx`) calls this endpoint
// with credentials.
//
// TRANSPORT: request/response only (no durable connection), so it is served on
// either mount; per design §10 it resolves through the Next bridge. This module
// only EXPORTS `demoAdminRoutes`; wiring it into the Elysia core
// (`lib/cms/api/index.ts`) is task 19.1.
//
// SCOPE: design §10 groups a future `POST /api/demo/hooks/jobs` (job-status
// webhook) under this same module; that belongs to the job-runner wiring and is
// intentionally NOT added here — task 18.2 owns only the admin-gated reset.

export const demoAdminRoutes = new Elysia({ name: "demo-admin", prefix: "/demo" })
  .use(identityGuard)
  .use(requireAdmin)

  // POST /api/demo/reset — wipe the demo-scoped voice-surface rows (admin only).
  // Returns 202 Accepted with a summary of exactly what was removed so the
  // Console can confirm the reset (and observe the ≤ 60s budget via durationMs).
  .post("/reset", async ({ set }) => {
    const summary = await resetVoiceDemo(db);
    set.status = 202;
    return { data: summary };
  });
