-- Prospecting Workspace (S7) — prospecting domain (task 2.1)
--
-- The outbound prospecting domain that sits on top of the market catalog
-- (0037): a Prospecting_Brief (what the rep wants to sell), the canonical Target
-- object, editable grounded OutreachDrafts, and a do-not-contact opt-out store.
--
-- Target separation (Req 1.4 / Decision 3): a Target is a pre-qualification
-- record, NOT a `tickets` row and NOT a Lead until explicitly promoted (Req 5).
-- `party_id` is set on promotion (FK → parties), nullable until then.
--
-- Privacy (CC-Privacy / Req 1.5, 9.2): a Target's phone is persisted ONLY as a
-- salted `phone_hash`; `raw_phone` is a transient Salesforce-ingress copy purged
-- ≤24h after forwarding to the outbox.
--
-- Provenance (CC-Provenance / Req 1.3, 9.1): every Target carries record-level
-- `source_provider` + `lawful_basis`, plus a per-field `attributes` provenance
-- map (Record<field, {value, source, as_of, lawful_basis}>).
--
-- Grounding (CC-SQL / Req 6.2): an outreach_draft carries a `grounding` manifest
-- pinning every factual claim to a SQL source record.
--
-- Idempotency (CC-Idem / Req 7.2, 8.2): a unique `job_key` on outreach_drafts
-- keeps a send at-most-once across retries. The opt-out store is uniquely keyed
-- on (match_kind, match_value) so a do-not-contact entry is recorded once.
--
-- Defaults: targets.status defaults to 'new'; outreach_drafts.status to 'draft'.
--
-- See prospecting-workspace design §Data Models (Prospecting domain).
-- Requirements: 1.2, 1.3, 1.5, 7.3.

CREATE TABLE "prospecting_briefs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL,
  "ai_unit_id" uuid REFERENCES "ai_units"("id") ON DELETE SET NULL,
  "spec" jsonb NOT NULL,
  "buyer_hypothesis" jsonb,
  "status" text NOT NULL DEFAULT 'draft',
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "targets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "brief_id" uuid REFERENCES "prospecting_briefs"("id") ON DELETE SET NULL,
  "target_type" text NOT NULL,
  "display_name" text,
  "company_name" text,
  "title" text,
  "email" text,
  "phone_hash" text,
  "raw_phone" text,
  "country" text,
  "attributes" jsonb,
  "source_provider" text NOT NULL,
  "source_ref" text,
  "lawful_basis" text NOT NULL,
  "status" text NOT NULL DEFAULT 'new',
  "party_id" uuid REFERENCES "parties"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_drafts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "target_id" uuid NOT NULL REFERENCES "targets"("id") ON DELETE CASCADE,
  "brief_id" uuid REFERENCES "prospecting_briefs"("id") ON DELETE SET NULL,
  "channel" text NOT NULL,
  "language" text NOT NULL,
  "subject" text,
  "body" text NOT NULL,
  "grounding" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "approved_by" uuid REFERENCES "users"("id"),
  "job_key" text,
  "sent_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospect_optouts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "match_kind" text NOT NULL,
  "match_value" text NOT NULL,
  "reason" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "targets_brief_idx" ON "targets" ("brief_id");
--> statement-breakpoint
CREATE INDEX "targets_party_idx" ON "targets" ("party_id");
--> statement-breakpoint
CREATE INDEX "targets_status_idx" ON "targets" ("status");
--> statement-breakpoint
CREATE INDEX "outreach_drafts_target_idx" ON "outreach_drafts" ("target_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_drafts_job_key_ux" ON "outreach_drafts" ("job_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "prospect_optouts_match_ux" ON "prospect_optouts" ("match_kind", "match_value");
