import { z } from "zod";
import type { ValidationResult } from "./types";

export const componentInstanceSchema = z.object({
  type: z.string().min(1),
  props: z
    .object({
      id: z.string().min(1),
    })
    .passthrough(),
});

export const pageDataSchema = z.object({
  root: z.object({
    props: z.record(z.string(), z.unknown()).default({}),
  }),
  content: z.array(componentInstanceSchema),
  zones: z.record(z.string(), z.array(componentInstanceSchema)).optional(),
});

/**
 * Validates unknown data against the PageData schema.
 * Returns a ValidationResult with success/failure and error details.
 */
export function validatePageData(data: unknown): ValidationResult {
  const result = pageDataSchema.safeParse(data);

  if (!result.success) {
    const errors = result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));

    return { success: false, errors };
  }

  const sectionErrors: Array<{ path: string; message: string }> = [];
  const zones = result.data.zones ?? {};

  for (const [zoneKey, items] of Object.entries(zones)) {
    items.forEach((item, index) => {
      if (item.type !== "Section") return;
      sectionErrors.push({
        path: `zones.${zoneKey}.${index}.type`,
        message: "Section components must be placed at root content and cannot be nested in zones.",
      });
    });
  }

  if (sectionErrors.length > 0) {
    return { success: false, errors: sectionErrors };
  }

  return { success: true };
}
