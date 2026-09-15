-- packages/db/migrations/0012_fix_workspace_select_policy.down.sql
--
-- Restore the original (un-scoped) workspace_member_select policy from 0008.

DROP POLICY IF EXISTS workspace_member_select ON workspace;

CREATE POLICY workspace_member_select ON workspace FOR SELECT
  USING (
    id = current_workspace_id()
    OR is_cross_tenant_admin()
    OR EXISTS (
      SELECT 1 FROM workspace_member m
      WHERE m.workspace_id = workspace.id
        AND m.user_id = current_setting('app.user_id', true)::text
    )
  );
