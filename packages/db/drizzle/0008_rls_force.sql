-- 0008_rls_force.sql — recovered from 2044d27 (0009 + 0010 + 0014 + 0049 org policy)
-- FORCE ROW LEVEL SECURITY on every tenant table so even the table owner
-- (postgres superuser) is not exempt when connected as app_user.

ALTER TABLE agent_memory FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE knowledge_chunk FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE conversation FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE feature_flag FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE gdpr_export_job FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ai_provider FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workspace_integration FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE api_key FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE security_event FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE team FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE agent FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE channel FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE employee FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE flow FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE flow_run FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE knowledge_base FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE knowledge_doc FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE conversation_label FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE notification_pref FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE outbound_webhook FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE idempotency_key FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE agent_tool FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE agent_version FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE flow_schedule FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE flow_version FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE flow_webhook FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE usage_event FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE webhook_delivery FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workspace_billing FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workspace_invite FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE message FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE flow_run_step FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workspace FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workspace_member FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Deferrable owner-must-be-member trigger (0014)
ALTER TABLE workspace DROP CONSTRAINT IF EXISTS workspace_owner_must_be_member;--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_workspace_owner_is_member()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.owner_user_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM workspace_member
                 WHERE workspace_id = NEW.id AND user_id = NEW.owner_user_id) THEN
    RAISE EXCEPTION 'workspace owner (%) must be a member of workspace (%)',
      NEW.owner_user_id, NEW.id USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER workspace_owner_must_be_member
  AFTER INSERT OR UPDATE OF owner_user_id ON workspace
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION check_workspace_owner_is_member();--> statement-breakpoint

-- org RLS (0049)
ALTER TABLE org ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE org FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS org_read_via_workspace_membership ON org;--> statement-breakpoint
CREATE POLICY org_read_via_workspace_membership ON org FOR SELECT
  USING (id IN (SELECT org_id FROM workspace
                WHERE id = current_setting('app.workspace_id', true)));