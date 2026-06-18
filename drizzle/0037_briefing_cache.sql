-- Agent-First Home / Briefing Surface (S5) — briefing_cache (task 5.1)
--
-- The ONLY schema change S5 introduces (Design §Data Models). Stores an
-- assembled Briefing so repeat Home_Surface loads are served without re-running
-- the multi-step Briefing_Workflow (CC-Cost / Req 5.1, 5.3).
--
-- Keyed by (user_id, window, period_date) — the same triple the Briefing_Cache
-- accessors and the scheduled `briefing_assembly` job derive their idempotency
-- key from, so at most one cached Briefing exists per user / window / day and a
-- re-assembly for the same key overwrites in place (Req 5.1, 5.2, 5.3).
--
-- `briefing` is the assembled Briefing JSON verbatim — already phone-redacted
-- (CC-Privacy / Req 2.7, 9.4) — so a served cached Briefing presents figures
-- byte-identical to what was assembled, with no recomputation on read (Req 5.7).
-- `expires_at` carries the TTL (clamped 1–60min, default 15) computed at write
-- time; a read returns a row only while `expires_at` is in the future (Req 5.4).
--
-- This table carries no personal data beyond the user-id key and the
-- already-redacted Briefing body. The `briefing_cache_user_period_idx` backs
-- invalidation of every entry for a (user_id, period_date) when a Tool_Dispatcher
-- mutation changes that user's Stack data (Req 5.5).
--
-- CREATE TABLE/INDEX IF NOT EXISTS keeps the migration idempotent under the
-- project's direct migration runner (scripts/migrate-direct.ts), which tolerates
-- re-application. See agentic-home design §Data Models. Requirements: 5.1, 5.3, 5.4.
CREATE TABLE IF NOT EXISTS "briefing_cache" (
  "user_id"      text        NOT NULL,
  "window"       text        NOT NULL CHECK ("window" IN ('morning','midday','evening')),
  "period_date"  date        NOT NULL,
  "briefing"     jsonb       NOT NULL,   -- the assembled Briefing (already redacted)
  "assembled_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at"   timestamptz NOT NULL,
  PRIMARY KEY ("user_id", "window", "period_date")
);
CREATE INDEX IF NOT EXISTS "briefing_cache_user_period_idx" ON "briefing_cache" ("user_id", "period_date");
