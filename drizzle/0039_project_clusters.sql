-- Prospecting Workspace (S7) — increment: own-project clusters + location cache
-- + market price-index trend extension (task 10.1)
--
-- Completes the OWN real-estate hierarchy (community → project → cluster → unit)
-- for the prospecting comparison resolver and adds the supporting cache/trend
-- columns the Property Finder reseller source needs. ALL changes are additive;
-- no existing column, table, or `app/api/[...slugs]/route.ts` setting changes.
--
-- `project_clusters` (NEW, Req 13.1): a named sub-zone within an own project
-- (e.g. "Views 3"), backfilled from the retained free-text `ai_units.cluster`
-- label. Unique on (project_id, slug) so the backfill is idempotent (Property
-- 11); indexed by project_id for the picker/resolver. Deleting a project
-- cascades its clusters. Prospecting-internal grouping only — never rendered on
-- the public site (Decision 7).
--
-- `ai_units.cluster_id` (NEW nullable FK, Req 13.1): links a unit to its cluster.
-- `onDelete: set null` mirrors the existing projectId/communityId posture —
-- deleting a cluster never deletes a unit. The legacy free-text `ai_units.cluster`
-- column is RETAINED as the backfill source and a transition fallback.
--
-- `market_price_index.roi_pct` / `.volume` / `.trend` (NEW nullable, Req 14.7):
-- Area_Trend figures carried from the reseller summary block; additive so the
-- existing 0037 ingest stays field-identical.
--
-- `location_resolutions` (NEW, Req 14.3): own area name → provider location_id,
-- resolved once and reused so the free-tier AutoComplete endpoint is hit at most
-- once per distinct normalized area name. Unique on (source, area_name_normalized).
--
-- See prospecting-workspace design §1 (own hierarchy), §3 (location cache +
-- price-index extension), §4. Requirements: 13.1, 14.1, 14.3, 14.7.

CREATE TABLE "project_clusters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "name_ar" text,
  "slug" text NOT NULL,
  "segment" text,
  "unit_types" jsonb,
  "bedrooms_min" integer,
  "bedrooms_max" integer,
  "price_min_aed" numeric,
  "price_max_aed" numeric,
  "avg_price_per_sqft" numeric,
  "handover_date" date,
  "total_units" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "project_clusters_project_slug_ux" ON "project_clusters" ("project_id", "slug");
--> statement-breakpoint
CREATE INDEX "project_clusters_project_idx" ON "project_clusters" ("project_id");
--> statement-breakpoint
ALTER TABLE "ai_units" ADD COLUMN "cluster_id" uuid REFERENCES "project_clusters"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX "ai_units_cluster_id_idx" ON "ai_units" ("cluster_id");
--> statement-breakpoint
-- market_price_index trend extension (§4): roi + volume + raw summary block.
ALTER TABLE "market_price_index" ADD COLUMN "roi_pct" numeric;
--> statement-breakpoint
ALTER TABLE "market_price_index" ADD COLUMN "volume" integer;
--> statement-breakpoint
ALTER TABLE "market_price_index" ADD COLUMN "trend" jsonb;
--> statement-breakpoint
-- location_resolutions cache (§3): own area name → provider location_id.
CREATE TABLE "location_resolutions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source" text NOT NULL,
  "area_name_normalized" text NOT NULL,
  "location_id" text NOT NULL,
  "display_name" text,
  "as_of" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "location_resolutions_key_ux" ON "location_resolutions" ("source", "area_name_normalized");
