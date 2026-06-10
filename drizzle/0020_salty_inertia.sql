ALTER TABLE "form_submissions" ADD COLUMN "first_touch_attribution" jsonb;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD COLUMN "last_touch_attribution" jsonb;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "first_touch_attribution" jsonb;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "last_touch_attribution" jsonb;