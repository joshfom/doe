ALTER TABLE "tickets" ADD COLUMN "request_type" text DEFAULT 'general_inquiry' NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "community_id" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "unit_number" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "request_data" jsonb;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "scheduled_start" timestamp;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "scheduled_end" timestamp;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tickets_request_type_idx" ON "tickets" USING btree ("request_type");--> statement-breakpoint
CREATE INDEX "tickets_community_id_idx" ON "tickets" USING btree ("community_id");--> statement-breakpoint
CREATE INDEX "tickets_project_id_idx" ON "tickets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tickets_scheduled_start_idx" ON "tickets" USING btree ("scheduled_start");