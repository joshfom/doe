-- Prospecting Sequences — additive lifecycle / cadence / enrollment domain (task 1.1)
--
-- A strictly ADDITIVE increment on the prospecting domain (0038), the agentic
-- batch domain (0040), and the one-shot sequences table (0041). No existing
-- table, column, enum, or index semantics is changed. Every statement is
-- idempotent (ADD COLUMN / CREATE TABLE / CREATE INDEX ... IF NOT EXISTS) so
-- `scripts/migrate-direct.ts` — which tolerates already-exists errors — is safe
-- to re-run.
--
-- Additive nullable columns on existing `prospecting_sequences` (lib/cms/schema.ts):
--   `status`                   lifecycle source of truth, text enum
--                              draft|live|paused|archived, default 'draft'
--                              (Req 1.1). Backfilled from `mode` in task 9.1.
--   `refresh_interval_minutes` Refresh_Frequency as minutes, default 1440
--                              (daily); hourly=60, weekly=10080 (Req 4.5).
--   `last_refreshed_at`        set on each completed Refresh_Run (Req 4.4);
--                              null ⇒ never refreshed (Req 6.5).
--   `next_refresh_at`          the next scheduled slot; advanced atomically by
--                              the sweep (Req 4.5). null while draft/archived.
--   `enrollment_cap`           max enrollments per period, default 200;
--                              null ⇒ unbounded (Req 11.1).
--   `enrollment_period`        cap reset period, text enum day|week|month,
--                              default 'month' (Req 11.3).
--   `archived_at`              stamped on archive.
--
-- New table `prospecting_sequence_enrollments`: the per-Sequence enrollment
-- ledger. Its rows are simultaneously the enrollment-at-most-once guard AND the
-- enrollment-cap counter. UNIQUE (sequence_id, match_kind, match_value) enrolls
-- a prospect in a given Sequence at most once across all its refreshes
-- (Req 5.1, 5.2); the ON CONFLICT DO NOTHING insert is what makes a retried
-- refresh idempotent (Req 5.3) and increments the period count exactly once per
-- enrollment (Req 11.4). Index (sequence_id, period_bucket) backs the fast cap
-- count (Req 11.3).
--
-- Enums are stored as plain `text` (matching the prospecting domain in 0038 and
-- the one-shot `mode` column in 0041); no DB enum type is created.
--
-- This migration is DDL only. The backfill of existing one-shot rows is appended
-- in task 9.1.
--
-- See prospecting-sequences design §Data Models (changed table + new table),
-- Project Conventions (Additive migration only).
-- Requirements: 1.1, 3.1, 4.4, 4.5, 5.1, 5.2, 11.1, 11.3.

ALTER TABLE "prospecting_sequences" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'draft';
--> statement-breakpoint
ALTER TABLE "prospecting_sequences" ADD COLUMN IF NOT EXISTS "refresh_interval_minutes" integer DEFAULT 1440;
--> statement-breakpoint
ALTER TABLE "prospecting_sequences" ADD COLUMN IF NOT EXISTS "last_refreshed_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "prospecting_sequences" ADD COLUMN IF NOT EXISTS "next_refresh_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "prospecting_sequences" ADD COLUMN IF NOT EXISTS "enrollment_cap" integer DEFAULT 200;
--> statement-breakpoint
ALTER TABLE "prospecting_sequences" ADD COLUMN IF NOT EXISTS "enrollment_period" text DEFAULT 'month';
--> statement-breakpoint
ALTER TABLE "prospecting_sequences" ADD COLUMN IF NOT EXISTS "archived_at" timestamptz;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prospecting_sequence_enrollments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sequence_id" uuid NOT NULL REFERENCES "prospecting_sequences"("id") ON DELETE CASCADE,
  "match_kind" text NOT NULL,
  "match_value" text NOT NULL,
  "target_id" uuid NOT NULL REFERENCES "targets"("id"),
  "batch_run_id" uuid NOT NULL REFERENCES "prospecting_batch_runs"("id") ON DELETE CASCADE,
  "period_bucket" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "prospecting_sequence_enrollments_seq_match_ux" ON "prospecting_sequence_enrollments" ("sequence_id", "match_kind", "match_value");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prospecting_sequence_enrollments_seq_period_idx" ON "prospecting_sequence_enrollments" ("sequence_id", "period_bucket");
--> statement-breakpoint

-- ── Backfill of existing one-shot sequence rows (task 9.1) ───────────────────
--
-- Migrate legacy one-shot `prospecting_sequences` rows (created before the
-- lifecycle/cadence domain) onto the new model. Strictly additive — it only
-- fills the new columns; it never touches `target_count` (preserved verbatim as
-- the per-refresh batch size — there is no fixed-N campaign-total stop) and never
-- changes any other table. Every statement is idempotent / re-runnable so
-- `scripts/migrate-direct.ts` (tolerant of re-runs) is safe.
--
-- See prospecting-sequences design §Data Models (Migration of existing one-shot
-- rows), Decisions 7. Requirements: 3.1, 4.1.

-- Backfill `status` from the legacy `mode` toggle (draft→draft, live→live).
-- Guarded on the just-defaulted `status = 'draft'` so a row already advanced by
-- the new lifecycle (paused / archived) is NEVER clobbered on a re-run, and a
-- legacy `live` row is promoted exactly once.
UPDATE "prospecting_sequences" SET "status" = 'live' WHERE "mode" = 'live' AND "status" = 'draft';
--> statement-breakpoint
-- Apply the cadence / cap defaults to any row that predates the columns (a no-op
-- once set — `ADD COLUMN ... DEFAULT` already backfills, but COALESCE keeps the
-- statement safe and explicit).
UPDATE "prospecting_sequences" SET
  "refresh_interval_minutes" = COALESCE("refresh_interval_minutes", 1440),
  "enrollment_cap" = COALESCE("enrollment_cap", 200),
  "enrollment_period" = COALESCE("enrollment_period", 'month');
--> statement-breakpoint
-- Schedule the first refresh for rows that are already `live`; leave every other
-- status unscheduled. Idempotent: only sets a still-null slot.
UPDATE "prospecting_sequences" SET "next_refresh_at" = now() WHERE "status" = 'live' AND "next_refresh_at" IS NULL;

