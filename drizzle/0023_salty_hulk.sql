CREATE TABLE "custom_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "custom_events_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "custom_events" ADD CONSTRAINT "custom_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_events_name_idx" ON "custom_events" USING btree ("name");--> statement-breakpoint
CREATE INDEX "custom_events_active_idx" ON "custom_events" USING btree ("is_active");