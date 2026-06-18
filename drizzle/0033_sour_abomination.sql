CREATE TABLE "briefing_cache" (
	"user_id" text NOT NULL,
	"window" text NOT NULL,
	"period_date" date NOT NULL,
	"briefing" jsonb NOT NULL,
	"assembled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "briefing_cache_user_id_window_period_date_pk" PRIMARY KEY("user_id","window","period_date")
);
--> statement-breakpoint
CREATE TABLE "inbound_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"name" text,
	"email" text,
	"phone_hash" text,
	"raw_phone" text,
	"content" text DEFAULT '' NOT NULL,
	"raw_payload" jsonb,
	"attribution" jsonb,
	"structured" jsonb,
	"party_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_sync_log" ALTER COLUMN "ticket_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_notes" ALTER COLUMN "ticket_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_notes" ALTER COLUMN "author_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_notes" ADD COLUMN "actor_type" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_notes" ADD COLUMN "lead_party_id" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "lead_party_id" uuid;--> statement-breakpoint
ALTER TABLE "inbound_leads" ADD CONSTRAINT "inbound_leads_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "briefing_cache_user_period_idx" ON "briefing_cache" USING btree ("user_id","period_date");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_leads_idempotency_key_ux" ON "inbound_leads" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "inbound_leads_status_idx" ON "inbound_leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "inbound_leads_party_id_idx" ON "inbound_leads" USING btree ("party_id");--> statement-breakpoint
ALTER TABLE "ticket_notes" ADD CONSTRAINT "ticket_notes_lead_party_id_parties_id_fk" FOREIGN KEY ("lead_party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_lead_party_id_parties_id_fk" FOREIGN KEY ("lead_party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_sync_log_external_ref_idx" ON "crm_sync_log" USING btree ("external_ref_id");--> statement-breakpoint
CREATE INDEX "ticket_notes_lead_party_id_idx" ON "ticket_notes" USING btree ("lead_party_id");--> statement-breakpoint
CREATE INDEX "tickets_lead_party_id_idx" ON "tickets" USING btree ("lead_party_id");--> statement-breakpoint
ALTER TABLE "ticket_notes" ADD CONSTRAINT "ticket_notes_assoc_chk" CHECK ("ticket_notes"."ticket_id" IS NOT NULL OR "ticket_notes"."lead_party_id" IS NOT NULL);