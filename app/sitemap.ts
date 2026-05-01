import type { MetadataRoute } from "next";
import {
  fetchPublicProjects,
  fetchPublicCommunities,
  fetchSiteSettings,
} from "@/lib/cms/utils/fetch-page";

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.SITE_URL ||
  "http://localhost:3000"
).replace(/\/$/, "");

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const settings = await fetchSiteSettings();
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

  const [projectList, communityList] = await Promise.all([
    fetchPublicProjects(),
    fetchPublicCommunities(),
  ]);

  const now = new Date();
  const entries: MetadataRoute.Sitemap = [];

  entries.push(
    {
      url: `${SITE_URL}/${projectPrefix}`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/ar/${projectPrefixAr}`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/${communityPrefix}`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/ar/${communityPrefixAr}`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.6,
    }
  );

  for (const p of projectList.projects) {
    const slug = (p as { slug?: string }).slug;
    const updatedAt = (p as { updatedAt?: string }).updatedAt;
    if (!slug) continue;
    const lastModified = updatedAt ? new Date(updatedAt) : now;
    entries.push({
      url: `${SITE_URL}/${projectPrefix}/${slug}`,
      lastModified,
      changeFrequency: "weekly",
      priority: 0.8,
      alternates: {
        languages: {
          en: `${SITE_URL}/${projectPrefix}/${slug}`,
          ar: `${SITE_URL}/ar/${projectPrefixAr}/${slug}`,
        },
      },
    });
  }

  for (const c of communityList.communities) {
    const slug = (c as { slug?: string }).slug;
    const updatedAt = (c as { updatedAt?: string }).updatedAt;
    if (!slug) continue;
    const lastModified = updatedAt ? new Date(updatedAt) : now;
    entries.push({
      url: `${SITE_URL}/${communityPrefix}/${slug}`,
      lastModified,
      changeFrequency: "weekly",
      priority: 0.6,
      alternates: {
        languages: {
          en: `${SITE_URL}/${communityPrefix}/${slug}`,
          ar: `${SITE_URL}/ar/${communityPrefixAr}/${slug}`,
        },
      },
    });
  }

  return entries;
}
