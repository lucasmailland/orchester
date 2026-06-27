-- 0006_rls_helpers_roles.sql
-- Recovered from 2044d27: 0006_rls_helpers.sql + 0007_postgres_roles.sql
-- GUC reader functions, apply_pattern_a generator, and the three application
-- roles (app_user / cron_admin / read_only_audit) with their GRANTs.

CREATE OR REPLACE FUNCTION current_workspace_id()
RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT NULLIF(current_setting('app.workspace_id', true), '')::text;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION is_cross_tenant_admin()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.cross_tenant_admin', true) = 'true', false);
$$;--> statement-breakpoint

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
$$;--> statement-breakpoint

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
END$$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO app_user, cron_admin, read_only_audit;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, cron_admin;--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA public TO read_only_audit;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user, cron_admin;--> statement-breakpoint
REVOKE UPDATE, DELETE ON audit_log FROM app_user;--> statement-breakpoint
REVOKE UPDATE, DELETE ON security_event FROM app_user;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cron_admin;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO read_only_audit;