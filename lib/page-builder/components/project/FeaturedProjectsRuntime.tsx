"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { apiFetch } from "@/lib/cms/hooks/api";
import type { ProjectMedia } from "./types";
import type { PublicProjectListItem } from "./ProjectIndex";

const STATUS_LABELS_EN: Record<string, string> = {
  planning: "Planning",
  pre_launch: "Pre-Launch",
  selling: "Selling Now",
  under_construction: "Under Construction",
  handover: "Handover",
  completed: "Completed",
};

interface PublicListResponse {
  projects: PublicProjectListItem[];
  media: Record<string, ProjectMedia>;
}

export interface FeaturedProjectsRuntimeProps {
  projectIds?: string[];
  limit?: number;
  columns?: number;
  heading?: string;
  subheading?: string;
  ctaLabel?: string;
  prefix?: string;
}

export function FeaturedProjectsRuntime({
  projectIds = [],
  limit = 3,
  columns = 3,
  heading = "Featured Projects",
  subheading = "",
  ctaLabel = "Explore",
  prefix = "projects",
}: FeaturedProjectsRuntimeProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["public-projects-list"],
    queryFn: () =>
      apiFetch<{ data: PublicListResponse }>("/api/projects/public").then(
        (r) => r.data
      ),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <section className="bg-ora-cream py-16">
        <div className="mx-auto max-w-6xl px-6 md:px-10">
          <div className="h-8 w-48 animate-pulse bg-ora-sand/60" />
        </div>
      </section>
    );
  }

  const all = data?.projects ?? [];
  const media = data?.media ?? {};
  const ids = projectIds.filter((id) => id);
  const selected =
    ids.length > 0
      ? (ids
          .map((id) => all.find((p) => p.id === id))
          .filter((p): p is PublicProjectListItem => !!p)
          .slice(0, limit))
      : all.slice(0, limit);

  if (selected.length === 0) return null;

  const colsClass =
    columns === 1
      ? "grid-cols-1"
      : columns === 2
        ? "grid-cols-1 md:grid-cols-2"
        : columns === 4
          ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
          : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";

  return (
    <section className="bg-ora-cream py-16">
      <div className="mx-auto max-w-6xl px-6 md:px-10">
        <div className="mb-8">
          <h2 className="font-serif text-3xl text-ora-charcoal md:text-4xl">
            {heading}
          </h2>
          {subheading && (
            <p className="mt-2 text-base text-ora-charcoal-light">
              {subheading}
            </p>
          )}
        </div>
        <div className={`grid gap-6 ${colsClass}`}>
          {selected.map((p) => {
            const hero = p.heroImageId ? media[p.heroImageId] : null;
            const status = STATUS_LABELS_EN[p.status];
            return (
              <Link
                key={p.id}
                href={`/${prefix}/${p.slug}`}
                className="group block bg-ora-white border border-ora-sand/60 transition-shadow hover:shadow-ora-md"
              >
                <div className="relative aspect-4/3 bg-ora-sand/40">
                  {hero && (
                    <img
                      src={hero.url}
                      alt={hero.alt || p.nameEn}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  )}
                  {status && (
                    <span className="absolute left-3 top-3 bg-ora-charcoal/90 px-3 py-1 text-[10px] uppercase tracking-wider text-ora-white">
                      {status}
                    </span>
                  )}
                </div>
                <div className="p-5">
                  <h3 className="text-lg font-medium text-ora-charcoal group-hover:text-ora-gold">
                    {p.nameEn}
                  </h3>
                  {p.shortDescriptionEn && (
                    <p className="mt-2 line-clamp-2 text-sm text-ora-charcoal-light">
                      {p.shortDescriptionEn}
                    </p>
                  )}
                  <span className="mt-4 inline-block text-[11px] uppercase tracking-[0.18em] text-ora-gold group-hover:text-ora-charcoal">
                    {ctaLabel} →
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
