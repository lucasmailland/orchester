-- packages/db/migrations/0064_tool_call.sql
--
-- One row per tool call: every call an agent makes through `executeTool`
-- (channel turns, the test chat, the agent API, flow agent steps, the MCP
-- server) and every real call of a flow `integration` step. It answers "which
-- agent read or wrote what, and when" after the fact: channel conversations
-- drop their tool calls once the turn ends, and flow runs keep only tool names.
--
-- Written by `apps/web/lib/activity/tool-calls.ts`, in its own workspace
-- transaction so a turn that rolls back still leaves its calls on record.
--
-- What a row holds
-- ----------------
-- `input` is a sanitized copy of what the tool was called with: keys that look
-- like credentials are dropped, long strings and arrays are cut, URL query
-- values are masked. The tool's OUTPUT is never stored; `result_size` is only
-- its JSON length. `ref` is a short pointer to the business object the call
-- was about (e.g. `odoo:4512`), so a ticket's history can be looked up.
--
-- No foreign keys to agent, flow, flow_run or conversation on purpose: the log
-- is an audit trail and must outlive what it talks about. Only the workspace
-- cascades, because deleting a workspace deletes its data.
--
-- Append-only: policies for SELECT, INSERT and DELETE (the last for a future
-- retention job), none for UPDATE, and UPDATE is revoked from app_user.
--
-- Idempotent: every DDL is guarded with IF [NOT] EXISTS.

-- ── 1. Table ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tool_call (
  id                text PRIMARY KEY,
  workspace_id      text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- Where the call came from. Mirrored in TOOL_CALL_SOURCES
  -- (apps/web/lib/activity/tool-calls.ts).
  source            text NOT NULL CHECK (source IN ('channel','test_chat','api','flow_agent','flow_step','mcp_server')),
  agent_id          text,
  conversation_id   text,
  channel_id        text,
  flow_id           text,
  flow_run_id       text,
  node_id           text,
  -- Tool name as the model saw it (`odoo_get_task`, `mcp__<key>__<tool>`), or
  -- `<integration>::<action>` for a flow step.
  tool              text NOT NULL,
  integration_type  text,
  integration_id    text,
  ref               text CHECK (char_length(ref) <= 64),
  input             jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome           text NOT NULL CHECK (outcome IN ('ok','error','refused')),
  error_code        text,
  error             text,
  duration_ms       integer NOT NULL,
  result_size       integer
);

-- The activity views list a workspace's calls newest first, optionally for one
-- agent or one integration, and look up the history of one object by `ref`.
CREATE INDEX IF NOT EXISTS tool_call_workspace_created_idx
  ON tool_call (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tool_call_workspace_agent_created_idx
  ON tool_call (workspace_id, agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tool_call_workspace_integration_created_idx
  ON tool_call (workspace_id, integration_type, created_at DESC);
CREATE INDEX IF NOT EXISTS tool_call_workspace_ref_idx
  ON tool_call (workspace_id, ref);

-- ── 2. RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE tool_call ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_call FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tool_call' AND policyname = 'tool_call_select'
  ) THEN
    EXECUTE 'CREATE POLICY tool_call_select ON tool_call FOR SELECT USING (workspace_id = current_setting(''app.workspace_id'', true)::text)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tool_call' AND policyname = 'tool_call_insert'
  ) THEN
    EXECUTE 'CREATE POLICY tool_call_insert ON tool_call FOR INSERT WITH CHECK (workspace_id = current_setting(''app.workspace_id'', true)::text)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tool_call' AND policyname = 'tool_call_delete'
  ) THEN
    EXECUTE 'CREATE POLICY tool_call_delete ON tool_call FOR DELETE USING (workspace_id = current_setting(''app.workspace_id'', true)::text)';
  END IF;
END$$;

-- The default privileges from 0007 would also hand app_user UPDATE.
GRANT SELECT, INSERT, DELETE ON tool_call TO app_user;
REVOKE UPDATE ON tool_call FROM app_user;
