-- Reverse migration 0037_mnemosyne_actor_id.sql

DROP INDEX IF EXISTS idx_mnemo_fact_actor;

ALTER TABLE mnemo_fact
  DROP COLUMN IF EXISTS actor_id;
