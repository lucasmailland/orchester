-- packages/db/migrations/0007_postgres_roles.sql
-- NOTE: requires superuser to execute. Run via psql with admin credentials.
-- Passwords below are dev-only literals; production must use secret manager.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOINHERIT LOGIN PASSWORD 'app';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cron_admin') THEN
    CREATE ROLE cron_admin NOINHERIT LOGIN PASSWORD 'cron' BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'read_only_audit') THEN
    CREATE ROLE read_only_audit NOINHERIT LOGIN PASSWORD 'audit';
  END IF;
END$$;

GRANT CONNECT ON DATABASE orchester TO app_user, cron_admin, read_only_audit;
GRANT USAGE ON SCHEMA public TO app_user, cron_admin, read_only_audit;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, cron_admin;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO read_only_audit;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user, cron_admin;

REVOKE UPDATE, DELETE ON audit_log FROM app_user;
REVOKE UPDATE, DELETE ON security_event FROM app_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cron_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO read_only_audit;
