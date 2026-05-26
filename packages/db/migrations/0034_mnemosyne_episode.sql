-- packages/db/migrations/0034_mnemosyne_episode.sql
--
-- Mnemosyne v1.4 — "The Cognitive Leap". The `mnemo_episode` table
-- stores rich timeline events: meetings, decisions, milestones,
-- multi-turn discussions that produced a cluster of facts. Distinct
-- from `mnemo_fact` because an episode carries:
--
--   • a duration (a meeting takes 45 min; a fact is a point);
--   • multiple linked facts (the participants, decisions, action
--     items extracted from that one meeting);
--   • a narrative arc — a one-paragraph LLM summary of what happened.
--
-- Many facts can reference one episode via
-- `mnemo_fact.metadata.episode_id` (set by the extraction pipeline,
-- which lives outside this migration). The `linked_fact_ids` array
-- on the episode row carries the reverse direction for cheap
-- timeline rendering without an extra join.
--
-- RLS+FORCE Pattern A — same shape as `mnemo_summary` (migration
-- 0028), `mnemo_health` (0031), `mnemo_review_queue` (0032). Four
-- policies gated on `current_setting('app.workspace_id')`. Reads/
-- writes flow through `withMnemoTx(workspaceId, …)` which downgrades
-- the tx to `app_user` (ADR-0010) so the BYPASSRLS bit on the
-- session role can't leak rows across tenants.

CREATE TABLE IF NOT EXISTS mnemo_episode (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  -- Short human-readable label: "Q2 planning meeting", "Postgres rollout
  -- decision", etc. Used in timeline lists; not searched as FTS.
  title text NOT NULL,
  -- LLM-generated one-paragraph summary of what happened. Searchable
  -- via the timeline UI; can grow over time as more facts attach.
  narrative text NOT NULL,
  occurred_at timestamptz NOT NULL,
  -- NULL for instantaneous events (a single decision logged in passing).
  duration_minutes integer,
  -- Free-form participant ids — user_ids OR agent_ids. We don't FK
  -- here because an episode may outlive a deleted participant and
  -- we'd rather keep the audit trail than cascade.
  participants text[] NOT NULL DEFAULT '{}',
  -- Topical tags ("deployment", "Q2-roadmap"). GIN-indexed below for
  -- the "?topic=" filter on the timeline route.
  topics text[] NOT NULL DEFAULT '{}',
  -- Facts (mnemo_fact.id values) that the extraction pipeline tied to
  -- this episode. Denormalised intentionally — the alternative join
  -- table (mnemo_episode_fact_link) would add a second RLS surface
  -- for negligible benefit at v1.4 cardinality.
  linked_fact_ids text[] NOT NULL DEFAULT '{}',
  -- NULL when the episode was synthesised from multiple convos (e.g.
  -- the consolidator collapsed three planning chats into one).
  source_conversation_id text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Timeline queries always scope to the workspace and sort by
-- occurred_at DESC. Composite index serves both predicates without a
-- sort step.
CREATE INDEX IF NOT EXISTS idx_mnemo_episode_workspace_occurred
  ON mnemo_episode (workspace_id, occurred_at DESC);

-- GIN on the topics array so the "?topic=foo" filter degenerates to
-- a single index hop. Necessary because the timeline UI exposes a
-- topic filter as a first-class UX surface.
CREATE INDEX IF NOT EXISTS idx_mnemo_episode_topics
  ON mnemo_episode USING gin (topics);

ALTER TABLE mnemo_episode ENABLE ROW LEVEL SECURITY;
ALTER TABLE mnemo_episode FORCE  ROW LEVEL SECURITY;

CREATE POLICY mnemo_episode_select ON mnemo_episode FOR SELECT
  USING (workspace_id = current_setting('app.workspace_id', true)::text);

CREATE POLICY mnemo_episode_insert ON mnemo_episode FOR INSERT
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::text);

CREATE POLICY mnemo_episode_update ON mnemo_episode FOR UPDATE
  USING (workspace_id = current_setting('app.workspace_id', true)::text)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::text);

CREATE POLICY mnemo_episode_delete ON mnemo_episode FOR DELETE
  USING (workspace_id = current_setting('app.workspace_id', true)::text);

-- Explicit grant for app_user (the role `withMnemoTx` downgrades to).
GRANT SELECT, INSERT, UPDATE, DELETE ON mnemo_episode TO app_user;
