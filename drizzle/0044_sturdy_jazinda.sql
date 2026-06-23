CREATE TABLE "prospecting_sequence_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence_id" uuid NOT NULL,
	"match_kind" text NOT NULL,
	"match_value" text NOT NULL,
	"target_id" uuid NOT NULL,
	"batch_run_id" uuid NOT NULL,
	"period_bucket" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "prospecting_sequences" ADD COLUMN "status" text DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE "prospecting_sequences" ADD COLUMN "refresh_interval_minutes" integer DEFAULT 1440;--> statement-breakpoint
ALTER TABLE "prospecting_sequences" ADD COLUMN "last_refreshed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prospecting_sequences" ADD COLUMN "next_refresh_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prospecting_sequences" ADD COLUMN "enrollment_cap" integer DEFAULT 200;--> statement-breakpoint
ALTER TABLE "prospecting_sequences" ADD COLUMN "enrollment_period" text DEFAULT 'month';--> statement-breakpoint
ALTER TABLE "prospecting_sequences" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prospecting_sequence_enrollments" ADD CONSTRAINT "prospecting_sequence_enrollments_sequence_id_prospecting_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."prospecting_sequences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospecting_sequence_enrollments" ADD CONSTRAINT "prospecting_sequence_enrollments_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospecting_sequence_enrollments" ADD CONSTRAINT "prospecting_sequence_enrollments_batch_run_id_prospecting_batch_runs_id_fk" FOREIGN KEY ("batch_run_id") REFERENCES "public"."prospecting_batch_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prospecting_sequence_enrollments_identity_ux" ON "prospecting_sequence_enrollments" USING btree ("sequence_id","match_kind","match_value");--> statement-breakpoint
CREATE INDEX "prospecting_sequence_enrollments_period_idx" ON "prospecting_sequence_enrollments" USING btree ("sequence_id","period_bucket");