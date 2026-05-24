-- packages/db/migrations/0011_rls_missing_tables.down.sql

-- Pattern B: flow_run_step
DROP POLICY IF EXISTS flow_run_step_tenant_select ON flow_run_step;
DROP POLICY IF EXISTS flow_run_step_tenant_insert ON flow_run_step;
DROP POLICY IF EXISTS flow_run_step_tenant_update ON flow_run_step;
DROP POLICY IF EXISTS flow_run_step_tenant_delete ON flow_run_step;
ALTER TABLE flow_run_step DISABLE ROW LEVEL SECURITY;

-- Pattern A tables
DO $$
DECLARE
  tbl  text;
  op   text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'agent_eval', 'agent_tool', 'agent_version',
    'flow_schedule', 'flow_version', 'flow_webhook',
    'usage_event', 'webhook_delivery',
    'workspace_billing', 'workspace_invite'
  ]
  LOOP
    FOREACH op IN ARRAY ARRAY['select','insert','update','delete']
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %1$I ON %2$I',
                     tbl || '_tenant_' || op, tbl);
    END LOOP;
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', tbl);
  END LOOP;
END$$;
