-- packages/db/migrations/0011_rls_missing_tables.sql
--
-- Apply RLS to 10 tenant tables that were missed in migration 0008
-- and 1 Pattern-B table (flow_run_step joins through flow_run).
--
-- NOT FORCED: superusers/owners still bypass. FORCE is bundle-3 scope
-- once all app paths are confirmed to set app.workspace_id GUC.

-- Pattern A: tables with direct workspace_id column
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'agent_eval', 'agent_tool', 'agent_version',
    'flow_schedule', 'flow_version', 'flow_webhook',
    'usage_event', 'webhook_delivery',
    'workspace_billing', 'workspace_invite'
  ]
  LOOP
    PERFORM apply_pattern_a(tbl);
  END LOOP;
END$$;

-- Pattern B: flow_run_step → flow_run (no workspace_id column, FK via run_id)
ALTER TABLE flow_run_step ENABLE ROW LEVEL SECURITY;

CREATE POLICY flow_run_step_tenant_select ON flow_run_step FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM flow_run fr
      WHERE fr.id = flow_run_step.run_id
        AND (fr.workspace_id = current_workspace_id() OR is_cross_tenant_admin())
    )
  );

CREATE POLICY flow_run_step_tenant_insert ON flow_run_step FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM flow_run fr
      WHERE fr.id = flow_run_step.run_id
        AND (fr.workspace_id = current_workspace_id() OR is_cross_tenant_admin())
    )
  );

CREATE POLICY flow_run_step_tenant_update ON flow_run_step FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM flow_run fr
      WHERE fr.id = flow_run_step.run_id
        AND (fr.workspace_id = current_workspace_id() OR is_cross_tenant_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM flow_run fr
      WHERE fr.id = flow_run_step.run_id
        AND (fr.workspace_id = current_workspace_id() OR is_cross_tenant_admin())
    )
  );

CREATE POLICY flow_run_step_tenant_delete ON flow_run_step FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM flow_run fr
      WHERE fr.id = flow_run_step.run_id
        AND (fr.workspace_id = current_workspace_id() OR is_cross_tenant_admin())
    )
  );
