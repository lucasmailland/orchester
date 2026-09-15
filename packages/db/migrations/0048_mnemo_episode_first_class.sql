-- packages/db/migrations/0048_mnemo_episode_first_class.sql
--
-- Mnemosyne v2 — "Episodes first-class" (design doc §4).
--
-- Adds two changes that, together, give every fact a stable temporal
-- anchor without breaking existing callers:
--
--   1. `mnemo_episode.is_synthetic` boolean (default false).
--      Tags episodes auto-created by the extraction pipeline (one per
--      message turn / document / day) so the Inspector UI can hide
--      them under a "show synthetic" toggle while still letting them
--      participate in recall scoring.
--
--   2. `mnemo_fact.episode_id` text NULLABLE.
--      The forward-compatible shape. v2.1 will land a follow-up
--      migration that NOT-NULLs the column AFTER a backfill pass via
--      `apps/web/worker/episode-backfill-job.ts` populates it for
--      every existing fact. Until then the column is optional so
--      existing inserts continue to work unchanged.
--
-- Why two-step (this migration nullable, follow-up NOT NULL):
--   The codebase has thousands of legacy facts written before v2.
--   A single migration that adds the column AND backfills AND NOT-
--   NULLs in one transaction would either (a) lock `mnemo_fact` for
--   the duration of the backfill (unacceptable on large tenants) or
--   (b) require backfilling during the migration window (operationally
--   risky). Two-step lets the backfill run as a background cron and
--   the NOT-NULL flip becomes a no-op once coverage hits 100%.
--
-- Why text (not uuid):
--   `mnemo_episode.id` is text already (matches the rest of the
--   `mnemo_*` PK convention in this codebase). FK matches it.

-- ── 1. is_synthetic on mnemo_episode ─────────────────────────────────────────
ALTER TABLE mnemo_episode
  ADD COLUMN IF NOT EXISTS is_synthetic boolean NOT NULL DEFAULT false;

-- Partial index for "real episodes only" (the Inspector UI's default
-- view). Synthetic episodes dominate row count once backfill runs;
-- listing the real ones must stay fast.
CREATE INDEX IF NOT EXISTS idx_mnemo_episode_real
  ON mnemo_episode (workspace_id, occurred_at DESC)
  WHERE is_synthetic = false;

-- ── 2. episode_id on mnemo_fact ──────────────────────────────────────────────
ALTER TABLE mnemo_fact
  ADD COLUMN IF NOT EXISTS episode_id text
    REFERENCES mnemo_episode(id) ON DELETE SET NULL;

-- Reverse lookup: "all facts in this episode". Composite with
-- workspace_id so RLS predicate hits the index.
CREATE INDEX IF NOT EXISTS idx_mnemo_fact_episode_id
  ON mnemo_fact (workspace_id, episode_id)
  WHERE episode_id IS NOT NULL;

-- ── Notes for the v2.1 follow-up migration ─────────────────────────────────
-- After the backfill cron has stamped every fact with an episode_id
-- (a follow-up host job, see apps/web/worker/episode-backfill-job.ts),
-- the v2.1 migration will:
--   1. Verify coverage:  SELECT count(*) FROM mnemo_fact WHERE episode_id IS NULL;
--      Expected: 0. Abort the migration if non-zero (operator runs
--      backfill again and retries).
--   2. ALTER TABLE mnemo_fact ALTER COLUMN episode_id SET NOT NULL;
--   3. Optionally drop the partial WHERE clause from the index (full
--      coverage means the WHERE is no longer pruning anything).
