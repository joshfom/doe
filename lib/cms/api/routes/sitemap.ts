import { Elysia } from "elysia";
import { authGuard } from "../auth";
import { db } from "../../db";
import { logAudit } from "../../audit";
import {
  collectSitemapCandidates,
  getRobotsTxt,
  getSitemapConfig,
  saveRobotsTxt,
  saveSitemapConfig,
} from "../../sitemap/service";
import {
  DEFAULT_SITEMAP_CONFIG,
  normalizeCustomLink,
  type CustomSitemapLink,
  type SitemapConfig,
} from "../../sitemap/config";

/**
 * Coerce an arbitrary request body into a valid SitemapConfig, ignoring
 * unknown keys and falling back to defaults for anything missing.
 */
function normalizeConfigBody(body: unknown): SitemapConfig {
  const o = (body && typeof body === "object" ? body : {}) as Record<
    string,
    unknown
  >;
  const bool = (v: unknown, fallback: boolean) =>
    typeof v === "boolean" ? v : fallback;
  return {
    includePages: bool(o.includePages, DEFAULT_SITEMAP_CONFIG.includePages),
    includePosts: bool(o.includePosts, DEFAULT_SITEMAP_CONFIG.includePosts),
    includeProjects: bool(
      o.includeProjects,
      DEFAULT_SITEMAP_CONFIG.includeProjects
    ),
    includeCommunities: bool(
      o.includeCommunities,
      DEFAULT_SITEMAP_CONFIG.includeCommunities
    ),
    includeArabic: bool(o.includeArabic, DEFAULT_SITEMAP_CONFIG.includeArabic),
    excludedKeys: Array.isArray(o.excludedKeys)
      ? o.excludedKeys.filter((k): k is string => typeof k === "string")
      : [],
    customLinks: Array.isArray(o.customLinks)
      ? o.customLinks
          .map(normalizeCustomLink)
          .filter((l): l is CustomSitemapLink => l !== null)
      : [],
  };
}

// ── Public route (consumed by app/sitemap.ts) ────────────────────────────────

const publicSitemap = new Elysia({ name: "sitemap-public" })
  // GET /sitemap/data — config + candidates for the sitemap.xml generator.
  .get("/sitemap/data", async () => {
    const [config, candidates] = await Promise.all([
      getSitemapConfig(db),
      collectSitemapCandidates(db),
    ]);
    return { data: { config, candidates } };
  })

  // GET /sitemap/robots — stored robots.txt text (null if never customized).
  .get("/sitemap/robots", async () => {
    const text = await getRobotsTxt(db);
    return { data: { text } };
  });

// ── Authenticated routes (admin manager) ─────────────────────────────────────

const protectedSitemap = new Elysia({ name: "sitemap-protected" })
  .use(authGuard)

  // GET /sitemap — manager view: config + candidates with metadata.
  .get("/sitemap", async () => {
    const [config, candidates] = await Promise.all([
      getSitemapConfig(db),
      collectSitemapCandidates(db),
    ]);
    return { data: { config, candidates } };
  })

  // PUT /sitemap/config — persist the manager settings.
  .put("/sitemap/config", async ({ body, userId }) => {
    const config = normalizeConfigBody(body);
    const saved = await saveSitemapConfig(db, config);

    await logAudit(db, {
      userId,
      action: "update",
      entityType: "settings",
      entityId: "sitemap_config",
      summary: `Updated sitemap configuration (${saved.excludedKeys.length} excluded, ${saved.customLinks.length} custom links, arabic ${saved.includeArabic ? "on" : "off"})`,
    });

    return { data: saved };
  })

  // PUT /sitemap/robots — persist the exact robots.txt text.
  .put("/sitemap/robots", async ({ body, userId }) => {
    const text =
      body && typeof body === "object" && typeof (body as { text?: unknown }).text === "string"
        ? (body as { text: string }).text
        : "";
    const saved = await saveRobotsTxt(db, text);

    await logAudit(db, {
      userId,
      action: "update",
      entityType: "settings",
      entityId: "robots_txt",
      summary: `Updated robots.txt (${saved.split("\n").length} lines)`,
    });

    return { data: { text: saved } };
  });

export const sitemapRoutes = new Elysia({ name: "sitemap" })
  .use(publicSitemap)
  .use(protectedSitemap);
