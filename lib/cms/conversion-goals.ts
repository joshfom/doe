import { db } from "./db";
import { conversionGoals } from "./schema";
import { eq } from "drizzle-orm";

export const DEFAULT_CONVERSION_EVENTS = [
  "lead_qualified",
  "reservation_completed",
  "form_submitted",
];

export async function getActiveConversionGoals() {
  try {
    const goals = await db
      .select()
      .from(conversionGoals)
      .where(eq(conversionGoals.isActive, true));
    return goals;
  } catch {
    return [];
  }
}

export function getConversionEventNames(
  goals: (typeof conversionGoals.$inferSelect)[]
): string[] {
  if (goals.length === 0) return DEFAULT_CONVERSION_EVENTS;
  return goals.map((g) => g.eventName);
}
