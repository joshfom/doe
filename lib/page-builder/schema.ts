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

  if (result.success) {
    return { success: true };
  }

  const errors = result.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));

  return { success: false, errors };
}
