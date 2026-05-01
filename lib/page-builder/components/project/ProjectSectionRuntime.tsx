"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/cms/hooks/api";
import {
  ProjectHero,
  ProjectOverview,
  BrochureGallery,
  FloorplanGrid,
  AmenitiesGrid,
  LocationHighlights,
  PaymentPlanTable,
} from "./ProjectLanding";
import type { ProjectLandingData, Locale } from "./types";

export type ProjectSectionKind =
  | "hero"
  | "overview"
  | "gallery"
  | "floorplans"
  | "amenities"
  | "location"
  | "payment";

interface PublicProjectResponse {
  data: ProjectLandingData;
}

export function ProjectSectionRuntime({
  projectSlug,
  section,
  locale,
}: {
  projectSlug: string;
  section: ProjectSectionKind;
  locale: Locale;
}) {
  const query = useQuery({
    queryKey: ["public-project", projectSlug],
    queryFn: () =>
      apiFetch<PublicProjectResponse>(
        `/api/projects/public/${encodeURIComponent(projectSlug)}`
      ).then((r) => r.data),
    enabled: !!projectSlug,
    staleTime: 60_000,
  });

  if (!projectSlug) {
    return (
      <div className="border border-dashed border-ora-muted/40 p-8 text-center text-sm text-ora-muted">
        Pick a project slug to embed this section.
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="min-h-32 animate-pulse bg-ora-charcoal/5" aria-hidden />
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="border border-dashed border-ora-error/40 p-8 text-center text-sm text-ora-error">
        Project &ldquo;{projectSlug}&rdquo; not found.
      </div>
    );
  }

  const data = query.data;

  switch (section) {
    case "hero":
      return <ProjectHero data={data} locale={locale} />;
    case "overview":
      return <ProjectOverview data={data} locale={locale} />;
    case "gallery":
      return <BrochureGallery data={data} locale={locale} />;
    case "floorplans":
      return <FloorplanGrid data={data} locale={locale} />;
    case "amenities":
      return <AmenitiesGrid data={data} locale={locale} />;
    case "location":
      return <LocationHighlights data={data} locale={locale} />;
    case "payment":
      return <PaymentPlanTable data={data} locale={locale} />;
    default:
      return null;
  }
}
