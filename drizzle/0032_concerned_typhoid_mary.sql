CREATE TABLE "admin_confirmations" (
	"token" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"args" jsonb NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_migration_flags" (
	"capability" text PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'deterministic' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"proven" boolean DEFAULT false NOT NULL,
	"last_divergence_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_confirmations" ADD CONSTRAINT "admin_confirmations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_confirmations_user_idx" ON "admin_confirmations" USING btree ("user_id");