-- Prospecting Workspace (S7) — market catalog mirror (task 1.1)
--
-- The external/competitor market-intelligence catalog, ingested from Property
-- Monitor / Dubai Pulse via the MarketData_Adapter and kept in a dedicated
-- `market_*` namespace, deliberately SEPARATE from ORA's own communities /
-- projects / ai_units (which are brochure/landing-page bound and rendered on
-- the public site). Competitor rows must never leak onto the public site
-- (Design §Decision 1, Requirement 11.1).
--
-- Provenance (CC-Provenance / Req 11.1, 11.6): every row carries `source` +
-- `source_ref` + `as_of` and a `demo` flag, so a figure can be stamped
-- "official DLD, Q1 2026" vs "reseller, cleaned" and demo rows are never
-- mistaken for live data.
--
-- Idempotent ingest (CC-Idem / Req 11.2): a unique `(source, source_ref)` index
-- per ingested table means re-ingesting the same record is field-identical
-- (ON CONFLICT (source, source_ref) DO UPDATE). market_price_index is keyed on
-- (area_name, segment, period, source).
--
-- SQL grounding (CC-SQL / Req 11.3, 11.4): find_comparables / market_comps read
-- ONLY these tables, so every stat shown or embedded in outreach is sourced and
-- as-of-stamped, never model-computed. Segment / area / date indexes back the
-- comparables ranker and the stat readers.
--
-- buyer_segment / buyer_nationality on market_transactions are AGGREGATE /
-- segment-level labels only — never individual buyer PII (Design §Decision 4).
--
-- The project_comparables bridge links an OWN project to comparable MARKET
-- projects without copying competitor data into the own catalog.
--
-- See prospecting-workspace design §Data Models (Market catalog).
-- Requirements: 11.1, 11.2, 11.6.

CREATE TABLE "market_developers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "name_normalized" text NOT NULL,
  "country" text,
  "source" text NOT NULL,
  "source_ref" text,
  "as_of" timestamp,
  "demo" boolean NOT NULL DEFAULT false,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "developer_id" uuid REFERENCES "market_developers"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "name_normalized" text NOT NULL,
  "community_name" text,
  "city" text,
  "region" text,
  "country" text,
  "location_lat" numeric,
  "location_lng" numeric,
  "segment" text,
  "status" text,
  "launch_date" date,
  "handover_date" date,
  "total_units" integer,
  "unit_types" jsonb,
  "price_min" numeric,
  "price_max" numeric,
  "avg_price_per_sqft" numeric,
  "branded" boolean DEFAULT false,
  "brand_name" text,
  "source" text NOT NULL,
  "source_ref" text,
  "as_of" timestamp,
  "demo" boolean NOT NULL DEFAULT false,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_buildings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "market_project_id" uuid REFERENCES "market_projects"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "floors" integer,
  "total_units" integer,
  "completion_year" integer,
  "source" text NOT NULL,
  "source_ref" text,
  "as_of" timestamp,
  "demo" boolean NOT NULL DEFAULT false,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "market_project_id" uuid REFERENCES "market_projects"("id") ON DELETE SET NULL,
  "market_building_id" uuid REFERENCES "market_buildings"("id") ON DELETE SET NULL,
  "community_name" text,
  "area_name" text,
  "txn_type" text NOT NULL,
  "txn_date" date NOT NULL,
  "unit_type" text,
  "area_sqm" numeric,
  "bedrooms" integer,
  "price_aed" numeric,
  "price_per_sqft" numeric,
  "is_cash" boolean,
  "buyer_segment" text,
  "buyer_nationality" text,
  "source" text NOT NULL,
  "source_ref" text,
  "as_of" timestamp,
  "demo" boolean NOT NULL DEFAULT false,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_price_index" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "area_name" text NOT NULL,
  "segment" text,
  "period" text NOT NULL,
  "index_value" numeric,
  "avg_price_per_sqft" numeric,
  "yoy_pct" numeric,
  "source" text NOT NULL,
  "as_of" timestamp,
  "demo" boolean NOT NULL DEFAULT false,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_comparables" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "market_project_id" uuid NOT NULL REFERENCES "market_projects"("id") ON DELETE CASCADE,
  "similarity_score" numeric,
  "rationale" text,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "market_developers_source_ref_ux" ON "market_developers" ("source", "source_ref");
--> statement-breakpoint
CREATE UNIQUE INDEX "market_projects_source_ref_ux" ON "market_projects" ("source", "source_ref");
--> statement-breakpoint
CREATE INDEX "market_projects_segment_idx" ON "market_projects" ("segment");
--> statement-breakpoint
CREATE INDEX "market_projects_community_idx" ON "market_projects" ("community_name");
--> statement-breakpoint
CREATE UNIQUE INDEX "market_buildings_source_ref_ux" ON "market_buildings" ("source", "source_ref");
--> statement-breakpoint
CREATE UNIQUE INDEX "market_transactions_source_ref_ux" ON "market_transactions" ("source", "source_ref");
--> statement-breakpoint
CREATE INDEX "market_transactions_project_idx" ON "market_transactions" ("market_project_id");
--> statement-breakpoint
CREATE INDEX "market_transactions_date_idx" ON "market_transactions" ("txn_date");
--> statement-breakpoint
CREATE UNIQUE INDEX "market_price_index_key_ux" ON "market_price_index" ("area_name", "segment", "period", "source");
--> statement-breakpoint
CREATE UNIQUE INDEX "project_comparables_pair_ux" ON "project_comparables" ("project_id", "market_project_id");
