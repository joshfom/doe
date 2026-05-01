import Image from "next/image";
import Link from "next/link";
import type { Locale, ProjectMedia } from "./types";

export interface PublicProjectListItem {
  id: string;
  slug: string;
  nameEn: string;
  nameAr?: string | null;
  shortDescriptionEn?: string | null;
  shortDescriptionAr?: string | null;
  status: string;
  heroImageId?: string | null;
  expectedHandoverDate?: string | null;
  developer?: string | null;
  communityId?: string | null;
  floorplans?: Array<{ bedrooms?: number | null }> | null;
}

export interface PublicCommunityRef {
  id: string;
  slug: string;
  nameEn: string;
  nameAr?: string | null;
}

function FilterRow({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="me-2 text-[11px] font-medium uppercase tracking-wider text-ora-muted">
        {heading}
      </span>
      {children}
    </div>
  );
}

const STATUS_LABELS: Record<string, { en: string; ar: string }> = {
  planning: { en: "Planning", ar: "قيد التخطيط" },
  pre_launch: { en: "Pre-Launch", ar: "قبل الإطلاق" },
  selling: { en: "Selling Now", ar: "البيع متاح" },
  under_construction: { en: "Under Construction", ar: "قيد الإنشاء" },
  handover: { en: "Handover", ar: "التسليم" },
  completed: { en: "Completed", ar: "مكتمل" },
};

export function ProjectIndex({
  projects,
  media,
  communities,
  prefix,
  locale,
  activeStatus,
  activeCommunity,
  activeBedrooms,
}: {
  projects: PublicProjectListItem[];
  media: Record<string, ProjectMedia>;
  communities?: PublicCommunityRef[];
  prefix: string;
  locale: Locale;
  activeStatus?: string | null;
  activeCommunity?: string | null;
  activeBedrooms?: string | null;
}) {
  const heading = locale === "ar" ? "المشاريع" : "Projects";
  const empty =
    locale === "ar" ? "لا توجد مشاريع منشورة بعد." : "No projects published yet.";
  const basePath = locale === "ar" ? `/ar/${prefix}` : `/${prefix}`;

  // Build available filter chips from the union of project statuses.
  const availableStatuses = Array.from(
    new Set(projects.map((p) => p.status))
  ).filter((s) => STATUS_LABELS[s]);

  // Available bedroom counts across all floorplans
  const availableBedrooms = Array.from(
    new Set(
      projects.flatMap((p) =>
        Array.isArray(p.floorplans)
          ? p.floorplans
              .map((f) => f?.bedrooms)
              .filter((n): n is number => typeof n === "number" && n > 0)
          : []
      )
    )
  ).sort((a, b) => a - b);

  // Available communities present in this list
  const presentCommunityIds = new Set(
    projects.map((p) => p.communityId).filter((v): v is string => !!v)
  );
  const availableCommunities = (communities ?? []).filter((c) =>
    presentCommunityIds.has(c.id)
  );

  let filtered = projects;
  if (activeStatus) filtered = filtered.filter((p) => p.status === activeStatus);
  if (activeCommunity)
    filtered = filtered.filter((p) => p.communityId === activeCommunity);
  if (activeBedrooms) {
    const target = Number(activeBedrooms);
    if (!Number.isNaN(target)) {
      filtered = filtered.filter((p) =>
        Array.isArray(p.floorplans)
          ? p.floorplans.some((f) => f?.bedrooms === target)
          : false
      );
    }
  }

  // URL helper preserving the other active filters when a chip is clicked.
  function buildHref(next: {
    status?: string | null;
    community?: string | null;
    bedrooms?: string | null;
  }): string {
    const params = new URLSearchParams();
    const status = next.status === undefined ? activeStatus : next.status;
    const community =
      next.community === undefined ? activeCommunity : next.community;
    const bedrooms =
      next.bedrooms === undefined ? activeBedrooms : next.bedrooms;
    if (status) params.set("status", status);
    if (community) params.set("community", community);
    if (bedrooms) params.set("bedrooms", bedrooms);
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  const allLabel = locale === "ar" ? "الكل" : "All";
  const communityHeading = locale === "ar" ? "المجتمع" : "Community";
  const bedroomsHeading = locale === "ar" ? "غرف النوم" : "Bedrooms";
  const statusHeading = locale === "ar" ? "الحالة" : "Status";

  function chipClass(active: boolean): string {
    return `inline-flex h-8 items-center px-4 text-xs uppercase tracking-wider transition-colors ${
      active
        ? "bg-ora-charcoal text-ora-white"
        : "border border-ora-sand bg-ora-white text-ora-charcoal-light hover:border-ora-gold hover:text-ora-charcoal"
    }`;
  }

  return (
    <main dir={locale === "ar" ? "rtl" : "ltr"} className="bg-ora-cream">
      <header className="border-b border-ora-sand/60 bg-ora-white py-16">
        <div className="mx-auto max-w-6xl px-6 md:px-10">
          <h1 className="font-serif text-4xl text-ora-charcoal md:text-5xl">
            {heading}
          </h1>
          {(availableStatuses.length > 1 ||
            availableCommunities.length > 1 ||
            availableBedrooms.length > 0) && (
            <div className="mt-6 space-y-3">
              {availableStatuses.length > 1 && (
                <FilterRow heading={statusHeading}>
                  <Link href={buildHref({ status: null })} className={chipClass(!activeStatus)}>
                    {allLabel}
                  </Link>
                  {availableStatuses.map((s) => {
                    const label = STATUS_LABELS[s]?.[locale] ?? s;
                    return (
                      <Link
                        key={s}
                        href={buildHref({ status: s })}
                        className={chipClass(activeStatus === s)}
                      >
                        {label}
                      </Link>
                    );
                  })}
                </FilterRow>
              )}
              {availableCommunities.length > 1 && (
                <FilterRow heading={communityHeading}>
                  <Link
                    href={buildHref({ community: null })}
                    className={chipClass(!activeCommunity)}
                  >
                    {allLabel}
                  </Link>
                  {availableCommunities.map((c) => {
                    const cname =
                      locale === "ar" ? c.nameAr?.trim() || c.nameEn : c.nameEn;
                    return (
                      <Link
                        key={c.id}
                        href={buildHref({ community: c.id })}
                        className={chipClass(activeCommunity === c.id)}
                      >
                        {cname}
                      </Link>
                    );
                  })}
                </FilterRow>
              )}
              {availableBedrooms.length > 0 && (
                <FilterRow heading={bedroomsHeading}>
                  <Link
                    href={buildHref({ bedrooms: null })}
                    className={chipClass(!activeBedrooms)}
                  >
                    {allLabel}
                  </Link>
                  {availableBedrooms.map((n) => (
                    <Link
                      key={n}
                      href={buildHref({ bedrooms: String(n) })}
                      className={chipClass(activeBedrooms === String(n))}
                    >
                      {n} {locale === "ar" ? "غرف" : n === 1 ? "BR" : "BR"}
                    </Link>
                  ))}
                </FilterRow>
              )}
            </div>
          )}
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-6 py-16 md:px-10">
        {filtered.length === 0 ? (
          <p className="text-sm text-ora-charcoal-light">{empty}</p>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((p) => {
              const hero = p.heroImageId ? media[p.heroImageId] : null;
              const name =
                locale === "ar" ? p.nameAr?.trim() || p.nameEn : p.nameEn;
              const desc =
                locale === "ar"
                  ? p.shortDescriptionAr?.trim() || p.shortDescriptionEn
                  : p.shortDescriptionEn;
              const status = STATUS_LABELS[p.status]?.[locale];
              return (
                <Link
                  key={p.id}
                  href={`${basePath}/${p.slug}`}
                  className="group block bg-ora-white border border-ora-sand/60 transition-shadow hover:shadow-ora-md"
                >
                  <div className="relative aspect-4/3 bg-ora-sand/40">
                    {hero && (
                      <Image
                        src={hero.url}
                        alt={hero.alt || name}
                        fill
                        sizes="(max-width: 768px) 100vw, 33vw"
                        className="object-cover"
                      />
                    )}
                    {status && (
                      <span className="absolute left-3 top-3 bg-ora-charcoal/90 px-3 py-1 text-[10px] uppercase tracking-wider text-ora-white">
                        {status}
                      </span>
                    )}
                  </div>
                  <div className="p-5">
                    <h2 className="text-lg font-medium text-ora-charcoal group-hover:text-ora-gold">
                      {name}
                    </h2>
                    {desc && (
                      <p className="mt-2 line-clamp-2 text-sm text-ora-charcoal-light">
                        {desc}
                      </p>
                    )}
                    {p.developer && (
                      <p className="mt-3 text-[11px] uppercase tracking-wider text-ora-muted">
                        {p.developer}
                      </p>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
