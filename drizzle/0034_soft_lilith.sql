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
CREATE TABLE "market_buildings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_project_id" uuid,
	"name" text NOT NULL,
	"floors" integer,
	"total_units" integer,
	"completion_year" integer,
	"source" text NOT NULL,
	"source_ref" text,
	"as_of" timestamp,
	"demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_developers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"country" text,
	"source" text NOT NULL,
	"source_ref" text,
	"as_of" timestamp,
	"demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_price_index" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"area_name" text NOT NULL,
	"segment" text,
	"period" text NOT NULL,
	"index_value" numeric,
	"avg_price_per_sqft" numeric,
	"yoy_pct" numeric,
	"roi_pct" numeric,
	"volume" integer,
	"trend" jsonb,
	"source" text NOT NULL,
	"as_of" timestamp,
	"demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"developer_id" uuid,
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
	"demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_project_id" uuid,
	"market_building_id" uuid,
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
	"demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"brief_id" uuid,
	"channel" text NOT NULL,
	"language" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"grounding" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_by" uuid,
	"job_key" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
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
CREATE TABLE "project_comparables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"market_project_id" uuid NOT NULL,
	"similarity_score" numeric,
	"rationale" text,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospect_optouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_kind" text NOT NULL,
	"match_value" text NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospecting_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by" uuid NOT NULL,
	"project_id" uuid,
	"ai_unit_id" uuid,
	"spec" jsonb NOT NULL,
	"buyer_hypothesis" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brief_id" uuid,
	"target_type" text NOT NULL,
	"display_name" text,
	"company_name" text,
	"title" text,
	"email" text,
	"phone_hash" text,
	"raw_phone" text,
	"country" text,
	"attributes" jsonb,
	"source_provider" text NOT NULL,
	"source_ref" text,
	"lawful_basis" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"party_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_units" ADD COLUMN "cluster_id" uuid;--> statement-breakpoint
ALTER TABLE "market_buildings" ADD CONSTRAINT "market_buildings_market_project_id_market_projects_id_fk" FOREIGN KEY ("market_project_id") REFERENCES "public"."market_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_projects" ADD CONSTRAINT "market_projects_developer_id_market_developers_id_fk" FOREIGN KEY ("developer_id") REFERENCES "public"."market_developers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_transactions" ADD CONSTRAINT "market_transactions_market_project_id_market_projects_id_fk" FOREIGN KEY ("market_project_id") REFERENCES "public"."market_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_transactions" ADD CONSTRAINT "market_transactions_market_building_id_market_buildings_id_fk" FOREIGN KEY ("market_building_id") REFERENCES "public"."market_buildings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_brief_id_prospecting_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."prospecting_briefs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_clusters" ADD CONSTRAINT "project_clusters_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_comparables" ADD CONSTRAINT "project_comparables_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_comparables" ADD CONSTRAINT "project_comparables_market_project_id_market_projects_id_fk" FOREIGN KEY ("market_project_id") REFERENCES "public"."market_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_comparables" ADD CONSTRAINT "project_comparables_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospecting_briefs" ADD CONSTRAINT "prospecting_briefs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospecting_briefs" ADD CONSTRAINT "prospecting_briefs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospecting_briefs" ADD CONSTRAINT "prospecting_briefs_ai_unit_id_ai_units_id_fk" FOREIGN KEY ("ai_unit_id") REFERENCES "public"."ai_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_brief_id_prospecting_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."prospecting_briefs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "location_resolutions_key_ux" ON "location_resolutions" USING btree ("source","area_name_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "market_buildings_source_ref_ux" ON "market_buildings" USING btree ("source","source_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "market_developers_source_ref_ux" ON "market_developers" USING btree ("source","source_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "market_price_index_key_ux" ON "market_price_index" USING btree ("area_name","segment","period","source");--> statement-breakpoint
CREATE UNIQUE INDEX "market_projects_source_ref_ux" ON "market_projects" USING btree ("source","source_ref");--> statement-breakpoint
CREATE INDEX "market_projects_segment_idx" ON "market_projects" USING btree ("segment");--> statement-breakpoint
CREATE INDEX "market_projects_community_idx" ON "market_projects" USING btree ("community_name");--> statement-breakpoint
CREATE UNIQUE INDEX "market_transactions_source_ref_ux" ON "market_transactions" USING btree ("source","source_ref");--> statement-breakpoint
CREATE INDEX "market_transactions_project_idx" ON "market_transactions" USING btree ("market_project_id");--> statement-breakpoint
CREATE INDEX "market_transactions_date_idx" ON "market_transactions" USING btree ("txn_date");--> statement-breakpoint
CREATE INDEX "outreach_drafts_target_idx" ON "outreach_drafts" USING btree ("target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_drafts_job_key_ux" ON "outreach_drafts" USING btree ("job_key");--> statement-breakpoint
CREATE UNIQUE INDEX "project_clusters_project_slug_ux" ON "project_clusters" USING btree ("project_id","slug");--> statement-breakpoint
CREATE INDEX "project_clusters_project_idx" ON "project_clusters" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_comparables_pair_ux" ON "project_comparables" USING btree ("project_id","market_project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prospect_optouts_match_ux" ON "prospect_optouts" USING btree ("match_kind","match_value");--> statement-breakpoint
CREATE INDEX "targets_brief_idx" ON "targets" USING btree ("brief_id");--> statement-breakpoint
CREATE INDEX "targets_party_idx" ON "targets" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "targets_status_idx" ON "targets" USING btree ("status");--> statement-breakpoint
ALTER TABLE "ai_units" ADD CONSTRAINT "ai_units_cluster_id_project_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."project_clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_units_cluster_id_idx" ON "ai_units" USING btree ("cluster_id");