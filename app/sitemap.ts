import type { MetadataRoute } from "next";
import { fetchSiteSettings } from "@/lib/cms/utils/fetch-page";
import {
  DEFAULT_SITEMAP_CONFIG,
  parseSitemapConfig,
  type CustomSitemapLink,
  type SitemapConfig,
  type SitemapEntryType,
} from "@/lib/cms/sitemap/config";

const API_BASE_URL =
  process.env.API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:3000";

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.SITE_URL ||
  "http://localhost:3000"
).replace(/\/$/, "");

interface Candidate {
  key: string;
  type: SitemapEntryType;
  id: string;
  slug: string;
  noIndex: boolean;
  updatedAt: string | null;
}

interface SitemapData {
  config: SitemapConfig;
  candidates: Record<SitemapEntryType, Candidate[]>;
}

async function fetchSitemapData(): Promise<SitemapData> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/sitemap/data`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const json = await res.json();
    return {
      config: parseSitemapConfig(JSON.stringify(json.data?.config ?? {})),
      candidates: json.data?.candidates ?? {
        page: [],
        post: [],
        project: [],
        community: [],
      },
    };
  } catch {
    return {
      config: { ...DEFAULT_SITEMAP_CONFIG },
      candidates: { page: [], post: [], project: [], community: [] },
    };
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [settings, { config, candidates }] = await Promise.all([
    fetchSiteSettings(),
    fetchSitemapData(),
  ]);

  const projectPrefix = (settings.project_slug_prefix || "projects").trim();
  const projectPrefixAr = (
    settings.project_slug_prefix_ar ||
    settings.project_slug_prefix ||
    "projects"
  ).trim();
  const communityPrefix = (
    settings.community_slug_prefix || "communities"
  ).trim();
  const communityPrefixAr = (
    settings.community_slug_prefix_ar ||
    settings.community_slug_prefix ||
    "communities"
  ).trim();

  const { includeArabic } = config;
  const excluded = new Set(config.excludedKeys);
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [];

  /** Build a localized entry, attaching the AR alternate when enabled. */
  function pushEntry(
    enPath: string,
    arPath: string,
    opts: {
      lastModified?: Date;
      changeFrequency?: MetadataRoute.Sitemap[number]["changeFrequency"];
      priority?: number;
    } = {}
  ) {
    const entry: MetadataRoute.Sitemap[number] = {
      url: `${SITE_URL}${enPath}`,
      lastModified: opts.lastModified ?? now,
      changeFrequency: opts.changeFrequency,
      priority: opts.priority,
    };
    if (includeArabic) {
      entry.alternates = {
        languages: {
          en: `${SITE_URL}${enPath}`,
          ar: `${SITE_URL}/ar${arPath}`,
        },
      };
    }
    entries.push(entry);
    if (includeArabic) {
      entries.push({
        url: `${SITE_URL}/ar${arPath}`,
        lastModified: opts.lastModified ?? now,
        changeFrequency: opts.changeFrequency,
        priority: opts.priority,
      });
    }
  }

  const visible = (c: Candidate) => !c.noIndex && !excluded.has(c.key);
  const lastMod = (c: Candidate) => (c.updatedAt ? new Date(c.updatedAt) : now);

  // ── Index pages for enabled collections ──────────────────────────────────
  if (config.includeProjects) {
    pushEntry(`/${projectPrefix}`, `/${projectPrefixAr}`, {
      changeFrequency: "daily",
      priority: 0.7,
    });
  }
  if (config.includeCommunities) {
    pushEntry(`/${communityPrefix}`, `/${communityPrefixAr}`, {
      changeFrequency: "weekly",
      priority: 0.6,
    });
  }

  // ── CMS pages ─────────────────────────────────────────────────────────────
  if (config.includePages) {
    for (const c of candidates.page) {
      if (!visible(c)) continue;
      const path = c.slug ? `/${c.slug}` : "";
      pushEntry(path || "/", path || "/", {
        lastModified: lastMod(c),
        changeFrequency: "weekly",
        priority: c.slug ? 0.6 : 1,
      });
    }
  }

  // ── Blog / news posts ───────────────────────────────────────────────────
  if (config.includePosts) {
    for (const c of candidates.post) {
      if (!visible(c)) continue;
      pushEntry(`/blog/${c.slug}`, `/blog/${c.slug}`, {
        lastModified: lastMod(c),
        changeFrequency: "weekly",
        priority: 0.5,
      });
    }
  }

  // ── Projects ──────────────────────────────────────────────────────────────
  if (config.includeProjects) {
    for (const c of candidates.project) {
      if (!visible(c)) continue;
      pushEntry(`/${projectPrefix}/${c.slug}`, `/${projectPrefixAr}/${c.slug}`, {
        lastModified: lastMod(c),
        changeFrequency: "weekly",
        priority: 0.8,
      });
    }
  }

  // ── Communities ─────────────────────────────────────────────────────────
  if (config.includeCommunities) {
    for (const c of candidates.community) {
      if (!visible(c)) continue;
      pushEntry(
        `/${communityPrefix}/${c.slug}`,
        `/${communityPrefixAr}/${c.slug}`,
        {
          lastModified: lastMod(c),
          changeFrequency: "weekly",
          priority: 0.6,
        }
      );
    }
  }

  // ── Custom arbitrary links ────────────────────────────────────────────────
  for (const link of config.customLinks) {
    const url = resolveCustomUrl(link, SITE_URL, includeArabic);
    if (!url) continue;
    const lastModified = link.lastModified
      ? new Date(link.lastModified)
      : now;
    entries.push({
      url,
      lastModified: Number.isNaN(lastModified.getTime()) ? now : lastModified,
      changeFrequency: link.changeFrequency,
      priority: link.priority,
    });
  }

  return entries;
}

/**
 * Resolve a custom link to an absolute URL. External links are used verbatim;
 * internal links are prefixed with the site URL and (for Arabic) the /ar
 * segment. Returns null when an Arabic-only link is requested but Arabic is
 * disabled.
 */
function resolveCustomUrl(
  link: CustomSitemapLink,
  siteUrl: string,
  includeArabic: boolean
): string | null {
  if (link.external) {
    return /^https?:\/\//i.test(link.url) ? link.url : `https://${link.url}`;
  }
  if (link.language === "ar" && !includeArabic) return null;
  const path = link.url.startsWith("/") ? link.url : `/${link.url}`;
  const localePrefix = link.language === "ar" ? "/ar" : "";
  return `${siteUrl}${localePrefix}${path}`;
}
