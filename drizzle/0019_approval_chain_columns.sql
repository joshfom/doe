-- Add the sequential approval chain columns that were defined in
-- lib/cms/schema.ts but never had a generated migration. Without this
-- migration, production hits "column does not exist" errors on every
-- query that touches approval_requests / approval_decisions
-- (e.g. GET /api/pages/:id → 500, POST /api/pages/:id/clone-locale → 400).
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "current_step" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD COLUMN IF NOT EXISTS "chain_step" integer;--> statement-breakpoint
DROP INDEX IF EXISTS "approval_decisions_unique_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "approval_decisions_unique_idx" ON "approval_decisions" USING btree ("request_id","approver_id","chain_step");
