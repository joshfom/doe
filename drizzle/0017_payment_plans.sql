ALTER TABLE "ai_units" ADD COLUMN "cluster" text;--> statement-breakpoint
ALTER TABLE "ai_units" ADD COLUMN "purchase_price" numeric;--> statement-breakpoint
CREATE TABLE "ai_unit_payment_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"plan_name" text NOT NULL,
	"total_price" numeric NOT NULL,
	"booking_date" date NOT NULL,
	"expected_handover_date" date,
	"down_payment_pct" integer DEFAULT 10 NOT NULL,
	"second_payment_pct" integer DEFAULT 10 NOT NULL,
	"handover_pct" integer DEFAULT 40 NOT NULL,
	"post_handover_pct" integer DEFAULT 40 NOT NULL,
	"post_handover_months" integer DEFAULT 36 NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_unit_installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"installment_number" integer NOT NULL,
	"label_en" text NOT NULL,
	"label_ar" text,
	"due_date" date NOT NULL,
	"amount_aed" numeric NOT NULL,
	"status" text DEFAULT 'upcoming' NOT NULL,
	"paid_at" timestamp,
	"payment_reference" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_unit_payment_plans" ADD CONSTRAINT "ai_unit_payment_plans_client_id_ai_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."ai_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_unit_payment_plans" ADD CONSTRAINT "ai_unit_payment_plans_unit_id_ai_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."ai_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_unit_installments" ADD CONSTRAINT "ai_unit_installments_plan_id_ai_unit_payment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."ai_unit_payment_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_unit_payment_plans_client_id_idx" ON "ai_unit_payment_plans" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "ai_unit_payment_plans_unit_id_idx" ON "ai_unit_payment_plans" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "ai_unit_installments_plan_id_idx" ON "ai_unit_installments" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "ai_unit_installments_due_date_idx" ON "ai_unit_installments" USING btree ("due_date");
