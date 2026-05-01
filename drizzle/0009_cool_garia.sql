CREATE TABLE "communities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text,
	"description_en" text,
	"description_ar" text,
	"city" text,
	"region" text,
	"country" text DEFAULT 'AE',
	"location_lat" numeric,
	"location_lng" numeric,
	"hero_image_id" uuid,
	"logo_image_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"seo_meta" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "communities_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text,
	"short_description_en" text,
	"short_description_ar" text,
	"long_description_en" text,
	"long_description_ar" text,
	"status" text DEFAULT 'planning' NOT NULL,
	"hero_image_id" uuid,
	"logo_image_id" uuid,
	"brochure_pdf_id" uuid,
	"brochure_gallery" jsonb,
	"floorplans" jsonb,
	"amenities" jsonb,
	"location_lat" numeric,
	"location_lng" numeric,
	"location_highlights" jsonb,
	"payment_plans" jsonb,
	"expected_handover_date" date,
	"total_units" integer,
	"available_units" integer,
	"developer" text,
	"contractor" text,
	"architect" text,
	"seo_meta" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_units" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_units" ADD COLUMN "community_id" uuid;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_hero_image_id_media_items_id_fk" FOREIGN KEY ("hero_image_id") REFERENCES "public"."media_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_logo_image_id_media_items_id_fk" FOREIGN KEY ("logo_image_id") REFERENCES "public"."media_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_hero_image_id_media_items_id_fk" FOREIGN KEY ("hero_image_id") REFERENCES "public"."media_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_logo_image_id_media_items_id_fk" FOREIGN KEY ("logo_image_id") REFERENCES "public"."media_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_brochure_pdf_id_media_items_id_fk" FOREIGN KEY ("brochure_pdf_id") REFERENCES "public"."media_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "communities_status_idx" ON "communities" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_community_slug_idx" ON "projects" USING btree ("community_id","slug");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "projects_community_id_idx" ON "projects" USING btree ("community_id");--> statement-breakpoint
ALTER TABLE "ai_units" ADD CONSTRAINT "ai_units_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_units" ADD CONSTRAINT "ai_units_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_units_project_id_idx" ON "ai_units" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ai_units_community_id_idx" ON "ai_units" USING btree ("community_id");