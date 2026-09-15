-- Reverse migration 0017_mnemosyne_init.sql
DROP TABLE IF EXISTS mnemo_extraction_job CASCADE;
DROP TRIGGER IF EXISTS mnemo_fact_updated_at ON mnemo_fact;
DROP FUNCTION IF EXISTS mnemo_fact_set_updated_at();
DROP TABLE IF EXISTS mnemo_fact CASCADE;
