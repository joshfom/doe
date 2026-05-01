import type {
  ProjectFloorplan,
  ProjectAmenity,
  ProjectLocationHighlight,
  ProjectPaymentPlan,
  ProjectStatus,
} from "@/lib/cms/types";

export type Locale = "en" | "ar";

export interface ProjectMedia {
  url: string;
  alt: string;
}

export interface ProjectLandingData {
  project: {
    id: string;
    communityId: string;
    slug: string;
    nameEn: string;
    nameAr?: string | null;
    shortDescriptionEn?: string | null;
    shortDescriptionAr?: string | null;
    longDescriptionEn?: string | null;
    longDescriptionAr?: string | null;
    status: ProjectStatus;
    heroImageId?: string | null;
    logoImageId?: string | null;
    brochurePdfId?: string | null;
    brochureGallery?: string[] | null;
    floorplans?: ProjectFloorplan[] | null;
    amenities?: ProjectAmenity[] | null;
    locationLat?: number | null;
    locationLng?: number | null;
    locationHighlights?: ProjectLocationHighlight[] | null;
    paymentPlans?: ProjectPaymentPlan[] | null;
    expectedHandoverDate?: string | null;
    totalUnits?: number | null;
    availableUnits?: number | null;
    developer?: string | null;
    contractor?: string | null;
    architect?: string | null;
  };
  community: {
    id: string;
    slug: string;
    nameEn: string;
    nameAr?: string | null;
  } | null;
  media: Record<string, ProjectMedia>;
}

export function pickMedia(
  data: ProjectLandingData,
  id: string | null | undefined
): ProjectMedia | null {
  if (!id) return null;
  return data.media[id] ?? null;
}
