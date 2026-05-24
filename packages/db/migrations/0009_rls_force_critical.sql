-- packages/db/migrations/0009_rls_force_critical.sql
--
-- Phase C.2 — FORCE ROW LEVEL SECURITY on the highest-risk tenant tables.
-- Up to now (migration 0008) RLS was ENABLED but not FORCED, which means
-- the table owner (the `orchester` superuser used by `getDb()`) bypassed
-- the policy entirely. FORCE removes that loophole: every write/read
-- must satisfy the existing tenant_select/insert/update/delete policies
-- — no exceptions for owners or app_user.
--
-- Pre-condition: lib/audit/log.ts and lib/tenant/cron.ts now SET
-- app.workspace_id / app.cross_tenant_admin LOCAL inside their own
-- transactions (commit 930c441). Without that pre-flight, the writes
-- below would start rejecting from the moment this migration applies.
--
-- Table-name notes (vs the original plan draft):
--   integration  → workspace_integration
--   message: FORCE deferred — message has no workspace_id column and
--            uses Pattern B (JOIN through conversation). Phase C.2 is
--            scoped to direct-workspace_id tables; message lives in
--            0010 once we validate the JOIN policy under FORCE.

ALTER TABLE agent_memory FORCE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunk FORCE ROW LEVEL SECURITY;
ALTER TABLE conversation FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
ALTER TABLE feature_flag FORCE ROW LEVEL SECURITY;
ALTER TABLE gdpr_export_job FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_provider FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_integration FORCE ROW LEVEL SECURITY;
ALTER TABLE api_key FORCE ROW LEVEL SECURITY;
ALTER TABLE security_event FORCE ROW LEVEL SECURITY;
