-- packages/db/migrations/0073_audit_log_trim_function.sql
--
-- SEC-009: retention runs as app_user (web and worker connect with it), and
-- 0007 / 0013 revoke DELETE on audit_log and audit_log_legacy from app_user,
-- so the plain DELETE in lib/retention.ts failed with "permission denied".
-- These SECURITY DEFINER functions, owned by the migrating role, are the only
-- way app_user can delete audit rows: by age, never inside the last 30 days
-- (RETENTION_AUDIT_DAYS defaults to 365), so a compromised app connection
-- cannot wipe the recent log. app_user keeps no DELETE on either table.
--
-- audit_log_trim returns the deleted rows' chain positions: retention writes
-- an audit.retention_trimmed marker per workspace from them.
CREATE OR REPLACE FUNCTION audit_log_trim(cutoff timestamptz)
RETURNS TABLE (workspace_id text, seq bigint, chain_hash char(64))
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF cutoff IS NULL OR cutoff > now() - interval '30 days' THEN
    RAISE EXCEPTION 'audit_log_trim: cutoff must be at least 30 days ago';
  END IF;
  RETURN QUERY
    DELETE FROM public.audit_log a
    WHERE a.created_at < cutoff
    RETURNING a.workspace_id, a.seq, a.chain_hash;
END;
$$;

CREATE OR REPLACE FUNCTION audit_log_legacy_trim(cutoff timestamptz)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  n bigint;
BEGIN
  IF cutoff IS NULL OR cutoff > now() - interval '30 days' THEN
    RAISE EXCEPTION 'audit_log_legacy_trim: cutoff must be at least 30 days ago';
  END IF;
  DELETE FROM public.audit_log_legacy l WHERE l.created_at < cutoff;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION audit_log_trim(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION audit_log_legacy_trim(timestamptz) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT EXECUTE ON FUNCTION audit_log_trim(timestamptz) TO app_user;
    GRANT EXECUTE ON FUNCTION audit_log_legacy_trim(timestamptz) TO app_user;
  END IF;
END$$;
