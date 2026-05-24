-- Reverse migration 0016_brain_core.sql

BEGIN;

DROP TABLE IF EXISTS brain_extraction_job CASCADE;
DROP TRIGGER IF EXISTS brain_fact_updated_at ON brain_fact;
DROP FUNCTION IF EXISTS brain_fact_set_updated_at();
DROP TABLE IF EXISTS brain_fact CASCADE;

COMMIT;
