ALTER TABLE "posts" ADD COLUMN "featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "utm_links" ADD COLUMN "total_hits" integer DEFAULT 0 NOT NULL;