import { z } from "zod";
import { slugSchema, seoMetaSchema } from "../communities/validation";

const floorplanSchema = z.object({
  unitType: z.string().trim().min(1),
  nameEn: z.string().trim().optional(),
  nameAr: z.string().trim().optional(),
  areaSqm: z.number().positive().optional(),
  bedrooms: z.number().int().min(0).optional(),
  bathrooms: z.number().int().min(0).optional(),
  imageId: z.string().uuid().optional(),
  pdfId: z.string().uuid().optional(),
});

const amenitySchema = z.object({
  icon: z.string().trim().optional(),
  nameEn: z.string().trim().min(1),
  nameAr: z.string().trim().optional(),
  descriptionEn: z.string().trim().optional(),
  descriptionAr: z.string().trim().optional(),
  imageId: z.string().uuid().optional(),
});

const locationHighlightSchema = z.object({
  titleEn: z.string().trim().min(1),
  titleAr: z.string().trim().optional(),
  distanceKm: z.number().positive().optional(),
});

const paymentMilestoneSchema = z.object({
  pct: z.number().min(0).max(100),
  labelEn: z.string().trim().min(1),
  labelAr: z.string().trim().optional(),
});

const paymentPlanSchema = z.object({
  nameEn: z.string().trim().min(1),
  nameAr: z.string().trim().optional(),
  downPaymentPct: z.number().min(0).max(100).optional(),
  milestones: z.array(paymentMilestoneSchema).default([]),
});

export const projectStatusEnum = z.enum([
  "planning",
  "pre_launch",
  "selling",
  "under_construction",
  "handover",
  "completed",
  "archived",
]);

export const createProjectSchema = z.object({
  communityId: z.string().uuid("Invalid community id"),
  slug: slugSchema,
  nameEn: z.string().trim().min(1, "English name is required").max(200),
  nameAr: z.string().trim().max(200).optional(),
  shortDescriptionEn: z.string().trim().max(500).optional(),
  shortDescriptionAr: z.string().trim().max(500).optional(),
  longDescriptionEn: z.string().trim().optional(),
  longDescriptionAr: z.string().trim().optional(),
  status: projectStatusEnum.optional(),
  heroImageId: z.string().uuid().optional().nullable(),
  logoImageId: z.string().uuid().optional().nullable(),
  brochurePdfId: z.string().uuid().optional().nullable(),
  brochureGallery: z.array(z.string().uuid()).optional(),
  floorplans: z.array(floorplanSchema).optional(),
  amenities: z.array(amenitySchema).optional(),
  locationLat: z.number().min(-90).max(90).optional(),
  locationLng: z.number().min(-180).max(180).optional(),
  locationHighlights: z.array(locationHighlightSchema).optional(),
  paymentPlans: z.array(paymentPlanSchema).optional(),
  expectedHandoverDate: z.string().optional(), // ISO date YYYY-MM-DD
  totalUnits: z.number().int().min(0).optional(),
  availableUnits: z.number().int().min(0).optional(),
  developer: z.string().trim().max(200).optional(),
  contractor: z.string().trim().max(200).optional(),
  architect: z.string().trim().max(200).optional(),
  seoMeta: seoMetaSchema,
});

export const updateProjectSchema = createProjectSchema.partial().extend({
  // communityId cannot be changed via update — projects are tied to a community
  communityId: z.never().optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
