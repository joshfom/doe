import type { Metadata } from "next";

export interface BlogMetadataInput {
  metaTitle?: string | null;
  metaDescription?: string | null;
  metaKeywords?: string | null;
  ogImage?: string | null;
  featuredImage?: string | null;
  canonicalUrl?: string | null;
  robotsDirective?: string | null;
  slug: string;
  locale: "en" | "ar";
  postType: "blog" | "news";
}

/**
 * Generate Next.js Metadata for a blog post.
 * Falls back to featuredImage for OG image when ogImage is not set.
 * Follows the same pattern as generatePageMetadata in seo.ts.
 */
export function generateBlogMetadata(input: BlogMetadataInput): Metadata {
  const {
    metaTitle,
    metaDescription,
    metaKeywords,
    ogImage,
    featuredImage,
    canonicalUrl,
    robotsDirective,
    slug,
    locale,
    postType,
  } = input;

  const enPath = `/blog/${slug}`;
  const arPath = `/ar/blog/${slug}`;

  const metadata: Metadata = {};

  if (metaTitle) {
    metadata.title = metaTitle;
  }

  if (metaDescription) {
    metadata.description = metaDescription;
  }

  if (metaKeywords) {
    metadata.keywords = metaKeywords.split(",").map((k) => k.trim());
  }

  // Robots
  if (robotsDirective) {
    metadata.robots = robotsDirective;
  }

  // Canonical
  if (canonicalUrl) {
    metadata.alternates = {
      ...metadata.alternates,
      canonical: canonicalUrl,
    };
  }

  // Resolve OG image: prefer ogImage, fall back to featuredImage
  const resolvedOgImage = ogImage || featuredImage || null;

  // Open Graph
  const og: Record<string, unknown> = {
    locale: locale === "ar" ? "ar_AE" : "en_US",
    type: "article",
  };
  if (metaTitle) og.title = metaTitle;
  if (metaDescription) og.description = metaDescription;
  if (resolvedOgImage) og.images = [{ url: resolvedOgImage }];
  metadata.openGraph = og;

  // Twitter card
  const twitter: Record<string, unknown> = { card: "summary_large_image" };
  if (metaTitle) twitter.title = metaTitle;
  if (metaDescription) twitter.description = metaDescription;
  if (resolvedOgImage) twitter.images = [resolvedOgImage];
  metadata.twitter = twitter;

  // Hreflang alternates
  metadata.alternates = {
    ...metadata.alternates,
    languages: {
      en: enPath,
      ar: arPath,
    },
  };

  return metadata;
}
