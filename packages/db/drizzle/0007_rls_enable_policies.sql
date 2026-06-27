-- 0007_rls_enable_policies.sql — recovered from 2044d27 (0008 + 0011 + 0012)
-- Pattern A: direct workspace_id column.
-- Pattern B: join through parent table.
-- Pattern C: workspace + workspace_member themselves.

-- Pattern A tables (apply_pattern_a enables + creates 4 policies each)
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'team','agent','channel','employee','conversation',
    'flow','flow_run','workspace_integration','api_key',
    'knowledge_base','knowledge_doc','knowledge_chunk',
    'agent_memory','audit_log','feature_flag',
    'gdpr_export_job','conversation_label','notification_pref',
    'ai_provider','outbound_webhook','security_event',
    'agent_tool','agent_version','flow_schedule','flow_version',
    'flow_webhook','usage_event','webhook_delivery',
    'workspace_billing','workspace_invite'
  ]
  LOOP
    PERFORM apply_pattern_a(tbl);
  END LOOP;
END$$;--> statement-breakpoint

-- Pattern B: message → conversation
ALTER TABLE message ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY message_tenant_select ON message FOR SELECT
  USING (EXISTS (SELECT 1 FROM conversation c WHERE c.id = message.conversation_id
    AND (c.workspace_id = current_workspace_id() OR is_cross_tenant_admin())));--> statement-breakpoint
CREATE POLICY message_tenant_insert ON message FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM conversation c WHERE c.id = message.conversation_id
    AND (c.workspace_id = current_workspace_id() OR is_cross_tenant_admin())));--> statement-breakpoint
CREATE POLICY message_tenant_update ON message FOR UPDATE
  USING (EXISTS (SELECT 1 FROM conversation c WHERE c.id = message.conversation_id
    AND (c.workspace_id = current_workspace_id() OR is_cross_tenant_admin())))
  WITH CHECK (EXISTS (SELECT 1 FROM conversation c WHERE c.id = message.conversation_id
    AND (c.workspace_id = current_workspace_id() OR is_cross_tenant_admin())));--> statement-breakpoint
CREATE POLICY message_tenant_delete ON message FOR DELETE
  USING (EXISTS (SELECT 1 FROM conversation c WHERE c.id = message.conversation_id
    AND (c.workspace_id = current_workspace_id() OR is_cross_tenant_admin())));--> statement-breakpoint

-- Pattern B: flow_run_step → flow_run
ALTER TABLE flow_run_step ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY flow_run_step_tenant_select ON flow_run_step FOR SELECT
  USING (EXISTS (SELECT 1 FROM flow_run fr WHERE fr.id = flow_run_step.run_id
    AND (fr.workspace_id = current_workspace_id() OR is_cross_tenant_admin())));--> statement-breakpoint
CREATE POLICY flow_run_step_tenant_insert ON flow_run_step FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM flow_run fr WHERE fr.id = flow_run_step.run_id
    AND (fr.workspace_id = current_workspace_id() OR is_cross_tenant_admin())));--> statement-breakpoint
CREATE POLICY flow_run_step_tenant_update ON flow_run_step FOR UPDATE
  USING (EXISTS (SELECT 1 FROM flow_run fr WHERE fr.id = flow_run_step.run_id
    AND (fr.workspace_id = current_workspace_id() OR is_cross_tenant_admin())))
  WITH CHECK (EXISTS (SELECT 1 FROM flow_run fr WHERE fr.id = flow_run_step.run_id
    AND (fr.workspace_id = current_workspace_id() OR is_cross_tenant_admin())));--> statement-breakpoint
CREATE POLICY flow_run_step_tenant_delete ON flow_run_step FOR DELETE
  USING (EXISTS (SELECT 1 FROM flow_run fr WHERE fr.id = flow_run_step.run_id
    AND (fr.workspace_id = current_workspace_id() OR is_cross_tenant_admin())));--> statement-breakpoint

-- Pattern C: workspace itself (id = current workspace context)
ALTER TABLE workspace ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY workspace_member_select ON workspace FOR SELECT
  USING (
    id = current_workspace_id()
    OR is_cross_tenant_admin()
    OR EXISTS (SELECT 1 FROM workspace_member m
      WHERE m.workspace_id = workspace.id
        AND m.workspace_id = current_workspace_id()
        AND m.user_id = current_setting('app.user_id', true)::text)
  );--> statement-breakpoint
CREATE POLICY workspace_owner_update ON workspace FOR UPDATE
  USING (id = current_workspace_id() OR is_cross_tenant_admin())
  WITH CHECK (id = current_workspace_id() OR is_cross_tenant_admin());--> statement-breakpoint
CREATE POLICY workspace_owner_delete ON workspace FOR DELETE
  USING (id = current_workspace_id() OR is_cross_tenant_admin());--> statement-breakpoint
CREATE POLICY workspace_insert_any ON workspace FOR INSERT WITH CHECK (true);--> statement-breakpoint

-- Pattern C: workspace_member (own rows + members of current workspace)
ALTER TABLE workspace_member ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY workspace_member_tenant ON workspace_member FOR ALL
  USING (workspace_id = current_workspace_id() OR is_cross_tenant_admin()
    OR (user_id = current_setting('app.user_id', true)::text))
  WITH CHECK (workspace_id = current_workspace_id() OR is_cross_tenant_admin());--> statement-breakpoint

-- idempotency_key: nullable workspace_id
ALTER TABLE idempotency_key ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY idempotency_key_tenant ON idempotency_key FOR ALL
  USING (workspace_id = current_workspace_id() OR workspace_id IS NULL OR is_cross_tenant_admin())
  WITH CHECK (workspace_id = current_workspace_id() OR workspace_id IS NULL OR is_cross_tenant_admin());