import type { Metadata } from "next";

export interface PageMetadataInput {
  metaTitle?: string | null;
  metaDescription?: string | null;
  metaKeywords?: string | null;
  ogImage?: string | null;
  canonicalUrl?: string | null;
  robotsDirective?: string | null;
  slug: string;
  locale: "en" | "ar";
}

/**
 * Generate Next.js Metadata object from page metadata fields.
 */
export function generatePageMetadata(input: PageMetadataInput): Metadata {
  const {
    metaTitle,
    metaDescription,
    metaKeywords,
    ogImage,
    canonicalUrl,
    robotsDirective,
    slug,
    locale,
  } = input;

  const enPath = slug === "/" ? "/" : `/${slug}`;
  const arPath = slug === "/" ? "/ar" : `/ar/${slug}`;

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

  // Open Graph
  const og: Record<string, unknown> = {
    locale: locale === "ar" ? "ar_AE" : "en_US",
    type: "website",
  };
  if (metaTitle) og.title = metaTitle;
  if (metaDescription) og.description = metaDescription;
  if (ogImage) og.images = [{ url: ogImage }];
  metadata.openGraph = og;

  // Twitter card
  const twitter: Record<string, unknown> = { card: "summary_large_image" };
  if (metaTitle) twitter.title = metaTitle;
  if (metaDescription) twitter.description = metaDescription;
  if (ogImage) twitter.images = [ogImage];
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
