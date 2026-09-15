-- Reverse migration 0035_mnemosyne_attribution.sql

ALTER TABLE mnemo_fact DROP COLUMN IF EXISTS attribution;
