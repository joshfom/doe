CREATE TABLE "ad_spend_ingestion_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_at" timestamp DEFAULT now() NOT NULL,
	"records_upserted" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"skipped_platforms" text[] DEFAULT '{}',
	"errors" jsonb
);
--> statement-breakpoint
CREATE TABLE "marketing_spend" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"channel" text NOT NULL,
	"campaign_id" text NOT NULL,
	"ad_set_id" text,
	"ad_id" text,
	"spend" numeric(12, 2) NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'AED' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "utm_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"destination_url" text NOT NULL,
	"utm_source" text NOT NULL,
	"utm_medium" text NOT NULL,
	"utm_campaign" text NOT NULL,
	"utm_term" text,
	"utm_content" text,
	"tagged_url" text NOT NULL,
	"project" text,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "utm_links" ADD CONSTRAINT "utm_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_spend_upsert_idx" ON "marketing_spend" USING btree ("date","channel","campaign_id","ad_set_id","ad_id");--> statement-breakpoint
CREATE INDEX "marketing_spend_date_channel_idx" ON "marketing_spend" USING btree ("date","channel");--> statement-breakpoint
CREATE INDEX "utm_links_project_idx" ON "utm_links" USING btree ("project");--> statement-breakpoint
CREATE INDEX "utm_links_created_at_idx" ON "utm_links" USING btree ("created_at");