-- packages/db/migrations/0031_mnemosyne_health.sql
--
-- Mnemosyne v1.2 — memory drift detection snapshot.
--
-- Goal: surface workspace-level "memory health" metrics so the v1.3 UI
-- dashboard (and ad-hoc ops queries today) can spot drift — facts
-- exploding, recall hit-rate collapsing, extraction backlog growing,
-- embedding coverage rotting. Each row is one point-in-time snapshot
-- per workspace, produced by the daily cron in
-- `apps/web/worker/health-job.ts`.
--
-- This is a metrics cache, not a source of truth. Every value can be
-- recomputed from the existing mnemo_* tables at any time; the
-- `mnemo_health` table just persists the timeseries so the dashboard
-- can render trends without re-scanning the whole catalogue.

CREATE TABLE IF NOT EXISTS mnemo_health (
  id                          text PRIMARY KEY,
  workspace_id                text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  snapshot_at                 timestamptz NOT NULL DEFAULT now(),

  -- ── counts ──────────────────────────────────────────────────────────
  fact_count_active           integer NOT NULL,
  fact_count_archived         integer NOT NULL,
  fact_count_embedded         integer NOT NULL,                       -- non-null embedding (active rows)
  fact_count_unembedded       integer NOT NULL,                       -- NULL embedding (active rows)
  decision_count_active       integer NOT NULL,
  relation_count_conflicts    integer NOT NULL,                       -- verb='conflicts_with'

  -- ── hit-rate quality ────────────────────────────────────────────────
  -- Facts with hit_count=0 are candidates for janitor pruning (the
  -- extraction layer thought they were worth remembering but recall
  -- has never surfaced them).
  facts_with_zero_hits        integer NOT NULL,
  -- Per-workspace recall hit-rate over the last 30 days, on the
  -- [0,1] scale. NULL when no telemetry exists yet (cold start).
  recall_hit_rate_30d         numeric(4,3),

  -- ── extraction quality ──────────────────────────────────────────────
  extraction_jobs_failed_7d   integer NOT NULL,
  extraction_jobs_deferred    integer NOT NULL,                       -- state='deferred_provider_outage'

  -- ── meta ────────────────────────────────────────────────────────────
  computed_in_ms              integer NOT NULL,
  generated_at                timestamptz NOT NULL DEFAULT now()
);

-- The dashboard reads "latest snapshot per workspace" + "last N snapshots
-- for trend chart". Both are served by this index — leading workspace_id
-- + descending snapshot_at gives the latest row in a single index hop
-- (LIMIT 1) and an efficient range scan for the trend.
CREATE INDEX IF NOT EXISTS idx_mnemo_health_workspace
  ON mnemo_health (workspace_id, snapshot_at DESC);

-- RLS+FORCE Pattern A, same shape as `mnemo_summary` (migration 0028).
-- Every read/write happens inside `withMnemoTx` so the GUC is set and
-- `app_user` (the downgraded role) is the effective principal.
ALTER TABLE mnemo_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE mnemo_health FORCE  ROW LEVEL SECURITY;

CREATE POLICY mnemo_health_select ON mnemo_health FOR SELECT
  USING (workspace_id = current_setting('app.workspace_id', true)::text);

CREATE POLICY mnemo_health_insert ON mnemo_health FOR INSERT
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::text);

CREATE POLICY mnemo_health_update ON mnemo_health FOR UPDATE
  USING (workspace_id = current_setting('app.workspace_id', true)::text)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::text);

CREATE POLICY mnemo_health_delete ON mnemo_health FOR DELETE
  USING (workspace_id = current_setting('app.workspace_id', true)::text);

-- Explicit grant for app_user (the role `withMnemoTx` downgrades to).
GRANT SELECT, INSERT, UPDATE, DELETE ON mnemo_health TO app_user;
