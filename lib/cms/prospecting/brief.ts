/**
 * Prospecting Workspace (S7) — Prospecting_Brief schema (Design §Components #1;
 * Requirements 10.1, 10.3).
 *
 * The Prospecting_Brief is the user's "what I want to sell" input and the
 * starting point of the property-led hero flow: an own `project` or `ai_unit`
 * (FK to the own catalog) and/or a free-form spec (area, price band, unit type,
 * bedrooms, features). The Prospecting_Agent retrieves Market_Comparables for
 * this brief before searching for people.
 */

import { z } from "zod";

// ── Schema ───────────────────────────────────────────────────────────────────

/** The free-form portion of a Prospecting_Brief (area, band, unit shape). */
export const briefSpecSchema = z.object({
  area: z.string().max(120).optional(), // e.g. "Palm Jumeirah"
  segment: z.enum(["ultra_luxury", "luxury", "premium", "mid"]).optional(),
  unitType: z
    .enum(["apartment", "villa", "townhouse", "penthouse", "office"])
    .optional(),
  bedrooms: z.number().int().min(0).max(20).optional(),
  priceMinAed: z.number().nonnegative().optional(),
  priceMaxAed: z.number().nonnegative().optional(),
  features: z.array(z.string().max(60)).max(20).default([]),
});
export type BriefSpec = z.infer<typeof briefSpecSchema>;

/** A full Prospecting_Brief: an own project/unit reference and/or a spec. */
export const prospectingBriefSchema = z.object({
  projectId: z.string().uuid().optional(), // own project (FK projects)
  aiUnitId: z.string().uuid().optional(), // own unit (FK ai_units)
  spec: briefSpecSchema,
});
export type ProspectingBrief = z.infer<typeof prospectingBriefSchema>;
