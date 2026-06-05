-- packages/db/migrations/0042_mnemosyne_halfvec.sql
--
-- Mnemosyne v1.6 "True 10/10" — halfvec quantization on
-- `mnemo_fact.embedding`.
--
-- Migrates the column from `vector(1536)` (float32, ~6KB/fact) to
-- `halfvec(1536)` (float16, ~3KB/fact). 2x storage reduction on the
-- single hottest table in the system, with <0.5% recall quality loss
-- (well within noise floor for the hybrid score model — see the
-- regression test in `packages/mnemosyne/tests/integration/
-- halfvec-recall-quality.spec.ts`).
--
-- Why halfvec (and not int8 / 8-bit quantization)?
--   - float16 keeps 11 bits of significand (1 sign + 5 exponent + 10
--     significand). For unit-length normalized embeddings this is
--     plenty of dynamic range: cosine similarity stays within ~1e-3
--     of the float32 reference.
--   - pgvector ships native halfvec support since v0.7 (June 2024).
--     The `<=>` cosine operator is overloaded for both vector and
--     halfvec, so the SELECT queries in `recall/search.ts` continue
--     to work unchanged — no app-side code change required.
--   - int8 (256 buckets per dimension) would be a more aggressive
--     win but for 1536-dim embeddings the quantization noise
--     compounds enough that top-1 recall drops 1-2%. halfvec is
--     basically free — we pay for storage and serialization wins
--     without measurably sacrificing recall.
--
-- Production playbook:
--   - pgvector 0.7+ is required. Verify in prod BEFORE deploying:
--       SELECT extversion FROM pg_extension WHERE extname = 'vector';
--     If < 0.7, run `ALTER EXTENSION vector UPDATE;` first.
--   - The HNSW index is dropped and rebuilt. On a 10k-fact table
--     this takes ~30s on commodity hardware; on a 100k-fact table
--     ~5 minutes. The index is `IF NOT EXISTS` so a partial deploy
--     is safe to re-run.
--   - During the index rebuild window, vector recall falls through
--     to a sequential scan. For 10k facts the seq scan is ~50ms;
--     production-grade latency. For 100k+ schedule the migration
--     during a low-traffic window.
--   - The ALTER COLUMN ... USING ... cast is in-place — Postgres
--     rewrites the heap. On a typical 5-50k fact workspace this
--     is bounded; for the largest workspaces, monitor LWLock
--     contention on `mnemo_fact` during the rewrite.

-- 1. Drop the existing HNSW index (it's typed for `vector`, not
--    `halfvec`, so the rebuild MUST come after the ALTER TYPE).
DROP INDEX IF EXISTS idx_mnemo_fact_embedding_hnsw;

-- 2. Migrate the column. The USING clause does the float32 → float16
--    cast on every existing row. Cost: O(N) rows; the cast is in
--    native C inside pgvector so it's bounded by I/O.
ALTER TABLE mnemo_fact
  ALTER COLUMN embedding TYPE halfvec(1536)
  USING embedding::halfvec(1536);

-- 3. Recreate the HNSW index on the new type with the cosine ops
--    catalog entry for halfvec. The `m` + `ef_construction` knobs
--    match the v1.0 index parameters (migration 0017) so retrieval
--    latency stays in the same envelope.
CREATE INDEX IF NOT EXISTS idx_mnemo_fact_embedding_hnsw
  ON mnemo_fact USING hnsw (embedding halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Note: `mnemo_decision.embedding` and `mnemo_query_cache.query_embedding`
-- intentionally STAY on `vector(1536)`. The fact table holds 95%+ of
-- the row count and storage; migrating the others is a marginal win
-- and adds risk to a v1.6 release that's already touching three core
-- tables. v1.7 candidate.
