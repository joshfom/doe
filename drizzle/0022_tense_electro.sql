CREATE TABLE "dsar_deletion_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"posthog_distinct_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"last_error" text,
	"next_retry_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "dsar_deletion_queue_status_idx" ON "dsar_deletion_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dsar_deletion_queue_next_retry_idx" ON "dsar_deletion_queue" USING btree ("next_retry_at");