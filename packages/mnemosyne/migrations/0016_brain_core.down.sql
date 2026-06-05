-- Reverse migration 0016_brain_core.sql
--
-- No explicit BEGIN/COMMIT — see the comment in the forward
-- migration. Production wraps each file in a transaction via
-- drizzle-kit; tests stream through `sql.unsafe()` which rejects
-- explicit transaction markers under a pooled connection.

DROP TABLE IF EXISTS brain_extraction_job CASCADE;
DROP TRIGGER IF EXISTS brain_fact_updated_at ON brain_fact;
DROP FUNCTION IF EXISTS brain_fact_set_updated_at();
DROP TABLE IF EXISTS brain_fact CASCADE;
