-- packages/db/migrations/0033_mnemosyne_memory_types.sql
--
-- Mnemosyne v1.4 — "The Cognitive Leap". Adds a memory_type column on
-- `mnemo_fact` so the recall pipeline can separate facts by the way
-- human cognition does:
--
--   • semantic    — durable factual knowledge ("Lucas prefers TS").
--                   This is the DEFAULT; every pre-v1.4 fact migrates
--                   here so existing behaviour is unchanged.
--   • episodic    — events tied to a specific moment ("we decided to
--                   deploy Postgres on 2026-04-15"). Linked to rows in
--                   the new `mnemo_episode` table (migration 0034) via
--                   metadata.episode_id set by the extraction pipeline.
--   • procedural  — how-to ("when the user asks for reports, format
--                   as CSV"). Invoked by the agent runtime on tool
--                   turns.
--   • working     — the current conversation only. Ephemeral; never
--                   persisted long-term, but stored here so the recall
--                   path remains a single SQL query.
--
-- Implementation: text + CHECK constraint instead of a Postgres ENUM
-- type. ENUM types are painful to evolve (adding a value requires
-- ALTER TYPE … ADD VALUE which can't run inside a transaction in some
-- Postgres versions, and removing one is essentially impossible). The
-- 4-value cardinality is tiny so the planner picks a bitmap-scan +
-- recheck plan over the secondary index either way.

ALTER TABLE mnemo_fact
  ADD COLUMN IF NOT EXISTS memory_type text NOT NULL DEFAULT 'semantic'
    CHECK (memory_type IN ('semantic', 'episodic', 'procedural', 'working'));

-- Composite (workspace_id, memory_type) index, partial on status='active'.
-- Recall queries always scope to `workspace_id = $1 AND status = 'active'`
-- and v1.4 adds `AND memory_type IN (…)`; this index serves all three
-- predicates in a single bitmap. A partial index on the most-common case
-- (semantic) wouldn't help because the type filter is mode-dependent and
-- callers will routinely pass `["semantic", "episodic"]` together.
CREATE INDEX IF NOT EXISTS idx_mnemo_fact_memory_type
  ON mnemo_fact (workspace_id, memory_type)
  WHERE status = 'active';
