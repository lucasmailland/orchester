-- Reverse migration 0027_mnemosyne_provider_health.sql
--
-- Note: there is no in-flight CHECK-constraint risk because at this
-- point any rows in the new 'deferred_provider_outage' state need to be
-- migrated/cleared by the operator before running the down. The down
-- below will fail with check_violation if such rows exist — that's the
-- intended safety net.

DROP INDEX IF EXISTS idx_mnemo_extraction_defer_until;

ALTER TABLE mnemo_extraction_job
  DROP COLUMN IF EXISTS defer_until;

ALTER TABLE mnemo_extraction_job
  DROP CONSTRAINT IF EXISTS mnemo_extraction_job_state_check;

ALTER TABLE mnemo_extraction_job
  ADD CONSTRAINT mnemo_extraction_job_state_check
  CHECK (state IN ('pending','running','done','failed','skipped'));

DROP INDEX IF EXISTS idx_brain_extraction_defer_until;

ALTER TABLE brain_extraction_job
  DROP COLUMN IF EXISTS defer_until;

ALTER TABLE brain_extraction_job
  DROP CONSTRAINT IF EXISTS brain_extraction_job_state_check;

ALTER TABLE brain_extraction_job
  ADD CONSTRAINT brain_extraction_job_state_check
  CHECK (state IN ('pending','running','done','failed','skipped'));
