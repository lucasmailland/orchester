-- packages/db/migrations/0037_mnemosyne_actor_id.sql
--
-- Mnemosyne v1.4 — per-conversation actor isolation. The `actor_id`
-- column on `mnemo_fact` tracks WHICH end-user the fact was learned
-- from. Today every fact belongs to the workspace; v2.0 will use this
-- to enforce per-actor read scopes ("Lucas only sees facts learned in
-- his conversations").
--
-- Nullable on purpose:
--   • NULL = workspace-shared fact (current behaviour preserved).
--   • set  = fact attributed to a specific end-user (User.id).
--
-- No FK to `user` because end-users come+go independently of facts
-- (we keep a fact's audit trail even after the user is deleted). The
-- reference is semantic, not enforced.
--
-- The partial index covers the dominant filter ("active facts for
-- workspace W and actor A"), skips the NULL rows (which are the
-- workspace-wide fallback path) and ignores forgotten rows so the
-- index stays small.

ALTER TABLE mnemo_fact
  ADD COLUMN IF NOT EXISTS actor_id text;

CREATE INDEX IF NOT EXISTS idx_mnemo_fact_actor
  ON mnemo_fact (workspace_id, actor_id)
  WHERE actor_id IS NOT NULL AND status = 'active';
