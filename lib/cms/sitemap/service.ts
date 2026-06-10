/**
 * Sitemap candidate collection + config persistence.
 *
 * The admin UI and the public `app/sitemap.ts` route both build on the same
 * set of "candidates" so what an editor sees in the manager matches exactly
 * what ends up in `/sitemap.xml`.
 */

import { and, eq, ne } from "drizzle-orm";
import type { Database } from "../db";
import { pages, posts, communities, projects, siteSettings } from "../schema";
import {
  DEFAULT_SITEMAP_CONFIG,
  ROBOTS_TXT_KEY,
  SITEMAP_CONFIG_KEY,
  entryKey,
  isNoIndex,
  parseSitemapConfig,
  serializeSitemapConfig,
  type SitemapConfig,
  type SitemapEntryType,
} from "./config";

export interface SitemapCandidate {
  /** `${type}:${id}` — stable identity used for exclusions. */
  key: string;
  type: SitemapEntryType;
  id: string;
  /** English/base slug (empty string for the home page). */
  slug: string;
  /** Human label for the admin table. */
  label: string;
  /** Whether the source content opts out via robots `noindex`. */
  noIndex: boolean;
  /** ISO timestamp of last modification, if known. */
  updatedAt: string | null;
}

// ── Config persistence ───────────────────────────────────────────────────────

export async function getSitemapConfig(db: Database): Promise<SitemapConfig> {
  const [row] = await db
    .select()
    .from(siteSettings)
    .where(eq(siteSettings.key, SITEMAP_CONFIG_KEY))
    .limit(1);
  return parseSitemapConfig(row?.value);
}

export async function saveSitemapConfig(
  db: Database,
  config: SitemapConfig
): Promise<SitemapConfig> {
  const value = serializeSitemapConfig(config);
  const [existing] = await db
    .select()
    .from(siteSettings)
    .where(eq(siteSettings.key, SITEMAP_CONFIG_KEY))
    .limit(1);

  if (existing) {
    await db
      .update(siteSettings)
      .set({ value, updatedAt: new Date() })
      .where(eq(siteSettings.key, SITEMAP_CONFIG_KEY));
  } else {
    await db.insert(siteSettings).values({ key: SITEMAP_CONFIG_KEY, value });
  }

  return parseSitemapConfig(value);
}

// ── Robots.txt persistence ───────────────────────────────────────────────────

/** Returns the stored robots.txt text, or null if never customized. */
export async function getRobotsTxt(db: Database): Promise<string | null> {
  const [row] = await db
    .select()
    .from(siteSettings)
    .where(eq(siteSettings.key, ROBOTS_TXT_KEY))
    .limit(1);
  return row ? row.value : null;
}

export async function saveRobotsTxt(
  db: Database,
  text: string
): Promise<string> {
  const [existing] = await db
    .select()
    .from(siteSettings)
    .where(eq(siteSettings.key, ROBOTS_TXT_KEY))
    .limit(1);

  if (existing) {
    await db
      .update(siteSettings)
      .set({ value: text, updatedAt: new Date() })
      .where(eq(siteSettings.key, ROBOTS_TXT_KEY));
  } else {
    await db.insert(siteSettings).values({ key: ROBOTS_TXT_KEY, value: text });
  }
  return text;
}

// ── Candidate collection ─────────────────────────────────────────────────────

/**
 * Collect every URL that could appear in the sitemap, grouped by type. Only
 * the English/base record is returned per item — the Arabic alternate is
 * derived from the same slug at render time.
 */
export async function collectSitemapCandidates(
  db: Database
): Promise<Record<SitemapEntryType, SitemapCandidate[]>> {
  const [pageRows, postRows, communityRows, projectRows] = await Promise.all([
    db
      .select({
        id: pages.id,
        slug: pages.slug,
        title: pages.title,
        robotsDirective: pages.robotsDirective,
        updatedAt: pages.updatedAt,
      })
      .from(pages)
      .where(and(eq(pages.locale, "en"), eq(pages.status, "published"))),

    db
      .select({
        id: posts.id,
        slug: posts.slug,
        title: posts.title,
        robotsDirective: posts.robotsDirective,
        updatedAt: posts.updatedAt,
      })
      .from(posts)
      .where(and(eq(posts.locale, "en"), eq(posts.status, "published"))),

    db
      .select({
        id: communities.id,
        slug: communities.slug,
        nameEn: communities.nameEn,
        updatedAt: communities.updatedAt,
      })
      .from(communities)
      .where(ne(communities.status, "archived")),

    db
      .select({
        id: projects.id,
        slug: projects.slug,
        nameEn: projects.nameEn,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .where(ne(projects.status, "archived")),
  ]);

  return {
    page: pageRows.map((r) => ({
      key: entryKey("page", r.id),
      type: "page" as const,
      id: r.id,
      slug: r.slug,
      label: r.title,
      noIndex: isNoIndex(r.robotsDirective),
      updatedAt: toIso(r.updatedAt),
    })),
    post: postRows.map((r) => ({
      key: entryKey("post", r.id),
      type: "post" as const,
      id: r.id,
      slug: r.slug,
      label: r.title,
      noIndex: isNoIndex(r.robotsDirective),
      updatedAt: toIso(r.updatedAt),
    })),
    community: communityRows.map((r) => ({
      key: entryKey("community", r.id),
      type: "community" as const,
      id: r.id,
      slug: r.slug,
      label: r.nameEn,
      noIndex: false,
      updatedAt: toIso(r.updatedAt),
    })),
    project: projectRows.map((r) => ({
      key: entryKey("project", r.id),
      type: "project" as const,
      id: r.id,
      slug: r.slug,
      label: r.nameEn,
      noIndex: false,
      updatedAt: toIso(r.updatedAt),
    })),
  };
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export { DEFAULT_SITEMAP_CONFIG };
