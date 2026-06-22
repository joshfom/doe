CREATE TABLE "prospecting_batch_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"action" text NOT NULL,
	"reason" text,
	"target_id" uuid,
	"payload" jsonb,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospecting_batch_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_rep" uuid NOT NULL,
	"subject" jsonb NOT NULL,
	"cluster_id" text,
	"target_count" integer NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"rerun_key" text NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospecting_queue_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_run_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"draft_id" uuid,
	"eligibility" text NOT NULL,
	"skip_reason" text,
	"fit_score" numeric,
	"fit_rationale" jsonb,
	"lawful_basis" text,
	"data_source" text,
	"acquired_at" timestamp,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospecting_send_counters" (
	"scope_kind" text NOT NULL,
	"scope_id" text NOT NULL,
	"period_bucket" text NOT NULL,
	"consumed" integer DEFAULT 0 NOT NULL,
	"cap" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "prospecting_send_counters_pk" PRIMARY KEY("scope_kind","scope_id","period_bucket")
);
--> statement-breakpoint
CREATE TABLE "prospecting_send_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"scope_kind" text NOT NULL,
	"scope_id" text NOT NULL,
	"period_bucket" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospecting_target_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_kind" text NOT NULL,
	"match_value" text NOT NULL,
	"owner_rep" uuid NOT NULL,
	"batch_run_id" uuid,
	"queue_item_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outreach_drafts" ADD COLUMN "ai_original_subject" text;--> statement-breakpoint
ALTER TABLE "outreach_drafts" ADD COLUMN "ai_original_body" text;--> statement-breakpoint
ALTER TABLE "prospecting_batch_activity" ADD CONSTRAINT "prospecting_batch_activity_batch_run_id_prospecting_batch_runs_id_fk" FOREIGN KEY ("batch_run_id") REFERENCES "public"."prospecting_batch_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospecting_batch_runs" ADD CONSTRAINT "prospecting_batch_runs_owner_rep_users_id_fk" FOREIGN KEY ("owner_rep") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospecting_queue_items" ADD CONSTRAINT "prospecting_queue_items_batch_run_id_prospecting_batch_runs_id_fk" FOREIGN KEY ("batch_run_id") REFERENCES "public"."prospecting_batch_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospecting_queue_items" ADD CONSTRAINT "prospecting_queue_items_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospecting_queue_items" ADD CONSTRAINT "prospecting_queue_items_draft_id_outreach_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."outreach_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospecting_send_ledger" ADD CONSTRAINT "prospecting_send_ledger_draft_id_outreach_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."outreach_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospecting_target_claims" ADD CONSTRAINT "prospecting_target_claims_owner_rep_users_id_fk" FOREIGN KEY ("owner_rep") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospecting_target_claims" ADD CONSTRAINT "prospecting_target_claims_batch_run_id_prospecting_batch_runs_id_fk" FOREIGN KEY ("batch_run_id") REFERENCES "public"."prospecting_batch_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospecting_target_claims" ADD CONSTRAINT "prospecting_target_claims_queue_item_id_prospecting_queue_items_id_fk" FOREIGN KEY ("queue_item_id") REFERENCES "public"."prospecting_queue_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prospecting_batch_activity_run_seq_idx" ON "prospecting_batch_activity" USING btree ("batch_run_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "prospecting_batch_runs_rerun_key_ux" ON "prospecting_batch_runs" USING btree ("rerun_key");--> statement-breakpoint
CREATE INDEX "prospecting_batch_runs_owner_idx" ON "prospecting_batch_runs" USING btree ("owner_rep");--> statement-breakpoint
CREATE UNIQUE INDEX "prospecting_queue_items_run_target_ux" ON "prospecting_queue_items" USING btree ("batch_run_id","target_id");--> statement-breakpoint
CREATE INDEX "prospecting_queue_items_run_idx" ON "prospecting_queue_items" USING btree ("batch_run_id");--> statement-breakpoint
CREATE INDEX "prospecting_queue_items_status_idx" ON "prospecting_queue_items" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "prospecting_send_ledger_draft_scope_ux" ON "prospecting_send_ledger" USING btree ("draft_id","scope_kind");--> statement-breakpoint
CREATE UNIQUE INDEX "prospecting_target_claims_match_ux" ON "prospecting_target_claims" USING btree ("match_kind","match_value");