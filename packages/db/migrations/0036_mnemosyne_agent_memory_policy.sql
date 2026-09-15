-- packages/db/migrations/0036_mnemosyne_agent_memory_policy.sql
--
-- Mnemosyne v1.4 — per-agent memory policy. The default behaviour
-- (write_scope_default='workspace', read_scopes=['workspace','agent'])
-- preserves v1.3 semantics: facts produced by an agent are visible to
-- the workspace, and the agent can read both workspace-shared and its
-- own private facts. Workspaces that want stricter isolation can set
-- `write_scope_default='agent'` so an agent's facts stay private; an
-- agent that should never write workspace-scoped facts (e.g. an
-- exploratory research agent) can also drop 'workspace' from
-- `read_scopes`.
--
-- The third axis is `sensitive_categories`: any PII category listed
-- here (see `packages/mnemosyne/src/pii/patterns.ts`) downgrades the
-- write scope to 'agent' regardless of `write_scope_default` — so a
-- workspace can opt-in "email facts stay private to the agent that
-- learned them" without making every fact private.
--
-- Stored as jsonb (not separate columns) because the shape is
-- evolving — v2.0 plans to add `share_with_team_ids` and similar.
-- The default is held in `DEFAULT_AGENT_MEMORY_POLICY` (TS source of
-- truth) AND mirrored here so a row inserted without explicit policy
-- still gets the safe default at the DB layer.
--
-- IF NOT EXISTS guards make this safe to re-run on already-migrated
-- envs.

ALTER TABLE agent
  ADD COLUMN IF NOT EXISTS memory_policy jsonb NOT NULL DEFAULT '{
    "write_scope_default": "workspace",
    "read_scopes": ["workspace", "agent"],
    "sensitive_categories": []
  }'::jsonb;
