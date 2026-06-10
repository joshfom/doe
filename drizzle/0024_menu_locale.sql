ALTER TABLE "menus" ADD COLUMN "locale" text NOT NULL DEFAULT 'en';
ALTER TABLE "menu_items" ADD COLUMN "translations" jsonb;
