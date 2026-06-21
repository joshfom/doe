-- Agentic Prospecting Batch — additive batch/approval/guardrail domain (task 1.1)
--
-- A strictly ADDITIVE increment on the prospecting domain (0038) and the
-- own-project clusters (0039). No existing table, column, enum, or index is
-- changed. Every statement is idempotent (CREATE TABLE / ADD COLUMN /
-- CREATE INDEX ... IF NOT EXISTS) so `scripts/migrate-direct.ts` — which is
-- tolerant of already-exists errors — is safe to re-run.
--
-- New tables:
--   `prospecting_batch_runs`     one autonomous batch job; `rerun_key` UNIQUE
--                                makes a re-run idempotent (Req 1.3, 9.1).
--   `prospecting_queue_items`    one AI-drafted outreach entry awaiting review;
--                                UNIQUE (batch_run_id, target_id) is the re-run
--                                idempotency key for a queue item (Req 2.3, 2.4,
--                                4.5, 9.2, 10.1).
--   `prospecting_target_claims`  cross-rep claim on a privacy-safe identity;
--                                UNIQUE (match_kind, match_value) → a candidate
--                                is claimed by at most one rep (Req 6.2).
--   `prospecting_send_counters`  consumed send count per scope per period;
--                                PK (scope_kind, scope_id, period_bucket),
--                                resets by bucket (Req 7.1, 7.4, 7.5).
--   `prospecting_send_ledger`    exactly-once guard so each scope counts at most
--                                once per send; UNIQUE (draft_id, scope_kind)
--                                keeps rep + cluster increments independent
--                                (Req 7.5, 7.6).
--   `prospecting_batch_activity` persisted Agent_Activity_Log (privacy-safe,
--                                internal ids only) with monotonic `seq` for
--                                ordered retrieval (Req 3.2, 3.3, 3.4).
--
-- Additive nullable columns on existing `outreach_drafts` to retain the AI
-- original after a rep edit (Req 4.2): `ai_original_subject`, `ai_original_body`.
--
-- Enums are stored as plain `text` (matching the prospecting domain in 0038);
-- `events.type` / `JobKind` likewise need no migration. Timestamps use
-- `timestamp DEFAULT now()` to match the repo convention.
--
-- See agentic-prospecting-batch design §Data Models (all new tables + additive
-- columns), Project Conventions (Additive migrations only).
-- Requirements: 1.3, 2.3, 2.4, 4.2, 4.5, 6.2, 7.1, 7.4, 7.5, 7.6, 9.1, 9.2, 10.1.

CREATE TABLE IF NOT EXISTS "prospecting_batch_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_rep" uuid NOT NULL REFERENCES "users"("id"),
  "subject" jsonb NOT NULL,
  "cluster_id" text,
  "target_count" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'running',
  "rerun_key" text NOT NULL,
  "reason" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "prospecting_batch_runs_rerun_key_ux" ON "prospecting_batch_runs" ("rerun_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prospecting_batch_runs_owner_idx" ON "prospecting_batch_runs" ("owner_rep");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prospecting_queue_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "batch_run_id" uuid NOT NULL REFERENCES "prospecting_batch_runs"("id") ON DELETE CASCADE,
  "target_id" uuid NOT NULL REFERENCES "targets"("id"),
  "draft_id" uuid REFERENCES "outreach_drafts"("id") ON DELETE SET NULL,
  "eligibility" text NOT NULL,
  "skip_reason" text,
  "fit_score" numeric,
  "fit_rationale" jsonb,
  "lawful_basis" text,
  "data_source" text,
  "acquired_at" timestamp,
  "status" text NOT NULL DEFAULT 'pending',
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "prospecting_queue_items_run_target_ux" ON "prospecting_queue_items" ("batch_run_id", "target_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prospecting_queue_items_run_idx" ON "prospecting_queue_items" ("batch_run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prospecting_queue_items_status_idx" ON "prospecting_queue_items" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prospecting_target_claims" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "match_kind" text NOT NULL,
  "match_value" text NOT NULL,
  "owner_rep" uuid NOT NULL REFERENCES "users"("id"),
  "batch_run_id" uuid REFERENCES "prospecting_batch_runs"("id") ON DELETE CASCADE,
  "queue_item_id" uuid REFERENCES "prospecting_queue_items"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "prospecting_target_claims_match_ux" ON "prospecting_target_claims" ("match_kind", "match_value");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prospecting_send_counters" (
  "scope_kind" text NOT NULL,
  "scope_id" text NOT NULL,
  "period_bucket" text NOT NULL,
  "consumed" integer NOT NULL DEFAULT 0,
  "cap" integer,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "prospecting_send_counters_pk" PRIMARY KEY ("scope_kind", "scope_id", "period_bucket")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prospecting_send_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "draft_id" uuid NOT NULL REFERENCES "outreach_drafts"("id") ON DELETE CASCADE,
  "scope_kind" text NOT NULL,
  "scope_id" text NOT NULL,
  "period_bucket" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "prospecting_send_ledger_draft_scope_ux" ON "prospecting_send_ledger" ("draft_id", "scope_kind");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prospecting_batch_activity" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "batch_run_id" uuid NOT NULL REFERENCES "prospecting_batch_runs"("id") ON DELETE CASCADE,
  "seq" integer NOT NULL,
  "action" text NOT NULL,
  "reason" text,
  "target_id" uuid,
  "payload" jsonb,
  "at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prospecting_batch_activity_run_seq_idx" ON "prospecting_batch_activity" ("batch_run_id", "seq");
--> statement-breakpoint
-- Additive nullable columns on existing outreach_drafts to retain the AI
-- original after a rep edit (Req 4.2). No other existing column changes.
ALTER TABLE "outreach_drafts" ADD COLUMN IF NOT EXISTS "ai_original_subject" text;
--> statement-breakpoint
ALTER TABLE "outreach_drafts" ADD COLUMN IF NOT EXISTS "ai_original_body" text;
