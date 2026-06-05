-- Reverse migration 0051_mnemo_fact_episode_not_null.sql
--
-- Just relaxes the NOT NULL constraint. The placeholder synthetic
-- episodes + the stamped fact rows are left intact — undoing the
-- backfill silently would lose information, and dropping the
-- placeholder episodes would orphan thousands of fact rows. If the
-- operator needs to "undo" the backfill content, they must do so
-- explicitly via a follow-up forward migration.

ALTER TABLE mnemo_fact ALTER COLUMN episode_id DROP NOT NULL;
