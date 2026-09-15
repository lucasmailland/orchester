-- packages/db/migrations/0032_mnemosyne_review_queue.sql
--
-- Mnemosyne v1.3 — active learning review queue. Each row is one
-- candidate fact that needs human attention: either we couldn't
-- auto-resolve a contradiction (no LLM judge available — Mode A/B)
-- or the daily review-sweep cron flagged a low-confidence inactive
-- fact for human triage.
--
-- The queue is decoupled from `mnemo_fact` so a fact can move to the
-- archive (merged / pruned) without breaking referential integrity on
-- a pending review row. The reviewer UI resolves the row by setting
-- `resolved_at + resolved_by + resolution`; the fact itself is mutated
-- via the existing fact CRUD path so the audit log captures the change.
--
-- RLS+FORCE Pattern A — same shape as `mnemo_summary`,
-- `mnemo_health`, `mnemo_fact_archive`. Every read/write goes through
-- `withMnemoTx(workspaceId, ...)` which sets the GUC and downgrades
-- the role to `app_user`.

CREATE TABLE IF NOT EXISTS mnemo_review_queue (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  -- No FK to `mnemo_fact`: the fact may move to `mnemo_fact_archive`
  -- between enqueue and resolve (the janitor crons don't block on the
  -- queue). The UI handles the "fact gone" case gracefully.
  fact_id text NOT NULL,
  -- 'low_confidence' = swept by the daily cron (confidence < 0.5 +
  --   never pinned + not already queued).
  -- 'contradiction'  = `saveFactWithCandidates` flagged judgmentRequired
  --   and no LLM judge was available to auto-resolve.
  -- 'manual'         = a UI user explicitly added the row.
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- NULL while the row is open. Set together with `resolved_by` +
  -- `resolution` when a reviewer acts on it.
  resolved_at timestamptz,
  resolved_by text,
  -- 'kept'      = no change to the fact.
  -- 'edited'    = reviewer mutated the fact via the inspector UI.
  -- 'forgotten' = reviewer marked status='forgotten' on the fact.
  -- 'dismissed' = "don't show me this again" — fact stays as-is.
  resolution text
);

-- The UI's primary query is "give me the open queue for this workspace".
-- Partial index keeps the index hot only for unresolved rows; resolved
-- rows are read at most once (audit trail) and don't need indexing.
CREATE INDEX IF NOT EXISTS idx_mnemo_review_queue_workspace_unresolved
  ON mnemo_review_queue (workspace_id) WHERE resolved_at IS NULL;

ALTER TABLE mnemo_review_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE mnemo_review_queue FORCE  ROW LEVEL SECURITY;

CREATE POLICY mnemo_review_queue_select ON mnemo_review_queue FOR SELECT
  USING (workspace_id = current_setting('app.workspace_id', true)::text);

CREATE POLICY mnemo_review_queue_insert ON mnemo_review_queue FOR INSERT
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::text);

CREATE POLICY mnemo_review_queue_update ON mnemo_review_queue FOR UPDATE
  USING (workspace_id = current_setting('app.workspace_id', true)::text)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::text);

CREATE POLICY mnemo_review_queue_delete ON mnemo_review_queue FOR DELETE
  USING (workspace_id = current_setting('app.workspace_id', true)::text);

-- Explicit grant for app_user (the role `withMnemoTx` downgrades to).
GRANT SELECT, INSERT, UPDATE, DELETE ON mnemo_review_queue TO app_user;
