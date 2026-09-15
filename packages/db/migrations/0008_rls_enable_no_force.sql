-- packages/db/migrations/0008_rls_enable_no_force.sql
--
-- Enable Row Level Security on all tenant tables with policies that allow
-- access when workspace_id matches the session GUC `app.workspace_id`
-- (set via current_workspace_id()) OR the session is flagged as a
-- cross-tenant admin (is_cross_tenant_admin()).
--
-- NOT FORCED: superusers and table owners (incl. `orchester`) still bypass.
-- Phase C will switch to FORCE ROW LEVEL SECURITY once all call sites have
-- been migrated to use app_user (which lacks BYPASSRLS).
--
-- Table-name adjustments vs plan: integration → workspace_integration,
-- webhook_out → outbound_webhook (this codebase uses those names).

CREATE OR REPLACE FUNCTION apply_pattern_a(tbl text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format($f$
    CREATE POLICY %1$I_tenant_select ON %1$I FOR SELECT
    USING (workspace_id = current_workspace_id() OR is_cross_tenant_admin())
  $f$, tbl);
  EXECUTE format($f$
    CREATE POLICY %1$I_tenant_insert ON %1$I FOR INSERT
    WITH CHECK (workspace_id = current_workspace_id() OR is_cross_tenant_admin())
  $f$, tbl);
  EXECUTE format($f$
    CREATE POLICY %1$I_tenant_update ON %1$I FOR UPDATE
    USING (workspace_id = current_workspace_id() OR is_cross_tenant_admin())
    WITH CHECK (workspace_id = current_workspace_id() OR is_cross_tenant_admin())
  $f$, tbl);
  EXECUTE format($f$
    CREATE POLICY %1$I_tenant_delete ON %1$I FOR DELETE
    USING (workspace_id = current_workspace_id() OR is_cross_tenant_admin())
  $f$, tbl);
END;
$$;

-- Apply to direct-workspace_id tables
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'team','agent','channel','employee','conversation',
    'flow','flow_run','workspace_integration','api_key',
    'knowledge_base','knowledge_doc','knowledge_chunk',
    'agent_memory','audit_log','feature_flag',
    'gdpr_export_job','conversation_label','notification_pref',
    'ai_provider','outbound_webhook','security_event'
  ]
  LOOP
    PERFORM apply_pattern_a(tbl);
  END LOOP;
END$$;

-- Pattern B (JOIN): message → conversation
ALTER TABLE message ENABLE ROW LEVEL SECURITY;

CREATE POLICY message_tenant_select ON message FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM conversation c
      WHERE c.id = message.conversation_id
        AND (c.workspace_id = current_workspace_id() OR is_cross_tenant_admin())
    )
  );

CREATE POLICY message_tenant_insert ON message FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversation c
      WHERE c.id = message.conversation_id
        AND (c.workspace_id = current_workspace_id() OR is_cross_tenant_admin())
    )
  );

CREATE POLICY message_tenant_update ON message FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM conversation c
      WHERE c.id = message.conversation_id
        AND (c.workspace_id = current_workspace_id() OR is_cross_tenant_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversation c
      WHERE c.id = message.conversation_id
        AND (c.workspace_id = current_workspace_id() OR is_cross_tenant_admin())
    )
  );

CREATE POLICY message_tenant_delete ON message FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM conversation c
      WHERE c.id = message.conversation_id
        AND (c.workspace_id = current_workspace_id() OR is_cross_tenant_admin())
    )
  );

-- Pattern C: workspace + workspace_member
ALTER TABLE workspace ENABLE ROW LEVEL SECURITY;

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

CREATE POLICY workspace_owner_update ON workspace FOR UPDATE
  USING (id = current_workspace_id() OR is_cross_tenant_admin())
  WITH CHECK (id = current_workspace_id() OR is_cross_tenant_admin());

CREATE POLICY workspace_owner_delete ON workspace FOR DELETE
  USING (id = current_workspace_id() OR is_cross_tenant_admin());

CREATE POLICY workspace_insert_any ON workspace FOR INSERT
  WITH CHECK (true);
  -- INSERT on workspace is special: no tenant exists yet. Application enforces
  -- that the creator becomes the owner.

ALTER TABLE workspace_member ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_member_tenant ON workspace_member FOR ALL
  USING (
    workspace_id = current_workspace_id()
    OR is_cross_tenant_admin()
    OR (user_id = current_setting('app.user_id', true)::text)
  )
  WITH CHECK (
    workspace_id = current_workspace_id()
    OR is_cross_tenant_admin()
  );

-- Pattern A also for idempotency_key (workspace_id is nullable but RLS rule works)
ALTER TABLE idempotency_key ENABLE ROW LEVEL SECURITY;
CREATE POLICY idempotency_key_tenant ON idempotency_key FOR ALL
  USING (
    workspace_id = current_workspace_id()
    OR workspace_id IS NULL
    OR is_cross_tenant_admin()
  )
  WITH CHECK (
    workspace_id = current_workspace_id()
    OR workspace_id IS NULL
    OR is_cross_tenant_admin()
  );
