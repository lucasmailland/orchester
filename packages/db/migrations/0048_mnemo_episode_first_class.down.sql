-- Reverse migration 0048_mnemo_episode_first_class.sql
--
-- Safe to run on any database (idempotent). Drops the additions in
-- reverse order: mnemo_fact column + index first, then mnemo_episode
-- column + index.
--
-- Data loss WARNING: this drops the `episode_id` column from
-- `mnemo_fact`. Any backfill done by the v2.1 cron is lost. The
-- column is nullable in 0048 so this drop is non-destructive in the
-- v2.0 → v1.6 direction; if v2.1's NOT NULL flip has already run,
-- this reverse should NOT be used — write a dedicated v2.1 reverse
-- instead.

DROP INDEX IF EXISTS idx_mnemo_fact_episode_id;
ALTER TABLE mnemo_fact DROP COLUMN IF EXISTS episode_id;

DROP INDEX IF EXISTS idx_mnemo_episode_real;
ALTER TABLE mnemo_episode DROP COLUMN IF EXISTS is_synthetic;
