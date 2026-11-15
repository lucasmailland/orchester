-- packages/db/migrations/0070_default_roles_nologin.sql
--
-- 0007 creates three login roles with passwords that are in this public
-- repository: app_user/app, cron_admin/cron (BYPASSRLS) and
-- read_only_audit/audit. Anyone who can reach the database could log in with
-- them.
--
-- cron_admin and read_only_audit are never used to connect: the app reaches
-- cross-tenant data through a setting on its own connection
-- (lib/tenant/cron.ts), and tests take the roles with SET ROLE, which does not
-- need LOGIN. Both stop accepting logins; their grants stay.
--
-- app_user is the role the app connects with, so it keeps LOGIN: rotating its
-- password is an operator step (the app warns at boot while it is the
-- default). See deploy/docker-compose.prod.yml APP_DB_PASSWORD.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'cron_admin') THEN
    ALTER ROLE cron_admin NOLOGIN;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'read_only_audit') THEN
    ALTER ROLE read_only_audit NOLOGIN;
  END IF;
END$$;
