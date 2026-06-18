-- Salesforce Lead Core (S2) — generalize the sync ledger (task 1.3)
--
-- Promotes `crm_sync_log` from a per-ticket trail to a general CRM sync ledger so
-- Lead and inbound syncs that have no originating ticket can be recorded:
--   • ticket_id is now nullable so a Lead/inbound entry needs no Ticket.
--   • crm_sync_log_external_ref_idx indexes external_ref_id for lookups by SF id.
-- The existing per-ticket outbound trail keeps working while direction / status /
-- external_ref_id entries become recordable for ticketless Lead and inbound syncs.
-- See salesforce-lead-core design §6.3 (Requirements 8.1, 8.2, 8.3, 8.4).
ALTER TABLE "crm_sync_log" ALTER COLUMN "ticket_id" DROP NOT NULL;
CREATE INDEX "crm_sync_log_external_ref_idx" ON "crm_sync_log" ("external_ref_id");
