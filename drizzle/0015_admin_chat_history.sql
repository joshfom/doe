CREATE TABLE "admin_chat_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text DEFAULT 'New chat' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"pending_action" jsonb,
	"executed" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_chat_sessions" ADD CONSTRAINT "admin_chat_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_chat_messages" ADD CONSTRAINT "admin_chat_messages_session_id_admin_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."admin_chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_chat_sessions_user_id_idx" ON "admin_chat_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "admin_chat_sessions_updated_at_idx" ON "admin_chat_sessions" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "admin_chat_messages_session_id_idx" ON "admin_chat_messages" USING btree ("session_id");
