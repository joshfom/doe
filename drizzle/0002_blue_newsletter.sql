CREATE TABLE "newsletter_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"locale" text,
	"source_path" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_subscriptions_email_idx" ON "newsletter_subscriptions" USING btree ("email");
--> statement-breakpoint
CREATE INDEX "newsletter_subscriptions_created_at_idx" ON "newsletter_subscriptions" USING btree ("created_at");
