-- Reverse migration 0033_mnemosyne_memory_types.sql

DROP INDEX IF EXISTS idx_mnemo_fact_memory_type;

ALTER TABLE mnemo_fact DROP COLUMN IF EXISTS memory_type;
