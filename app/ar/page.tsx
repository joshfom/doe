import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { fetchPublicPage } from "@/lib/cms/utils/fetch-page";
import { generatePageMetadata } from "@/lib/cms/utils/seo";
import { PageRenderer } from "@/lib/page-builder/components/PageRenderer";

export async function generateMetadata(): Promise<Metadata> {
  const page = await fetchPublicPage("ar", "/");
  if (!page) return { title: "الرئيسية" };

  return generatePageMetadata({
    metaTitle: page.metaTitle ?? page.meta_title,
    metaDescription: page.metaDescription ?? page.meta_description,
    metaKeywords: page.metaKeywords ?? page.meta_keywords,
    ogImage: page.ogImage ?? page.og_image,
    canonicalUrl: page.canonicalUrl ?? page.canonical_url,
    robotsDirective: page.robotsDirective ?? page.robots_directive,
    slug: "/",
    locale: "ar",
  });
}

export default async function ArHomePage() {
  const page = await fetchPublicPage("ar", "/");

  if (!page) {
    notFound();
  }

  return (
    <main>
      <PageRenderer data={page.data ?? page} />
    </main>
  );
}
