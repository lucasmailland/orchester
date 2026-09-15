-- packages/db/migrations/0029_mnemosyne_archive.sql
--
-- Mnemosyne v1.2 — "The Janitor". Cold-storage archive for facts that
-- have been (a) merged into a dedup primary or (b) pruned for inactivity
-- + low relevance. The active table (`mnemo_fact`) stays small and
-- index-warm; the archive carries the audit/traceability tail.
--
-- Schema mirrors `mnemo_fact` MINUS the heavy/transient columns:
--   • `embedding`        — dropped (huge column, would re-bloat the cold
--                          store; we don't recall against archive).
--   • `text_lemmatized`  — dropped (FTS index churn; no recall path).
-- Added columns:
--   • `original_status`  — the pre-archive `status` ('active' /
--                          'forgotten' / 'merged') for audit clarity.
--   • `archived_at`      — when the janitor swept it in.
--   • `archive_reason`   — why ('merged' / 'pruned_inactive' /
--                          'pruned_low_relevance').
--
-- RLS+FORCE Pattern A — same shape as `mnemo_summary` (migration 0028):
-- four policies gated on `current_setting('app.workspace_id')`, no
-- cross-tenant admin escape hatch (the dedup/prune jobs already set the
-- GUC per-workspace via `withMnemoTx`).
--
-- Note on partial-index gotcha: only IMMUTABLE expressions are allowed
-- in partial-index predicates. We use `merged_into_id IS NOT NULL`
-- (IS NOT NULL is immutable) — never `now()` or STABLE functions.

CREATE TABLE IF NOT EXISTS mnemo_fact_archive (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  agent_id text,
  scope text NOT NULL,
  scope_ref text,
  kind text NOT NULL,
  subject text NOT NULL,
  statement text NOT NULL,
  confidence numeric(3,2) NOT NULL,
  pinned boolean NOT NULL DEFAULT false,
  relevance numeric(4,3) NOT NULL,
  hit_count integer NOT NULL DEFAULT 0,
  last_recalled_at timestamptz,
  source_message_ids text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}',
  original_status text NOT NULL,           -- was 'active' | 'forgotten' | 'merged'
  merged_into_id text,
  archived_at timestamptz NOT NULL DEFAULT now(),
  archive_reason text NOT NULL,            -- 'merged' | 'pruned_inactive' | 'pruned_low_relevance'
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mnemo_fact_archive_workspace
  ON mnemo_fact_archive (workspace_id);
CREATE INDEX IF NOT EXISTS idx_mnemo_fact_archive_archived_at
  ON mnemo_fact_archive (archived_at);
-- Partial index: only rows that were actually merged carry a non-NULL
-- merged_into_id; pruned rows leave it NULL. `IS NOT NULL` is IMMUTABLE
-- so this satisfies the partial-index predicate constraint.
CREATE INDEX IF NOT EXISTS idx_mnemo_fact_archive_merged_into
  ON mnemo_fact_archive (merged_into_id) WHERE merged_into_id IS NOT NULL;

ALTER TABLE mnemo_fact_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE mnemo_fact_archive FORCE  ROW LEVEL SECURITY;

CREATE POLICY mnemo_fact_archive_select ON mnemo_fact_archive FOR SELECT
  USING (workspace_id = current_setting('app.workspace_id', true)::text);

CREATE POLICY mnemo_fact_archive_insert ON mnemo_fact_archive FOR INSERT
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::text);

CREATE POLICY mnemo_fact_archive_update ON mnemo_fact_archive FOR UPDATE
  USING (workspace_id = current_setting('app.workspace_id', true)::text)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::text);

CREATE POLICY mnemo_fact_archive_delete ON mnemo_fact_archive FOR DELETE
  USING (workspace_id = current_setting('app.workspace_id', true)::text);

-- Explicit grant for app_user (the role `withMnemoTx` downgrades to).
GRANT SELECT, INSERT, UPDATE, DELETE ON mnemo_fact_archive TO app_user;
