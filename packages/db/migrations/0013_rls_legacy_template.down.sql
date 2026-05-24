-- packages/db/migrations/0013_rls_legacy_template.down.sql

-- ============================================================
-- 3. Restore original workspace_member_tenant policy
-- ============================================================

DROP POLICY IF EXISTS workspace_member_tenant ON workspace_member;

CREATE POLICY workspace_member_tenant ON workspace_member
  FOR ALL
  USING (
    workspace_id = current_workspace_id()
    OR is_cross_tenant_admin()
    OR (user_id = current_setting('app.user_id', true))
  )
  WITH CHECK (
    workspace_id = current_workspace_id()
    OR is_cross_tenant_admin()
  );

-- ============================================================
-- 2. flow_template
-- ============================================================

DROP POLICY IF EXISTS flow_template_select ON flow_template;
DROP POLICY IF EXISTS flow_template_insert ON flow_template;
DROP POLICY IF EXISTS flow_template_update ON flow_template;
DROP POLICY IF EXISTS flow_template_delete ON flow_template;

ALTER TABLE flow_template DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- 1. audit_log_legacy
-- ============================================================

DROP POLICY IF EXISTS audit_log_legacy_select ON audit_log_legacy;

GRANT INSERT, UPDATE, DELETE ON audit_log_legacy TO app_user;

ALTER TABLE audit_log_legacy DISABLE ROW LEVEL SECURITY;
