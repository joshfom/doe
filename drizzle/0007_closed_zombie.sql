CREATE TABLE "crm_sync_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"action" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"external_ref_id" text,
	"error_message" text,
	"request_payload" jsonb,
	"response_payload" jsonb,
	"attempted_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "ticket_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "ticket_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"content" text NOT NULL,
	"is_internal" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_number" text NOT NULL,
	"subject" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"category" text,
	"contact_name" text NOT NULL,
	"contact_email" text NOT NULL,
	"contact_phone" text,
	"source" text NOT NULL,
	"assignee_id" uuid,
	"created_by" uuid,
	"external_crm_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"closed_at" timestamp,
	CONSTRAINT "tickets_ticket_number_unique" UNIQUE("ticket_number")
);
--> statement-breakpoint
ALTER TABLE "crm_sync_log" ADD CONSTRAINT "crm_sync_log_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_notes" ADD CONSTRAINT "ticket_notes_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_notes" ADD CONSTRAINT "ticket_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_sync_log_ticket_id_idx" ON "crm_sync_log" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "crm_sync_log_status_idx" ON "crm_sync_log" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ticket_notes_ticket_id_idx" ON "ticket_notes" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "tickets_status_idx" ON "tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tickets_assignee_id_idx" ON "tickets" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "tickets_category_idx" ON "tickets" USING btree ("category");--> statement-breakpoint
CREATE INDEX "tickets_created_at_idx" ON "tickets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "tickets_contact_email_idx" ON "tickets" USING btree ("contact_email");