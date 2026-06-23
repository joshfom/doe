CREATE TABLE "prospecting_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_rep" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"subject" jsonb NOT NULL,
	"target_count" integer DEFAULT 10 NOT NULL,
	"mode" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prospecting_batch_runs" ADD COLUMN "sequence_id" uuid;--> statement-breakpoint
ALTER TABLE "prospecting_sequences" ADD CONSTRAINT "prospecting_sequences_owner_rep_users_id_fk" FOREIGN KEY ("owner_rep") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prospecting_sequences_owner_idx" ON "prospecting_sequences" USING btree ("owner_rep");--> statement-breakpoint
ALTER TABLE "prospecting_batch_runs" ADD CONSTRAINT "prospecting_batch_runs_sequence_id_prospecting_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."prospecting_sequences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prospecting_batch_runs_sequence_idx" ON "prospecting_batch_runs" USING btree ("sequence_id");