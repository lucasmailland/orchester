-- packages/db/migrations/0002a_rename_legacy_audit_log.sql
--
-- Tenant Hardening Sub-spec 1, Phase A — Task A.3 prerequisite.
--
-- A legacy `audit_log` table already exists in the codebase with an
-- incompatible schema (no hash chain, no actor split, no inet, etc.).
-- Rather than dropping it (and losing 12 historical rows in dev), rename
-- it to `audit_log_legacy` so the new spec'd `audit_log` table (with the
-- hash chain) can be created fresh in the next migration (0002b).
--
-- Historical rows are migrated into the new schema in 0002c with placeholder
-- zero hashes and an action prefix of `legacy.` so the chain verifier knows
-- to skip them.

ALTER TABLE audit_log RENAME TO audit_log_legacy;

ALTER INDEX IF EXISTS audit_log_pkey RENAME TO audit_log_legacy_pkey;

-- Rename the workspace FK constraint so the new audit_log can claim the
-- canonical constraint name.
ALTER TABLE audit_log_legacy
  RENAME CONSTRAINT audit_log_workspace_id_workspace_id_fk
  TO audit_log_legacy_workspace_id_workspace_id_fk;
