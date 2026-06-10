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
  .use(sitemapRoutes);
