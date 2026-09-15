-- 0008 down: drop all RLS policies and disable RLS on every covered table.

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'team','agent','channel','employee','conversation','message',
    'flow','flow_run','workspace_integration','api_key',
    'knowledge_base','knowledge_doc','knowledge_chunk',
    'agent_memory','audit_log','feature_flag',
    'gdpr_export_job','conversation_label','notification_pref',
    'ai_provider','outbound_webhook','security_event',
    'workspace','workspace_member','idempotency_key'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', tbl);
    -- DROP POLICIES is implicit when RLS disabled, but explicit per safety:
    EXECUTE format('DROP POLICY IF EXISTS %1$I_tenant_select ON %1$I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %1$I_tenant_insert ON %1$I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %1$I_tenant_update ON %1$I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %1$I_tenant_delete ON %1$I', tbl);
  END LOOP;
END$$;

DROP POLICY IF EXISTS workspace_member_select ON workspace;
DROP POLICY IF EXISTS workspace_owner_update ON workspace;
DROP POLICY IF EXISTS workspace_owner_delete ON workspace;
DROP POLICY IF EXISTS workspace_insert_any ON workspace;
DROP POLICY IF EXISTS workspace_member_tenant ON workspace_member;
DROP POLICY IF EXISTS idempotency_key_tenant ON idempotency_key;

DROP FUNCTION IF EXISTS apply_pattern_a(text);
