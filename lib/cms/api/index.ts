import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { db } from "../db";
import { seedRbac } from "../rbac/seed";
import { migrateExistingUsers } from "../rbac/migration";
import { seedTicketPermissions } from "../tickets/seed";
import { seedCommunityProjectPermissions } from "../communities/seed";
import { seedAiPermissions } from "../ai/seed";
import { authPlugin } from "./auth";
import { pagesRoutes } from "./routes/pages";
import { revisionsRoutes } from "./routes/revisions";
import { mediaRoutes } from "./routes/media";
import { formsRoutes } from "./routes/forms";
import { settingsRoutes } from "./routes/settings";
import { auditRoutes } from "./routes/audit";
import { componentTemplatesRoutes } from "./routes/component-templates";
import { postsRoutes } from "./routes/posts";
import { postRevisionsRoutes } from "./routes/post-revisions";
import { categoriesRoutes } from "./routes/categories";
import { tagsRoutes } from "./routes/tags";
import { statsRoutes } from "./routes/stats";
import { menusRoutes } from "./routes/menus";
import { newsletterRoutes } from "./routes/newsletter";
import { footerRoutes } from "./routes/footer";
import { approvalConfigRoutes } from "./routes/approval-config";
import { approvalRoutes } from "./routes/approvals";
import { usersRoutes } from "./routes/users";
import { ticketsRoutes } from "./routes/tickets";
import { leadsRoutes, leadsConsoleRoutes } from "./routes/leads";
import { ticketCategoriesRoutes } from "./routes/ticket-categories";
import { communitiesRoutes } from "./routes/communities";
import { projectsRoutes } from "./routes/projects";
import { aiChatRoutes } from "./routes/ai-chat";
import { aiAdminRoutes } from "./routes/ai-admin";
import { aiEmailTestRoutes } from "./routes/ai-email-test";
import { aiConversationsRoutes } from "./routes/ai-conversations";
import { aiKnowledgeBaseRoutes } from "./routes/ai-knowledge-base";
import { aiRecordsRoutes } from "./routes/ai-records";
import { aiAppointmentsRoutes } from "./routes/ai-appointments";
import { aiAnalyticsRoutes } from "./routes/ai-analytics";
import { aiAnalyticsEmailRoutes } from "./routes/ai-analytics-email";
import { aiConfigRoutes } from "./routes/ai-config";
import { calendarRoutes } from "./routes/calendar";
import { interestRoutes } from "./routes/interest";
import { analyticsSettingsRoutes } from "./routes/analytics-settings";
import { utmLinksRoutes } from "./routes/utm-links";
import { marketingDashboardRoutes } from "./routes/marketing-dashboard";
import { marketingSpendRoutes } from "./routes/marketing-spend";
import { customEventsRoutes } from "./routes/custom-events";
import { conversionGoalsRoutes } from "./routes/conversion-goals";
import { utmAnalyticsRoutes } from "./routes/utm-analytics";
import { sitemapRoutes } from "./routes/sitemap";
// DOE Voice Surface route modules (task 19.1). voice/tools/demo-admin resolve on
// the Next mount (request/response); realtime SSE is effective only on the Bun
// mount (`api.listen`), where the stream can stay open. See design §3, §10.
import { voiceRoutes, voiceStaffRoutes } from "./routes/voice";
import { toolsRoutes } from "./routes/tools";
import { realtimeRoutes, realtimeLeadsRoutes } from "./routes/realtime";
import { prospectingRoutes } from "./routes/prospecting";
import { demoAdminRoutes } from "./routes/demo-admin";
// Agent-First Home / Briefing Surface (S5, task 11). Bun-mounted Elysia
// transports attached to THIS single app (no second mount): GET /home/briefing,
// POST /home/chat, GET /home/health + the SSE-bus Briefing_Cache invalidation
// listener (wired on `.listen()` via the plugin's onStart). The chat turn and
// health probe dynamically import the agent runtime, so this static import
// pulls no `@mastra` into the Next bridge bundle.
import { homeRoutes } from "./routes/home";

// ── One-time RBAC init ───────────────────────────────────────────────────────
// When running under `next dev`, the standalone server.ts entry never executes,
// so we have to ensure RBAC + AI + ticket + community permissions are seeded
// before the first request. This runs at module load (once per process).
let _rbacInitPromise: Promise<void> | null = null;
function ensureRbacSeeded(): Promise<void> {
  if (!_rbacInitPromise) {
    _rbacInitPromise = (async () => {
      try {
        await seedRbac(db);
      } catch (err) {
        console.error("[api] RBAC seeder failed:", err);
      }
      try {
        await seedTicketPermissions(db);
      } catch (err) {
        console.error("[api] Ticket permissions seeder failed:", err);
      }
      try {
        await seedCommunityProjectPermissions(db);
      } catch (err) {
        console.error("[api] Community/project permissions seeder failed:", err);
      }
      try {
        await seedAiPermissions(db);
      } catch (err) {
        console.error("[api] AI permissions seeder failed:", err);
      }
      try {
        await migrateExistingUsers(db);
      } catch (err) {
        console.error("[api] RBAC user migration failed:", err);
      }
    })();
  }
  return _rbacInitPromise;
}

// Kick off seeding immediately at module load. Routes can still hit
// `await ensureRbacSeeded()` defensively, but in practice this resolves
// long before the first authenticated request lands.
void ensureRbacSeeded();

export const api = new Elysia({ prefix: "/api" })
  .use(cors())
  .onRequest(async () => {
    // Defensive: block the first few requests until RBAC is ready.
    await ensureRbacSeeded();
  })
  .use(authPlugin)
  .use(pagesRoutes)
  .use(revisionsRoutes)
  .use(mediaRoutes)
  .use(formsRoutes)
  .use(settingsRoutes)
  .use(auditRoutes)
  .use(componentTemplatesRoutes)
  .use(postsRoutes)
  .use(postRevisionsRoutes)
  .use(categoriesRoutes)
  .use(tagsRoutes)
  .use(statsRoutes)
  .use(menusRoutes)
  .use(newsletterRoutes)
  .use(footerRoutes)
  .use(approvalConfigRoutes)
  .use(approvalRoutes)
  .use(usersRoutes)
  .use(ticketsRoutes)
  .use(leadsRoutes) // POST /api/leads/simulate (+ /sources) — token-guarded test harness
  .use(leadsConsoleRoutes) // GET /api/leads/inbound(/:id) + sync-sf/analyze — RBAC leads:read (dashboard)
  .use(ticketCategoriesRoutes)
  .use(communitiesRoutes)
  .use(projectsRoutes)
  .use(aiChatRoutes)
  .use(aiAdminRoutes)
  .use(aiEmailTestRoutes)
  .use(aiConversationsRoutes)
  .use(aiKnowledgeBaseRoutes)
  .use(aiRecordsRoutes)
  .use(aiAppointmentsRoutes)
  .use(aiAnalyticsRoutes)
  .use(aiAnalyticsEmailRoutes)
  .use(aiConfigRoutes)
  .use(calendarRoutes)
  .use(interestRoutes)
  .use(analyticsSettingsRoutes)
  .use(utmLinksRoutes)
  .use(marketingDashboardRoutes)
  .use(marketingSpendRoutes)
  .use(customEventsRoutes)
  .use(conversionGoalsRoutes)
  .use(utmAnalyticsRoutes)
  .use(sitemapRoutes)
  // ── DOE Voice Surface (task 19.1) ──────────────────────────────────────────
  // Additive registration, after the existing routes and before `type Api`, so
  // the single `api` instance — and the `Api` type Eden Treaty consumes — now
  // includes the voice surface. `realtimeRoutes` rides the same instance but is
  // only useful on the Bun mount (`server.ts`), where the SSE stream stays open.
  .use(voiceRoutes) // POST /api/voice/sessions, GET /api/voice/sessions/:id
  .use(voiceStaffRoutes) // POST /api/voice/staff-sessions (authenticated employee Twin)
  .use(toolsRoutes) // POST /api/tools/:toolName (service-token guarded)
  .use(realtimeRoutes) // GET /api/realtime/events (SSE) — durable on Bun mount only
  .use(realtimeLeadsRoutes) // GET /api/realtime/leads (SSE, leads:read) — Bun mount only
  // ── Prospecting Workspace bridge (S7, task 8.4) ────────────────────────────
  // The thin, AUDITED bridge for the outbound prospecting surface
  // (`app/ora-panel/prospecting/`). Drives the flow through `dispatchTool` into
  // the prospecting CatalogEntries (never importing the container-only Mastra
  // agents/workflow). RBAC-gated (`leads:read`); the prospecting SSE stream
  // (`GET /api/prospecting/events`) is durable on the Bun mount, same as the
  // other realtime streams.
  .use(prospectingRoutes)
  .use(demoAdminRoutes) // POST /api/demo/reset (admin-gated)
  // ── Agent-First Home / Briefing Surface (S5, task 11) ──────────────────────
  // GET /api/home/briefing, POST /api/home/chat, GET /api/home/health. The
  // Briefing_Cache invalidation listener subscribes on the Bun mount's
  // `.listen()` (the plugin's onStart), never on the Next `.handle()` bridge.
  .use(homeRoutes);

// Single app type consumed by every Eden Treaty client (web, agent worker,
// job runner, Demo Console). See design §3 and §16.
export type Api = typeof api;
