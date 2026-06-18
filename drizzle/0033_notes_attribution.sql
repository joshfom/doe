-- Salesforce Lead Core (S2) — notes with creator attribution (task 1.2)
--
-- Evolves `ticket_notes` so a note records whether its creator is an AI actor,
-- a human user, or the system, and so a note may attach to a Lead (parties row)
-- as well as — or instead of — a Ticket:
--   • actor_type (ai | user | system, default user) — creator attribution.
--   • author_id is now nullable so an AI- or system-authored note needs no human.
--   • ticket_id is now nullable so a note may attach to a Lead only.
--   • lead_party_id links a note to a Lead (ON DELETE CASCADE).
--   • a CHECK backstops the at-least-one-association invariant.
-- See salesforce-lead-core design §6.2 (Requirements 14.1, 14.2, 14.4, 14.5, 14.8).
ALTER TABLE "ticket_notes" ADD COLUMN "actor_type" text NOT NULL DEFAULT 'user';
ALTER TABLE "ticket_notes" ALTER COLUMN "author_id" DROP NOT NULL;
ALTER TABLE "ticket_notes" ALTER COLUMN "ticket_id" DROP NOT NULL;
ALTER TABLE "ticket_notes" ADD COLUMN "lead_party_id" uuid REFERENCES "parties"("id") ON DELETE CASCADE;
CREATE INDEX "ticket_notes_lead_party_id_idx" ON "ticket_notes" ("lead_party_id");
ALTER TABLE "ticket_notes" ADD CONSTRAINT "ticket_notes_assoc_chk"
  CHECK ("ticket_id" IS NOT NULL OR "lead_party_id" IS NOT NULL);
