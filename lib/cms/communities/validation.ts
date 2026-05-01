import { z } from "zod";

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const slugSchema = z
  .string()
  .trim()
  .min(1, "Slug is required")
  .max(120)
  .regex(
    slugRegex,
    "Slug must be lowercase letters, numbers, and hyphens (no leading/trailing hyphen)"
  );

export const seoMetaSchema = z
  .object({
    title: z.string().optional(),
    description: z.string().optional(),
    ogImage: z.string().optional(),
  })
  .partial()
  .optional();

export const createCommunitySchema = z.object({
  slug: slugSchema,
  nameEn: z.string().trim().min(1, "English name is required").max(200),
  nameAr: z.string().trim().max(200).optional(),
  descriptionEn: z.string().trim().optional(),
  descriptionAr: z.string().trim().optional(),
  city: z.string().trim().max(100).optional(),
  region: z.string().trim().max(100).optional(),
  country: z.string().trim().length(2).optional(),
  locationLat: z.number().min(-90).max(90).optional(),
  locationLng: z.number().min(-180).max(180).optional(),
  heroImageId: z.string().uuid().optional().nullable(),
  logoImageId: z.string().uuid().optional().nullable(),
  status: z.enum(["active", "inactive", "archived"]).optional(),
  seoMeta: seoMetaSchema,
});

export const updateCommunitySchema = createCommunitySchema.partial();

export type CreateCommunityInput = z.infer<typeof createCommunitySchema>;
export type UpdateCommunityInput = z.infer<typeof updateCommunitySchema>;
