CREATE TABLE "menu_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"menu_id" uuid NOT NULL,
	"parent_id" uuid,
	"label" text NOT NULL,
	"url" text DEFAULT '#' NOT NULL,
	"icon" text,
	"item_type" text DEFAULT 'link' NOT NULL,
	"dropdown_type" text,
	"mega_columns" integer DEFAULT 3 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "menus_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "menu_items_menu_id_idx" ON "menu_items" USING btree ("menu_id");--> statement-breakpoint
CREATE INDEX "menu_items_parent_id_idx" ON "menu_items" USING btree ("parent_id");