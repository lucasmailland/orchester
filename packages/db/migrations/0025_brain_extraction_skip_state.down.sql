-- Reverse migration 0025_brain_extraction_skip_state.sql

ALTER TABLE brain_extraction_job
  DROP COLUMN IF EXISTS skip_reason;

ALTER TABLE brain_extraction_job
  DROP CONSTRAINT IF EXISTS brain_extraction_job_state_check;

ALTER TABLE brain_extraction_job
  ADD CONSTRAINT brain_extraction_job_state_check
  CHECK (state IN ('pending','running','done','failed'));
