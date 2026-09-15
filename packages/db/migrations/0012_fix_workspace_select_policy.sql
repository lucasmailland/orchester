-- packages/db/migrations/0012_fix_workspace_select_policy.sql
--
-- Fix audit finding M-2: workspace_member_select policy allowed user A
-- (member of WS-1 and WS-2) with GUC app.workspace_id='ws-1' to read
-- the WS-2 row because the EXISTS clause was not scoped to the current
-- workspace GUC. Fix: add `m.workspace_id = current_workspace_id()` to
-- the EXISTS clause so multi-tenant members can only see the workspace
-- that matches the active session context.

DROP POLICY IF EXISTS workspace_member_select ON workspace;

CREATE POLICY workspace_member_select ON workspace FOR SELECT
  USING (
    id = current_workspace_id()
    OR is_cross_tenant_admin()
    OR EXISTS (
      SELECT 1 FROM workspace_member m
      WHERE m.workspace_id = workspace.id
        AND m.workspace_id = current_workspace_id()
        AND m.user_id = current_setting('app.user_id', true)::text
    )
  );
