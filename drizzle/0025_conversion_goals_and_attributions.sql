CREATE TABLE "conversion_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_name" text NOT NULL,
	"display_label" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "conversion_goals_event_name_unique" UNIQUE("event_name")
);
--> statement-breakpoint
ALTER TABLE "form_submissions" ADD COLUMN "conversion_attributions" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
CREATE INDEX "conversion_goals_active_idx" ON "conversion_goals" USING btree ("is_active");