-- packages/db/migrations/0006_rls_helpers.sql

CREATE OR REPLACE FUNCTION current_workspace_id()
RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT NULLIF(current_setting('app.workspace_id', true), '')::text;
$$;

COMMENT ON FUNCTION current_workspace_id() IS
  'Returns the current tenant context from session GUC. Returns NULL if unset, '
  'which causes RLS policies to evaluate to false (fail-closed).';

CREATE OR REPLACE FUNCTION is_cross_tenant_admin()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.cross_tenant_admin', true) = 'true', false);
$$;
