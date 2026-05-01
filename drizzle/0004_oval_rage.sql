CREATE TABLE "approval_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_module" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_config_approvers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"config_id" uuid NOT NULL,
	"user_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"approver_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_id" text NOT NULL,
	"content_module" text NOT NULL,
	"submitter_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "approval_config_approvers" ADD CONSTRAINT "approval_config_approvers_config_id_approval_config_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."approval_config"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_config_approvers" ADD CONSTRAINT "approval_config_approvers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_request_id_approval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_submitter_id_users_id_fk" FOREIGN KEY ("submitter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_config_module_idx" ON "approval_config" USING btree ("content_module");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_config_approvers_unique_idx" ON "approval_config_approvers" USING btree ("config_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_decisions_unique_idx" ON "approval_decisions" USING btree ("request_id","approver_id");--> statement-breakpoint
CREATE INDEX "approval_decisions_request_idx" ON "approval_decisions" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "approval_requests_content_idx" ON "approval_requests" USING btree ("content_id","content_module");--> statement-breakpoint
CREATE INDEX "approval_requests_status_idx" ON "approval_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "approval_requests_submitter_idx" ON "approval_requests" USING btree ("submitter_id");