-- packages/db/migrations/0013_rls_legacy_template.sql
--
-- R2-A audit fixes:
--   1. Enable RLS on audit_log_legacy (CRITICAL: 12 rows leaked cross-tenant).
--      Table is read-only post-migration-0002c; revoke write privileges from app_user.
--   2. Enable RLS on flow_template with NULL-aware SELECT (global templates have
--      workspace_id IS NULL and must remain visible to all authenticated sessions).
--   3. Replace workspace_member_tenant SELECT clause to scope the self-lookup
--      (user_id = current_user) to current_workspace_id() so a user who is a
--      member of multiple workspaces cannot read rows from other workspaces via
--      the self-access path alone.

-- ============================================================
-- 1. audit_log_legacy
-- ============================================================

ALTER TABLE audit_log_legacy ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log_legacy FORCE ROW LEVEL SECURITY;

-- Pattern A: workspace-scoped SELECT, no writes allowed from app_user
CREATE POLICY audit_log_legacy_select ON audit_log_legacy
  FOR SELECT
  USING (
    workspace_id = current_workspace_id()
    OR is_cross_tenant_admin()
  );

-- Revoke write operations — this table is append-only via the migration path
-- and must never accept application-layer mutations
REVOKE INSERT, UPDATE, DELETE ON audit_log_legacy FROM app_user;

-- ============================================================
-- 2. flow_template
-- ============================================================

ALTER TABLE flow_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_template FORCE ROW LEVEL SECURITY;

-- NULL-aware SELECT: workspace_id IS NULL means a global/cross-tenant template
CREATE POLICY flow_template_select ON flow_template
  FOR SELECT
  USING (
    workspace_id = current_workspace_id()
    OR workspace_id IS NULL
    OR is_cross_tenant_admin()
  );

CREATE POLICY flow_template_insert ON flow_template
  FOR INSERT
  WITH CHECK (
    workspace_id = current_workspace_id()
    OR is_cross_tenant_admin()
  );

CREATE POLICY flow_template_update ON flow_template
  FOR UPDATE
  USING (
    workspace_id = current_workspace_id()
    OR is_cross_tenant_admin()
  )
  WITH CHECK (
    workspace_id = current_workspace_id()
    OR is_cross_tenant_admin()
  );

CREATE POLICY flow_template_delete ON flow_template
  FOR DELETE
  USING (
    workspace_id = current_workspace_id()
    OR is_cross_tenant_admin()
  );

-- ============================================================
-- 3. Fix workspace_member SELECT self-clause
--
-- The v1.1 fix (migration 0012) tightened the workspace.workspace_member_select
-- policy on the *workspace* table, but the workspace_member table's own policy
-- still has an unscoped self-clause:
--   user_id = current_setting('app.user_id', true)
-- Without scoping to current_workspace_id(), a user belonging to WS-1 and WS-2
-- with GUC app.workspace_id='ws-1' can read their WS-2 member row via this path.
--
-- Fix: scope the self-access branch to current_workspace_id().
-- ============================================================

DROP POLICY IF EXISTS workspace_member_tenant ON workspace_member;

CREATE POLICY workspace_member_tenant ON workspace_member
  FOR ALL
  USING (
    workspace_id = current_workspace_id()
    OR is_cross_tenant_admin()
    OR (
      workspace_id = current_workspace_id()
      AND user_id = current_setting('app.user_id', true)
    )
  )
  WITH CHECK (
    workspace_id = current_workspace_id()
    OR is_cross_tenant_admin()
  );
