-- packages/db/migrations/0072_audit_log_hmac.sql
--
-- SEC-009: harden the audit log hash chain.
--
-- 1. hash_version: existing rows stay 1 (unkeyed sha256 chain). New rows are
--    written as 2 (HMAC chain keyed outside the database, payload also covers
--    workspace_id, actor_ip and actor_user_agent). See apps/web/lib/audit/chain.ts.
-- 2. Drop the foreign keys on workspace_id (ON DELETE CASCADE) and
--    actor_user_id (NO ACTION). Deleting a workspace used to wipe its audit
--    trail, and deleting a user with audit rows in a live workspace failed.
--    Audit rows now outlive both and leave only through retention
--    (RETENTION_AUDIT_DAYS, lib/retention.ts), which deletes by age alone.
-- 3. Index (workspace_id, created_at) for per-workspace, time-ordered reads.

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS hash_version smallint NOT NULL DEFAULT 1;

-- 0002b creates them unnamed, so Postgres names them audit_log_workspace_id_fkey
-- and audit_log_actor_user_id_fkey. Drop every FK on the table instead of
-- trusting those names, in case a database was built another way: these two
-- are the only FKs audit_log has.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'audit_log'::regclass AND contype = 'f'
  LOOP
    EXECUTE format('ALTER TABLE audit_log DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

-- This build takes a SHARE lock on audit_log (writes wait until it ends). It
-- can't be CONCURRENTLY: scripts/apply-sql-migrations.mjs runs each file
-- inside sql.begin(), and CREATE INDEX CONCURRENTLY can't run in a
-- transaction. On a large audit_log, run the migration off-peak.
CREATE INDEX IF NOT EXISTS idx_audit_workspace_created ON audit_log(workspace_id, created_at);
