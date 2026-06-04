-- packages/db/migrations/0052_mnemo_cron_schedule.sql
--
-- Mnemosyne v2.1 — Per-workspace cron periodicity overrides for the
-- Memory Maintenance panel.
--
-- Background
-- ----------
-- The Mnemosyne housekeeping jobs (dedup, prune, consolidation,
-- summary, auto-pin, review-sweep, health) ship with global pg-boss
-- schedules baked into `worker/index.ts`. That's fine for the median
-- workspace but tenants kept asking two things:
--
--   "Can I disable dedup? My workspace is small and I don't need it
--    burning compute every Sunday."
--
--   "Can dedup run weekly for my main workspace but monthly for the
--    archive workspace where data barely changes?"
--
-- This table is the override knob. Each row says: for this workspace,
-- run this job at this cadence — or skip it entirely. When no row
-- exists for a (workspace, job) pair, the worker treats it as
-- `mode='default'` (i.e., run at the global cadence). That keeps
-- existing installations unchanged.
--
-- Semantics
-- ---------
-- The worker fires its GLOBAL cron at the schedule defined in
-- `worker/index.ts`. Each tick, the job iterates workspaces and, for
-- each, consults `mnemo_cron_schedule.shouldRunForWorkspace`:
--
--   default   → run (it's what the global cron is for)
--   disabled  → skip
--   hourly    → run if (now() - last_run_at) >= 1h
--   daily     → run if (now() - last_run_at) >= 24h
--   weekly    → run if (now() - last_run_at) >= 7d
--   monthly   → run if (now() - last_run_at) >= 30d
--   custom    → run if (now() - last_run_at) >= one_tick(custom_cron)
--                — we don't actually parse cron in SQL; the helper
--                  derives the minimum interval at evaluation time.
--
-- Important caveat surfaced in the UI:
--   The chosen mode is a MAXIMUM frequency. It cannot fire MORE often
--   than the global cron does — picking "hourly" on a job whose
--   global is daily yields daily. The drawer shows the operator the
--   global cadence so the contract is visible.
--
-- RLS
-- ---
-- Workspace-scoped, same pattern as every other Mnemosyne table:
-- USING (workspace_id = current_setting('app.workspace_id', true)::text).
-- The worker reads via `withCrossTenantAdmin` (cron_admin BYPASSRLS)
-- since it needs to iterate workspaces; the API/UI side uses the
-- normal app_user role and is naturally scoped to the caller's
-- workspace.
--
-- Idempotent: every DDL is guarded with IF [NOT] EXISTS.

-- ── 1. Table ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mnemo_cron_schedule (
  id                       text PRIMARY KEY,
  workspace_id             text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  -- One of the well-known job names; mirrored in
  -- `apps/web/lib/mnemo/cron-policy.ts#CRON_JOBS`. We don't FK this to
  -- anything because the canonical job catalogue lives in code.
  job_name                 text NOT NULL,
  -- Cadence override. `default` = "follow the global cron"; `disabled`
  -- = "skip this workspace"; the others = minimum interval between
  -- runs for this workspace. Validated by CHECK.
  mode                     text NOT NULL DEFAULT 'default'
    CHECK (mode IN ('default','hourly','daily','weekly','monthly','custom','disabled')),
  -- When mode='custom' this holds a 5-field crontab expression.
  -- Validated by the API on write (cron-parser); the DB only
  -- enforces "either custom or NULL".
  custom_cron_expression   text,
  -- Bookkeeping for the interval gate. The worker reads + updates
  -- this from inside its own transaction so cross-tick concurrency
  -- on the same workspace can't double-run.
  last_run_at              timestamptz,
  updated_at               timestamptz NOT NULL DEFAULT now(),

  -- One row per (workspace, job) — UNIQUE here is what makes
  -- `UPSERT ... ON CONFLICT (workspace_id, job_name)` cheap on writes.
  UNIQUE (workspace_id, job_name),

  -- Custom mode must have an expression; non-custom must NOT (we'd
  -- rather force a single source of truth than carry a stale string).
  CONSTRAINT mnemo_cron_schedule_custom_expr_check CHECK (
    (mode = 'custom' AND custom_cron_expression IS NOT NULL) OR
    (mode <> 'custom' AND custom_cron_expression IS NULL)
  )
);

-- Lookup by workspace dominates the access pattern (the API hands
-- back the whole config for one workspace, the worker picks one
-- (workspace, job) pair). The UNIQUE constraint above already
-- creates an index on (workspace_id, job_name); no extra index needed.

-- ── 2. RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE mnemo_cron_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE mnemo_cron_schedule FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'mnemo_cron_schedule' AND policyname = 'mnemo_cron_schedule_select'
  ) THEN
    EXECUTE 'CREATE POLICY mnemo_cron_schedule_select ON mnemo_cron_schedule FOR SELECT USING (workspace_id = current_setting(''app.workspace_id'', true)::text)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'mnemo_cron_schedule' AND policyname = 'mnemo_cron_schedule_insert'
  ) THEN
    EXECUTE 'CREATE POLICY mnemo_cron_schedule_insert ON mnemo_cron_schedule FOR INSERT WITH CHECK (workspace_id = current_setting(''app.workspace_id'', true)::text)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'mnemo_cron_schedule' AND policyname = 'mnemo_cron_schedule_update'
  ) THEN
    EXECUTE 'CREATE POLICY mnemo_cron_schedule_update ON mnemo_cron_schedule FOR UPDATE USING (workspace_id = current_setting(''app.workspace_id'', true)::text) WITH CHECK (workspace_id = current_setting(''app.workspace_id'', true)::text)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'mnemo_cron_schedule' AND policyname = 'mnemo_cron_schedule_delete'
  ) THEN
    EXECUTE 'CREATE POLICY mnemo_cron_schedule_delete ON mnemo_cron_schedule FOR DELETE USING (workspace_id = current_setting(''app.workspace_id'', true)::text)';
  END IF;
END$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON mnemo_cron_schedule TO app_user;
