CREATE TABLE "ticket_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp,
	"decision_comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket_approvals" ADD CONSTRAINT "ticket_approvals_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_approvals" ADD CONSTRAINT "ticket_approvals_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_approvals" ADD CONSTRAINT "ticket_approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_approvals_ticket_scope_idx" ON "ticket_approvals" USING btree ("ticket_id","scope");--> statement-breakpoint
CREATE INDEX "ticket_approvals_status_idx" ON "ticket_approvals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ticket_approvals_scope_idx" ON "ticket_approvals" USING btree ("scope");