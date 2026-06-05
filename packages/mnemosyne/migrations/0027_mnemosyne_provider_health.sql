-- packages/db/migrations/0027_mnemosyne_provider_health.sql
--
-- Mnemosyne v1.1 — provider health / circuit breaker support.
--
-- Mode A's real purpose is graceful degradation when the LLM provider is
-- unavailable (outage, spend cap hit, rate-limited, network partition,
-- revoked key). We need to differentiate jobs that were INTENTIONALLY
-- skipped (no provider configured — Mode A steady state) from jobs that
-- were DEFERRED because the provider went down (transient — retry later).
--
-- Adds:
--   1. New state value 'deferred_provider_outage' on the extraction job
--      tables (both `mnemo_extraction_job` and `brain_extraction_job`
--      while the brain → mnemo backfill window is still open).
--   2. `defer_until timestamptz` column for the retry scheduler (worker
--      consults this and re-enqueues after the timestamp passes).
--   3. Partial index on (defer_until) WHERE state = 'deferred_provider_outage'
--      so the worker query is index-only on the hot path.

-- ── mnemo_extraction_job ──────────────────────────────────────────────────
--
-- mnemo_extraction_job uses a CHECK constraint, not a Postgres ENUM (see
-- migration 0017). So we DROP + re-ADD the constraint with the new value
-- rather than ALTER TYPE.

ALTER TABLE mnemo_extraction_job
  DROP CONSTRAINT IF EXISTS mnemo_extraction_job_state_check;

ALTER TABLE mnemo_extraction_job
  ADD CONSTRAINT mnemo_extraction_job_state_check
  CHECK (state IN (
    'pending',
    'running',
    'done',
    'failed',
    'skipped',
    'deferred_provider_outage'
  ));

ALTER TABLE mnemo_extraction_job
  ADD COLUMN IF NOT EXISTS defer_until timestamptz;

CREATE INDEX IF NOT EXISTS idx_mnemo_extraction_defer_until
  ON mnemo_extraction_job (defer_until)
  WHERE state = 'deferred_provider_outage';

-- ── brain_extraction_job (legacy, still receives live writes) ─────────────
--
-- The active extract-job worker still reads/writes brain_extraction_job
-- (the rename to mnemo_* is mid-flight via migration 0024). Add the same
-- column + state value here so deferral works during the cutover window.
-- Both tables can be cleaned up in a later migration when the brain side
-- is fully decommissioned.

ALTER TABLE brain_extraction_job
  DROP CONSTRAINT IF EXISTS brain_extraction_job_state_check;

ALTER TABLE brain_extraction_job
  ADD CONSTRAINT brain_extraction_job_state_check
  CHECK (state IN (
    'pending',
    'running',
    'done',
    'failed',
    'skipped',
    'deferred_provider_outage'
  ));

ALTER TABLE brain_extraction_job
  ADD COLUMN IF NOT EXISTS defer_until timestamptz;

CREATE INDEX IF NOT EXISTS idx_brain_extraction_defer_until
  ON brain_extraction_job (defer_until)
  WHERE state = 'deferred_provider_outage';
