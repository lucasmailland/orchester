-- Reverse migration 0041_mnemosyne_protocol_v12_tagging.sql

DROP INDEX IF EXISTS idx_mnemo_fact_protocol_version;

ALTER TABLE mnemo_fact
  DROP COLUMN IF EXISTS protocol_version;
