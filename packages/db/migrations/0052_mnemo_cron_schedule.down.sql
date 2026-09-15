-- packages/db/migrations/0052_mnemo_cron_schedule.down.sql
--
-- Reverse of 0052_mnemo_cron_schedule.sql.
-- Drops the per-workspace cron periodicity override table.
-- The worker hardcoded schedules continue to fire unchanged after
-- this rollback, so behavior reverts cleanly to "every workspace
-- always runs the global cadence."

DROP TABLE IF EXISTS mnemo_cron_schedule;
