-- DOE Voice Surface — demo flag on marketing_spend (task 18.1)
--
-- The voice demo seed populates a synthetic 90-day marketing-spend dataset so
-- the `metrics_*` views (drizzle/0030_metrics_views.sql) return meaningful
-- cost-per-qualified-lead figures. Those rows must be removable by the
-- one-click voice demo reset (task 18.2), which deletes exactly the rows
-- flagged `demo = true` (Requirement 11.4). All existing/real spend rows
-- default to `demo = false`, so the reset never touches real marketing data.
ALTER TABLE "marketing_spend" ADD COLUMN "demo" boolean DEFAULT false NOT NULL;
