import Link from "next/link";
import { MapPin } from "lucide-react";
import type { Locale, ProjectMedia } from "./types";

const STATUS_LABELS: Record<string, { en: string; ar: string }> = {
  planning: { en: "Planning", ar: "قيد التخطيط" },
  pre_launch: { en: "Pre-Launch", ar: "قبل الإطلاق" },
  selling: { en: "Selling Now", ar: "البيع متاح" },
  under_construction: { en: "Under Construction", ar: "قيد الإنشاء" },
  handover: { en: "Handover", ar: "التسليم" },
  completed: { en: "Completed", ar: "مكتمل" },
};

export interface PublicCommunityListItem {
  id: string;
  slug: string;
  nameEn: string;
  nameAr?: string | null;
  descriptionEn?: string | null;
  descriptionAr?: string | null;
  city?: string | null;
  region?: string | null;
  heroImageId?: string | null;
}

function pickBilingual(
  en: string | null | undefined,
  ar: string | null | undefined,
  locale: Locale
): string {
  if (locale === "ar") return ar?.trim() || en?.trim() || "";
  return en?.trim() || "";
}

function CommunityCard({
  community,
  hero,
  basePath,
  locale,
  projectCount,
}: {
  community: PublicCommunityListItem;
  hero: ProjectMedia | null;
  basePath: string;
  locale: Locale;
  projectCount: number;
}) {
  const name = pickBilingual(community.nameEn, community.nameAr, locale);
  const desc = pickBilingual(
    community.descriptionEn,
    community.descriptionAr,
    locale
  );
  const location = [community.city, community.region]
    .filter(Boolean)
    .join(", ");

  return (
    <a
      href={`${basePath}/${community.slug}`}
      className="group block bg-ora-white transition-shadow hover:shadow-lg"
    >
      <div className="relative aspect-4/3 overflow-hidden bg-ora-charcoal/5">
        {hero ? (
          <img
            src={hero.url}
            alt={hero.alt || name}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-ora-muted">
            No image
          </div>
        )}
      </div>
      <div className="p-5">
        <h3 className="font-serif text-xl text-ora-charcoal">{name}</h3>
        {location && (
          <p className="mt-1 flex items-center gap-1 text-xs text-ora-muted">
            <MapPin className="h-3 w-3 stroke-1" />
            {location}
          </p>
        )}
        {desc && (
          <p className="mt-3 line-clamp-2 text-sm text-ora-charcoal-light">
            {desc}
          </p>
        )}
        <p className="mt-4 text-xs uppercase tracking-wider text-ora-gold">
          {projectCount}{" "}
          {locale === "ar"
            ? projectCount === 1
              ? "مشروع"
              : "مشاريع"
            : projectCount === 1
              ? "project"
              : "projects"}
        </p>
      </div>
    </a>
  );
}

export function CommunityIndex({
  communities,
  media,
  projectCounts,
  prefix,
  locale,
}: {
  communities: PublicCommunityListItem[];
  media: Record<string, ProjectMedia>;
  projectCounts: Record<string, number>;
  prefix: string;
  locale: Locale;
}) {
  const basePath = locale === "ar" ? `/ar/${prefix}` : `/${prefix}`;
  return (
    <main className="min-h-screen bg-ora-bone">
      <header className="bg-ora-charcoal py-16 text-ora-white">
        <div className="mx-auto max-w-6xl px-6 md:px-10">
          <h1 className="font-serif text-4xl md:text-5xl">
            {locale === "ar" ? "المجتمعات" : "Communities"}
          </h1>
          <p className="mt-3 max-w-2xl text-ora-white/80">
            {locale === "ar"
              ? "استكشف مجتمعاتنا الفاخرة في جميع أنحاء المنطقة."
              : "Explore our curated collection of communities across the region."}
          </p>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-6 py-12 md:px-10">
        {communities.length === 0 ? (
          <p className="text-sm text-ora-muted">
            {locale === "ar"
              ? "لا توجد مجتمعات متاحة حاليًا."
              : "No communities available yet."}
          </p>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {communities.map((c) => {
              const hero = c.heroImageId ? media[c.heroImageId] ?? null : null;
              return (
                <CommunityCard
                  key={c.id}
                  community={c}
                  hero={hero}
                  basePath={basePath}
                  locale={locale}
                  projectCount={projectCounts[c.id] ?? 0}
                />
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

export interface PublicCommunityProject {
  id: string;
  slug: string;
  nameEn: string;
  nameAr?: string | null;
  shortDescriptionEn?: string | null;
  shortDescriptionAr?: string | null;
  status: string;
  heroImageId?: string | null;
}

export function CommunityDetail({
  community,
  projects,
  media,
  projectPrefix,
  communityPrefix,
  locale,
  activeStatus,
}: {
  community: PublicCommunityListItem;
  projects: PublicCommunityProject[];
  media: Record<string, ProjectMedia>;
  projectPrefix: string;
  communityPrefix: string;
  locale: Locale;
  activeStatus?: string | null;
}) {
  const name = pickBilingual(community.nameEn, community.nameAr, locale);
  const desc = pickBilingual(
    community.descriptionEn,
    community.descriptionAr,
    locale
  );
  const location = [community.city, community.region]
    .filter(Boolean)
    .join(", ");
  const hero = community.heroImageId ? media[community.heroImageId] ?? null : null;
  const projectsBase = locale === "ar" ? `/ar/${projectPrefix}` : `/${projectPrefix}`;
  const detailBase =
    locale === "ar"
      ? `/ar/${communityPrefix}/${community.slug}`
      : `/${communityPrefix}/${community.slug}`;

  const availableStatuses = Array.from(
    new Set(projects.map((p) => p.status))
  ).filter((s) => STATUS_LABELS[s]);
  const filtered = activeStatus
    ? projects.filter((p) => p.status === activeStatus)
    : projects;

  const allLabel = locale === "ar" ? "الكل" : "All";

  function chipClass(active: boolean): string {
    return `inline-flex h-8 items-center px-4 text-xs uppercase tracking-wider transition-colors ${
      active
        ? "bg-ora-charcoal text-ora-white"
        : "border border-ora-sand bg-ora-white text-ora-charcoal-light hover:border-ora-gold hover:text-ora-charcoal"
    }`;
  }

  return (
    <main className="min-h-screen bg-ora-bone">
      <section className="relative h-96 bg-ora-charcoal">
        {hero && (
          <img
            src={hero.url}
            alt={hero.alt || name}
            className="absolute inset-0 h-full w-full object-cover opacity-70"
          />
        )}
        <div className="absolute inset-0 flex items-end bg-linear-to-t from-ora-charcoal/80 to-transparent">
          <div className="mx-auto w-full max-w-6xl px-6 pb-10 text-ora-white md:px-10">
            <h1 className="font-serif text-4xl md:text-5xl">{name}</h1>
            {location && (
              <p className="mt-2 flex items-center gap-1 text-sm text-ora-white/80">
                <MapPin className="h-4 w-4 stroke-1" />
                {location}
              </p>
            )}
          </div>
        </div>
      </section>

      {desc && (
        <section className="bg-ora-white py-12">
          <div className="mx-auto max-w-3xl px-6 md:px-10">
            <p className="whitespace-pre-line text-base leading-relaxed text-ora-charcoal-light">
              {desc}
            </p>
          </div>
        </section>
      )}

      <section className="py-16">
        <div className="mx-auto max-w-6xl px-6 md:px-10">
          <h2 className="mb-8 font-serif text-3xl text-ora-charcoal md:text-4xl">
            {locale === "ar" ? "المشاريع" : "Projects"}
          </h2>
          {availableStatuses.length > 1 && (
            <div className="mb-8 flex flex-wrap gap-2">
              <Link href={detailBase} className={chipClass(!activeStatus)}>
                {allLabel}
              </Link>
              {availableStatuses.map((s) => {
                const label = STATUS_LABELS[s]?.[locale] ?? s;
                return (
                  <Link
                    key={s}
                    href={`${detailBase}?status=${encodeURIComponent(s)}`}
                    className={chipClass(activeStatus === s)}
                  >
                    {label}
                  </Link>
                );
              })}
            </div>
          )}
          {filtered.length === 0 ? (
            <p className="text-sm text-ora-muted">
              {locale === "ar"
                ? "لا توجد مشاريع منشورة في هذا المجتمع بعد."
                : "No projects published in this community yet."}
            </p>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {filtered.map((p) => {
                const ph = p.heroImageId ? media[p.heroImageId] ?? null : null;
                const pname = pickBilingual(p.nameEn, p.nameAr, locale);
                const pdesc = pickBilingual(
                  p.shortDescriptionEn,
                  p.shortDescriptionAr,
                  locale
                );
                return (
                  <a
                    key={p.id}
                    href={`${projectsBase}/${p.slug}`}
                    className="group block bg-ora-white transition-shadow hover:shadow-lg"
                  >
                    <div className="relative aspect-4/3 overflow-hidden bg-ora-charcoal/5">
                      {ph && (
                        <img
                          src={ph.url}
                          alt={ph.alt || pname}
                          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                      )}
                    </div>
                    <div className="p-5">
                      <h3 className="font-serif text-xl text-ora-charcoal">
                        {pname}
                      </h3>
                      {pdesc && (
                        <p className="mt-2 line-clamp-2 text-sm text-ora-charcoal-light">
                          {pdesc}
                        </p>
                      )}
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
