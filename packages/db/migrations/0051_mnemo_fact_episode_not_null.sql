-- packages/db/migrations/0051_mnemo_fact_episode_not_null.sql
--
-- Mnemosyne v2.1 — flip mnemo_fact.episode_id to NOT NULL.
--
-- Migration 0048 added the column nullable. Now we:
--   1. SQL-level backfill every still-NULL row with a deterministic
--      legacy-synthetic episode (one per workspace × UTC-day, mirroring
--      `deriveSyntheticEpisodeId({day})`).
--   2. Verify zero NULLs remain.
--   3. ALTER ... SET NOT NULL.
--
-- The SQL-level backfill uses text-keyed synthetic ids
-- (`mepi_legacy_<workspaceId>_<yyyy-mm-dd>`) instead of the UUIDv5
-- shape the host helper emits. The two ID schemes never collide:
-- the cron's `deriveSyntheticEpisodeId` always produces a 36-char
-- UUID; this migration's `mepi_legacy_…` strings are longer and
-- start with `mepi_`. When the cron later runs over the rows this
-- migration touched, it leaves them alone (UPDATE clause checks
-- `episode_id IS NULL`).
--
-- IDEMPOTENT: re-running the migration is safe — every WHERE clause
-- filters by `episode_id IS NULL`, so the second pass is a no-op.

-- ── 1. SQL-level backfill ────────────────────────────────────────────────────

-- 1a. Insert a placeholder synthetic episode for every (workspace, UTC
--     day) that has at least one un-stamped fact.
INSERT INTO mnemo_episode (
  id, workspace_id, title, narrative, occurred_at,
  participants, topics, linked_fact_ids,
  metadata, is_synthetic, created_at, updated_at
)
SELECT
  'mepi_legacy_' || f.workspace_id || '_' || to_char(date_trunc('day', f.created_at), 'YYYY-MM-DD') AS id,
  f.workspace_id,
  '(synthetic legacy)',
  'Backfilled by migration 0051 — fact predates the episode-first-class invariant.',
  date_trunc('day', f.created_at),
  ARRAY[]::text[],
  ARRAY[]::text[],
  ARRAY[]::text[],
  '{}'::jsonb,
  true,
  date_trunc('day', f.created_at),
  date_trunc('day', f.created_at)
FROM mnemo_fact f
WHERE f.episode_id IS NULL
GROUP BY f.workspace_id, date_trunc('day', f.created_at)
ON CONFLICT (id) DO NOTHING;

-- 1b. Stamp every un-stamped fact with its corresponding placeholder
--     synthetic episode.
UPDATE mnemo_fact f
SET episode_id =
  'mepi_legacy_' || f.workspace_id || '_' || to_char(date_trunc('day', f.created_at), 'YYYY-MM-DD')
WHERE f.episode_id IS NULL;

-- ── 2. Verify zero NULLs ────────────────────────────────────────────────────
DO $$
DECLARE
  null_count bigint;
BEGIN
  SELECT count(*) INTO null_count FROM mnemo_fact WHERE episode_id IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'migration 0051: % rows still have NULL episode_id after backfill; aborting NOT NULL flip', null_count;
  END IF;
END
$$;

-- ── 3. NOT NULL ─────────────────────────────────────────────────────────────
ALTER TABLE mnemo_fact ALTER COLUMN episode_id SET NOT NULL;
