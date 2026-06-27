\set ON_ERROR_STOP on

-- 1. roles exist and app_user lacks BYPASSRLS
SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_user' AND rolbypassrls=false)
            THEN 'ok' ELSE 1/0 END AS app_user_ok;

-- 2. FORCE RLS on a representative tenant table
SELECT CASE WHEN (SELECT relforcerowsecurity FROM pg_class WHERE relname='agent')
            THEN 'ok' ELSE 1/0 END AS agent_forced;

-- 3. NOSUPERUSER read is blocked when no GUC is set (fail-closed).
INSERT INTO "user"(id,email,name,email_verified) VALUES ('u_ci','ci@x.invalid','ci',true)
  ON CONFLICT DO NOTHING;
INSERT INTO org(id,name,owner_user_id) VALUES ('org_ci','ci','u_ci') ON CONFLICT DO NOTHING;
INSERT INTO workspace(id,name,slug,status,owner_user_id,org_id)
  VALUES ('ws_ci','ci','ws-ci','active','u_ci','org_ci') ON CONFLICT DO NOTHING;
INSERT INTO workspace_member(id,workspace_id,user_id,role)
  VALUES ('m_ci','ws_ci','u_ci','owner') ON CONFLICT DO NOTHING;
INSERT INTO agent(id,workspace_id,name,role,system_prompt,status)
  VALUES ('a_ci','ws_ci','ci','r','sp','active') ON CONFLICT DO NOTHING;

BEGIN;
SET LOCAL ROLE app_user;
SELECT CASE WHEN (SELECT count(*) FROM agent) = 0 THEN 'ok' ELSE 1/0 END AS blocked_without_guc;
ROLLBACK;
