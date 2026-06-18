CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"job_key" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"payload" jsonb,
	"plan" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"party_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_job_key_unique" UNIQUE("job_key")
);
--> statement-breakpoint
CREATE TABLE "leads_mirror" (
	"party_id" uuid PRIMARY KEY NOT NULL,
	"sf_lead_id" text,
	"stage" text,
	"tier" text,
	"score_reason" text,
	"project_interest" text,
	"unit_interest" text,
	"budget_band" text,
	"source" text,
	"campaign" text,
	"assigned_rep_id" uuid,
	"last_interaction_at" timestamp,
	"last_interaction_summary" text,
	"sla_due_at" timestamp,
	"demo" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text DEFAULT 'person' NOT NULL,
	"name" text,
	"language" text DEFAULT 'en',
	"client_id" uuid,
	"tenant_id" uuid,
	"consent_at" timestamp,
	"demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "party_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"party_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"verified_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "report_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_email" text NOT NULL,
	"scope" text NOT NULL,
	"period" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"message_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"languages" text[],
	"projects" text[],
	"capacity" integer DEFAULT 3 NOT NULL,
	"open_hot_count" integer DEFAULT 0 NOT NULL,
	"phone" text,
	"teams_id" text,
	"demo" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sf_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"job_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sf_id" text,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sf_outbox_job_key_unique" UNIQUE("job_key")
);
--> statement-breakpoint
CREATE TABLE "viewing_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project" text NOT NULL,
	"starts_at" timestamp NOT NULL,
	"rep_id" uuid,
	"taken" boolean DEFAULT false NOT NULL,
	"demo" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_appointments" ADD COLUMN "rep_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_appointments" ADD COLUMN "slot_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_appointments" ADD COLUMN "sf_event_id" text;--> statement-breakpoint
ALTER TABLE "ai_appointments" ADD COLUMN "project" text;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD COLUMN "sentiment" text;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD COLUMN "party_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "t_ms" integer;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "latency_ms" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads_mirror" ADD CONSTRAINT "leads_mirror_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads_mirror" ADD CONSTRAINT "leads_mirror_assigned_rep_id_reps_id_fk" FOREIGN KEY ("assigned_rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_client_id_ai_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."ai_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_tenant_id_ai_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."ai_tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_identities" ADD CONSTRAINT "party_identities_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewing_slots" ADD CONSTRAINT "viewing_slots_rep_id_reps_id_fk" FOREIGN KEY ("rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_at_idx" ON "events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "party_identities_value_idx" ON "party_identities" USING btree ("kind","value");--> statement-breakpoint
CREATE INDEX "sf_outbox_status_idx" ON "sf_outbox" USING btree ("status");--> statement-breakpoint
CREATE INDEX "viewing_slots_project_idx" ON "viewing_slots" USING btree ("project","starts_at");--> statement-breakpoint
ALTER TABLE "ai_appointments" ADD CONSTRAINT "ai_appointments_rep_id_reps_id_fk" FOREIGN KEY ("rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_appointments" ADD CONSTRAINT "ai_appointments_slot_id_viewing_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."viewing_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;