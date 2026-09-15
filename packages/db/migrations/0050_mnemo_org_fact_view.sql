-- packages/db/migrations/0050_mnemo_org_fact_view.sql
--
-- Mnemosyne v2 — Cross-workspace consolidation surface.
--
-- See: docs/specs/2026-05-30-cross-workspace-consolidation-design.md
--
-- This migration ships the read-side materialized view that the
-- cross-workspace cron (apps/web/worker/org-consolidation-job.ts)
-- populates and that the (future) org-admin UI reads. The cron
-- writes via service-role; the UI reads via the new `app_org_user`
-- role scoped by the `app.org_id` GUC.
--
-- INVARIANT: the per-workspace `app_user` role gets ZERO grants on
-- this table. Cross-workspace data must never bleed into the
-- agent-runtime hot path; that's why the role lattice is split.

-- ── 1. mnemo_org_fact_view table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mnemo_org_fact_view (
  id                    text PRIMARY KEY,
  org_id                text NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  -- Source facts that contributed to the summary. Plain text array
  -- (mnemo_fact.id is text); cron filters by length >= 2 so
  -- single-fact clusters never land here.
  source_fact_ids       text[] NOT NULL,
  source_workspace_ids  text[] NOT NULL,
  -- LLM summary text. PII-redacted by the cron BEFORE the LLM call;
  -- this column may safely surface in the admin UI under workspace
  -- isolation policies.
  statement_summary     text NOT NULL,
  cluster_similarity    real NOT NULL,
  subject               text NOT NULL,
  kind                  text NOT NULL,
  -- Open enum so future cross-workspace sources (manual entry,
  -- third-party imports) can disambiguate via this column.
  source                text NOT NULL DEFAULT 'org_consolidation',
  stale                 boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mnemo_org_fact_view_org
  ON mnemo_org_fact_view (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mnemo_org_fact_view_subject_kind
  ON mnemo_org_fact_view (org_id, subject, kind);

-- ── 2. app_org_user role + grants ────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_org_user') THEN
    CREATE ROLE app_org_user NOLOGIN;
  END IF;
END
$$;

GRANT SELECT ON mnemo_org_fact_view TO app_org_user;
GRANT SELECT ON org                  TO app_org_user;

-- Service-role cron retains full rights via SUPERUSER / direct
-- privileges; this migration intentionally does NOT grant write
-- access to `app_org_user` — the cron is the only writer.

-- ── 3. RLS + FORCE on mnemo_org_fact_view ────────────────────────────────────
ALTER TABLE mnemo_org_fact_view ENABLE ROW LEVEL SECURITY;
ALTER TABLE mnemo_org_fact_view FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_user_select ON mnemo_org_fact_view;
CREATE POLICY org_user_select ON mnemo_org_fact_view
  FOR SELECT TO app_org_user
  USING (org_id::text = current_setting('app.org_id', true));

-- Service-role (SUPERUSER) bypasses RLS implicitly. No write policy
-- exposed to `app_org_user`.
