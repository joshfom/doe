import { Elysia } from "elysia";
import { ilike, eq, or, and } from "drizzle-orm";
import { authGuard } from "../auth";
import { utmLinks } from "../../schema";
import { db } from "../../db";
import {
  getActiveConversionGoals,
  getConversionEventNames,
} from "../../conversion-goals";

// ── Types ────────────────────────────────────────────────────────────────────

interface PostHogQueryResult {
  results?: unknown[][];
  columns?: string[];
}

interface UtmAnalyticsRow {
  id: string;
  taggedUrl: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmTerm: string | null;
  utmContent: string | null;
  project: string | null;
  autoRegistered: boolean;
  createdAt: string;
  totalHits: number;
  uniqueVisitors: number;
  bounceRate: number;
  conversions: number;
}

interface UtmAnalyticsResponse {
  data: UtmAnalyticsRow[];
  total: number;
  page: number;
  pageSize: number;
  sources: string[];
  projects: string[];
  stale?: boolean;
}

interface UtmDetailResponse {
  link: UtmAnalyticsRow;
  avgSessionDuration: number; // seconds
  conversionRate: number; // 0-100
  dailyHits: Array<{ date: string; hits: number }>;
  topLandingPages: Array<{ path: string; hits: number }>;
}

interface CacheEntry {
  data: UtmAnalyticsResponse;
  timestamp: number;
}

// ── Cache ────────────────────────────────────────────────────────────────────

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 300_000; // 5 minutes

function getCacheKey(
  days: number,
  search: string,
  source: string,
  project: string,
  page: number,
  sort: string,
  order: string
): string {
  const filtersHash = `${search}|${source}|${project}|${page}|${sort}|${order}`;
  return `${days}:${filtersHash}`;
}

function getCachedResponse(key: string): CacheEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry;
}

function setCacheEntry(key: string, data: UtmAnalyticsResponse): void {
  cache.set(key, { data, timestamp: Date.now() });
}

/**
 * Get a stale cache entry (ignoring TTL) for fallback on PostHog failure.
 */
function getStaleCacheEntry(key: string): CacheEntry | null {
  return cache.get(key) || null;
}

// ── Route ────────────────────────────────────────────────────────────────────

export const utmAnalyticsRoutes = new Elysia({
  name: "utm-analytics",
})
  .use(authGuard)

  // GET /utm-analytics?days=7|30|90&search=&source=&project=&page=1&sort=hits&order=desc
  .get("/utm-analytics", async ({ query, userId, set }) => {
    // Permission check: analytics:read or admin
    const hasAccess = await checkAnalyticsAccess(userId);
    if (!hasAccess) {
      set.status = 403;
      return { error: "Forbidden: analytics:read permission required" };
    }

    // Parse query params
    const days = query?.days === "7" ? 7 : query?.days === "90" ? 90 : 30;
    const search = (query?.search || "").trim();
    const source = (query?.source || "").trim();
    const project = (query?.project || "").trim();
    const page = Math.max(1, parseInt(query?.page || "1", 10) || 1);
    const sort = query?.sort || "hits";
    const order = query?.order === "asc" ? "asc" : "desc";
    const pageSize = 1000;

    // Check cache
    const cacheKey = getCacheKey(days, search, source, project, page, sort, order);
    const cached = getCachedResponse(cacheKey);
    if (cached) {
      return cached.data;
    }

    try {
      // 1. Query utm_links from DB with filters
      const dbLinks = await queryUtmLinks(search, source, project);

      // 2. Query PostHog for metrics
      const [hitsData, bounceData, conversionsData] = await Promise.all([
        fetchHitsAndVisitors(days),
        fetchBounceRates(days),
        fetchConversions(days),
      ]);

      // 3. Join DB records with PostHog metrics
      const rows = joinMetrics(dbLinks, hitsData, bounceData, conversionsData);

      // 4. Sort
      const sorted = sortRows(rows, sort, order);

      // 5. Get distinct sources and projects from full dataset
      const sources = Array.from(new Set(dbLinks.map((l) => l.utmSource).filter(Boolean))).sort();
      const projects = Array.from(
        new Set(dbLinks.map((l) => l.project).filter((p): p is string => !!p))
      ).sort();

      // 6. Paginate
      const total = sorted.length;
      const start = (page - 1) * pageSize;
      const paginated = sorted.slice(start, start + pageSize);

      const response: UtmAnalyticsResponse = {
        data: paginated,
        total,
        page,
        pageSize,
        sources,
        projects,
      };

      // Cache the response
      setCacheEntry(cacheKey, response);

      return response;
    } catch (err) {
      console.error("[utm-analytics] Error fetching metrics:", err);

      // On PostHog failure, try returning stale cache
      const stale = getStaleCacheEntry(cacheKey);
      if (stale) {
        return { ...stale.data, stale: true };
      }

      // No cache available — return 503
      set.status = 503;
      return { error: "Analytics service temporarily unavailable" };
    }
  })

  // GET /utm-analytics/:id/detail?days=7|30|90
  .get("/utm-analytics/:id/detail", async ({ params, query, userId, set }) => {
    // Permission check
    const hasAccess = await checkAnalyticsAccess(userId);
    if (!hasAccess) {
      set.status = 403;
      return { error: "Forbidden: analytics:read permission required" };
    }

    const { id } = params;
    const days = query?.days === "7" ? 7 : query?.days === "90" ? 90 : 30;

    // Fetch UTM link record from DB
    const [linkRecord] = await db
      .select()
      .from(utmLinks)
      .where(eq(utmLinks.id, id))
      .limit(1);

    if (!linkRecord) {
      set.status = 404;
      return { error: "UTM link not found" };
    }

    const source = linkRecord.utmSource;
    const medium = linkRecord.utmMedium;
    const campaign = linkRecord.utmCampaign;

    try {
      // Query PostHog for all detail metrics in parallel
      const [dailyHitsResult, topPagesResult, avgDurationResult, hitsData, conversionsData] =
        await Promise.all([
          fetchDailyHits(days, source, medium, campaign),
          fetchTopLandingPages(days, source, medium, campaign),
          fetchAvgSessionDuration(days, source, medium, campaign),
          fetchHitsAndVisitors(days),
          fetchConversions(days),
        ]);

      // Build the link row with metrics
      const comboKey = makeComboKey(source, medium, campaign);
      const metrics = hitsData.get(comboKey) || { hits: 0, uniqueVisitors: 0 };
      const conversions = conversionsData.get(comboKey) || 0;

      // Compute conversion rate: conversions / unique_visitors * 100
      const conversionRate =
        metrics.uniqueVisitors > 0
          ? Math.round((conversions / metrics.uniqueVisitors) * 100 * 100) / 100
          : 0;

      const link: UtmAnalyticsRow = {
        id: linkRecord.id,
        taggedUrl: linkRecord.taggedUrl,
        utmSource: linkRecord.utmSource,
        utmMedium: linkRecord.utmMedium,
        utmCampaign: linkRecord.utmCampaign,
        utmTerm: linkRecord.utmTerm || null,
        utmContent: linkRecord.utmContent || null,
        project: linkRecord.project || null,
        autoRegistered: linkRecord.autoRegistered,
        createdAt: linkRecord.createdAt.toISOString(),
        totalHits: metrics.hits,
        uniqueVisitors: metrics.uniqueVisitors,
        bounceRate: 0,
        conversions,
      };

      const response: UtmDetailResponse = {
        link,
        avgSessionDuration: avgDurationResult,
        conversionRate,
        dailyHits: dailyHitsResult,
        topLandingPages: topPagesResult,
      };

      return response;
    } catch (err) {
      console.error("[utm-analytics] Detail endpoint PostHog error:", err);
      set.status = 502;
      return { error: "Performance data could not be retrieved", retryable: true };
    }
  });

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Check if the user has analytics:read permission or admin access.
 */
async function checkAnalyticsAccess(userId: string): Promise<boolean> {
  const { loadUserRoles, resolvePermissions } = await import("../../rbac/engine");
  try {
    const userRolesList = await loadUserRoles(db, userId);
    const roleNames = userRolesList.map((r) => r.name);
    const perms = await resolvePermissions(db, userRolesList);
    return (
      roleNames.includes("super_admin") ||
      perms.includes("*:*") ||
      perms.includes("analytics:read") ||
      perms.includes("analytics:*")
    );
  } catch {
    return false;
  }
}

/**
 * Query utm_links from DB with optional filters.
 */
async function queryUtmLinks(
  search: string,
  source: string,
  project: string
) {
  const conditions: ReturnType<typeof eq>[] = [];

  // Source dropdown filter
  if (source) {
    conditions.push(eq(utmLinks.utmSource, source));
  }

  // Project dropdown filter
  if (project) {
    conditions.push(eq(utmLinks.project, project));
  }

  // Text search (ILIKE on source/medium/campaign/term/content)
  if (search && search.length >= 2) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(utmLinks.utmSource, pattern),
        ilike(utmLinks.utmMedium, pattern),
        ilike(utmLinks.utmCampaign, pattern),
        ilike(utmLinks.utmTerm, pattern),
        ilike(utmLinks.utmContent, pattern)
      )!
    );
  }

  const query = db.select().from(utmLinks);

  if (conditions.length > 0) {
    return query.where(and(...conditions));
  }

  return query;
}

/**
 * Fetch hits + unique visitors per UTM combo from PostHog.
 * Uses $current_url parsing to extract UTM params since PostHog may
 * store them as person properties rather than event properties.
 */
async function fetchHitsAndVisitors(
  days: number
): Promise<Map<string, { hits: number; uniqueVisitors: number }>> {
  const hogql = `
    SELECT
      coalesce(properties.$utm_source, extractURLParameter(properties.$current_url, 'utm_source')) AS source,
      coalesce(properties.$utm_medium, extractURLParameter(properties.$current_url, 'utm_medium')) AS medium,
      coalesce(properties.$utm_campaign, extractURLParameter(properties.$current_url, 'utm_campaign')) AS campaign,
      count() AS hits,
      count(DISTINCT person_id) AS unique_visitors
    FROM events
    WHERE event = '$pageview'
      AND timestamp >= now() - interval ${days} day
      AND (
        properties.$utm_source IS NOT NULL
        OR extractURLParameter(properties.$current_url, 'utm_source') != ''
      )
    GROUP BY source, medium, campaign
    HAVING source != ''
  `;

  const result = await queryPostHog(hogql);
  const map = new Map<string, { hits: number; uniqueVisitors: number }>();

  if (result?.results) {
    for (const row of result.results) {
      const key = makeComboKey(
        String(row[0] || ""),
        String(row[1] || ""),
        String(row[2] || "")
      );
      map.set(key, {
        hits: Number(row[3] || 0),
        uniqueVisitors: Number(row[4] || 0),
      });
    }
  }

  return map;
}

/**
 * Fetch bounce rate per UTM combo from PostHog.
 */
async function fetchBounceRates(
  days: number
): Promise<Map<string, number>> {
  const hogql = `
    SELECT
      source, medium, campaign,
      countIf(session_pageviews = 1) / count() * 100 AS bounce_rate
    FROM (
      SELECT
        $session_id,
        any(coalesce(properties.$utm_source, extractURLParameter(properties.$current_url, 'utm_source'))) AS source,
        any(coalesce(properties.$utm_medium, extractURLParameter(properties.$current_url, 'utm_medium'))) AS medium,
        any(coalesce(properties.$utm_campaign, extractURLParameter(properties.$current_url, 'utm_campaign'))) AS campaign,
        count() AS session_pageviews
      FROM events
      WHERE event = '$pageview'
        AND timestamp >= now() - interval ${days} day
        AND (
          properties.$utm_source IS NOT NULL
          OR extractURLParameter(properties.$current_url, 'utm_source') != ''
        )
      GROUP BY $session_id
    )
    WHERE source != ''
    GROUP BY source, medium, campaign
  `;

  const result = await queryPostHog(hogql);
  const map = new Map<string, number>();

  if (result?.results) {
    for (const row of result.results) {
      const key = makeComboKey(
        String(row[0] || ""),
        String(row[1] || ""),
        String(row[2] || "")
      );
      map.set(key, Number(row[3] || 0));
    }
  }

  return map;
}

/**
 * Sanitize an event name for safe inclusion in HogQL queries.
 */
function sanitizeEventName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "");
}

/**
 * Fetch conversions per UTM combo from PostHog (last-touch attribution).
 * Uses dynamically configured conversion goals (falls back to defaults).
 */
async function fetchConversions(
  days: number
): Promise<Map<string, number>> {
  const goals = await getActiveConversionGoals();
  const eventNames = getConversionEventNames(goals);
  const sanitizedEvents = eventNames.map(sanitizeEventName).filter(Boolean);
  const inClause = sanitizedEvents.map((e) => `'${e}'`).join(", ");

  const hogql = `
    SELECT
      properties.$utm_source AS source,
      properties.$utm_medium AS medium,
      properties.$utm_campaign AS campaign,
      count() AS conversions
    FROM events
    WHERE event IN (${inClause})
      AND timestamp >= now() - interval ${days} day
      AND properties.$utm_source IS NOT NULL
    GROUP BY source, medium, campaign
  `;

  const result = await queryPostHog(hogql);
  const map = new Map<string, number>();

  if (result?.results) {
    for (const row of result.results) {
      const key = makeComboKey(
        String(row[0] || ""),
        String(row[1] || ""),
        String(row[2] || "")
      );
      map.set(key, Number(row[3] || 0));
    }
  }

  return map;
}

/**
 * Join DB records with PostHog metrics.
 * Uses the higher of DB-tracked hits vs PostHog-tracked hits to ensure
 * visits are counted even without client-side consent.
 */
function joinMetrics(
  dbLinks: Awaited<ReturnType<typeof queryUtmLinks>>,
  hitsData: Map<string, { hits: number; uniqueVisitors: number }>,
  bounceData: Map<string, number>,
  conversionsData: Map<string, number>
): UtmAnalyticsRow[] {
  return dbLinks.map((link) => {
    const key = makeComboKey(link.utmSource, link.utmMedium, link.utmCampaign);
    const metrics = hitsData.get(key) || { hits: 0, uniqueVisitors: 0 };
    const bounceRate = bounceData.get(key) || 0;
    const conversions = conversionsData.get(key) || 0;

    // Use the higher of server-side DB hits vs PostHog-reported hits
    const dbHits = link.totalHits ?? 0;
    const totalHits = Math.max(dbHits, metrics.hits);

    return {
      id: link.id,
      taggedUrl: link.taggedUrl,
      utmSource: link.utmSource,
      utmMedium: link.utmMedium,
      utmCampaign: link.utmCampaign,
      utmTerm: link.utmTerm || null,
      utmContent: link.utmContent || null,
      project: link.project || null,
      autoRegistered: link.autoRegistered,
      createdAt: link.createdAt.toISOString(),
      totalHits,
      uniqueVisitors: metrics.uniqueVisitors,
      bounceRate: Math.round(bounceRate * 100) / 100,
      conversions,
    };
  });
}

/**
 * Sort rows by a given column.
 */
function sortRows(
  rows: UtmAnalyticsRow[],
  sort: string,
  order: string
): UtmAnalyticsRow[] {
  const sortKey = getSortKey(sort);
  const multiplier = order === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];

    if (typeof aVal === "number" && typeof bVal === "number") {
      return (aVal - bVal) * multiplier;
    }

    const aStr = String(aVal || "");
    const bStr = String(bVal || "");
    return aStr.localeCompare(bStr) * multiplier;
  });
}

function getSortKey(sort: string): keyof UtmAnalyticsRow {
  const mapping: Record<string, keyof UtmAnalyticsRow> = {
    hits: "totalHits",
    visitors: "uniqueVisitors",
    bounce: "bounceRate",
    conversions: "conversions",
    source: "utmSource",
    medium: "utmMedium",
    campaign: "utmCampaign",
    created: "createdAt",
  };
  return mapping[sort] || "totalHits";
}

/**
 * Create a case-insensitive combo key for joining UTM metrics.
 */
function makeComboKey(source: string, medium: string, campaign: string): string {
  return `${source.toLowerCase()}|${medium.toLowerCase()}|${campaign.toLowerCase()}`;
}

/**
 * Fetch daily hits trend for a specific UTM link.
 */
async function fetchDailyHits(
  days: number,
  source: string,
  medium: string,
  campaign: string
): Promise<Array<{ date: string; hits: number }>> {
  const hogql = `
    SELECT toDate(timestamp) AS day, count() AS hits
    FROM events
    WHERE event = '$pageview'
      AND timestamp >= now() - interval ${days} day
      AND (
        lower(properties.$utm_source) = lower('${source.replace(/'/g, "\\'")}')
        OR lower(extractURLParameter(properties.$current_url, 'utm_source')) = lower('${source.replace(/'/g, "\\'")}')
      )
      AND (
        lower(properties.$utm_medium) = lower('${medium.replace(/'/g, "\\'")}')
        OR lower(extractURLParameter(properties.$current_url, 'utm_medium')) = lower('${medium.replace(/'/g, "\\'")}')
      )
      AND (
        lower(properties.$utm_campaign) = lower('${campaign.replace(/'/g, "\\'")}')
        OR lower(extractURLParameter(properties.$current_url, 'utm_campaign')) = lower('${campaign.replace(/'/g, "\\'")}')
      )
    GROUP BY day
    ORDER BY day
  `;

  const result = await queryPostHog(hogql);
  if (!result?.results) return [];

  return result.results.map((row) => ({
    date: String(row[0] || ""),
    hits: Number(row[1] || 0),
  }));
}

/**
 * Fetch top 5 landing pages by hit count for a specific UTM link.
 */
async function fetchTopLandingPages(
  days: number,
  source: string,
  medium: string,
  campaign: string
): Promise<Array<{ path: string; hits: number }>> {
  const hogql = `
    SELECT properties.$pathname AS path, count() AS hits
    FROM events
    WHERE event = '$pageview'
      AND timestamp >= now() - interval ${days} day
      AND (
        lower(properties.$utm_source) = lower('${source.replace(/'/g, "\\'")}')
        OR lower(extractURLParameter(properties.$current_url, 'utm_source')) = lower('${source.replace(/'/g, "\\'")}')
      )
      AND (
        lower(properties.$utm_medium) = lower('${medium.replace(/'/g, "\\'")}')
        OR lower(extractURLParameter(properties.$current_url, 'utm_medium')) = lower('${medium.replace(/'/g, "\\'")}')
      )
      AND (
        lower(properties.$utm_campaign) = lower('${campaign.replace(/'/g, "\\'")}')
        OR lower(extractURLParameter(properties.$current_url, 'utm_campaign')) = lower('${campaign.replace(/'/g, "\\'")}')
      )
    GROUP BY path
    ORDER BY hits DESC
    LIMIT 5
  `;

  const result = await queryPostHog(hogql);
  if (!result?.results) return [];

  return result.results.map((row) => ({
    path: String(row[0] || ""),
    hits: Number(row[1] || 0),
  }));
}

/**
 * Fetch average session duration (only sessions with >1 event) for a specific UTM link.
 */
async function fetchAvgSessionDuration(
  days: number,
  source: string,
  medium: string,
  campaign: string
): Promise<number> {
  const hogql = `
    SELECT avg(session_duration) AS avg_duration
    FROM (
      SELECT $session_id, dateDiff('second', min(timestamp), max(timestamp)) AS session_duration
      FROM events
      WHERE timestamp >= now() - interval ${days} day
        AND (
          lower(properties.$utm_source) = lower('${source.replace(/'/g, "\\'")}')
          OR lower(extractURLParameter(properties.$current_url, 'utm_source')) = lower('${source.replace(/'/g, "\\'")}')
        )
        AND (
          lower(properties.$utm_medium) = lower('${medium.replace(/'/g, "\\'")}')
          OR lower(extractURLParameter(properties.$current_url, 'utm_medium')) = lower('${medium.replace(/'/g, "\\'")}')
        )
        AND (
          lower(properties.$utm_campaign) = lower('${campaign.replace(/'/g, "\\'")}')
          OR lower(extractURLParameter(properties.$current_url, 'utm_campaign')) = lower('${campaign.replace(/'/g, "\\'")}')
        )
      GROUP BY $session_id
      HAVING count() > 1
    )
  `;

  const result = await queryPostHog(hogql);
  if (!result?.results || result.results.length === 0) return 0;

  return Math.round(Number(result.results[0][0] || 0));
}

/**
 * Execute a HogQL query against the PostHog Query API.
 */
async function queryPostHog(hogqlQuery: string): Promise<PostHogQueryResult> {
  const posthogKey = process.env.POSTHOG_PERSONAL_API_KEY;
  const posthogHost = process.env.POSTHOG_HOST || "https://eu.i.posthog.com";

  if (!posthogKey) {
    throw new Error("POSTHOG_PERSONAL_API_KEY not configured");
  }

  const url = `${posthogHost}/api/projects/@current/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${posthogKey}`,
    },
    body: JSON.stringify({
      query: {
        kind: "HogQLQuery",
        query: hogqlQuery,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `PostHog query failed: ${res.status} ${res.statusText} — ${text}`
    );
  }

  return res.json();
}
