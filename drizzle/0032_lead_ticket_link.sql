-- Salesforce Lead Core (S2) — ticket ↔ Lead link (task 1.1)
--
-- Adds a nullable `lead_party_id` reference from `tickets` to `parties`,
-- establishing the Lead/Ticket entity separation. A Ticket with a non-null
-- `lead_party_id` is a Lead_Task (a sales activity on that Lead); a null value
-- leaves it an Internal_Ticket. The relation is recorded here rather than by
-- adding a value to the `request_type` enum. ON DELETE SET NULL preserves the
-- Ticket when its linked Party is removed.
-- See salesforce-lead-core design §6.1 (Requirements 13.4, 13.5, 13.6).
ALTER TABLE "tickets" ADD COLUMN "lead_party_id" uuid REFERENCES "parties"("id") ON DELETE SET NULL;
CREATE INDEX "tickets_lead_party_id_idx" ON "tickets" ("lead_party_id");
