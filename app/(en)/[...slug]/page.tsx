import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import { fetchPublicPage } from "@/lib/cms/utils/fetch-page";
import { generatePageMetadata } from "@/lib/cms/utils/seo";
import { PageRenderer } from "@/lib/page-builder/components/PageRenderer";

interface Props {
  params: Promise<{ slug: string[] }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const fullSlug = slug.join("/");
  const page = await fetchPublicPage("en", fullSlug);

  if (!page) {
    return { title: "Page Not Found" };
  }

  return generatePageMetadata({
    metaTitle: page.metaTitle ?? page.meta_title,
    metaDescription: page.metaDescription ?? page.meta_description,
    metaKeywords: page.metaKeywords ?? page.meta_keywords,
    ogImage: page.ogImage ?? page.og_image,
    canonicalUrl: page.canonicalUrl ?? page.canonical_url,
    robotsDirective: page.robotsDirective ?? page.robots_directive,
    slug: fullSlug,
    locale: "en",
  });
}

export default async function EnDynamicPage({ params }: Props) {
  const { slug } = await params;
  const fullSlug = slug.join("/");
  const page = await fetchPublicPage("en", fullSlug);

  if (!page) {
    notFound();
  }

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("better-auth.session_token");
  const isAuthenticated = !!sessionCookie?.value;

  return (
    <main>
      <PageRenderer data={page.data ?? page} />
      {isAuthenticated && page.id && (
        <a
          href={`/ora-panel/pages/${page.id}/edit`}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-ora-charcoal text-ora-white px-4 py-2 text-sm font-medium hover:bg-ora-graphite transition-colors"
        >
          Edit page
        </a>
      )}
    </main>
  );
}
