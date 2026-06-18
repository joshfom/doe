-- Lead Engine (S3) — inbound_leads durable intake ledger (task 1.1)
--
-- The Lead-Engine records every Inbound_Lead in this table BEFORE any parsing
-- is attempted, so no inbound lead is ever dropped (P-NoDrop). The `status`
-- column is the parsed-or-queued state machine — every recorded row sits in
-- exactly one of {received, parsed, queued, failed} (Req 3.1, 3.7).
--
-- `idempotency_key` is unique so at most one row exists per source-payload
-- identity; a second record with the same key is acknowledged against the
-- first via ON CONFLICT (idempotency_key) DO NOTHING (Req 3.2, 3.3, CC-Idem).
--
-- Privacy (CC-Privacy / Req 13): a phone is stored only as the salted
-- `phone_hash`; `raw_phone` is a transient Salesforce-ingress copy used solely
-- to populate the SF-bound outbox payload and purged ≤24h after forwarding.
-- `raw_payload` is retained verbatim for retry / human review (Req 1.3, 2.3).
-- `party_id` is set after dedupe resolution; ON DELETE SET NULL preserves the
-- intake row if its resolved Party is removed.
--
-- See lead-engine design §Data Models (inbound_leads). Requirements: 3.1, 3.2, 3.3, 3.7.
CREATE TABLE "inbound_leads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "status" text NOT NULL DEFAULT 'received',
  "name" text,
  "email" text,
  "phone_hash" text,
  "raw_phone" text,
  "content" text NOT NULL DEFAULT '',
  "raw_payload" jsonb,
  "attribution" jsonb,
  "structured" jsonb,
  "party_id" uuid REFERENCES "parties"("id") ON DELETE SET NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "inbound_leads_idempotency_key_ux" ON "inbound_leads" ("idempotency_key");
CREATE INDEX "inbound_leads_status_idx" ON "inbound_leads" ("status");
CREATE INDEX "inbound_leads_party_id_idx" ON "inbound_leads" ("party_id");
