import { Elysia } from "elysia";
import { sql, desc, sum } from "drizzle-orm";
import { authGuard } from "../auth";
import { marketingSpend } from "../../schema";
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

interface ConversionGoalBreakdown {
  goalId: string;
  eventName: string;
  displayLabel: string;
  conversions: number;
  value: number;
}

// ── Helpers: Sanitization ────────────────────────────────────────────────────

/**
 * Sanitize an event name for safe inclusion in HogQL queries.
 * Only allows alphanumeric characters and underscores to prevent injection.
 */
function sanitizeEventName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "");
}

// ── Route ────────────────────────────────────────────────────────────────────

export const marketingDashboardRoutes = new Elysia({
  name: "marketing-dashboard",
})
  .use(authGuard)

  // GET /marketing-dashboard?days=7|30
  .get("/marketing-dashboard", async ({ query, userId, set }) => {
    // Permission check: analytics:read or admin
    const hasAccess = await checkAnalyticsAccess(userId);
    if (!hasAccess) {
      set.status = 403;
      return { error: "Forbidden: analytics:read permission required" };
    }

    const days = query?.days === "7" ? 7 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split("T")[0];
    const endDateStr = new Date().toISOString().split("T")[0];

    try {
      // 1. Fetch active conversion goals (with fallback on failure)
      const goals = await getActiveConversionGoals();
      const eventNames = getConversionEventNames(goals);

      // 2. Query marketing_spend for campaign spend data
      const spendRows = await db
        .select({
          campaignId: marketingSpend.campaignId,
          channel: marketingSpend.channel,
          totalSpend: sum(marketingSpend.spend),
          totalClicks: sum(marketingSpend.clicks),
          totalImpressions: sum(marketingSpend.impressions),
        })
        .from(marketingSpend)
        .where(
          sql`${marketingSpend.date} >= ${startDateStr} AND ${marketingSpend.date} <= ${endDateStr}`
        )
        .groupBy(marketingSpend.campaignId, marketingSpend.channel)
        .orderBy(desc(sum(marketingSpend.spend)))
        .limit(10);

      // 3. Query PostHog for conversion metrics via HogQL
      const posthogMetrics = await fetchPostHogMetrics(days, eventNames);

      // 4. Compute dashboard metrics
      const totalSpend = spendRows.reduce(
        (acc, r) => acc + parseFloat(r.totalSpend || "0"),
        0
      );
      const totalConversions = posthogMetrics.totalConversions;
      const totalConversionValue = posthogMetrics.totalConversionValue;
      const totalVisitors = posthogMetrics.totalVisitors;
      const aiConversions = posthogMetrics.aiConversions;

      const conversionRate =
        totalVisitors > 0
          ? ((totalConversions / totalVisitors) * 100).toFixed(2)
          : "0.00";
      const cac =
        totalConversions > 0
          ? (totalSpend / totalConversions).toFixed(2)
          : "0.00";
      const roas =
        totalSpend > 0
          ? (totalConversionValue / totalSpend).toFixed(2)
          : "0.00";
      const aiContribution =
        totalConversions > 0
          ? ((aiConversions / totalConversions) * 100).toFixed(1)
          : "0.0";

      // 5. Build top campaigns with ROAS
      const topCampaigns = spendRows.map((row) => {
        const spend = parseFloat(row.totalSpend || "0");
        const campaignConversions =
          posthogMetrics.campaignConversions[row.campaignId] || 0;
        const campaignValue =
          posthogMetrics.campaignValues[row.campaignId] || 0;
        const campaignRoas = spend > 0 ? (campaignValue / spend).toFixed(2) : "0.00";

        return {
          campaignId: row.campaignId,
          channel: row.channel,
          spend: spend.toFixed(2),
          conversions: campaignConversions,
          roas: campaignRoas,
        };
      });

      // 6. Build conversion breakdown per goal
      const conversionBreakdown: ConversionGoalBreakdown[] = eventNames.map(
        (eventName) => {
          const goal = goals.find((g) => g.eventName === eventName);
          const eventMetrics = posthogMetrics.perEventMetrics[eventName] || {
            conversions: 0,
            value: 0,
          };
          return {
            goalId: goal?.id || "",
            eventName,
            displayLabel: goal?.displayLabel || eventName,
            conversions: eventMetrics.conversions,
            value: eventMetrics.value,
          };
        }
      );

      return {
        data: {
          topCampaigns,
          conversionBreakdown,
          conversionRate,
          cac,
          roas,
          aiContribution,
          aiConversions,
          totalConversions,
          totalSpend: totalSpend.toFixed(2),
          totalVisitors,
          days,
          fetchedAt: new Date().toISOString(),
        },
      };
    } catch (err) {
      console.error("[marketing-dashboard] Error fetching metrics:", err);
      set.status = 500;
      return { error: "Failed to fetch dashboard metrics" };
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
 * Fetch conversion metrics from PostHog Query API (HogQL).
 * Returns total conversions, conversion value, visitors, AI conversions,
 * per-campaign breakdowns, and per-event breakdowns.
 */
async function fetchPostHogMetrics(
  days: number,
  eventNames: string[]
): Promise<{
  totalConversions: number;
  totalConversionValue: number;
  totalVisitors: number;
  aiConversions: number;
  campaignConversions: Record<string, number>;
  campaignValues: Record<string, number>;
  perEventMetrics: Record<string, { conversions: number; value: number }>;
}> {
  const posthogKey = process.env.POSTHOG_PERSONAL_API_KEY;
  const posthogHost = process.env.POSTHOG_HOST || "https://eu.i.posthog.com";

  if (!posthogKey) {
    return {
      totalConversions: 0,
      totalConversionValue: 0,
      totalVisitors: 0,
      aiConversions: 0,
      campaignConversions: {},
      campaignValues: {},
      perEventMetrics: {},
    };
  }

  try {
    // Sanitize event names and build the IN clause
    const sanitizedEvents = eventNames.map(sanitizeEventName).filter(Boolean);
    const inClause = sanitizedEvents.map((e) => `'${e}'`).join(", ");

    // Query 1: Total conversions and conversion value by campaign
    const conversionsQuery = `
      SELECT
        properties.$utm_campaign AS campaign,
        count() AS conversions,
        sum(coalesce(properties.conversion_value_aed, 0)) AS value
      FROM events
      WHERE event IN (${inClause})
        AND timestamp >= now() - interval ${days} day
      GROUP BY campaign
    `;

    // Query 2: Total unique visitors
    const visitorsQuery = `
      SELECT count(DISTINCT person_id) AS visitors
      FROM events
      WHERE event = '$pageview'
        AND timestamp >= now() - interval ${days} day
    `;

    // Query 3: AI-attributed conversions
    const aiQuery = `
      SELECT count() AS ai_conversions
      FROM events
      WHERE event IN (${inClause})
        AND timestamp >= now() - interval ${days} day
        AND person_id IN (
          SELECT DISTINCT person_id
          FROM events
          WHERE event = 'ai_conversation_started'
            AND timestamp >= now() - interval ${days} day
        )
    `;

    // Query 4: Per-event breakdown (conversions and value per event name)
    const perEventQuery = `
      SELECT
        event AS event_name,
        count() AS conversions,
        sum(coalesce(properties.conversion_value_aed, 0)) AS value
      FROM events
      WHERE event IN (${inClause})
        AND timestamp >= now() - interval ${days} day
      GROUP BY event_name
    `;

    const [conversionsResult, visitorsResult, aiResult, perEventResult] =
      await Promise.all([
        queryPostHog(posthogHost, posthogKey, conversionsQuery),
        queryPostHog(posthogHost, posthogKey, visitorsQuery),
        queryPostHog(posthogHost, posthogKey, aiQuery),
        queryPostHog(posthogHost, posthogKey, perEventQuery),
      ]);

    // Parse conversions result
    const campaignConversions: Record<string, number> = {};
    const campaignValues: Record<string, number> = {};
    let totalConversions = 0;
    let totalConversionValue = 0;

    if (conversionsResult?.results) {
      for (const row of conversionsResult.results) {
        const campaign = String(row[0] || "");
        const conversions = Number(row[1] || 0);
        const value = Number(row[2] || 0);
        if (campaign) {
          campaignConversions[campaign] = conversions;
          campaignValues[campaign] = value;
        }
        totalConversions += conversions;
        totalConversionValue += value;
      }
    }

    // Parse visitors result
    const totalVisitors =
      visitorsResult?.results?.[0]?.[0]
        ? Number(visitorsResult.results[0][0])
        : 0;

    // Parse AI conversions result
    const aiConversions =
      aiResult?.results?.[0]?.[0] ? Number(aiResult.results[0][0]) : 0;

    // Parse per-event breakdown
    const perEventMetrics: Record<string, { conversions: number; value: number }> = {};
    if (perEventResult?.results) {
      for (const row of perEventResult.results) {
        const eventName = String(row[0] || "");
        const conversions = Number(row[1] || 0);
        const value = Number(row[2] || 0);
        if (eventName) {
          perEventMetrics[eventName] = { conversions, value };
        }
      }
    }

    return {
      totalConversions,
      totalConversionValue,
      totalVisitors,
      aiConversions,
      campaignConversions,
      campaignValues,
      perEventMetrics,
    };
  } catch (err) {
    console.error("[marketing-dashboard] PostHog query failed:", err);
    return {
      totalConversions: 0,
      totalConversionValue: 0,
      totalVisitors: 0,
      aiConversions: 0,
      campaignConversions: {},
      campaignValues: {},
      perEventMetrics: {},
    };
  }
}

/**
 * Execute a HogQL query against the PostHog Query API.
 */
async function queryPostHog(
  host: string,
  apiKey: string,
  hogqlQuery: string
): Promise<PostHogQueryResult> {
  const url = `${host}/api/projects/@current/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
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
