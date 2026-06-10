/**
 * Sitemap manager configuration.
 *
 * Stored as a single JSON blob in the `site_settings` table under
 * {@link SITEMAP_CONFIG_KEY}. This lets admins control — without a deploy —
 * which content types appear in `/sitemap.xml`, whether the Arabic
 * (other-language) URLs are emitted, and exclude individual entries.
 */

export const SITEMAP_CONFIG_KEY = "sitemap_config";
export const ROBOTS_TXT_KEY = "robots_txt";

export type SitemapEntryType = "page" | "post" | "project" | "community";

export type SitemapChangeFrequency =
  | "always"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "never";

export const CHANGE_FREQUENCIES: SitemapChangeFrequency[] = [
  "always",
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "never",
];

export type SitemapLanguage = "en" | "ar";

/**
 * An admin-defined sitemap entry that isn't backed by a CMS record — e.g. a
 * landing page hosted elsewhere or a route the generator doesn't know about.
 */
export interface CustomSitemapLink {
  /** Client-generated stable id for list operations. */
  id: string;
  /** Full URL when {@link external}, otherwise a site-relative path. */
  url: string;
  /** When true the URL is used verbatim; when false it's prefixed with the site URL (+ locale). */
  external: boolean;
  priority: number;
  changeFrequency: SitemapChangeFrequency;
  /** ISO date (yyyy-mm-dd) or full ISO timestamp. Empty = "now" at render. */
  lastModified: string;
  /** Locale for internal links (controls the /ar prefix). */
  language: SitemapLanguage;
}

export interface SitemapConfig {
  /** Include CMS pages (published, non-noindex). */
  includePages: boolean;
  /** Include blog/news posts (published, non-noindex). */
  includePosts: boolean;
  /** Include project landing pages (non-archived). */
  includeProjects: boolean;
  /** Include community landing pages (non-archived). */
  includeCommunities: boolean;
  /**
   * Emit the Arabic (other-language) URLs and `alternates.languages`.
   * When false the sitemap is English-only.
   */
  includeArabic: boolean;
  /**
   * Per-entry exclusions. Each key is `${type}:${id}` (see {@link entryKey}).
   * Entries listed here are dropped from the sitemap even if their content
   * type is enabled.
   */
  excludedKeys: string[];
  /** Admin-defined extra URLs appended to the sitemap. */
  customLinks: CustomSitemapLink[];
}

export const DEFAULT_SITEMAP_CONFIG: SitemapConfig = {
  includePages: true,
  includePosts: true,
  includeProjects: true,
  includeCommunities: true,
  includeArabic: true,
  excludedKeys: [],
  customLinks: [],
};

/** Build the stable identity key for a sitemap candidate. */
export function entryKey(type: SitemapEntryType, id: string): string {
  return `${type}:${id}`;
}

/**
 * Parse the raw `site_settings` value into a {@link SitemapConfig}, falling
 * back to defaults for any missing/invalid field. Never throws.
 */
export function parseSitemapConfig(raw: string | null | undefined): SitemapConfig {
  if (!raw) return { ...DEFAULT_SITEMAP_CONFIG };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_SITEMAP_CONFIG };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ...DEFAULT_SITEMAP_CONFIG };
  }
  const o = parsed as Record<string, unknown>;
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

/** Serialize a config for storage, coercing to the known shape. */
export function serializeSitemapConfig(config: SitemapConfig): string {
  return JSON.stringify({
    includePages: !!config.includePages,
    includePosts: !!config.includePosts,
    includeProjects: !!config.includeProjects,
    includeCommunities: !!config.includeCommunities,
    includeArabic: !!config.includeArabic,
    excludedKeys: Array.isArray(config.excludedKeys)
      ? Array.from(new Set(config.excludedKeys.filter((k) => typeof k === "string")))
      : [],
    customLinks: Array.isArray(config.customLinks)
      ? config.customLinks
          .map(normalizeCustomLink)
          .filter((l): l is CustomSitemapLink => l !== null)
      : [],
  } satisfies SitemapConfig);
}

/**
 * Coerce an arbitrary value into a valid {@link CustomSitemapLink}, or return
 * null when it lacks a usable URL. Never throws.
 */
export function normalizeCustomLink(value: unknown): CustomSitemapLink | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const url = typeof o.url === "string" ? o.url.trim() : "";
  if (!url) return null;

  const freq =
    typeof o.changeFrequency === "string" &&
    (CHANGE_FREQUENCIES as string[]).includes(o.changeFrequency)
      ? (o.changeFrequency as SitemapChangeFrequency)
      : "weekly";

  let priority = typeof o.priority === "number" ? o.priority : Number(o.priority);
  if (!Number.isFinite(priority)) priority = 0.5;
  priority = Math.min(1, Math.max(0, priority));

  const language: SitemapLanguage = o.language === "ar" ? "ar" : "en";

  return {
    id:
      typeof o.id === "string" && o.id
        ? o.id
        : `custom-${Math.random().toString(36).slice(2, 10)}`,
    url,
    external: typeof o.external === "boolean" ? o.external : /^https?:\/\//i.test(url),
    priority,
    changeFrequency: freq,
    lastModified: typeof o.lastModified === "string" ? o.lastModified : "",
    language,
  };
}

/** Whether a candidate's `robotsDirective` opts it out of indexing. */
export function isNoIndex(robotsDirective: string | null | undefined): boolean {
  if (!robotsDirective) return false;
  return /noindex/i.test(robotsDirective);
}

/**
 * Default robots.txt body. Used to seed the editor when no custom text has
 * been saved yet. The sitemap URL is derived from the site URL.
 */
export function defaultRobotsTxt(siteUrl: string): string {
  const base = (siteUrl || "").replace(/\/$/, "");
  return [
    "User-Agent: *",
    "Allow: /",
    "Disallow: /ora-panel/",
    "Disallow: /api/",
    "",
    `Sitemap: ${base}/sitemap.xml`,
    "",
  ].join("\n");
}
