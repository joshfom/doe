import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { fetchPublicPage, fetchSiteSettings, fetchPageById } from "@/lib/cms/utils/fetch-page";
import { generatePageMetadata } from "@/lib/cms/utils/seo";
import { PageRenderer } from "@/lib/page-builder/components/PageRenderer";

async function getHomePage() {
  const settings = await fetchSiteSettings();
  const homePageId = settings.home_page_id;
  let page = homePageId ? await fetchPageById(homePageId) : null;
  if (!page) {
    page = await fetchPublicPage("en", "/");
  }
  return page;
}

export async function generateMetadata(): Promise<Metadata> {
  const page = await getHomePage();
  if (!page) return { title: "Home" };

  return generatePageMetadata({
    metaTitle: page.metaTitle ?? page.meta_title,
    metaDescription: page.metaDescription ?? page.meta_description,
    metaKeywords: page.metaKeywords ?? page.meta_keywords,
    ogImage: page.ogImage ?? page.og_image,
    canonicalUrl: page.canonicalUrl ?? page.canonical_url,
    robotsDirective: page.robotsDirective ?? page.robots_directive,
    slug: "/",
    locale: "en",
  });
}

export default async function EnHomePage() {
  const page = await getHomePage();

  if (!page) {
    notFound();
  }

  return (
    <main>
      <PageRenderer data={page.data ?? page} />
    </main>
  );
}
