-- packages/db/migrations/0045_mnemo_fact_memory_strength.down.sql
-- Reverses migration 0045 (Hebbian potentiation columns).

DROP INDEX IF EXISTS idx_mnemo_fact_memory_strength;

ALTER TABLE mnemo_fact
  DROP COLUMN IF EXISTS last_strength_update,
  DROP COLUMN IF EXISTS memory_stability,
  DROP COLUMN IF EXISTS memory_strength;
