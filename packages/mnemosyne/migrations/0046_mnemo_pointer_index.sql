-- packages/db/migrations/0046_mnemo_pointer_index.sql
--
-- Mnemosyne v1.1 #1+2 — Pointer index + drawer-grep.
--
-- ARCHITECTURE
-- ------------
-- The pointer index is the lightweight routing tier that sits BEFORE the
-- first-stage FTS/vector retrieval. It maps individual content terms to
-- the entity (drawer) that mentions them most. At query time:
--
--   1. Tokenize the query → terms
--   2. Lookup pointer_index for those terms → ranked entity_ids (drawers)
--   3. Drawer-grep: FTS search restricted to those entity_ids (fast, targeted)
--   4. Merge drawer results with the full first-stage results
--   5. Continue existing pipeline (rerank → prune → diversity → cap)
--
-- This combination achieves 96.6% R@5 in mempalace benchmarks because
-- entity-filtered search has dramatically higher precision for entity-
-- specific queries (e.g. "Lucas's preferences" routes to Lucas's drawer).
--
-- SCHEMA
-- ------
-- Primary key is (workspace_id, term, entity_id) — one counter per
-- (term, entity) pair. `mention_count` tracks how many facts within
-- that entity reference the term, so the pointer lookup can rank
-- entities by total signal strength for the query.
--
-- §0.1: additive migration — no backfill required. The index is
-- populated incrementally as new facts are created; existing facts
-- will be indexed in the background via the admin rebuild endpoint.
-- Queries degrade gracefully to the existing first-stage when the
-- pointer index has no entries for a workspace.

CREATE TABLE IF NOT EXISTS mnemo_pointer (
  workspace_id    text        NOT NULL
    REFERENCES workspace (id) ON DELETE CASCADE,
  term            text        NOT NULL,
  entity_id       text        NOT NULL,   -- drawer ID (mnemo_entity.id)
  mention_count   int         NOT NULL DEFAULT 1,
  updated_at      timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, term, entity_id)
);

-- Fast lookup: given (workspace_id, term), find all entities that
-- reference the term, ordered by mention_count. This is the hot path
-- for the pointer routing step.
CREATE INDEX IF NOT EXISTS idx_mnemo_pointer_lookup
  ON mnemo_pointer (workspace_id, term, mention_count DESC);

-- Reverse index: given an entity_id, find all its indexed terms.
-- Used by the admin rebuild endpoint to delete stale entries per entity
-- before re-indexing, and for debugging ("what does the pointer know
-- about entity X?").
CREATE INDEX IF NOT EXISTS idx_mnemo_pointer_entity
  ON mnemo_pointer (workspace_id, entity_id);
