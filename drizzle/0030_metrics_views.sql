-- DOE Voice Surface — metrics_* SQL views (task 16.3)
--
-- These views are the SINGLE SOURCE of analytics arithmetic for both the voice
-- `get_pipeline_summary` tool (task 16.4) and the emailed report
-- (`compile_and_email_report`, task 16.6). All figures — cost per qualified
-- lead by channel, tier funnel, median speed-to-lead, rep load, and
-- week-over-week deltas — are computed in SQL so the LLM only narrates and
-- never performs arithmetic (Design §9.3, §15; Requirements 10.1, 10.2, 10.3).
--
-- Conventions:
--   • "Qualified lead" = a `leads_mirror` row whose `tier` is set (HOT/WARM/NURTURE).
--   • "Channel" = `leads_mirror.source`, joined to `marketing_spend.channel`.
--   • "Week" = ISO week bucket via date_trunc('week', ...) on the lead's
--     arrival time (`parties.created_at`) or the spend `date`.
--   • "Speed-to-lead" = seconds between lead arrival (`parties.created_at`) and
--     first/last recorded contact (`leads_mirror.last_interaction_at`); median
--     via percentile_cont(0.5).
--
-- CREATE OR REPLACE keeps the migration idempotent under the project's direct
-- migration runner (scripts/migrate-direct.ts), which tolerates re-application.

-- ── Base helper: qualified leads enriched with channel, week, speed-to-lead ──
CREATE OR REPLACE VIEW "metrics_qualified_leads" AS
SELECT
  lm.party_id,
  lm.tier,
  lm.source                                            AS channel,
  lm.campaign,
  lm.assigned_rep_id,
  p.created_at                                         AS lead_created_at,
  lm.last_interaction_at,
  date_trunc('week', p.created_at)::date               AS week,
  CASE
    WHEN lm.last_interaction_at IS NOT NULL
    THEN EXTRACT(EPOCH FROM (lm.last_interaction_at - p.created_at))
    ELSE NULL
  END                                                  AS speed_to_lead_seconds
FROM leads_mirror lm
JOIN parties p ON p.id = lm.party_id
WHERE lm.tier IS NOT NULL;
--> statement-breakpoint

-- ── Cost per qualified lead by channel × week ────────────────────────────────
CREATE OR REPLACE VIEW "metrics_cost_per_qualified_lead" AS
WITH spend AS (
  SELECT
    channel,
    date_trunc('week', date)::date AS week,
    SUM(spend)                     AS spend
  FROM marketing_spend
  GROUP BY channel, date_trunc('week', date)::date
),
leads AS (
  SELECT channel, week, COUNT(*) AS qualified_leads
  FROM metrics_qualified_leads
  GROUP BY channel, week
)
SELECT
  COALESCE(s.channel, l.channel)                                   AS channel,
  COALESCE(s.week, l.week)                                         AS week,
  COALESCE(s.spend, 0)::numeric(14,2)                              AS spend,
  COALESCE(l.qualified_leads, 0)                                   AS qualified_leads,
  ROUND(COALESCE(s.spend, 0) / NULLIF(l.qualified_leads, 0), 2)    AS cost_per_qualified_lead
FROM spend s
FULL OUTER JOIN leads l ON s.channel = l.channel AND s.week = l.week;
--> statement-breakpoint

-- ── Cost per qualified lead by channel (all-time, exec scope) ────────────────
CREATE OR REPLACE VIEW "metrics_cost_per_qualified_lead_overall" AS
WITH spend AS (
  SELECT channel, SUM(spend) AS spend
  FROM marketing_spend
  GROUP BY channel
),
leads AS (
  SELECT channel, COUNT(*) AS qualified_leads
  FROM metrics_qualified_leads
  GROUP BY channel
)
SELECT
  COALESCE(s.channel, l.channel)                                   AS channel,
  COALESCE(s.spend, 0)::numeric(14,2)                              AS spend,
  COALESCE(l.qualified_leads, 0)                                   AS qualified_leads,
  ROUND(COALESCE(s.spend, 0) / NULLIF(l.qualified_leads, 0), 2)    AS cost_per_qualified_lead
FROM spend s
FULL OUTER JOIN leads l ON s.channel = l.channel;
--> statement-breakpoint

-- ── Tier funnel (HOT / WARM / NURTURE) by week ───────────────────────────────
CREATE OR REPLACE VIEW "metrics_tier_funnel" AS
SELECT
  date_trunc('week', p.created_at)::date                       AS week,
  COUNT(*) FILTER (WHERE lm.tier = 'HOT')                      AS hot,
  COUNT(*) FILTER (WHERE lm.tier = 'WARM')                     AS warm,
  COUNT(*) FILTER (WHERE lm.tier = 'NURTURE')                  AS nurture,
  COUNT(*) FILTER (WHERE lm.tier IS NOT NULL)                  AS qualified_total
FROM leads_mirror lm
JOIN parties p ON p.id = lm.party_id
GROUP BY date_trunc('week', p.created_at)::date;
--> statement-breakpoint

-- ── Tier funnel (all-time, single-row exec scope) ────────────────────────────
CREATE OR REPLACE VIEW "metrics_tier_funnel_overall" AS
SELECT
  COUNT(*) FILTER (WHERE lm.tier = 'HOT')                      AS hot,
  COUNT(*) FILTER (WHERE lm.tier = 'WARM')                     AS warm,
  COUNT(*) FILTER (WHERE lm.tier = 'NURTURE')                  AS nurture,
  COUNT(*) FILTER (WHERE lm.tier IS NOT NULL)                  AS qualified_total
FROM leads_mirror lm;
--> statement-breakpoint

-- ── Median speed-to-lead by week ─────────────────────────────────────────────
CREATE OR REPLACE VIEW "metrics_speed_to_lead" AS
SELECT
  week,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY speed_to_lead_seconds)
                                                  AS median_speed_to_lead_seconds,
  COUNT(speed_to_lead_seconds)                    AS contacted_leads
FROM metrics_qualified_leads
WHERE speed_to_lead_seconds IS NOT NULL
GROUP BY week;
--> statement-breakpoint

-- ── Median speed-to-lead (all-time, single-row exec scope) ───────────────────
CREATE OR REPLACE VIEW "metrics_speed_to_lead_overall" AS
SELECT
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY speed_to_lead_seconds)
                                                  AS median_speed_to_lead_seconds,
  COUNT(speed_to_lead_seconds)                    AS contacted_leads
FROM metrics_qualified_leads
WHERE speed_to_lead_seconds IS NOT NULL;
--> statement-breakpoint

-- ── Rep load (assigned leads vs capacity) ────────────────────────────────────
CREATE OR REPLACE VIEW "metrics_rep_load" AS
SELECT
  r.id                                                          AS rep_id,
  r.name,
  r.capacity,
  r.open_hot_count,
  COUNT(lm.party_id)                                            AS assigned_leads,
  COUNT(lm.party_id) FILTER (WHERE lm.tier = 'HOT')             AS assigned_hot,
  ROUND(r.open_hot_count::numeric / NULLIF(r.capacity, 0), 2)   AS utilization
FROM reps r
LEFT JOIN leads_mirror lm ON lm.assigned_rep_id = r.id
GROUP BY r.id, r.name, r.capacity, r.open_hot_count;
--> statement-breakpoint

-- ── Week-over-week deltas (latest week vs prior week) ────────────────────────
CREATE OR REPLACE VIEW "metrics_week_over_week" AS
WITH weekly AS (
  SELECT
    tf.week,
    tf.qualified_total,
    tf.hot,
    tf.warm,
    tf.nurture,
    COALESCE(sp.spend, 0)               AS spend,
    stl.median_speed_to_lead_seconds
  FROM metrics_tier_funnel tf
  LEFT JOIN (
    SELECT week, SUM(spend) AS spend
    FROM metrics_cost_per_qualified_lead
    GROUP BY week
  ) sp ON sp.week = tf.week
  LEFT JOIN metrics_speed_to_lead stl ON stl.week = tf.week
),
ranked AS (
  SELECT w.*, ROW_NUMBER() OVER (ORDER BY w.week DESC) AS rn
  FROM weekly w
)
SELECT
  cur.week                                                          AS current_week,
  prev.week                                                         AS prior_week,
  cur.qualified_total                                               AS qualified_total,
  prev.qualified_total                                              AS prior_qualified_total,
  cur.qualified_total - COALESCE(prev.qualified_total, 0)           AS qualified_total_delta,
  cur.hot                                                           AS hot,
  prev.hot                                                          AS prior_hot,
  cur.hot - COALESCE(prev.hot, 0)                                   AS hot_delta,
  cur.spend::numeric(14,2)                                          AS spend,
  prev.spend::numeric(14,2)                                         AS prior_spend,
  (cur.spend - COALESCE(prev.spend, 0))::numeric(14,2)              AS spend_delta,
  cur.median_speed_to_lead_seconds                                  AS median_speed_to_lead_seconds,
  prev.median_speed_to_lead_seconds                                 AS prior_median_speed_to_lead_seconds,
  cur.median_speed_to_lead_seconds - prev.median_speed_to_lead_seconds
                                                                    AS median_speed_to_lead_delta,
  ROUND(cur.spend / NULLIF(cur.qualified_total, 0), 2)              AS cost_per_qualified_lead,
  ROUND(prev.spend / NULLIF(prev.qualified_total, 0), 2)            AS prior_cost_per_qualified_lead
FROM ranked cur
LEFT JOIN ranked prev ON prev.rn = cur.rn + 1
WHERE cur.rn = 1;
