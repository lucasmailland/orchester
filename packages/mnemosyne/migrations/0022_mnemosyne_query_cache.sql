-- packages/db/migrations/0022_mnemosyne_query_cache.sql
--
-- A7 L3 — Semantic-similar query cache. New queries embed first, check
-- L3 — if cosine > 0.95 with a recent query → reuse those result IDs.
-- Skips full vector search.

CREATE TABLE mnemo_query_cache (
  id                 text PRIMARY KEY,
  workspace_id       text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  query_embedding    vector(1536) NOT NULL,
  result_memory_ids  text[] NOT NULL,
  result_memory_kinds text[] NOT NULL,            -- parallel array with result_memory_ids
  scope              text,
  scope_ref          text,
  agent_id           text,
  top_k              integer NOT NULL,
  hit_count          integer NOT NULL DEFAULT 1,
  last_used_at       timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mnemo_qc_ws ON mnemo_query_cache (workspace_id, last_used_at DESC);
CREATE INDEX idx_mnemo_qc_embedding_hnsw ON mnemo_query_cache USING hnsw (query_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

ALTER TABLE mnemo_query_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE mnemo_query_cache FORCE  ROW LEVEL SECURITY;
SELECT apply_pattern_a('mnemo_query_cache');
