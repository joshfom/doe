CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "ai_appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference_number" text NOT NULL,
	"conversation_id" uuid,
	"client_id" uuid,
	"tenant_id" uuid,
	"contact_name" text NOT NULL,
	"contact_email" text,
	"contact_phone" text,
	"appointment_type" text NOT NULL,
	"scheduled_date" date NOT NULL,
	"scheduled_time" time NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_appointments_reference_number_unique" UNIQUE("reference_number")
);
--> statement-breakpoint
CREATE TABLE "ai_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text,
	"phone" text,
	"nationality" text,
	"preferred_language" text DEFAULT 'en',
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_config_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_name" text,
	"participant_phone" text,
	"participant_email" text,
	"participant_type" text DEFAULT 'visitor' NOT NULL,
	"client_id" uuid,
	"tenant_id" uuid,
	"channel" text,
	"language" text DEFAULT 'en' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"handoff_summary" jsonb,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text,
	"phone" text,
	"unit_id" uuid,
	"lease_start_date" date,
	"lease_end_date" date,
	"rent_amount" numeric,
	"payment_frequency" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_name" text NOT NULL,
	"unit_number" text NOT NULL,
	"unit_type" text NOT NULL,
	"floor_number" integer,
	"area_sqm" numeric,
	"status" text DEFAULT 'available' NOT NULL,
	"construction_progress" integer,
	"estimated_handover_date" date,
	"client_id" uuid,
	"tenant_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"source_type" text NOT NULL,
	"category" text,
	"locale" text NOT NULL,
	"source_ref_id" text,
	"last_indexed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"embedding" vector(768) NOT NULL,
	"chunk_index" integer NOT NULL,
	"chunk_text" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_appointments" ADD CONSTRAINT "ai_appointments_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_appointments" ADD CONSTRAINT "ai_appointments_client_id_ai_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."ai_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_appointments" ADD CONSTRAINT "ai_appointments_tenant_id_ai_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."ai_tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_client_id_ai_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."ai_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_tenant_id_ai_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."ai_tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tenants" ADD CONSTRAINT "ai_tenants_unit_id_ai_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."ai_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_units" ADD CONSTRAINT "ai_units_client_id_ai_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."ai_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_units" ADD CONSTRAINT "ai_units_tenant_id_ai_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."ai_tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_embeddings" ADD CONSTRAINT "knowledge_embeddings_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_appointments_scheduled_date_idx" ON "ai_appointments" USING btree ("scheduled_date");--> statement-breakpoint
CREATE INDEX "ai_appointments_status_idx" ON "ai_appointments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ai_clients_phone_idx" ON "ai_clients" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "ai_clients_email_idx" ON "ai_clients" USING btree ("email");--> statement-breakpoint
CREATE INDEX "ai_conversations_status_idx" ON "ai_conversations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ai_messages_conversation_id_idx" ON "ai_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "ai_tenants_phone_idx" ON "ai_tenants" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "ai_tenants_email_idx" ON "ai_tenants" USING btree ("email");--> statement-breakpoint
CREATE INDEX "ai_units_status_idx" ON "ai_units" USING btree ("status");--> statement-breakpoint
CREATE INDEX "knowledge_documents_source_type_idx" ON "knowledge_documents" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX "knowledge_documents_locale_idx" ON "knowledge_documents" USING btree ("locale");