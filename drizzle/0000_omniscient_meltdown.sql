CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"summary" text NOT NULL,
	"changes" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"parent_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "component_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"scope" text DEFAULT 'block' NOT NULL,
	"thumbnail" text,
	"content" jsonb NOT NULL,
	"zones" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_built_in" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"fields" jsonb NOT NULL,
	"salesforce_endpoint" text,
	"webhook_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"source_page_slug" text,
	"source_locale" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"alt_text" text DEFAULT '',
	"mime_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"width" integer,
	"height" integer,
	"storage_url" text NOT NULL,
	"storage_backend" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"component_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"locale" text NOT NULL,
	"namespace" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"data" jsonb NOT NULL,
	"meta_title" text,
	"meta_description" text,
	"meta_keywords" text,
	"og_image" text,
	"canonical_url" text,
	"robots_directive" text DEFAULT 'index, follow',
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"category_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"title_snapshot" text NOT NULL,
	"slug_snapshot" text NOT NULL,
	"action" text DEFAULT 'save' NOT NULL,
	"revision_number" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"locale" text NOT NULL,
	"namespace" uuid NOT NULL,
	"post_type" text DEFAULT 'blog' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"content" jsonb,
	"excerpt" text,
	"featured_image" text,
	"meta_title" text,
	"meta_description" text,
	"meta_keywords" text,
	"og_image" text,
	"canonical_url" text,
	"robots_directive" text DEFAULT 'index, follow',
	"author_id" uuid NOT NULL,
	"published_at" timestamp,
	"trashed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"title_snapshot" text NOT NULL,
	"slug_snapshot" text NOT NULL,
	"action" text DEFAULT 'save' NOT NULL,
	"revision_number" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "site_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" text DEFAULT '' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "site_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_templates" ADD CONSTRAINT "component_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_id_form_definitions_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."form_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_references" ADD CONSTRAINT "media_references_media_id_media_items_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_references" ADD CONSTRAINT "media_references_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_categories" ADD CONSTRAINT "post_categories_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_categories" ADD CONSTRAINT "post_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_revisions" ADD CONSTRAINT "post_revisions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_revisions" ADD CONSTRAINT "post_revisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_shares" ADD CONSTRAINT "post_shares_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_views" ADD CONSTRAINT "post_views_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_entity_type_idx" ON "audit_log" USING btree ("entity_type");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_user_id_idx" ON "audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_name_idx" ON "categories" USING btree ("name");--> statement-breakpoint
CREATE INDEX "component_templates_scope_idx" ON "component_templates" USING btree ("scope");--> statement-breakpoint
CREATE INDEX "media_refs_media_id_idx" ON "media_references" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "media_refs_page_id_idx" ON "media_references" USING btree ("page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pages_slug_locale_idx" ON "pages" USING btree ("slug","locale");--> statement-breakpoint
CREATE INDEX "pages_namespace_idx" ON "pages" USING btree ("namespace");--> statement-breakpoint
CREATE INDEX "pages_status_idx" ON "pages" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "post_categories_unique_idx" ON "post_categories" USING btree ("post_id","category_id");--> statement-breakpoint
CREATE INDEX "post_revisions_post_id_idx" ON "post_revisions" USING btree ("post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_shares_unique_idx" ON "post_shares" USING btree ("post_id","platform");--> statement-breakpoint
CREATE UNIQUE INDEX "post_tags_unique_idx" ON "post_tags" USING btree ("post_id","tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "posts_slug_locale_idx" ON "posts" USING btree ("slug","locale");--> statement-breakpoint
CREATE INDEX "posts_namespace_idx" ON "posts" USING btree ("namespace");--> statement-breakpoint
CREATE INDEX "posts_status_idx" ON "posts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "posts_post_type_idx" ON "posts" USING btree ("post_type");--> statement-breakpoint
CREATE INDEX "revisions_page_id_idx" ON "revisions" USING btree ("page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_name_idx" ON "tags" USING btree ("name");