import { db } from "@/lib/cms/db";
import { utmLinks } from "@/lib/cms/schema";
import { sql, and, eq } from "drizzle-orm";

export interface AutoRegisterParams {
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmTerm?: string | null;
  utmContent?: string | null;
  landingPath: string;
}

/**
 * Truncates a string to a maximum length.
 */
function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

/**
 * Normalizes optional UTM fields: treats null/undefined as empty string.
 */
function normalizeOptional(value: string | null | undefined): string {
  return value?.trim() || "";
}

/**
 * Builds the destination URL from the landing path by stripping query string.
 */
function buildDestinationUrl(landingPath: string): string {
  const questionIndex = landingPath.indexOf("?");
  return questionIndex === -1 ? landingPath : landingPath.slice(0, questionIndex);
}

/**
 * Builds the tagged URL with UTM parameters appended.
 */
function buildTaggedUrl(
  destinationUrl: string,
  source: string,
  medium: string,
  campaign: string,
  term: string,
  content: string
): string {
  const params = new URLSearchParams();
  params.set("utm_source", source);
  params.set("utm_medium", medium);
  params.set("utm_campaign", campaign);
  if (term) params.set("utm_term", term);
  if (content) params.set("utm_content", content);
  return `${destinationUrl}?${params.toString()}`;
}

/**
 * Attempts to auto-register a UTM link if the combination doesn't exist.
 * Uses INSERT ... ON CONFLICT DO NOTHING + SELECT to handle races.
 * Truncates values to 500 chars max.
 * Skips if source/medium/campaign are empty.
 * Returns the UTM link ID (existing or new) or null if skipped.
 */
export async function autoRegisterUtmLink(
  params: AutoRegisterParams
): Promise<string | null> {
  const MAX_LENGTH = 500;

  // Validate required fields are non-empty after trimming
  const source = params.utmSource.trim();
  const medium = params.utmMedium.trim();
  const campaign = params.utmCampaign.trim();

  if (!source || !medium || !campaign) {
    return null;
  }

  // Truncate all fields to 500 characters
  const truncatedSource = truncate(source, MAX_LENGTH);
  const truncatedMedium = truncate(medium, MAX_LENGTH);
  const truncatedCampaign = truncate(campaign, MAX_LENGTH);
  const truncatedTerm = truncate(normalizeOptional(params.utmTerm), MAX_LENGTH);
  const truncatedContent = truncate(normalizeOptional(params.utmContent), MAX_LENGTH);

  // Build URLs
  const destinationUrl = buildDestinationUrl(params.landingPath);
  const taggedUrl = buildTaggedUrl(
    destinationUrl,
    truncatedSource,
    truncatedMedium,
    truncatedCampaign,
    truncatedTerm,
    truncatedContent
  );

  // Attempt INSERT ... ON CONFLICT DO NOTHING
  const insertResult = await db
    .insert(utmLinks)
    .values({
      utmSource: truncatedSource,
      utmMedium: truncatedMedium,
      utmCampaign: truncatedCampaign,
      utmTerm: truncatedTerm || null,
      utmContent: truncatedContent || null,
      destinationUrl,
      taggedUrl,
      autoRegistered: true,
      totalHits: 1,
      createdBy: null,
    })
    .onConflictDoNothing()
    .returning({ id: utmLinks.id });

  // If insert succeeded, return the new ID (hit already counted as 1)
  if (insertResult.length > 0) {
    return insertResult[0].id;
  }

  // On conflict (0 rows returned), SELECT existing record by normalized keys
  const existing = await db
    .select({ id: utmLinks.id })
    .from(utmLinks)
    .where(
      and(
        sql`LOWER(${utmLinks.utmSource}) = LOWER(${truncatedSource})`,
        sql`LOWER(${utmLinks.utmMedium}) = LOWER(${truncatedMedium})`,
        sql`LOWER(${utmLinks.utmCampaign}) = LOWER(${truncatedCampaign})`,
        sql`COALESCE(LOWER(${utmLinks.utmTerm}), '') = LOWER(${truncatedTerm || ""})`,
        sql`COALESCE(LOWER(${utmLinks.utmContent}), '') = LOWER(${truncatedContent || ""})`
      )
    )
    .limit(1);

  if (existing.length > 0) {
    // Increment hit counter for existing link
    await db
      .update(utmLinks)
      .set({ totalHits: sql`${utmLinks.totalHits} + 1` })
      .where(eq(utmLinks.id, existing[0].id));

    return existing[0].id;
  }

  // Should not reach here under normal circumstances
  return null;
}
