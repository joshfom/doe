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
  floorplans?: Array<{ bedrooms?: number | null; unitType?: string | null }> | null;
}

export interface PublicCommunityRef {
  id: string;
  slug: string;
  nameEn: string;
  nameAr?: string | null;
}

/** Derive the dominant property type for a project from its floorplans */
function derivePropertyType(
  project: PublicProjectListItem
): string | null {
  if (!Array.isArray(project.floorplans) || project.floorplans.length === 0)
    return null;
  // Count unit types and return the most common
  const counts: Record<string, number> = {};
  for (const fp of project.floorplans) {
    const t = fp.unitType?.toLowerCase();
    if (t) counts[t] = (counts[t] ?? 0) + 1;
  }
  const entries = Object.entries(counts);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

const PROPERTY_TYPE_LABELS: Record<string, { en: string; ar: string }> = {
  villa: { en: "Villas", ar: "فلل" },
  townhouse: { en: "Townhouses", ar: "تاون هاوس" },
  apartment: { en: "Apartments", ar: "شقق" },
  office: { en: "Offices", ar: "مكاتب" },
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
  const basePath = locale === "ar" ? `/ar/${prefix}` : `/${prefix}`;

  // Derive property type categories from floorplans
  const projectsByType: Record<string, PublicProjectListItem[]> = {};
  for (const p of projects) {
    const ptype = derivePropertyType(p);
    if (ptype) {
      if (!projectsByType[ptype]) projectsByType[ptype] = [];
      projectsByType[ptype].push(p);
    }
  }

  const availableTypes = Object.keys(projectsByType).filter(
    (t) => PROPERTY_TYPE_LABELS[t]
  );

  // Active type filter from query params (reuses "status" param for simplicity,
  // or we can add a "type" param)
  const activeType = activeCommunity; // repurpose community param as property type for now

  // URL helper
  function buildHref(type?: string | null): string {
    const params = new URLSearchParams();
    if (type) params.set("community", type);
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  // Filter projects
  let filtered = projects;
  if (activeType && PROPERTY_TYPE_LABELS[activeType]) {
    filtered = projectsByType[activeType] ?? [];
  }

  const filterByLabel = locale === "ar" ? "تصفية حسب" : "FILTER BY";
  const allLabel = locale === "ar" ? "الكل" : "All";

  return (
    <main dir={locale === "ar" ? "rtl" : "ltr"} className="bg-ora-white">
      {/* Filter Section */}
      <section className="mx-auto max-w-7xl px-6 pt-24 md:px-10 lg:px-16">
        <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-ora-muted">
          {filterByLabel}
        </span>
        <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <Link
            href={buildHref(null)}
            className={`font-serif text-3xl transition-colors md:text-4xl ${
              !activeType
                ? "text-ora-teal"
                : "text-ora-charcoal/40 hover:text-ora-charcoal"
            }`}
          >
            {allLabel}
            <sup className="ms-0.5 text-sm font-sans font-normal">
              {projects.length}
            </sup>
          </Link>
          {availableTypes.map((type) => {
            const label = PROPERTY_TYPE_LABELS[type]?.[locale] ?? type;
            const count = projectsByType[type]?.length ?? 0;
            const isActive = activeType === type;
            return (
              <Link
                key={type}
                href={buildHref(type)}
                className={`font-serif text-3xl transition-colors md:text-4xl ${
                  isActive
                    ? "text-ora-teal"
                    : "text-ora-charcoal/40 hover:text-ora-charcoal"
                }`}
              >
                {label}
                <sup className="ms-0.5 text-sm font-sans font-normal">
                  {count}
                </sup>
              </Link>
            );
          })}
        </div>
        <hr className="mt-6 border-ora-sand" />
      </section>

      {/* Project Grid */}
      <section className="mx-auto max-w-7xl px-6 py-12 md:px-10 lg:px-16">
        {filtered.length === 0 ? (
          <p className="text-sm text-ora-charcoal-light">
            {locale === "ar"
              ? "لا توجد مشاريع منشورة بعد."
              : "No projects published yet."}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((p) => {
              const hero = p.heroImageId ? media[p.heroImageId] : null;
              const name =
                locale === "ar" ? p.nameAr?.trim() || p.nameEn : p.nameEn;
              const desc =
                locale === "ar"
                  ? p.shortDescriptionAr?.trim() || p.shortDescriptionEn
                  : p.shortDescriptionEn;
              return (
                <Link
                  key={p.id}
                  href={`${basePath}/${p.slug}`}
                  className="group block"
                >
                  {/* Hero Image */}
                  <div className="relative aspect-4/3 overflow-hidden bg-ora-sand/30">
                    {hero && (
                      <img
                        src={hero.url}
                        alt={hero.alt || name}
                        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    )}
                  </div>
                  {/* Card Info */}
                  <div className="mt-4 flex items-center justify-between">
                    <h2 className="text-base font-medium text-ora-charcoal">
                      {name}
                    </h2>
                    <span className="flex h-8 shrink-0 items-center justify-center rounded-full border border-ora-charcoal/30 px-4 text-ora-charcoal transition-colors group-hover:border-ora-charcoal group-hover:bg-ora-charcoal group-hover:text-ora-white">
                      <svg
                        width="18"
                        height="12"
                        viewBox="0 0 18 12"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M1 6h16M12 1l5 5-5 5"
                          stroke="currentColor"
                          strokeWidth="1.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  </div>
                  {desc && (
                    <p className="mt-1 line-clamp-2 text-sm text-ora-charcoal-light">
                      {desc}
                    </p>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
