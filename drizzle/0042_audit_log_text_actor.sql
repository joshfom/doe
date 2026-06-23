-- Audit log: allow non-UUID actor ids (agent/system principals).
--
-- `audit_log.user_id` was a `uuid NOT NULL` with an FK to `users.id`. Agent and
-- system dispatches audit under string actor ids (e.g. "agent:prospecting",
-- "agent:outreach", "rep:outreach") that are neither UUIDs nor `users` rows, so
-- every such insert failed the FK/type check and was swallowed as a non-fatal
-- error — flooding the logs and losing the agent audit trail. Relax the column
-- to `text` and drop the FK so any actor id is recorded faithfully. Existing
-- UUID values are preserved verbatim (cast to their text form).
ALTER TABLE "audit_log" DROP CONSTRAINT IF EXISTS "audit_log_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "user_id" SET DATA TYPE text USING "user_id"::text;
