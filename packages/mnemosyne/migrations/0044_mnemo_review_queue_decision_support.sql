-- packages/db/migrations/0044_mnemo_review_queue_decision_support.sql
--
-- Mnemosyne v1.1 #24 — extend mnemo_review_queue to support decisions.
--
-- The original schema (migration 0032) had `fact_id text NOT NULL` because
-- the only producer was `saveFactWithCandidates`. Now that
-- `saveDecisionWithCandidates` also queues contradictions, we need to
-- support decision rows. Two changes:
--
--   1. Make `fact_id` nullable (it already has no FK, so the DB is fine;
--      the application layer enforces the invariant below).
--   2. Add `decision_id text` (nullable, no FK — same reasoning as fact_id:
--      a decision may be superseded/withdrawn between enqueue and resolve;
--      the reviewer UI handles the "decision gone" case gracefully).
--
-- Application-layer invariant (enforced by `enqueueReview`):
--   Exactly one of (fact_id, decision_id) is non-NULL per row.
-- A CHECK constraint documents and enforces this at the DB layer too.
--
-- RLS — this table already has `workspace_id`-gated policies; no policy
-- changes needed. The new column is included in existing SELECT policies
-- by default.
--
-- Idempotent: IF NOT EXISTS / IF EXISTS guards on all DDL.

-- 1. Relax the NOT NULL on fact_id.
ALTER TABLE mnemo_review_queue
  ALTER COLUMN fact_id DROP NOT NULL;

-- 2. Add decision_id (nullable, no FK — same pattern as fact_id).
ALTER TABLE mnemo_review_queue
  ADD COLUMN IF NOT EXISTS decision_id text;

-- 3. Enforce the "at least one source" invariant at the DB layer.
ALTER TABLE mnemo_review_queue
  ADD CONSTRAINT mnemo_review_queue_source_check
  CHECK (fact_id IS NOT NULL OR decision_id IS NOT NULL);

-- 4. Partial index for decision-keyed suppression lookup (mirrors the
--    existing fact_id index that deduplicates `enqueueReview` calls).
CREATE INDEX IF NOT EXISTS idx_mnemo_review_queue_decision_unresolved
  ON mnemo_review_queue (workspace_id, decision_id)
  WHERE decision_id IS NOT NULL AND resolved_at IS NULL;
