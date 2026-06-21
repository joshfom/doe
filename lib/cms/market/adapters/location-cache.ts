/**
 * DB-backed {@link LocationResolutionCache} (S7 increment, Design §3; Req 14.3).
 *
 * Persists the mapping of an own area/community name → an external provider's
 * `location_id` in the `location_resolutions` table (migration 0039), so the
 * provider's free-tier Location AutoComplete endpoint is hit at most once per
 * distinct normalized area name across worker ticks AND across worker restarts
 * (the in-memory fallback in `property-finder.ts` only survives a single
 * process). Keyed uniquely on `(source, area_name_normalized)`; `put` upserts so
 * a re-resolve is a field-identical no-op except for the refreshed `as_of`.
 *
 * Container/worker tier only — it touches the database directly and is
 * constructed by the market-sync worker's {@link resolveMarketAdapter} seam. It
 * imports ONLY the Drizzle schema + query builder, never any Next.js route/page
 * code or the Mastra agent runtime, so it stays out of the serverless bundle.
 */

import { and, eq } from "drizzle-orm";

import type { Database } from "../../db";
import { locationResolutions } from "../../schema";
import type { LocationResolutionCache } from "./property-finder";

export class DbLocationResolutionCache implements LocationResolutionCache {
  constructor(private readonly database: Database) {}

  async get(
    source: string,
    areaNameNormalized: string
  ): Promise<string | null> {
    const rows = await this.database
      .select({ locationId: locationResolutions.locationId })
      .from(locationResolutions)
      .where(
        and(
          eq(locationResolutions.source, source),
          eq(locationResolutions.areaNameNormalized, areaNameNormalized)
        )
      )
      .limit(1);
    return rows[0]?.locationId ?? null;
  }

  async put(
    source: string,
    areaNameNormalized: string,
    locationId: string,
    displayName: string | null,
    asOf: Date
  ): Promise<void> {
    await this.database
      .insert(locationResolutions)
      .values({
        source,
        areaNameNormalized,
        locationId,
        displayName,
        asOf,
      })
      .onConflictDoUpdate({
        target: [
          locationResolutions.source,
          locationResolutions.areaNameNormalized,
        ],
        set: { locationId, displayName, asOf, updatedAt: new Date() },
      });
  }
}
