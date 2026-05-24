-- packages/db/migrations/0002a_rename_legacy_audit_log.down.sql

ALTER TABLE audit_log_legacy
  RENAME CONSTRAINT audit_log_legacy_workspace_id_workspace_id_fk
  TO audit_log_workspace_id_workspace_id_fk;

ALTER INDEX IF EXISTS audit_log_legacy_pkey RENAME TO audit_log_pkey;

ALTER TABLE audit_log_legacy RENAME TO audit_log;
