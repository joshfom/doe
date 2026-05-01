CREATE TABLE "otp_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"otp_hash" text NOT NULL,
	"email" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"verified_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD COLUMN "otp_verification_state" text DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
ALTER TABLE "otp_records" ADD CONSTRAINT "otp_records_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "otp_records_conversation_status_idx" ON "otp_records" USING btree ("conversation_id","status");