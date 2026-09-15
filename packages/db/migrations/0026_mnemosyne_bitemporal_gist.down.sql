-- Reverse migration 0026_mnemosyne_bitemporal_gist.sql

DROP INDEX IF EXISTS idx_mnemo_fact_valid;
DROP INDEX IF EXISTS idx_mnemo_decision_valid;
DROP INDEX IF EXISTS idx_mnemo_relation_valid;
