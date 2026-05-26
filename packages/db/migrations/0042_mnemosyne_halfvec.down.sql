-- Reverse migration 0042_mnemosyne_halfvec.sql
--
-- Migrates `mnemo_fact.embedding` BACK to `vector(1536)` from
-- `halfvec(1536)`. WARNING: this is a one-way upgrade in spirit —
-- rolling back is supported for emergency revert but is SLOW on
-- large tables because:
--   1. The float16 → float32 cast doubles storage on every row.
--   2. The HNSW index rebuild on `vector_cosine_ops` runs against
--      the original (denser) representation.
--
-- For a 100k-fact workspace this can take 10+ minutes. Plan
-- accordingly: take a logical backup before running this on prod,
-- and consider doing it during a maintenance window.

DROP INDEX IF EXISTS idx_mnemo_fact_embedding_hnsw;

ALTER TABLE mnemo_fact
  ALTER COLUMN embedding TYPE vector(1536)
  USING embedding::vector(1536);

CREATE INDEX IF NOT EXISTS idx_mnemo_fact_embedding_hnsw
  ON mnemo_fact USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
