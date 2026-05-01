"use client";

import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { apiFetch } from "@/lib/cms/hooks/api";

interface PublicCommunity {
  id: string;
  slug: string;
  nameEn: string;
  descriptionEn?: string | null;
  city?: string | null;
  region?: string | null;
  heroImageId?: string | null;
}

interface ListResponse {
  communities: PublicCommunity[];
  media: Record<string, { url: string; alt: string }>;
  projectCounts: Record<string, number>;
}

const COL_CLASSES: Record<number, string> = {
  1: "grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-2 lg:grid-cols-3",
  4: "md:grid-cols-2 lg:grid-cols-4",
};

export function FeaturedCommunitiesRuntime({
  heading,
  subheading,
  ctaLabel,
  prefix,
  columns,
  limit,
  communityIds,
}: {
  heading: string;
  subheading?: string;
  ctaLabel: string;
  prefix: string;
  columns: number;
  limit: number;
  communityIds: string[];
}) {
  const query = useQuery({
    queryKey: ["public-communities-list"],
    queryFn: () =>
      apiFetch<{ data: ListResponse }>("/api/communities/public").then(
        (r) => r.data
      ),
    staleTime: 60_000,
  });

  if (query.isLoading) {
    return <div className="min-h-32 animate-pulse bg-ora-charcoal/5" aria-hidden />;
  }

  const all = query.data?.communities ?? [];
  const media = query.data?.media ?? {};
  const counts = query.data?.projectCounts ?? {};

  const list = communityIds.length
    ? communityIds
        .map((id) => all.find((c) => c.id === id))
        .filter((c): c is PublicCommunity => !!c)
    : all;
  const sliced = list.slice(0, Math.max(1, limit));

  if (sliced.length === 0) {
    return (
      <div className="border border-dashed border-ora-muted/40 p-8 text-center text-sm text-ora-muted">
        No communities to display.
      </div>
    );
  }

  const colsClass = COL_CLASSES[columns] ?? COL_CLASSES[3];

  return (
    <section className="bg-ora-bone py-16">
      <div className="mx-auto max-w-6xl px-6 md:px-10">
        <h2 className="font-serif text-3xl text-ora-charcoal md:text-4xl">
          {heading}
        </h2>
        {subheading && (
          <p className="mt-2 max-w-2xl text-ora-charcoal-light">{subheading}</p>
        )}
        <div className={`mt-10 grid gap-6 ${colsClass}`}>
          {sliced.map((c) => {
            const hero = c.heroImageId ? media[c.heroImageId] ?? null : null;
            const location = [c.city, c.region].filter(Boolean).join(", ");
            const count = counts[c.id] ?? 0;
            return (
              <a
                key={c.id}
                href={`/${prefix}/${c.slug}`}
                className="group block bg-ora-white transition-shadow hover:shadow-lg"
              >
                <div className="relative aspect-4/3 overflow-hidden bg-ora-charcoal/5">
                  {hero && (
                    <img
                      src={hero.url}
                      alt={hero.alt || c.nameEn}
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  )}
                </div>
                <div className="p-5">
                  <h3 className="font-serif text-xl text-ora-charcoal">
                    {c.nameEn}
                  </h3>
                  {location && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-ora-muted">
                      <MapPin className="h-3 w-3 stroke-1" />
                      {location}
                    </p>
                  )}
                  {c.descriptionEn && (
                    <p className="mt-3 line-clamp-2 text-sm text-ora-charcoal-light">
                      {c.descriptionEn}
                    </p>
                  )}
                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wider text-ora-gold">
                      {count} {count === 1 ? "project" : "projects"}
                    </span>
                    <span className="text-xs uppercase tracking-wider text-ora-charcoal group-hover:text-ora-gold">
                      {ctaLabel} →
                    </span>
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      </div>
    </section>
  );
}
