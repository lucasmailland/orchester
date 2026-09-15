-- packages/db/migrations/0025_brain_extraction_skip_state.sql
--
-- Audit FIX-009 (M-A-005): brain_extraction_job needs a 'skipped' state
-- plus a `skip_reason` column so Mode A / Mode B workspaces can record
-- that extraction was intentionally bypassed (no LLM provider configured)
-- without faking it as 'done' via the `error` column.
--
-- This mirrors the mnemo_extraction_job schema (migration 0017) which
-- already carries both. Backfill is unnecessary — extraction jobs are
-- short-lived.

ALTER TABLE brain_extraction_job
  DROP CONSTRAINT IF EXISTS brain_extraction_job_state_check;

ALTER TABLE brain_extraction_job
  ADD CONSTRAINT brain_extraction_job_state_check
  CHECK (state IN ('pending','running','done','failed','skipped'));

ALTER TABLE brain_extraction_job
  ADD COLUMN IF NOT EXISTS skip_reason text;
