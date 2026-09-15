-- packages/db/migrations/0028_mnemosyne_summary.sql
--
-- Mnemosyne v1.1 — distilled user profile cache.
--
-- Goal: cut prompt bloat. v1.0 injects raw top-K facts on EVERY turn
-- (~1450 tokens/turn). v1.1 promotes a small, pre-computed user profile
-- to Layer 1 (always on, 80-150 tokens) and demotes dynamic recall to
-- Layer 2 (only when the heuristic classifier says the turn needs it).
--
-- This table is the Layer 1 cache. One row per (workspace, agent, user)
-- triplet (user_id nullable for workspace-level summaries used when no
-- specific user maps to the conversation). Refreshed daily by a cron
-- (`apps/web/worker/summary-job.ts`) or on demand via `forceRefresh`.
--
-- The summary is provider-agnostic: distillation is performed by a
-- host-injected `LlmCallFn` (Charter §25). When no LLM is available,
-- `getOrComputeSummary` returns a heuristic fallback derived from the
-- top facts so the system still works in Mode A.

CREATE TABLE IF NOT EXISTS mnemo_summary (
  id                text PRIMARY KEY,
  workspace_id      text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  agent_id          text NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
  user_id           text,                                              -- nullable for workspace-level summaries
  summary_text      text NOT NULL,                                     -- pre-rendered compact form for injection
  summary_struct    jsonb NOT NULL DEFAULT '{}'::jsonb,                -- structured fields (identity/role/context/...)
  source_fact_ids   text[] NOT NULL DEFAULT '{}',                      -- traceability — which facts produced this summary
  model_used        text,                                              -- which LLM model produced this (NULL for heuristic fallback)
  token_count       integer,                                           -- approx token count for capacity planning
  generated_at      timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, agent_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_mnemo_summary_lookup
  ON mnemo_summary (workspace_id, agent_id, user_id);

-- B-tree on expires_at — the staleness scanner / cron uses
-- `WHERE expires_at < now()` to find rows that need refresh. We can't
-- use a partial index with `WHERE ... < now() + 1d` because `now()` is
-- VOLATILE and Postgres rejects volatile predicates in index expressions
-- ("functions in index predicate must be marked IMMUTABLE"). A plain
-- b-tree on expires_at is sufficient: the cardinality stays bounded
-- (≤ N triplets active workspaces) and range scans are cheap.
CREATE INDEX IF NOT EXISTS idx_mnemo_summary_expires
  ON mnemo_summary (expires_at);

CREATE OR REPLACE FUNCTION mnemo_summary_set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mnemo_summary_updated_at
  BEFORE UPDATE ON mnemo_summary
  FOR EACH ROW EXECUTE FUNCTION mnemo_summary_set_updated_at();

-- RLS+FORCE Pattern A (same as every other mnemo_* table). The brief
-- spells the four policies explicitly rather than calling
-- `apply_pattern_a()`, because we want to gate purely on the GUC
-- (`app.workspace_id`) without `is_cross_tenant_admin()` — summaries are
-- a per-tenant cache and there is no cron path that needs cross-tenant
-- reads (each summary is computed inside `withMnemoTx` with the GUC set).
ALTER TABLE mnemo_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE mnemo_summary FORCE  ROW LEVEL SECURITY;

CREATE POLICY mnemo_summary_select ON mnemo_summary FOR SELECT
  USING (workspace_id = current_setting('app.workspace_id', true)::text);

CREATE POLICY mnemo_summary_insert ON mnemo_summary FOR INSERT
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::text);

CREATE POLICY mnemo_summary_update ON mnemo_summary FOR UPDATE
  USING (workspace_id = current_setting('app.workspace_id', true)::text)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::text);

CREATE POLICY mnemo_summary_delete ON mnemo_summary FOR DELETE
  USING (workspace_id = current_setting('app.workspace_id', true)::text);

-- Explicit grant for app_user (the role `withMnemoTx` downgrades to).
-- Default privileges in migration 0007 already cover this, but listing
-- it here keeps the migration self-describing.
GRANT SELECT, INSERT, UPDATE, DELETE ON mnemo_summary TO app_user;
