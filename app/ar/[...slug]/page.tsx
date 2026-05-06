import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import {
  fetchPublicPage,
  fetchPublicProject,
  fetchPublicProjects,
  fetchPublicCommunity,
  fetchPublicCommunities,
  fetchSiteSettings,
} from "@/lib/cms/utils/fetch-page";
import { generatePageMetadata } from "@/lib/cms/utils/seo";
import { PageRenderer } from "@/lib/page-builder/components/PageRenderer";
import { ProjectLanding } from "@/lib/page-builder/components/project/ProjectLanding";
import {
  ProjectIndex,
  type PublicProjectListItem,
} from "@/lib/page-builder/components/project/ProjectIndex";
import {
  CommunityIndex,
  CommunityDetail,
  type PublicCommunityListItem,
  type PublicCommunityProject,
} from "@/lib/page-builder/components/project/CommunityIndex";
import {
  ProjectJsonLd,
  CommunityJsonLd,
} from "@/lib/cms/utils/structured-data";
import type { ProjectLandingData } from "@/lib/page-builder/components/project/types";

const DEFAULT_PROJECT_PREFIX = "projects";
const DEFAULT_COMMUNITY_PREFIX = "communities";

interface Props {
  params: Promise<{ slug: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function getArProjectPrefix(): Promise<string> {
  const settings = await fetchSiteSettings();
  return (
    settings.project_slug_prefix_ar ||
    settings.project_slug_prefix ||
    DEFAULT_PROJECT_PREFIX
  ).trim();
}

async function getArCommunityPrefix(): Promise<string> {
  const settings = await fetchSiteSettings();
  return (
    settings.community_slug_prefix_ar ||
    settings.community_slug_prefix ||
    DEFAULT_COMMUNITY_PREFIX
  ).trim();
}

async function resolveProjectFromSlug(
  slug: string[]
): Promise<ProjectLandingData | null> {
  if (slug.length !== 2) return null;
  const prefix = await getArProjectPrefix();
  if (!prefix || slug[0] !== prefix) return null;
  const data = await fetchPublicProject(slug[1]);
  return (data as unknown as ProjectLandingData) ?? null;
}

async function isProjectIndex(slug: string[]): Promise<string | null> {
  if (slug.length !== 1) return null;
  const prefix = await getArProjectPrefix();
  if (!prefix || slug[0] !== prefix) return null;
  return prefix;
}

async function isCommunityIndex(slug: string[]): Promise<string | null> {
  if (slug.length !== 1) return null;
  const prefix = await getArCommunityPrefix();
  if (!prefix || slug[0] !== prefix) return null;
  return prefix;
}

async function resolveCommunityFromSlug(
  slug: string[]
): Promise<{ communitySlug: string; communityPrefix: string } | null> {
  if (slug.length !== 2) return null;
  const prefix = await getArCommunityPrefix();
  if (!prefix || slug[0] !== prefix) return null;
  return { communitySlug: slug[1], communityPrefix: prefix };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;

  const project = await resolveProjectFromSlug(slug);
  if (project) {
    const name = project.project.nameAr ?? project.project.nameEn ?? "";
    const desc =
      project.project.shortDescriptionAr ??
      project.project.shortDescriptionEn ??
      undefined;
    const heroId = project.project.heroImageId;
    const heroUrl = heroId ? project.media[heroId]?.url : undefined;
    return generatePageMetadata({
      metaTitle: name,
      metaDescription: desc ?? undefined,
      ogImage: heroUrl,
      slug: slug.join("/"),
      locale: "ar",
    });
  }

  const indexPrefix = await isProjectIndex(slug);
  if (indexPrefix) {
    return generatePageMetadata({
      metaTitle: "المشاريع",
      slug: indexPrefix,
      locale: "ar",
    });
  }

  const communityIndexPrefix = await isCommunityIndex(slug);
  if (communityIndexPrefix) {
    return generatePageMetadata({
      metaTitle: "المجتمعات",
      slug: communityIndexPrefix,
      locale: "ar",
    });
  }

  const community = await resolveCommunityFromSlug(slug);
  if (community) {
    const detail = await fetchPublicCommunity(community.communitySlug);
    if (detail) {
      const c = detail.community as unknown as PublicCommunityListItem;
      const heroUrl = c.heroImageId ? detail.media[c.heroImageId]?.url : undefined;
      return generatePageMetadata({
        metaTitle: c.nameAr ?? c.nameEn ?? "",
        metaDescription:
          c.descriptionAr ?? c.descriptionEn ?? undefined,
        ogImage: heroUrl,
        slug: slug.join("/"),
        locale: "ar",
      });
    }
  }

  const fullSlug = slug.join("/");
  const page = await fetchPublicPage("ar", fullSlug);

  if (!page) {
    return { title: "الصفحة غير موجودة" };
  }

  return generatePageMetadata({
    metaTitle: page.metaTitle ?? page.meta_title,
    metaDescription: page.metaDescription ?? page.meta_description,
    metaKeywords: page.metaKeywords ?? page.meta_keywords,
    ogImage: page.ogImage ?? page.og_image,
    canonicalUrl: page.canonicalUrl ?? page.canonical_url,
    robotsDirective: page.robotsDirective ?? page.robots_directive,
    slug: fullSlug,
    locale: "ar",
  });
}

export default async function ArDynamicPage({ params, searchParams }: Props) {
  const { slug } = await params;

  const project = await resolveProjectFromSlug(slug);
  if (project) {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("better-auth.session_token");
    const isAuthenticated = !!sessionCookie?.value;
    const settings = await fetchSiteSettings();

    // If the project has a custom landing page layout, render it via the page builder
    const landingPageData = (project.project as Record<string, unknown>).landingPageData as Record<string, unknown> | null | undefined;

    return (
      <>
        <ProjectJsonLd
          data={project}
          locale="ar"
          url={`/${slug.join("/")}`}
          companyName={settings.company_name}
        />
        {landingPageData ? (
          <PageRenderer data={landingPageData as any} />
        ) : (
          <ProjectLanding data={project} locale="ar" settings={settings} />
        )}
        {isAuthenticated && project.project.id && (
          <a
            href={`/ora-panel/projects/${project.project.id}`}
            className="fixed bottom-6 left-6 z-50 flex items-center gap-2 bg-ora-charcoal text-ora-white px-4 py-2 text-sm font-medium hover:bg-ora-graphite transition-colors"
          >
            تعديل المشروع
          </a>
        )}
      </>
    );
  }

  const indexPrefix = await isProjectIndex(slug);
  if (indexPrefix) {
    const { projects, media, communities } = await fetchPublicProjects();
    const sp = await searchParams;
    const status = typeof sp.status === "string" ? sp.status : null;
    const community = typeof sp.community === "string" ? sp.community : null;
    const bedrooms = typeof sp.bedrooms === "string" ? sp.bedrooms : null;
    return (
      <ProjectIndex
        projects={projects as unknown as PublicProjectListItem[]}
        media={media}
        communities={communities}
        prefix={indexPrefix}
        locale="ar"
        activeStatus={status}
        activeCommunity={community}
        activeBedrooms={bedrooms}
      />
    );
  }

  const communityIndexPrefix = await isCommunityIndex(slug);
  if (communityIndexPrefix) {
    const { communities, media, projectCounts } = await fetchPublicCommunities();
    return (
      <CommunityIndex
        communities={communities as unknown as PublicCommunityListItem[]}
        media={media}
        projectCounts={projectCounts}
        prefix={communityIndexPrefix}
        locale="ar"
      />
    );
  }

  const communityRoute = await resolveCommunityFromSlug(slug);
  if (communityRoute) {
    const detail = await fetchPublicCommunity(communityRoute.communitySlug);
    if (detail) {
      const projectPrefix = await getArProjectPrefix();
      const sp = await searchParams;
      const status = typeof sp.status === "string" ? sp.status : null;
      const c = detail.community as unknown as PublicCommunityListItem & {
        country?: string | null;
      };
      const heroUrl = c.heroImageId ? detail.media[c.heroImageId]?.url : undefined;
      return (
        <>
          <CommunityJsonLd
            community={c}
            heroUrl={heroUrl}
            url={`/${slug.join("/")}`}
            locale="ar"
          />
          <CommunityDetail
            community={detail.community as unknown as PublicCommunityListItem}
            projects={detail.projects as unknown as PublicCommunityProject[]}
            media={detail.media}
            projectPrefix={projectPrefix}
            communityPrefix={communityRoute.communityPrefix}
            locale="ar"
            activeStatus={status}
          />
        </>
      );
    }
  }

  const fullSlug = slug.join("/");
  const page = await fetchPublicPage("ar", fullSlug);

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
          className="fixed bottom-6 left-6 z-50 flex items-center gap-2 bg-ora-charcoal text-ora-white px-4 py-2 text-sm font-medium hover:bg-ora-graphite transition-colors"
        >
          تعديل الصفحة
        </a>
      )}
    </main>
  );
}
