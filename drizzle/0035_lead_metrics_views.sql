-- Salesforce Lead Core (S2) — lead metrics view (task 1.4)
--
-- Retires the legacy `request_type = 'lead_inquiry'` ticket shim as the source
-- of lead figures. The canonical source of lead data is the Lead world
-- (`parties` + `leads_mirror`), so lead counts are computed here in SQL over
-- `leads_mirror`, counting each distinct `party_id` exactly once and excluding
-- demo rows. This view deliberately does NOT read `tickets` and never counts
-- `tickets.request_type = 'lead_inquiry'` rows (Req 13.8, 13.9, 13.10).
--
-- Figures are computed in SQL, never in a model or application-layer code, so
-- the same scope + period returns identical figures for repeated requests
-- (Req 9.1, 9.2, 9.3). The admin-agent / admin-capabilities lead counts are
-- repointed at this view in task 7.1.
--
-- CREATE OR REPLACE keeps the migration idempotent under the project's direct
-- migration runner (scripts/migrate-direct.ts), which tolerates re-application.
-- See salesforce-lead-core design §6.4 (Requirements 9.1, 9.3, 13.8, 13.9, 13.10).
CREATE OR REPLACE VIEW "metrics_leads" AS
SELECT
  date_trunc('day', lm.updated_at)::date AS day,
  lm.tier                                AS tier,
  count(DISTINCT lm.party_id)            AS lead_count  -- canonical source = leads_mirror (Req 13.10)
FROM "leads_mirror" lm
WHERE lm.demo = false
GROUP BY 1, 2;
