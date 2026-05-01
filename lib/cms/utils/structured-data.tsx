import type {
  ProjectLandingData,
  Locale,
} from "@/lib/page-builder/components/project/types";

function pickBilingual(
  en: string | null | undefined,
  ar: string | null | undefined,
  locale: Locale
): string | undefined {
  const v = locale === "ar" ? ar?.trim() || en?.trim() : en?.trim();
  return v || undefined;
}

/**
 * Renders a JSON-LD <script> tag for a project landing page.
 * Uses the Product type with sub-properties for real estate context.
 */
export function ProjectJsonLd({
  data,
  locale,
  url,
  companyName,
}: {
  data: ProjectLandingData;
  locale: Locale;
  url: string;
  companyName?: string;
}) {
  const project = data.project;
  const heroUrl = project.heroImageId
    ? data.media[project.heroImageId]?.url
    : undefined;

  const name = pickBilingual(project.nameEn, project.nameAr, locale) ?? "";
  const description = pickBilingual(
    project.shortDescriptionEn ?? project.longDescriptionEn,
    project.shortDescriptionAr ?? project.longDescriptionAr,
    locale
  );

  const offers =
    Array.isArray(project.paymentPlans) && project.paymentPlans.length > 0
      ? {
          "@type": "AggregateOffer",
          availability: "https://schema.org/PreOrder",
          priceCurrency: "AED",
        }
      : undefined;

  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    description,
    url,
    image: heroUrl ? [heroUrl] : undefined,
    brand: companyName
      ? { "@type": "Organization", name: companyName }
      : undefined,
    additionalType: "https://schema.org/Residence",
    offers,
  };

  // Strip undefined for cleaner output
  Object.keys(ld).forEach((k) => ld[k] === undefined && delete ld[k]);

  return (
    <script
      type="application/ld+json"
      // JSON.stringify is XSS-safe enough here because all values originate from
      // structured project fields, but escape `</` to be defensive.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(ld).replace(/</g, "\\u003c"),
      }}
    />
  );
}

/**
 * JSON-LD <script> for a community page (Place).
 */
export function CommunityJsonLd({
  community,
  heroUrl,
  url,
  locale,
}: {
  community: {
    nameEn: string;
    nameAr?: string | null;
    descriptionEn?: string | null;
    descriptionAr?: string | null;
    city?: string | null;
    region?: string | null;
    country?: string | null;
  };
  heroUrl?: string;
  url: string;
  locale: Locale;
}) {
  const name = pickBilingual(community.nameEn, community.nameAr, locale) ?? "";
  const description = pickBilingual(
    community.descriptionEn,
    community.descriptionAr,
    locale
  );
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Place",
    name,
    description,
    url,
    image: heroUrl ? [heroUrl] : undefined,
    address: {
      "@type": "PostalAddress",
      addressLocality: community.city ?? undefined,
      addressRegion: community.region ?? undefined,
      addressCountry: community.country ?? undefined,
    },
  };
  Object.keys(ld).forEach((k) => ld[k] === undefined && delete ld[k]);
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(ld).replace(/</g, "\\u003c"),
      }}
    />
  );
}

export interface StructuredDataInput {
  postType: "blog" | "news";
  title: string;
  description: string;
  image?: string;
  publishedAt: string;
  updatedAt: string;
  authorName: string;
  url: string;
}

/**
 * Generate Schema.org Article or NewsArticle JSON-LD object.
 * Uses @type "Article" for blog posts and "NewsArticle" for news.
 */
export function generateStructuredData(
  input: StructuredDataInput
): Record<string, unknown> {
  const {
    postType,
    title,
    description,
    image,
    publishedAt,
    updatedAt,
    authorName,
    url,
  } = input;

  const structuredData: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": postType === "news" ? "NewsArticle" : "Article",
    headline: title,
    description,
    datePublished: publishedAt,
    dateModified: updatedAt,
    url,
    author: {
      "@type": "Person",
      name: authorName,
    },
  };

  if (image) {
    structuredData.image = image;
  }

  return structuredData;
}
